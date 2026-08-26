import User from '../models/User.js';

/**
 * ===========================================================================
 *  RECHERCHE GEOGRAPHIQUE
 * ===========================================================================
 *
 * Alimente la carte des coachs. Toute la logique de proximite vit ici : les
 * controleurs expriment une intention, ce service la traduit en agregation.
 */

/** Rayon minimal accepte, en metres. */
export const RAYON_MIN_M = 1000; //   1 km

/** Rayon maximal accepte, en metres. */
export const RAYON_MAX_M = 100000; // 100 km

/** Rayon applique quand l'appelant n'en fournit pas. */
export const RAYON_DEFAUT_M = 25000; // 25 km

/** Nombre de marqueurs renvoyes au maximum. */
export const LIMITE_MAX = 100;

/**
 * Coachs situes autour d'un point, du plus proche au plus lointain.
 *
 * POURQUOI `$geoNear` EN AGREGATION PLUTOT QUE `$near` EN REQUETE.
 * Les deux savent trier par distance et respecter un rayon. Un seul sait
 * RENVOYER la distance calculee : `$geoNear` la depose dans le champ nomme
 * par `distanceField`. Avec `$near`, il faudrait la recalculer cote client —
 * donc lui livrer la position exacte, exactement ce qu'on refuse de faire.
 * MongoDB calcule sur les coordonnees reelles, l'API ne publie que l'arrondi.
 *
 * CONTRAINTES DE `$geoNear`, qui expliquent la forme du code :
 *   - il doit etre le PREMIER etage du pipeline, sans exception ;
 *   - il n'accepte qu'un seul index geospatial dans la collection ;
 *   - `query` filtre AVANT le tri par distance, ce qui est bien plus
 *     economique qu'un `$match` place apres.
 *
 * @param {object} options
 * @param {number[]} options.centre        [longitude, latitude]
 * @param {number} [options.rayonM]        rayon en metres
 * @param {string} [options.sport]         filtre sur un sport pratique
 * @param {boolean} [options.certifiesSeuls]
 * @param {boolean} [options.avecOffre]    seulement ceux qui vendent du premium
 * @param {number} [options.limite]
 * @returns {Promise<Array>} vues « carte », distance comprise
 */
export async function coachsAutourDe({
  centre,
  rayonM = RAYON_DEFAUT_M,
  sport,
  certifiesSeuls = false,
  avecOffre = false,
  limite = 50,
} = {}) {
  const rayon = Math.min(Math.max(rayonM, RAYON_MIN_M), RAYON_MAX_M);
  const nombre = Math.min(Math.max(limite, 1), LIMITE_MAX);

  /*
   * Le filtre applique AVANT le tri par distance.
   *
   * Les quatre premieres conditions ne sont pas des options : elles portent
   * les regles de confidentialite du projet.
   *
   *   carteVisible   consentement explicite du coach (module 8)
   *   visibilite     un profil prive n'apparait pas sur une carte publique
   *   isActive       un compte desactive n'existe plus pour les tiers
   *   type           seuls les coachs sont cartographies ; un sportif n'a
   *                  aucune raison d'etre localisable par des inconnus
   */
  const filtre = {
    type: 'coach',
    carteVisible: true,
    visibilite: 'public',
    isActive: true,
  };

  if (certifiesSeuls) filtre['diplome.statut'] = 'verifie';
  if (sport) filtre.sports = sport;

  // « Propose une offre » se lit sur le tarif Stripe : sans `stripePriceId`,
  // aucun paiement n'est possible, l'offre n'existe donc pas reellement.
  if (avecOffre) {
    filtre['premium.actif'] = true;
    filtre['premium.stripePriceId'] = { $ne: null };
  }

  const resultats = await User.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: centre },
        distanceField: 'distanceM',
        maxDistance: rayon,
        query: filtre,
        spherical: true,
        /*
         * `key` DESIGNE EXPLICITEMENT L'INDEX GEOGRAPHIQUE A UTILISER.
         * Il est facultatif tant que la collection n'en porte qu'un seul —
         * mais le jour ou un second index 2dsphere apparait, `$geoNear`
         * refuse de choisir et echoue : « more than one 2dsphere index, not
         * sure which to run geoNear on ». La carte tomberait alors en panne
         * au premier appel, sans qu'aucune ligne de ce fichier ait bouge.
         * Une chaine de plus ici evite cette panne a distance.
         */
        key: 'localisation',
      },
    },
    { $limit: nombre },
  ]);

  /*
   * `aggregate()` renvoie des objets bruts, pas des documents Mongoose : les
   * methodes d'instance n'y sont pas attachees. On les rehydrate pour pouvoir
   * appeler `versionCarte()` — c'est le seul endroit ou l'arrondi des
   * coordonnees est applique, et il ne doit pas etre contourne.
   */
  return resultats.map((brut) => {
    const document = User.hydrate(brut);
    return document.versionCarte(brut.distanceM);
  });
}

/**
 * Regroupement des coachs par ville.
 *
 * A QUOI CELA SERT : sur une carte dezoomee, cent marqueurs qui se
 * chevauchent ne disent rien. Un compteur par ville reste lisible. C'est
 * aussi le repli quand le visiteur refuse la geolocalisation : sans point de
 * depart, `$geoNear` n'a rien a mesurer, mais une liste de villes reste utile.
 *
 * On ne renvoie PAS de coordonnees ici, seulement des noms et des comptes :
 * le placement des pastilles est l'affaire du client.
 *
 * @param {number} [minimum] n'expose une ville qu'a partir de N coachs
 */
export async function villesAvecCoachs({ minimum = 1 } = {}) {
  return User.aggregate([
    {
      $match: {
        type: 'coach',
        carteVisible: true,
        visibilite: 'public',
        isActive: true,
        ville: { $nin: [null, ''] },
      },
    },
    {
      $group: {
        _id: { $toLower: '$ville' },
        // On garde l'orthographe d'origine pour l'affichage : le regroupement
        // se fait en minuscules pour que « lyon » et « Lyon » se rejoignent,
        // mais on n'affiche pas une ville en bas de casse.
        ville: { $first: '$ville' },
        nombre: { $sum: 1 },
        certifies: {
          $sum: { $cond: [{ $eq: ['$diplome.statut', 'verifie'] }, 1, 0] },
        },
      },
    },
    { $match: { nombre: { $gte: minimum } } },
    { $sort: { nombre: -1, ville: 1 } },
    { $limit: 200 },
    { $project: { _id: 0, ville: 1, nombre: 1, certifies: 1 } },
  ]);
}

/**
 * Sports effectivement proposes par des coachs presents sur la carte.
 *
 * Alimente le filtre de l'interface. Une liste figee en dur proposerait des
 * sports pour lesquels aucun coach n'existe : l'utilisateur filtrerait pour
 * n'obtenir aucun resultat, sans comprendre pourquoi.
 */
export async function sportsDisponibles() {
  return User.aggregate([
    {
      $match: {
        type: 'coach',
        carteVisible: true,
        visibilite: 'public',
        isActive: true,
      },
    },
    { $unwind: '$sports' },
    { $group: { _id: '$sports', nombre: { $sum: 1 } } },
    { $sort: { nombre: -1, _id: 1 } },
    { $project: { _id: 0, sport: '$_id', nombre: 1 } },
  ]);
}
