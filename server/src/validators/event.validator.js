import { body, param, query } from 'express-validator';

/**
 * Validation des événements sportifs.
 *
 * LES DATES ARRIVENT EN CHAÎNES ISO ET REPARTENT EN `Date`.
 * `toDate()` fait la conversion une fois pour toutes, ici : sans lui, le
 * contrôleur manipulerait des chaînes et la comparaison `dateFin > dateDebut`
 * se ferait alphabétiquement — « 2026-1-5 » passerait pour postérieur à
 * « 2026-12-05 ».
 */

/** Une date doit exister et être postérieure à maintenant. */
const dateFuture = (champ, libelle) =>
  body(champ)
    .exists()
    .withMessage(`${libelle} est requise`)
    .bail()
    .isISO8601()
    .withMessage(`${libelle} doit être une date valide`)
    .bail()
    .toDate()
    .custom((valeur) => valeur > new Date())
    .withMessage(`${libelle} doit être dans le futur`);

export const reglesCreation = [
  body('titre')
    .trim()
    .isLength({ min: 3, max: 120 })
    .withMessage('Le titre doit faire entre 3 et 120 caractères')
    .escape(),

  body('description')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('La description ne peut dépasser 2000 caractères')
    .escape(),

  body('sport')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Sport invalide')
    .escape(),

  body('type')
    .optional()
    .isIn(['public', 'prive'])
    .withMessage('Le type doit valoir « public » ou « prive »'),

  dateFuture('dateDebut', 'La date de début'),

  body('dateFin')
    .exists()
    .withMessage('La date de fin est requise')
    .bail()
    .isISO8601()
    .withMessage('La date de fin doit être une date valide')
    .bail()
    .toDate()
    // La comparaison se fait ici, où les deux dates sont déjà converties.
    // Le schéma la revérifie : une règle de cette importance ne doit pas
    // dépendre du seul chemin HTTP.
    .custom((fin, { req }) => !req.body.dateDebut || fin > req.body.dateDebut)
    .withMessage('La date de fin doit suivre la date de début'),

  body('lieu.ville')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('La ville est requise')
    .escape(),

  body('lieu.adresse')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('L’adresse ne peut dépasser 200 caractères')
    .escape(),

  body('lieu.codePostal')
    .optional()
    .trim()
    .isLength({ max: 10 })
    .withMessage('Code postal invalide')
    .escape(),

  /*
   * Coordonnées facultatives, mais indissociables.
   * Une longitude sans latitude ne désigne rien ; accepter l'une sans l'autre
   * produirait un point invalide que MongoDB refuserait plus loin, avec un
   * message bien moins clair que celui-ci.
   */
  body('lieu.longitude')
    .optional()
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude invalide')
    .toFloat()
    /*
     * LE CONTRÔLE DU COUPLE DOIT ÊTRE SYMÉTRIQUE.
     * Chaque chaîne étant `optional()`, elle ne s'exécute que si SON champ
     * est présent. Ne vérifier le couple que du côté latitude laissait donc
     * passer le cas inverse : une longitude seule créait un événement sans
     * coordonnées, en silence, et l'événement n'apparaissait jamais dans une
     * recherche par proximité sans que personne comprenne pourquoi.
     */
    .custom((_lng, { req }) => req.body?.lieu?.latitude !== undefined)
    .withMessage('Longitude et latitude doivent être fournies ensemble'),

  body('lieu.latitude')
    .optional()
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude invalide')
    .toFloat()
    .custom((lat, { req }) => {
      const lng = req.body?.lieu?.longitude;
      const unSeul = (lat === undefined) !== (lng === undefined);
      return !unSeul;
    })
    .withMessage('Longitude et latitude doivent être fournies ensemble'),

  body('capaciteMax')
    .optional({ nullable: true })
    .isInt({ min: 1, max: 10000 })
    .withMessage('La capacité doit être comprise entre 1 et 10000')
    .toInt(),
];

/** Modification : les mêmes bornes, mais tous les champs facultatifs. */
export const reglesModification = [
  body('titre').optional().trim().isLength({ min: 3, max: 120 })
    .withMessage('Le titre doit faire entre 3 et 120 caractères').escape(),

  body('description').optional().trim().isLength({ max: 2000 })
    .withMessage('La description ne peut dépasser 2000 caractères').escape(),

  body('sport').optional().trim().isLength({ min: 1, max: 50 })
    .withMessage('Sport invalide').escape(),

  body('type').optional().isIn(['public', 'prive'])
    .withMessage('Le type doit valoir « public » ou « prive »'),

  body('dateDebut').optional().isISO8601()
    .withMessage('La date de début doit être une date valide').toDate(),

  body('dateFin').optional().isISO8601()
    .withMessage('La date de fin doit être une date valide').toDate(),

  body('lieu.ville').optional().trim().isLength({ min: 1, max: 100 })
    .withMessage('Ville invalide').escape(),

  body('lieu.adresse').optional().trim().isLength({ max: 200 })
    .withMessage('L’adresse ne peut dépasser 200 caractères').escape(),

  body('capaciteMax').optional({ nullable: true }).isInt({ min: 1, max: 10000 })
    .withMessage('La capacité doit être comprise entre 1 et 10000').toInt(),
];

export const reglesAnnulation = [
  body('motifAnnulation')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Le motif ne peut dépasser 500 caractères')
    .escape(),
];

export const reglesInscription = [
  body('message')
    .optional()
    .trim()
    .isLength({ max: 300 })
    .withMessage('Le message ne peut dépasser 300 caractères')
    .escape(),
];

export const reglesIdEvenement = [
  param('id').isMongoId().withMessage('Identifiant d’événement invalide'),
];

export const reglesListe = [
  query('ville').optional().trim().isLength({ max: 100 }).escape(),
  query('sport').optional().trim().isLength({ max: 50 }).escape(),
  query('type').optional().isIn(['public', 'prive']),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limite').optional().isInt({ min: 1, max: 50 }).toInt(),
];

export const reglesProximite = [
  query('lng').exists().withMessage('La longitude est requise').bail()
    .isFloat({ min: -180, max: 180 }).withMessage('Longitude invalide').toFloat(),

  query('lat').exists().withMessage('La latitude est requise').bail()
    .isFloat({ min: -90, max: 90 }).withMessage('Latitude invalide').toFloat(),

  query('rayon').optional().isInt({ min: 1000, max: 100000 })
    .withMessage('Le rayon doit être compris entre 1 et 100 km').toInt(),

  query('sport').optional().trim().isLength({ max: 50 }).escape(),
];
