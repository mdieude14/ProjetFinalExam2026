import { param, query } from 'express-validator';

/**
 * Validation des routes de suivi.
 *
 * L'identifiant d'URL accepte un ObjectId OU un pseudo : on ne peut donc pas
 * utiliser `isMongoId()`. On se contente de bornes de longueur et d'un jeu de
 * caracteres restreint — la resolution reelle est faite par le contrôleur,
 * qui renvoie 404 si rien ne correspond.
 *
 * Le motif exclut tout ce qui n'est ni alphanumerique ni `. - _` : c'est
 * suffisant pour empecher un identifiant fantaisiste d'atteindre la couche
 * base de donnees.
 */
export const reglesIdentifiant = [
  param('identifiant')
    .trim()
    .isLength({ min: 3, max: 40 })
    .withMessage('Identifiant invalide')
    .matches(/^[a-zA-Z0-9._-]+$/)
    .withMessage('Identifiant invalide'),
];

/** Les demandes sont toujours designees par leur ObjectId. */
export const reglesIdDemande = [
  param('id').isMongoId().withMessage('Identifiant de demande invalide'),
];

export const reglesSuggestions = [
  // Plafond a 12 : au-dela, le bloc de suggestions occuperait tout l'ecran
  // sans apporter d'information supplementaire.
  query('limite')
    .optional()
    .isInt({ min: 1, max: 12 })
    .withMessage('La limite doit être comprise entre 1 et 12')
    .toInt(),
];
