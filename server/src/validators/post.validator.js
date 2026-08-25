import { body, param, query } from 'express-validator';

/**
 * Validation des publications, commentaires et stories.
 *
 * PARTICULARITE DES REQUETES MULTIPART.
 * Les medias arrivent en `multipart/form-data`, pas en JSON : tous les champs
 * texte parviennent au serveur sous forme de CHAINES. `estPremium` vaut donc
 * la chaine "true" ou "false", jamais un booleen. D'ou `isBoolean()` avec
 * l'option `loose`, qui accepte les deux formes, et la conversion explicite
 * faite dans les controleurs.
 */

/* ------------------------------------------------------------------ *
 *  PUBLICATIONS
 * ------------------------------------------------------------------ */

export const reglesCreationPost = [
  body('titre')
    .optional()
    .trim()
    .isLength({ max: 150 }).withMessage('Le titre ne peut depasser 150 caractères')
    .escape(),

  body('description')
    .optional()
    .trim()
    .isLength({ max: 2000 }).withMessage('La description ne peut depasser 2000 caractères')
    .escape(),

  body('estPremium')
    .optional()
    .isBoolean({ loose: true }).withMessage('estPremium doit etre un booleen'),
];

export const reglesIdPost = [
  param('id').isMongoId().withMessage('Identifiant de publication invalide'),
];

export const reglesCurseur = [
  query('curseur')
    .optional()
    .isMongoId().withMessage('Curseur de pagination invalide'),

  // Plafond a 30 : au-dela, la reponse depasse plusieurs centaines de
  // kilooctets sur un fil charge en medias, pour un contenu que personne
  // ne fera defiler d'un coup.
  query('limite')
    .optional()
    .isInt({ min: 1, max: 30 }).withMessage('La limite doit être comprise entre 1 et 30')
    .toInt(),
];

/* ------------------------------------------------------------------ *
 *  COMMENTAIRES
 * ------------------------------------------------------------------ */

export const reglesCommentaire = [
  param('id').isMongoId().withMessage('Identifiant de publication invalide'),

  body('texte')
    .trim()
    .notEmpty().withMessage('Le commentaire ne peut pas être vide')
    .isLength({ max: 1000 }).withMessage('Un commentaire ne peut depasser 1000 caractères')
    // `escape` neutralise les chevrons et guillemets : meme si un composant
    // React affichait un jour ce texte via dangerouslySetInnerHTML, aucune
    // balise ne pourrait s'y executer.
    .escape(),

  body('parent')
    .optional({ values: 'null' })
    .isMongoId().withMessage('Identifiant de commentaire parent invalide'),
];

export const reglesIdCommentaire = [
  param('id').isMongoId().withMessage('Identifiant de commentaire invalide'),
];

/* ------------------------------------------------------------------ *
 *  STORIES
 * ------------------------------------------------------------------ */

export const reglesCreationStory = [
  body('texte')
    .optional()
    .trim()
    .isLength({ max: 200 }).withMessage('Le texte ne peut depasser 200 caractères')
    .escape(),

  body('estPremium')
    .optional()
    .isBoolean({ loose: true }).withMessage('estPremium doit etre un booleen'),
];

export const reglesIdStory = [
  param('id').isMongoId().withMessage('Identifiant de story invalide'),
];
