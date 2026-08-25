import { body } from 'express-validator';

/**
 * Regles de validation des routes d'authentification.
 *
 * PRINCIPE : ne jamais faire confiance au client. La validation cote React
 * ameliore l'experience mais se contourne en trois clics dans les outils de
 * developpement ou avec un simple curl. Le serveur revalide donc tout.
 *
 * Chaque regle enchaine trois familles d'operations :
 *   - assainissement (trim, normalizeEmail, toLowerCase) qui MODIFIE la valeur
 *   - verification (isLength, matches, isIn) qui accumule les erreurs
 *   - message en francais, directement affichable par le front
 */

/* ------------------------------------------------------------------ *
 *  INSCRIPTION
 * ------------------------------------------------------------------ */

export const reglesInscription = [
  body('type')
    .optional()
    .isIn(['utilisateur', 'coach'])
    .withMessage('Le type de compte doit être « utilisateur » ou « coach »'),
  // Note : « admin » est volontairement absent de cette liste. Un compte
  // administrateur ne peut PAS etre cree via l'API, seulement en ligne de
  // commande (voir scripts/creerAdmin.js). Sans cela, n'importe qui pourrait
  // s'octroyer les droits de moderation en modifiant le corps de la requete.

  body('nom')
    .trim()
    .notEmpty().withMessage('Le nom est obligatoire')
    .isLength({ max: 50 }).withMessage('Le nom ne peut dépasser 50 caractères')
    .escape(),

  body('prenom')
    .trim()
    .notEmpty().withMessage('Le prénom est obligatoire')
    .isLength({ max: 50 }).withMessage('Le prénom ne peut dépasser 50 caractères')
    .escape(),

  body('pseudo')
    .trim()
    .toLowerCase()
    .notEmpty().withMessage('Le pseudo est obligatoire')
    .isLength({ min: 3, max: 30 })
    .withMessage('Le pseudo doit faire entre 3 et 30 caractères')
    .matches(/^[a-z0-9._-]+$/)
    .withMessage('Pseudo invalide : lettres, chiffres, point, tiret et underscore uniquement'),

  body('email')
    .trim()
    .isEmail().withMessage('Adresse email invalide')
    // normalizeEmail uniformise la casse. On desactive les traitements
    // specifiques a Gmail (suppression des points, du suffixe +alias) :
    // ils modifieraient l'adresse reellement saisie par l'utilisateur,
    // qui ne se reconnaitrait plus dans son propre compte.
    .normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false }),

  body('password')
    .isLength({ min: 8, max: 128 })
    .withMessage('Le mot de passe doit faire au moins 8 caractères')
    .matches(/[a-z]/).withMessage('Le mot de passe doit contenir une minuscule')
    .matches(/[A-Z]/).withMessage('Le mot de passe doit contenir une majuscule')
    .matches(/\d/).withMessage('Le mot de passe doit contenir un chiffre'),
  // La borne haute a 128 caracteres n'est pas cosmetique : bcrypt tronque
  // silencieusement au-dela de 72 octets, et un mot de passe tres long
  // consomme du CPU au hachage (piste de deni de service).

  body('ville')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Nom de ville trop long')
    .escape(),

  // Coordonnees facultatives a l'inscription : le navigateur peut les fournir
  // si l'utilisateur accepte la geolocalisation.
  body('localisation.coordinates')
    .optional()
    .isArray({ min: 2, max: 2 })
    .withMessage('Coordonnees attendues au format [longitude, latitude]'),

  body('localisation.coordinates.*')
    .optional()
    .isFloat().withMessage('Les coordonnees doivent être numeriques'),

  // Informations de diplome, uniquement pertinentes pour un coach.
  body('diplome.intitule')
    .optional()
    .trim()
    .isLength({ max: 150 }).withMessage('Intitulé de diplôme trop long')
    .escape(),

  body('diplome.organisme')
    .optional()
    .trim()
    .isLength({ max: 150 }).withMessage('Nom d’organisme trop long')
    .escape(),
];

/* ------------------------------------------------------------------ *
 *  CONNEXION
 * ------------------------------------------------------------------ */

/**
 * L'identifiant accepte indifferemment un email ou un pseudo : c'est ce
 * qu'attendent les utilisateurs d'un reseau social. On ne valide donc pas
 * son format, seulement sa presence.
 */
export const reglesConnexion = [
  body('identifiant')
    .trim()
    .toLowerCase()
    .notEmpty().withMessage('Email ou pseudo obligatoire'),

  body('password')
    .notEmpty().withMessage('Mot de passe obligatoire'),
];

/* ------------------------------------------------------------------ *
 *  CHANGEMENT DE MOT DE PASSE
 * ------------------------------------------------------------------ */

export const reglesChangementMotDePasse = [
  body('ancienPassword')
    .notEmpty().withMessage('Mot de passe actuel obligatoire'),

  body('nouveauPassword')
    .isLength({ min: 8, max: 128 })
    .withMessage('Le nouveau mot de passe doit faire au moins 8 caractères')
    .matches(/[a-z]/).withMessage('Le mot de passe doit contenir une minuscule')
    .matches(/[A-Z]/).withMessage('Le mot de passe doit contenir une majuscule')
    .matches(/\d/).withMessage('Le mot de passe doit contenir un chiffre')
    .custom((valeur, { req }) => valeur !== req.body.ancienPassword)
    .withMessage('Le nouveau mot de passe doit être different de l’ancien'),
];
