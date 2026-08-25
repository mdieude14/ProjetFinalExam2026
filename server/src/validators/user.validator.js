import { body, param, query } from 'express-validator';

/**
 * Regles de validation des routes de profil et de moderation.
 *
 * PRINCIPE DE LA LISTE BLANCHE
 * Ces regles ne servent pas seulement a rejeter des valeurs aberrantes :
 * elles definissent quels champs existent. Le controleur d'edition ne recopie
 * que les champs listes ici. Un client qui glisserait `"type": "admin"` ou
 * `"stats": { "followersCount": 99999 }` dans son corps de requete verrait
 * ces cles simplement ignorees.
 *
 * C'est plus sur qu'une liste noire : oublier d'interdire un champ sensible
 * est une faille, oublier d'autoriser un champ anodin n'est qu'un bug visible
 * immediatement.
 */

/* ------------------------------------------------------------------ *
 *  EDITION DU PROFIL
 * ------------------------------------------------------------------ */

export const reglesEditionProfil = [
  body('nom')
    .optional()
    .trim()
    .notEmpty().withMessage('Le nom ne peut pas être vide')
    .isLength({ max: 50 }).withMessage('Le nom ne peut dépasser 50 caractères')
    .escape(),

  body('prenom')
    .optional()
    .trim()
    .notEmpty().withMessage('Le prénom ne peut pas être vide')
    .isLength({ max: 50 }).withMessage('Le prénom ne peut dépasser 50 caractères')
    .escape(),

  body('bio')
    .optional()
    .trim()
    .isLength({ max: 300 }).withMessage('La bio ne peut dépasser 300 caractères')
    .escape(),

  body('ville')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Nom de ville trop long')
    .escape(),

  body('sports')
    .optional()
    .isArray({ max: 10 }).withMessage('Maximum 10 sports'),

  body('sports.*')
    .optional()
    .trim()
    .isLength({ min: 1, max: 40 }).withMessage('Nom de sport invalide')
    .escape(),

  // Le pseudo est modifiable, mais reste soumis aux memes contraintes qu'a
  // l'inscription. L'unicite est garantie par l'index de la base, qui remonte
  // en erreur 409 via le middleware d'erreurs.
  body('pseudo')
    .optional()
    .trim()
    .toLowerCase()
    .isLength({ min: 3, max: 30 })
    .withMessage('Le pseudo doit faire entre 3 et 30 caractères')
    .matches(/^[a-z0-9._-]+$/)
    .withMessage('Pseudo invalide : lettres, chiffres, point, tiret et underscore uniquement'),
];

/* ------------------------------------------------------------------ *
 *  VISIBILITE
 * ------------------------------------------------------------------ */

export const reglesVisibilite = [
  body('visibilite')
    .isIn(['public', 'prive'])
    .withMessage('La visibilité doit valoir « public » ou « privé »'),
];

/* ------------------------------------------------------------------ *
 *  POSITION GEOGRAPHIQUE
 * ------------------------------------------------------------------ */

export const reglesLocalisation = [
  body('coordinates')
    .isArray({ min: 2, max: 2 })
    .withMessage('Coordonnees attendues au format [longitude, latitude]'),

  // Les bornes sont verifiees ici EN PLUS du validateur du schema Mongoose.
  // Le message obtenu est plus clair pour l'utilisateur, et la requete est
  // rejetee avant d'atteindre la base.
  body('coordinates.0')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude invalide (attendu entre -180 et 180)'),

  body('coordinates.1')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude invalide (attendu entre -90 et 90)'),

  body('ville')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .escape(),
];

/* ------------------------------------------------------------------ *
 *  SOUMISSION DE DIPLOME
 * ------------------------------------------------------------------ */

export const reglesDiplome = [
  body('intitule')
    .trim()
    .notEmpty().withMessage('L’intitulé du diplôme est obligatoire')
    .isLength({ max: 150 }).withMessage('Intitulé trop long')
    .escape(),

  body('organisme')
    .trim()
    .notEmpty().withMessage('L’organisme délivreur est obligatoire')
    .isLength({ max: 150 }).withMessage('Nom d’organisme trop long')
    .escape(),
];

/* ------------------------------------------------------------------ *
 *  MODERATION (ADMIN)
 * ------------------------------------------------------------------ */

export const reglesDecisionDiplome = [
  param('id').isMongoId().withMessage('Identifiant de coach invalide'),

  body('decision')
    .isIn(['verifie', 'refuse'])
    .withMessage('La decision doit valoir « vérifié » ou « refusé »'),

  // Un refus sans explication laisserait le coach sans recours : il ne
  // saurait pas quoi corriger avant de soumettre a nouveau.
  body('motifRefus')
    .if(body('decision').equals('refuse'))
    .trim()
    .notEmpty().withMessage('Un motif est obligatoire en cas de refus')
    .isLength({ max: 500 }).withMessage('Motif trop long')
    .escape(),
];

export const reglesStatutCompte = [
  param('id').isMongoId().withMessage('Identifiant utilisateur invalide'),
  body('isActive').isBoolean().withMessage('isActive doit etre un booleen'),
];

/* ------------------------------------------------------------------ *
 *  PAGINATION ET FILTRES
 * ------------------------------------------------------------------ */

export const reglesPagination = [
  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('Numéro de page invalide')
    .toInt(),

  // Plafond a 50 : sans borne haute, un appel avec limite=1000000 ferait
  // charger toute la collection en memoire (piste de deni de service).
  query('limite')
    .optional()
    .isInt({ min: 1, max: 50 }).withMessage('La limite doit être comprise entre 1 et 50')
    .toInt(),

  query('statut')
    .optional()
    .isIn(['non_soumis', 'en_attente', 'verifie', 'refuse'])
    .withMessage('Statut de diplôme inconnu'),
];
