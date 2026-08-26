import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import User from '../models/User.js';
import * as geoService from '../services/geo.service.js';

/* ================================================================== *
 *  GET /api/geo/coachs
 * ================================================================== */

/**
 * Coachs autour d'un point, du plus proche au plus lointain.
 *
 * ROUTE PUBLIQUE, ET C'EST VOULU. Chercher un coach pres de chez soi est
 * precisement ce qu'un visiteur non inscrit vient faire : exiger un compte
 * avant de montrer quoi que ce soit reviendrait a demander de s'engager
 * avant de savoir si l'offre existe.
 *
 * Ce que cette ouverture ne concede pas : seuls les coachs ayant coche
 * `carteVisible` apparaissent, et leur position est arrondie a ~110 m par
 * `versionCarte()`. Le service applique ces deux regles, pas ce controleur —
 * elles ne doivent pas dependre du point d'entree emprunte.
 */
export const coachsAutour = asyncHandler(async (req, res) => {
  const { lng, lat, rayon, sport, certifies, offre, limite } = req.query;

  const coachs = await geoService.coachsAutourDe({
    centre: [lng, lat],
    rayonM: rayon,
    sport,
    certifiesSeuls: certifies,
    avecOffre: offre,
    limite,
  });

  return res.json({
    succes: true,
    // Le rayon reellement applique est renvoye : le service borne la valeur
    // demandee, et l'interface doit dessiner le cercle qui correspond a ce
    // qu'elle a obtenu, pas a ce qu'elle avait demande.
    rayonApplique: Math.min(
      Math.max(rayon || geoService.RAYON_DEFAUT_M, geoService.RAYON_MIN_M),
      geoService.RAYON_MAX_M
    ),
    centre: [lng, lat],
    nombre: coachs.length,
    coachs,
  });
});

/* ================================================================== *
 *  GET /api/geo/villes
 * ================================================================== */

/**
 * Villes ou des coachs sont visibles, avec leur nombre.
 *
 * C'est le repli quand la geolocalisation est refusee ou indisponible : sans
 * point de depart, il n'y a pas de distance a mesurer, mais il reste utile de
 * savoir ou se trouvent les coachs.
 */
export const villes = asyncHandler(async (_req, res) => {
  const liste = await geoService.villesAvecCoachs();
  return res.json({ succes: true, nombre: liste.length, villes: liste });
});

/* ================================================================== *
 *  GET /api/geo/sports
 * ================================================================== */

/** Sports effectivement proposes, pour alimenter le filtre de l'interface. */
export const sports = asyncHandler(async (_req, res) => {
  const liste = await geoService.sportsDisponibles();
  return res.json({ succes: true, sports: liste });
});

/* ================================================================== *
 *  PATCH /api/geo/carte-visible
 * ================================================================== */

/**
 * Consentement du coach a figurer sur la carte publique.
 *
 * ON REFUSE D'ACTIVER SANS POSITION ENREGISTREE.
 * Accepter silencieusement laisserait le coach convaincu d'etre sur la carte
 * alors qu'aucune requete geographique ne peut le trouver : `$geoNear` ignore
 * les documents sans coordonnees. Un succes qui ne produit rien est pire
 * qu'un refus explique.
 */
export const definirCarteVisible = asyncHandler(async (req, res) => {
  const { carteVisible } = req.body;

  if (carteVisible && !req.user.localisation?.coordinates) {
    throw ApiError.badRequest(
      'Renseignez d’abord votre position pour apparaître sur la carte'
    );
  }

  await User.updateOne({ _id: req.user._id }, { carteVisible });

  return res.json({
    succes: true,
    carteVisible,
    message: carteVisible
      ? 'Vous apparaissez désormais sur la carte des coachs'
      : 'Vous n’apparaissez plus sur la carte',
  });
});
