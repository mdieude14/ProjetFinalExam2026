/**
 * ===========================================================================
 *  ÉVÉNEMENTS SPORTIFS — MODULE 9
 * ===========================================================================
 *
 *   npm run test:evenements
 *
 * Prérequis : l'API (port 5000) doit tourner et MongoDB être joignable.
 *
 * LA VÉRIFICATION QUI JUSTIFIE TOUTE L'ARCHITECTURE DU MODULE :
 * vingt personnes se ruent simultanément sur cinq places. Exactement cinq
 * doivent réussir. Ce test-là ne peut pas être remplacé par une lecture de
 * code : la concurrence ne se démontre qu'en la provoquant.
 *
 * Les comptes créés ici sont supprimés à la fin — et au démarrage, pour que
 * la suite ne dépende pas de la façon dont la précédente s'est terminée.
 * ===========================================================================
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const API = 'http://localhost:5000/api';
const DOM = '@eventtest.local';
const MDP = 'MotDePasse123';
const S = Date.now();

const resultats = [];
let sectionCourante = '';
const section = (nom) => { sectionCourante = nom; };
const ok = (libelle, condition, detail = '') =>
  resultats.push({ section: sectionCourante, libelle, ok: Boolean(condition), detail });

function afficher(interrompu) {
  let derniere = null;
  for (const r of resultats) {
    if (r.section !== derniere) { console.log(`\n--- ${r.section} ---`); derniere = r.section; }
    console.log(`${r.ok ? 'OK   ' : 'ECHEC'} ${r.libelle}${r.detail ? '  -> ' + r.detail : ''}`);
  }
  const echecs = resultats.filter((r) => !r.ok).length;
  console.log(
    `\n${resultats.length - echecs}/${resultats.length} vérifications réussies` +
      (interrompu ? `\nINTERROMPU : ${interrompu}` : '')
  );
  return echecs;
}

process.on('uncaughtException', (e) => { afficher(e.message); process.exit(1); });
process.on('unhandledRejection', (e) => { afficher(e?.message || e); process.exit(1); });

/**
 * Appel HTTP, avec réessai sur échec de TRANSPORT uniquement.
 *
 * POURQUOI UN RÉESSAI ICI, ALORS QU'IL SERAIT SUSPECT AILLEURS.
 * Cette suite lance délibérément vingt requêtes simultanées, précédées de
 * vingt créations de comptes. Une telle rafale épuise le pool de sockets
 * locales et `fetch` échoue au niveau réseau — « fetch failed », sans la
 * moindre réponse du serveur. Ce n'est pas un défaut du produit : c'est le
 * banc d'essai qui se met lui-même en difficulté.
 *
 * Le réessai ne couvre QUE ce cas. Une réponse HTTP, quel que soit son code,
 * est rendue telle quelle : réessayer un 409 ou un 403 masquerait exactement
 * ce que cette suite est chargée de mesurer.
 */
async function appel(chemin, { methode = 'GET', corps, token, essais = 3 } = {}) {
  const entetes = {};
  if (token) entetes.Authorization = `Bearer ${token}`;
  if (corps) entetes['Content-Type'] = 'application/json';

  for (let tentative = 1; ; tentative++) {
    try {
      const r = await fetch(API + chemin, {
        method: methode,
        headers: entetes,
        body: corps ? JSON.stringify(corps) : undefined,
      });
      const texte = await r.text();
      let json = null;
      try { json = JSON.parse(texte); } catch { /* réponse non JSON */ }
      return { statut: r.status, texte, json };
    } catch (erreur) {
      if (tentative >= essais) throw erreur;
      // Attente croissante, le temps que les sockets se libèrent.
      await new Promise((resoudre) => setTimeout(resoudre, 250 * tentative));
    }
  }
}

async function inscrireCompte({ type, pseudo, prenom }) {
  const r = await appel('/auth/register', {
    methode: 'POST',
    corps: {
      type, nom: 'Event', prenom, pseudo,
      email: `${pseudo}${DOM}`, password: MDP, ville: 'Lyon',
      ...(type === 'coach' ? { diplome: { intitule: 'BPJEPS', organisme: 'DRJSCS' } } : {}),
    },
  });
  return r.json?.accessToken;
}

/** Dans N jours, à l'heure ronde. */
const dansNJours = (n, heure = 10) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(heure, 0, 0, 0);
  return d.toISOString();
};

/* ------------------------- Accès direct à la base ------------------------ */

const requireServeur = createRequire(new URL('../package.json', import.meta.url));
const { MongoClient } = requireServeur('mongodb');

const uriMongo = readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .find((ligne) => ligne.startsWith('MONGO_URI='))
  .slice('MONGO_URI='.length)
  .trim()
  .replace(/^["']|["']$/g, '');

const clientMongo = new MongoClient(uriMongo, { serverSelectionTimeoutMS: 8000 });
await clientMongo.connect();
const bdd = clientMongo.db();

const motifTest = /@eventtest[.]local$/;

/** Supprime comptes, événements et inscriptions laissés par cette suite. */
async function purger() {
  const comptes = await bdd
    .collection('users')
    .find({ email: motifTest }, { projection: { _id: 1 } })
    .toArray();
  const ids = comptes.map((u) => u._id);
  if (ids.length === 0) return 0;

  const evenements = await bdd
    .collection('sportevents')
    .find({ organisateur: { $in: ids } }, { projection: { _id: 1 } })
    .toArray();
  const idsEvents = evenements.map((e) => e._id);

  await bdd.collection('eventregistrations').deleteMany({
    $or: [{ utilisateur: { $in: ids } }, { event: { $in: idsEvents } }],
  });
  await bdd.collection('sportevents').deleteMany({ _id: { $in: idsEvents } });
  await bdd.collection('users').deleteMany({ _id: { $in: ids } });
  return ids.length;
}

const restes = await purger();
if (restes > 0) console.log(`  (purge d'entrée : ${restes} compte(s) d'une exécution précédente)`);

/* ================================================================== *
 *  MISE EN PLACE
 * ================================================================== */

section('Mise en place');

const coachPseudo = `coach${S}`;
const coach2Pseudo = `coachb${S}`;
const sportifPseudo = `sportif${S}`;

const jetonCoach = await inscrireCompte({ type: 'coach', pseudo: coachPseudo, prenom: 'Chloe' });
const jetonCoach2 = await inscrireCompte({ type: 'coach', pseudo: coach2Pseudo, prenom: 'Bruno' });
const jetonSportif = await inscrireCompte({
  type: 'utilisateur', pseudo: sportifPseudo, prenom: 'Sam',
});

ok('comptes créés', Boolean(jetonCoach && jetonCoach2 && jetonSportif));

/* ================================================================== *
 *  DROITS DE CRÉATION
 * ================================================================== */

section('Droits de création');

const baseEvenement = {
  titre: 'Sortie course en bord de Saône',
  description: 'Allure modérée, 8 km.',
  sport: 'course',
  dateDebut: dansNJours(7),
  dateFin: dansNJours(7, 12),
  lieu: { ville: 'Lyon', adresse: '10 quai Rambaud', codePostal: '69002' },
};

const parSportif = await appel('/events', {
  methode: 'POST', token: jetonSportif, corps: baseEvenement,
});
ok('**création refusée à un sportif**', parSportif.statut === 403, `statut ${parSportif.statut}`);

// Le coach n'est pas encore certifié : le diplôme est en instruction.
const parNonCertifie = await appel('/events', {
  methode: 'POST', token: jetonCoach, corps: baseEvenement,
});
ok('**création refusée à un coach non certifié**', parNonCertifie.statut === 403,
  `statut ${parNonCertifie.statut}`);

const sansSession = await appel('/events', { methode: 'POST', corps: baseEvenement });
ok('création refusée sans session', sansSession.statut === 401);

// On certifie les deux coachs — la modération est couverte par `test:api`.
await bdd.collection('users').updateMany(
  { pseudo: { $in: [coachPseudo, coach2Pseudo] } },
  { $set: { 'diplome.statut': 'verifie' } }
);

const cree = await appel('/events', {
  methode: 'POST', token: jetonCoach, corps: baseEvenement,
});
ok('création acceptée pour un coach certifié', cree.statut === 201, cree.json?.message);

const idEvenement = cree.json?.evenement?._id;
ok('identifiant renvoyé', Boolean(idEvenement));
ok('sans capacité, `placesRestantes` vaut null',
  cree.json?.evenement?.placesRestantes === null);
ok('inscription ouverte à la création', cree.json?.evenement?.inscriptionOuverte === true);

/* ================================================================== *
 *  VALIDATION
 * ================================================================== */

section('Validation');

const datesInversees = await appel('/events', {
  methode: 'POST', token: jetonCoach,
  corps: { ...baseEvenement, dateDebut: dansNJours(9), dateFin: dansNJours(8) },
});
ok('**date de fin antérieure au début rejetée**', datesInversees.statut === 400,
  datesInversees.json?.details?.[0]?.message?.slice(0, 45));

const dansLePasse = await appel('/events', {
  methode: 'POST', token: jetonCoach,
  corps: { ...baseEvenement, dateDebut: dansNJours(-3), dateFin: dansNJours(-2) },
});
ok('date de début passée rejetée', dansLePasse.statut === 400);

const titreCourt = await appel('/events', {
  methode: 'POST', token: jetonCoach, corps: { ...baseEvenement, titre: 'ab' },
});
ok('titre trop court rejeté', titreCourt.statut === 400);

const sansVille = await appel('/events', {
  methode: 'POST', token: jetonCoach,
  corps: { ...baseEvenement, lieu: { adresse: 'quelque part' } },
});
ok('ville manquante rejetée', sansVille.statut === 400);

const coordonneeSeule = await appel('/events', {
  methode: 'POST', token: jetonCoach,
  corps: { ...baseEvenement, lieu: { ville: 'Lyon', longitude: 4.83 } },
});
ok('**longitude sans latitude rejetée**', coordonneeSeule.statut === 400,
  coordonneeSeule.json?.details?.[0]?.message?.slice(0, 45));

const capaciteZero = await appel('/events', {
  methode: 'POST', token: jetonCoach, corps: { ...baseEvenement, capaciteMax: 0 },
});
ok('capacité nulle rejetée', capaciteZero.statut === 400);

/* ================================================================== *
 *  INSCRIPTION — RÈGLES SIMPLES
 * ================================================================== */

section('Inscription — règles');

const surSoi = await appel(`/events/${idEvenement}/inscription`, {
  methode: 'POST', token: jetonCoach,
});
ok('**l’organisateur ne s’inscrit pas à son propre événement**', surSoi.statut === 400,
  surSoi.json?.message?.slice(0, 45));

const premiere = await appel(`/events/${idEvenement}/inscription`, {
  methode: 'POST', token: jetonSportif, corps: { message: 'Avec plaisir !' },
});
ok('inscription acceptée', premiere.statut === 201, premiere.json?.message);

const doublon = await appel(`/events/${idEvenement}/inscription`, {
  methode: 'POST', token: jetonSportif,
});
ok('**double inscription refusée (409)**', doublon.statut === 409,
  doublon.json?.message?.slice(0, 45));

const apresInscription = await appel(`/events/${idEvenement}`, { token: jetonSportif });
ok('compteur d’inscrits à 1', apresInscription.json?.evenement?.inscritsCount === 1);
ok('mon inscription exposée au front',
  apresInscription.json?.monInscription?.statut === 'inscrit');

/* La liste des participants n'est pas publique. */
ok('**liste des participants masquée au simple inscrit**',
  apresInscription.json?.participants === undefined);

const vueOrganisateur = await appel(`/events/${idEvenement}`, { token: jetonCoach });
ok('liste des participants visible pour l’organisateur',
  Array.isArray(vueOrganisateur.json?.participants) &&
    vueOrganisateur.json.participants.length === 1);

/* Désinscription puis retour. */
const desinscription = await appel(`/events/${idEvenement}/inscription`, {
  methode: 'DELETE', token: jetonSportif,
});
ok('désinscription acceptée', desinscription.statut === 200);

const apresDesinscription = await appel(`/events/${idEvenement}`, { token: jetonSportif });
ok('**la place est libérée** (compteur à 0)',
  apresDesinscription.json?.evenement?.inscritsCount === 0);

const doubleDesinscription = await appel(`/events/${idEvenement}/inscription`, {
  methode: 'DELETE', token: jetonSportif,
});
ok('double désinscription refusée', doubleDesinscription.statut === 409);

const retour = await appel(`/events/${idEvenement}/inscription`, {
  methode: 'POST', token: jetonSportif,
});
ok('retour après désistement accepté', retour.statut === 201);

const inscriptionsEnBase = await bdd.collection('eventregistrations').countDocuments({
  event: { $exists: true },
});
const miennes = await bdd.collection('eventregistrations').countDocuments({
  event: new (requireServeur('mongodb').ObjectId)(String(idEvenement)),
});
ok('**un seul document d’inscription malgré l’aller-retour**', miennes === 1,
  `${miennes} document(s)`);
ok('base cohérente', inscriptionsEnBase >= 1);

/* ================================================================== *
 *  LA VÉRIFICATION CENTRALE — SURRÉSERVATION
 * ================================================================== */

section('Concurrence — surréservation');

const PLACES = 5;
const CANDIDATS = 20;

const evenementLimite = await appel('/events', {
  methode: 'POST', token: jetonCoach,
  corps: {
    ...baseEvenement,
    titre: 'Cours collectif à places limitées',
    capaciteMax: PLACES,
  },
});
const idLimite = evenementLimite.json?.evenement?._id;
ok(`événement créé avec ${PLACES} places`, evenementLimite.statut === 201);
ok('places restantes annoncées', evenementLimite.json?.evenement?.placesRestantes === PLACES);

// Vingt comptes distincts, créés en parallèle.
const jetons = await Promise.all(
  Array.from({ length: CANDIDATS }, (_, i) =>
    inscrireCompte({ type: 'utilisateur', pseudo: `rush${S}n${i}`, prenom: `R${i}` })
  )
);
ok(`${CANDIDATS} candidats inscrits sur la plateforme`, jetons.every(Boolean));

/*
 * LE MOMENT DE VÉRITÉ.
 *
 * `Promise.all` lance les vingt requêtes sans attendre les réponses : elles
 * partent en rafale et arrivent au serveur dans un mouchoir de poche. C'est
 * exactement la situation qu'une implémentation naïve ne survit pas — chacune
 * lirait « 0 inscrit sur 5 » et conclurait qu'il reste de la place.
 */
const rafale = await Promise.all(
  jetons.map((jeton) =>
    appel(`/events/${idLimite}/inscription`, { methode: 'POST', token: jeton })
  )
);

const acceptees = rafale.filter((r) => r.statut === 201).length;
const refusees = rafale.filter((r) => r.statut === 409).length;

ok(`**exactement ${PLACES} inscriptions acceptées sur ${CANDIDATS}**`,
  acceptees === PLACES, `${acceptees} acceptées`);
ok(`${CANDIDATS - PLACES} refusées en 409`, refusees === CANDIDATS - PLACES,
  `${refusees} refusées`);
ok('aucune autre réponse inattendue', acceptees + refusees === CANDIDATS);

const apresRafale = await appel(`/events/${idLimite}`, { token: jetonSportif });
ok('**compteur exact après la rafale**',
  apresRafale.json?.evenement?.inscritsCount === PLACES,
  `${apresRafale.json?.evenement?.inscritsCount} inscrits`);
ok('plus aucune place', apresRafale.json?.evenement?.placesRestantes === 0);
ok('événement marqué complet', apresRafale.json?.evenement?.estComplet === true);
ok('inscription fermée', apresRafale.json?.evenement?.inscriptionOuverte === false);

/*
 * LE COMPTEUR DOIT CORRESPONDRE AUX DOCUMENTS RÉELS.
 * Un compteur juste avec des documents faux — ou l'inverse — signalerait que
 * la transaction n'a pas tenu les deux ensemble.
 */
const { ObjectId } = requireServeur('mongodb');
const reellementInscrits = await bdd.collection('eventregistrations').countDocuments({
  event: new ObjectId(String(idLimite)),
  statut: 'inscrit',
});
ok('**documents en base = compteur**', reellementInscrits === PLACES,
  `${reellementInscrits} documents`);

// Une place libérée doit redevenir disponible.
const jetonPremier = jetons[rafale.findIndex((r) => r.statut === 201)];
await appel(`/events/${idLimite}/inscription`, { methode: 'DELETE', token: jetonPremier });

const jetonRefuse = jetons[rafale.findIndex((r) => r.statut === 409)];
const rattrapage = await appel(`/events/${idLimite}/inscription`, {
  methode: 'POST', token: jetonRefuse,
});
ok('**une place libérée profite à un candidat refusé**', rattrapage.statut === 201,
  `statut ${rattrapage.statut}`);

/* ================================================================== *
 *  ÉVÉNEMENT PRIVÉ
 * ================================================================== */

section('Événement privé');

const prive = await appel('/events', {
  methode: 'POST', token: jetonCoach,
  corps: {
    ...baseEvenement,
    titre: 'Séance réservée aux abonnés',
    type: 'prive',
    lieu: { ville: 'Lyon', adresse: '5 rue Secrète', codePostal: '69003' },
  },
});
const idPrive = prive.json?.evenement?._id;
ok('événement privé créé', prive.statut === 201);

const vueNonAbonne = await appel(`/events/${idPrive}`, { token: jetonSportif });
ok('**adresse exacte absente pour un non-abonné**',
  !vueNonAbonne.texte.includes('rue Secrète'));
ok('verrouillage signalé au front',
  vueNonAbonne.json?.evenement?.detailsVerrouilles === true);
ok('la ville reste visible (argument commercial préservé)',
  vueNonAbonne.json?.evenement?.lieu?.ville === 'Lyon');
ok('le titre reste visible', Boolean(vueNonAbonne.json?.evenement?.titre));

const inscriptionPrive = await appel(`/events/${idPrive}/inscription`, {
  methode: 'POST', token: jetonSportif,
});
ok('**inscription refusée à un non-abonné (403)**', inscriptionPrive.statut === 403,
  inscriptionPrive.json?.message?.slice(0, 45));

const vueOrga = await appel(`/events/${idPrive}`, { token: jetonCoach });
ok('l’organisateur voit sa propre adresse',
  vueOrga.json?.evenement?.lieu?.adresse === '5 rue Secrète');

/* ================================================================== *
 *  MODIFICATION ET ANNULATION
 * ================================================================== */

section('Modification et annulation');

const parAutreCoach = await appel(`/events/${idEvenement}`, {
  methode: 'PATCH', token: jetonCoach2, corps: { titre: 'Titre détourné' },
});
ok('**modification refusée à un tiers**', parAutreCoach.statut === 403);

const modif = await appel(`/events/${idEvenement}`, {
  methode: 'PATCH', token: jetonCoach, corps: { titre: 'Sortie course — allure libre' },
});
ok('modification acceptée pour l’organisateur', modif.statut === 200);
ok('titre mis à jour',
  modif.json?.evenement?.titre?.includes('allure libre'));

const capaciteTropBasse = await appel(`/events/${idLimite}`, {
  methode: 'PATCH', token: jetonCoach, corps: { capaciteMax: 2 },
});
ok('**capacité sous le nombre d’inscrits refusée**', capaciteTropBasse.statut === 400,
  capaciteTropBasse.json?.message?.slice(0, 50));

const annulationTiers = await appel(`/events/${idEvenement}`, {
  methode: 'DELETE', token: jetonCoach2, corps: { motifAnnulation: 'non' },
});
ok('annulation refusée à un tiers', annulationTiers.statut === 403);

const annulation = await appel(`/events/${idEvenement}`, {
  methode: 'DELETE', token: jetonCoach,
  corps: { motifAnnulation: 'Alerte météo sur le secteur' },
});
ok('annulation acceptée', annulation.statut === 200);

const apresAnnulation = await appel(`/events/${idEvenement}`, { token: jetonSportif });
ok('**l’événement existe toujours après annulation**',
  apresAnnulation.statut === 200);
ok('statut « annule »', apresAnnulation.json?.evenement?.statut === 'annule');
ok('motif visible des inscrits',
  apresAnnulation.json?.evenement?.motifAnnulation?.includes('météo'));

const inscriptionAnnule = await appel(`/events/${idEvenement}/inscription`, {
  methode: 'POST', token: jetonCoach2,
});
ok('inscription impossible sur un événement annulé', inscriptionAnnule.statut === 400);

const modifApresAnnulation = await appel(`/events/${idEvenement}`, {
  methode: 'PATCH', token: jetonCoach, corps: { titre: 'Nouvelle tentative' },
});
ok('modification impossible après annulation', modifApresAnnulation.statut === 409);

/* ================================================================== *
 *  LISTES ET PROXIMITÉ
 * ================================================================== */

section('Listes et proximité');

const avecPosition = await appel('/events', {
  methode: 'POST', token: jetonCoach,
  corps: {
    ...baseEvenement,
    titre: 'Renforcement au parc de la Tête d’Or',
    lieu: {
      ville: 'Lyon', adresse: 'Parc de la Tête d’Or', codePostal: '69006',
      longitude: 4.8556, latitude: 45.7797,
    },
  },
});
ok('événement avec coordonnées créé', avecPosition.statut === 201);

const listePublique = await appel('/events?limite=50');
ok('liste accessible sans session', listePublique.statut === 200);
ok('les événements à venir y figurent',
  (listePublique.json?.elements?.length || 0) > 0,
  `${listePublique.json?.elements?.length} événements`);

const dates = (listePublique.json?.elements || []).map((e) => new Date(e.dateDebut).getTime());
ok('triés par date croissante',
  dates.every((d, i) => i === 0 || d >= dates[i - 1]));

const parVille = await appel('/events?ville=lyon&limite=50');
ok('filtre par ville insensible à la casse',
  (parVille.json?.elements?.length || 0) > 0);

const parVilleInconnue = await appel('/events?ville=Brest&limite=50');
ok('ville sans événement renvoie une liste vide',
  (parVilleInconnue.json?.elements?.length || 0) === 0);

const proches = await appel('/events/proches?lng=4.8592&lat=45.7605&rayon=5000');
ok('recherche par proximité fonctionnelle', proches.statut === 200);
ok('l’événement du parc est trouvé',
  (proches.json?.evenements || []).some((e) => e.titre?.includes('Tête')));
ok('distance renvoyée par le serveur',
  typeof proches.json?.evenements?.[0]?.distanceM === 'number',
  `${proches.json?.evenements?.[0]?.distanceM} m`);

const tropLoin = await appel('/events/proches?lng=2.3522&lat=48.8566&rayon=5000');
ok('aucun événement lyonnais depuis Paris',
  (tropLoin.json?.evenements || []).length === 0);

const rayonInvalide = await appel('/events/proches?lng=4.8&lat=45.7&rayon=999999');
ok('rayon hors bornes rejeté', rayonInvalide.statut === 400);

const sansCoordonnees = await appel('/events/proches');
ok('coordonnées manquantes rejetées', sansCoordonnees.statut === 400);

const mesInscr = await appel('/events/mes-inscriptions', { token: jetonSportif });
ok('mes inscriptions accessibles', mesInscr.statut === 200);
ok('l’inscription en cours y figure',
  (mesInscr.json?.elements?.length || 0) > 0);

const mesInscrSansSession = await appel('/events/mes-inscriptions');
ok('mes inscriptions refusées sans session', mesInscrSansSession.statut === 401);

/* ================================================================== *
 *  ORDRE DES ROUTES
 * ================================================================== */

section('Ordre des routes');

/*
 * `/events/proches` doit être lu comme un segment fixe, jamais comme
 * l'identifiant « proches ». Le piège est classique et silencieux : la route
 * répondrait 400 sur un identifiant invalide, message parfaitement
 * incompréhensible pour qui appelle une recherche par proximité.
 */
ok('**/events/proches n’est pas confondu avec un identifiant**',
  proches.statut === 200);
ok('/events/mes-inscriptions non plus', mesInscr.statut === 200);

const idInvalide = await appel('/events/pas-un-id');
ok('identifiant réellement invalide rejeté en 400', idInvalide.statut === 400);

const introuvable = await appel('/events/000000000000000000000000');
ok('événement inexistant en 404', introuvable.statut === 404);

/* ================================================================== *
 *  NETTOYAGE
 * ================================================================== */

const supprimes = await purger();
await clientMongo.close();

console.log('\n============ ÉVÉNEMENTS SPORTIFS — MODULE 9 ============');
const echecs = afficher();
console.log(`\n  (${supprimes} compte(s) de test supprimés, événements compris)`);
process.exit(echecs > 0 ? 1 : 0);
