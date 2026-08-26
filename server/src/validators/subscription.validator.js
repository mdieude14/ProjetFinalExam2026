import { body, param } from 'express-validator';

/**
 * Validation des routes de paiement.
 *
 * Les bornes de prix reprennent celles du modèle User (`premium.prixMensuel`,
 * 500 à 50 000 centimes). Elles sont exprimées ici en EUROS, parce que c'est
 * ce que saisit le coach dans le formulaire ; la conversion en centimes se
 * fait dans le contrôleur, en un seul endroit.
 */

export const reglesTarif = [
  body('prixMensuel')
    .isFloat({ min: 5, max: 500 })
    .withMessage('Le tarif doit être compris entre 5 € et 500 € par mois')
    .toFloat()
    // Stripe raisonne en centimes entiers : 19,999 € n'a pas de sens.
    // On refuse au-delà de deux décimales plutôt que d'arrondir en silence.
    .custom((valeur) => Math.round(valeur * 100) === Number((valeur * 100).toFixed(0)))
    .withMessage('Le tarif ne peut avoir plus de deux décimales'),

  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('La description ne peut dépasser 500 caractères')
    .escape(),
];

export const reglesActivation = [
  body('actif').isBoolean().withMessage('actif doit être un booléen').toBoolean(),
];

/**
 * L'identifiant du coach accepte un ObjectId ou un pseudo, comme partout
 * ailleurs : on ne valide donc que le jeu de caractères et la longueur.
 */
export const reglesIdentifiantCoach = [
  param('identifiant')
    .trim()
    .isLength({ min: 3, max: 40 })
    .withMessage('Identifiant invalide')
    .matches(/^[a-zA-Z0-9._-]+$/)
    .withMessage('Identifiant invalide'),
];

export const reglesIdAbonnement = [
  param('id').isMongoId().withMessage('Identifiant d’abonnement invalide'),
];
