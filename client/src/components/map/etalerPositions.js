/**
 * Écarte les marqueurs qui partagent exactement la même position.
 *
 * POURQUOI CE PROBLÈME EXISTE, ET POURQUOI IL EST DE NOTRE FAIT.
 * Le serveur arrondit les positions à trois décimales (~110 m) pour ne pas
 * publier l'adresse des coachs. Conséquence directe : deux coachs distants de
 * moins de 110 mètres reçoivent des coordonnées IDENTIQUES. Leurs marqueurs se
 * superposent au pixel près, et celui du dessous devient littéralement
 * inatteignable — impossible à cliquer, impossible à voir. Dans une salle de
 * sport ou un quartier dense, c'est le cas courant, pas l'exception.
 *
 * Le flou de confidentialité crée donc un défaut d'affichage. On ne peut pas
 * réduire le flou sans revenir sur la décision du module 8 ; on écarte donc
 * les doublons visuellement.
 *
 * COMMENT. Les marqueurs partageant une position sont disposés en cercle
 * autour d'elle. Le décalage est de l'ordre de la trentaine de mètres, très
 * en dessous du flou déjà appliqué : il ne révèle rien de plus, il rend
 * seulement chaque marqueur cliquable.
 *
 * DÉTERMINISTE, ET C'EST ESSENTIEL. Le décalage se déduit du rang dans le
 * groupe, jamais d'un tirage aléatoire : deux rendus successifs placent les
 * marqueurs au même endroit. Un `Math.random()` ferait danser la carte à
 * chaque changement de filtre.
 */

/** Rayon d'écartement, en degrés (~30 m sous nos latitudes). */
const ECART_DEG = 0.0003;

/**
 * LES ÉVÉNEMENTS CONNAISSENT LE MÊME PROBLÈME, POUR UNE AUTRE RAISON.
 * Leurs coordonnées ne sont pas floutées — un lieu de rendez-vous est public.
 * Mais un cours hebdomadaire donné dans la même salle produit une série
 * d'événements aux coordonnées *exactement* identiques : superposition, et
 * un seul marqueur cliquable sur les huit. Le remède est le même, seule la
 * façon de lire et d'écrire la position change — d'où les deux accesseurs.
 *
 * @param {Array} elements objets à placer
 * @param {object} [acces]
 * @param {Function} [acces.lire]   élément -> [longitude, latitude]
 * @param {Function} [acces.ecrire] (élément, position) -> élément ajusté
 * @returns {Array} les mêmes objets, position ajustée si nécessaire
 */
export default function etalerPositions(
  elements = [],
  {
    lire = (element) => element.position,
    ecrire = (element, position) => ({ ...element, position }),
  } = {}
) {
  // Regroupement par position publiée. La clé est la chaîne des coordonnées :
  // elles sont déjà arrondies par le serveur, la comparaison est donc exacte
  // et sans risque de flottant approximatif.
  const groupes = new Map();

  for (const element of elements) {
    const position = element && lire(element);
    if (!position) continue;
    const cle = position.join(',');
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(element);
  }

  const resultat = [];

  for (const groupe of groupes.values()) {
    // Position unique : rien à faire, on garde l'objet tel quel.
    if (groupe.length === 1) {
      resultat.push(groupe[0]);
      continue;
    }

    const [longitude, latitude] = lire(groupe[0]);

    groupe.forEach((element, rang) => {
      const angle = (2 * Math.PI * rang) / groupe.length;

      /*
       * La longitude est corrigée par le cosinus de la latitude.
       * Un degré de latitude vaut ~111 km partout ; un degré de longitude
       * rétrécit vers les pôles. Sans cette correction, le « cercle » serait
       * une ellipse aplatie — visible dès la France métropolitaine, où un
       * degré de longitude ne vaut plus que ~73 km.
       */
      const facteurLng = Math.cos((latitude * Math.PI) / 180) || 1;

      const ajuste = ecrire(element, [
        longitude + (ECART_DEG * Math.cos(angle)) / facteurLng,
        latitude + ECART_DEG * Math.sin(angle),
      ]);

      // On mémorise le partage : la fiche peut ainsi prévenir que la
      // position affichée est approchée, plutôt que de laisser croire à
      // une précision qu'elle n'a pas.
      resultat.push({ ...ajuste, positionPartagee: true });
    });
  }

  return resultat;
}
