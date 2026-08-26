import { query, body } from 'express-validator';

import { RAYON_MIN_M, RAYON_MAX_M, LIMITE_MAX } from '../services/geo.service.js';

/**
 * Validation des recherches geographiques.
 *
 * PIEGE RECURRENT DE CE PROJET : l'ordre des coordonnees.
 * L'API du navigateur expose `coords.latitude` puis `coords.longitude` ;
 * GeoJSON — donc MongoDB — attend l'inverse. Une inversion ne leve aucune
 * erreur, elle place simplement le point ailleurs sur la planete. Les bornes
 * ci-dessous ne l'attrapent que partiellement : une latitude de 45 est une
 * longitude parfaitement valide. Les parametres sont donc nommes
 * explicitement `lng` et `lat`, jamais un tableau positionnel.
 */
export const reglesRecherche = [
  query('lng')
    .exists()
    .withMessage('La longitude est requise')
    .bail()
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude invalide : attendu entre -180 et 180')
    .toFloat(),

  query('lat')
    .exists()
    .withMessage('La latitude est requise')
    .bail()
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude invalide : attendu entre -90 et 90')
    .toFloat(),

  query('rayon')
    .optional()
    .isInt({ min: RAYON_MIN_M, max: RAYON_MAX_M })
    .withMessage(
      `Le rayon doit être compris entre ${RAYON_MIN_M / 1000} et ${RAYON_MAX_M / 1000} km`
    )
    .toInt(),

  query('sport')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Sport invalide')
    .escape(),

  query('certifies').optional().isBoolean().toBoolean(),
  query('offre').optional().isBoolean().toBoolean(),

  query('limite').optional().isInt({ min: 1, max: LIMITE_MAX }).toInt(),
];

/** Consentement a figurer sur la carte publique. */
export const reglesCarteVisible = [
  body('carteVisible')
    .exists()
    .withMessage('Le champ carteVisible est requis')
    .bail()
    .isBoolean()
    .withMessage('carteVisible doit être un booléen')
    .toBoolean(),
];
