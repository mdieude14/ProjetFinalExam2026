import { body, param, query } from 'express-validator';

import { MOTIFS } from '../models/Signalement.js';

/**
 * ===========================================================================
 *  VALIDATION DES ACTIONS DE MODÉRATION
 * ===========================================================================
 *
 * L'IDENTIFIANT EST VALIDÉ ICI ALORS QUE LE SERVICE LE REVÉRIFIE.
 * Ce n'est pas un doublon inutile : le validateur rend une erreur 400 lisible
 * avant d'atteindre la base, le service se protège d'un appel qui ne
 * passerait pas par cette route. Chacun des deux doit tenir seul — c'est la
 * règle appliquée depuis le module 4.
 */

const idCible = [
  param('id').isMongoId().withMessage('Identifiant de compte invalide'),
];

export const reglesCibleModeration = idCible;

/**
 * Signalement.
 *
 * LE MOTIF EST TIRÉ DE LA LISTE DU MODÈLE, PAS RECOPIÉ ICI.
 * Une seconde liste écrite à la main divergerait au premier motif ajouté :
 * l'enum Mongoose refuserait une valeur que le validateur vient d'accepter,
 * et l'erreur remonterait en 500 au lieu d'un 400 explicite.
 */
export const reglesSignalement = [
  ...idCible,

  body('motif')
    .isIn(MOTIFS)
    .withMessage(`Le motif doit être l'un de : ${MOTIFS.join(', ')}`),

  /*
   * COMMENTAIRE FACULTATIF, ET BORNÉ À LA MÊME LONGUEUR QUE LE MODÈLE.
   * `trim` avant `isLength` : sans lui, cinq cents espaces passeraient la
   * validation pour être stockés comme une chaîne vide.
   */
  body('commentaire')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 500 })
    .withMessage('Le commentaire ne peut dépasser 500 caractères'),
];

/**
 * Instruction d'un signalement par l'administration.
 *
 * DEUX ISSUES SEULEMENT, ET AUCUNE PAR DEFAUT. « traiter » et « rejeter »
 * n'ont pas la meme signification pour la suite : seul un dossier tranche
 * rouvre la possibilite de signaler la meme personne. Un corps vide qui
 * classerait le dossier au hasard serait pire qu'une erreur.
 */
export const reglesDecisionSignalement = [
  param('id').isMongoId().withMessage('Identifiant de signalement invalide'),

  body('decision')
    .isIn(['traiter', 'rejeter'])
    .withMessage("La décision doit valoir « traiter » ou « rejeter »"),

  body('commentaire')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 500 })
    .withMessage('La décision ne peut dépasser 500 caractères'),
];

/**
 * File des signalements du back-office.
 *
 * VALIDATEUR DEDIE, ET C'EST LA CORRECTION D'UNE VRAIE ERREUR.
 * La route reutilisait `reglesPagination`, ecrit pour les diplomes : son champ
 * `statut` n'accepte que « non_soumis | en_attente | verifie | refuse ». La file
 * des signalements, elle, se filtre sur « ouvert | traite | rejete » — et
 * chaque appel repartait en 400 « Statut de diplôme inconnu », un message qui
 * ne disait rien de l'erreur reelle.
 *
 * La lecon : un validateur se choisit sur ce qu'il VALIDE, pas sur ce que son
 * nom laisse croire. « Pagination » sonnait generique ; il ne l'etait pas.
 */
export const reglesFileSignalements = [
  query('page').optional().isInt({ min: 1 }).withMessage('Numéro de page invalide').toInt(),

  query('limite')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('La limite doit être comprise entre 1 et 50')
    .toInt(),

  query('statut')
    .optional()
    .isIn(['ouvert', 'traite', 'rejete'])
    .withMessage('Statut de signalement inconnu'),
];
