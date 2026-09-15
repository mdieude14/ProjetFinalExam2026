/**
 * ===========================================================================
 *  GÉOCODAGE — d'une adresse écrite vers un point géographique
 * ===========================================================================
 *
 * POURQUOI CE SERVICE EXISTE.
 * Un événement se saisit avec une ville, pas avec des coordonnées : personne
 * ne tape « 2.2410, 43.6056 » dans un formulaire. Or `$geoNear` ne sait
 * chercher qu'autour d'un POINT, et un document sans point n'entre même pas
 * dans l'index `2dsphere` — il devient introuvable géographiquement, quel que
 * soit le rayon demandé. Sans traduction de l'adresse en coordonnées,
 * l'onglet « Autour de moi » ne peut donc rien montrer.
 *
 * POURQUOI NOMINATIM PLUTÔT QU'UN SERVICE COMMERCIAL.
 * Le projet rend déjà ses cartes avec Leaflet et les tuiles OpenStreetMap :
 * géocoder ailleurs introduirait un second fournisseur, une clé d'API et une
 * facturation à l'usage pour une fonction appelée quelques fois par jour.
 * Nominatim est le service de la même fondation, sans clé.
 *
 * CE QU'IL NE FAUT PAS FAIRE AVEC LUI, et qui est écrit dans sa politique
 * d'usage : pas plus d'une requête par seconde, un `User-Agent` qui identifie
 * l'application, et aucun géocodage en masse. D'où le verrou de cadence plus
 * bas, et le script de reprise qui l'espace lui aussi.
 *
 * LA PANNE EST SILENCIEUSE, ET C'EST VOULU. Si Nominatim ne répond pas,
 * l'événement se crée quand même — sans point. Faire échouer une création
 * d'événement parce qu'un service tiers est lent punirait l'organisateur pour
 * une panne qui ne le concerne pas. L'événement reste listé dans « À venir »
 * et consultable par ville ; seul « Autour de moi » l'ignore, et le script
 * `geocoder-evenements` rattrape le manque plus tard.
 * ===========================================================================
 */

const BASE = 'https://nominatim.openstreetmap.org/search';

/** Identification exigée par la politique d'usage de Nominatim. */
const AGENT = 'CoachConnect/1.0 (projet etudiant RNCP39608)';

/** Délai minimal entre deux appels, imposé par cette même politique. */
const CADENCE_MS = 1100;

/** Au-delà, on renonce : une création d'événement ne doit pas attendre. */
const DELAI_MAX_MS = 4000;

/**
 * Horodatage du dernier appel sortant.
 *
 * Le verrou est un compteur de processus, pas un verrou distribué : deux
 * instances de l'API le contourneraient. C'est suffisant ici — le projet
 * tourne sur un seul nœud — et il faut le savoir avant de déployer en
 * plusieurs exemplaires.
 */
let dernierAppel = 0;

/** Attend, si besoin, que la cadence autorisée soit respectée. */
async function respecterCadence() {
  const attente = dernierAppel + CADENCE_MS - Date.now();
  if (attente > 0) await new Promise((r) => setTimeout(r, attente));
  dernierAppel = Date.now();
}

/**
 * Établit les tentatives à envoyer, de la plus précise à la plus générale.
 *
 * POURQUOI PLUSIEURS TENTATIVES ET NON UNE SEULE CHAÎNE.
 * Nominatim traite la chaîne EN BLOC : il ne rend rien plutôt que d'ignorer
 * le morceau qu'il ne reconnaît pas. Mesuré sur un cas réel du projet,
 * « park Gourjade, 81100, Castres » ne rend AUCUN résultat — la faute de
 * frappe sur le nom du parc fait échouer la ville avec elle. La même adresse
 * réduite à « 81100, Castres » rend le bon point. Une adresse approximative
 * ne doit pas coûter la localisation de la commune.
 *
 * POURQUOI LA VILLE SEULE EST INTERDITE QUAND UN CODE POSTAL EXISTE.
 * « Castres » seul renvoie Castres dans l'AISNE — à 430 km de Castres dans le
 * Tarn. Il existe des communes homonymes, et Nominatim tranche par importance,
 * pas par proximité. Si l'organisateur a fourni un code postal, c'est lui qui
 * départage : y renoncer placerait l'événement ailleurs en France avec
 * l'apparence d'une donnée calculée — un point faux est pire qu'un point
 * absent, parce qu'il ne se signale pas.
 *
 * Le pays est fixé par `countrycodes`, sans quoi le même piège se rejouerait
 * à l'échelle du monde.
 */
function tentatives({ adresse, codePostal, ville }) {
  const requetes = [];
  const ajouter = (...morceaux) => {
    const q = morceaux.filter(Boolean).map(String).join(', ');
    if (q && !requetes.includes(q)) requetes.push(q);
  };

  ajouter(adresse, codePostal, ville);
  ajouter(codePostal, ville);

  // Dernier recours, et seulement faute de code postal : voir ci-dessus.
  if (!codePostal) ajouter(ville);

  return requetes;
}

/** URL complète pour une chaîne de recherche donnée. */
function composerUrl(q) {
  const parametres = new URLSearchParams({
    q,
    format: 'jsonv2',
    limit: '1',
    countrycodes: 'fr',
    addressdetails: '0',
  });

  return `${BASE}?${parametres}`;
}

/**
 * Traduit une adresse en coordonnées GeoJSON.
 *
 * @param   {{ adresse?: string, codePostal?: string, ville?: string }} lieu
 * @returns {Promise<{ type: 'Point', coordinates: [number, number] } | null>}
 *          `null` dès que l'adresse est vide, introuvable, ou le service
 *          indisponible — jamais d'exception, voir l'en-tête.
 */
export async function geocoder(lieu = {}) {
  for (const q of tentatives(lieu)) {
    const point = await interroger(q);
    if (point) return point;
  }

  return null;
}

/**
 * Une tentative unique. Rend `null` sur panne, refus, ou absence de résultat —
 * jamais d'exception, pour que l'appelant puisse simplement essayer la
 * requête suivante.
 */
async function interroger(q) {
  try {
    await respecterCadence();

    const reponse = await fetch(composerUrl(q), {
      headers: { 'User-Agent': AGENT, 'Accept-Language': 'fr' },
      signal: AbortSignal.timeout(DELAI_MAX_MS),
    });

    if (!reponse.ok) {
      console.warn(`[GEOCODAGE] Nominatim a répondu ${reponse.status} pour « ${q} »`);
      return null;
    }

    const resultats = await reponse.json();
    if (!Array.isArray(resultats) || resultats.length === 0) return null;

    const longitude = Number(resultats[0].lon);
    const latitude = Number(resultats[0].lat);

    /*
     * ON VÉRIFIE CE QUE LE SERVICE RENVOIE. Une réponse malformée écrirait
     * `[NaN, NaN]` dans le document : MongoDB le refuserait à l'écriture, et
     * l'erreur remonterait comme un échec de création d'événement — soit un
     * symptôme à trois couches de sa cause.
     */
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
    if (longitude < -180 || longitude > 180) return null;
    if (latitude < -90 || latitude > 90) return null;

    // GeoJSON attend [longitude, latitude] — l'inverse de l'usage courant,
    // et l'inversion place le point dans l'océan Indien sans rien signaler.
    return { type: 'Point', coordinates: [longitude, latitude] };
  } catch (erreur) {
    const cause = erreur.name === 'TimeoutError' ? 'délai dépassé' : erreur.message;
    console.warn(`[GEOCODAGE] Échec pour « ${q} » : ${cause}`);
    return null;
  }
}
