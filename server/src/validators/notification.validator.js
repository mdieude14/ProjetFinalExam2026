import { param, query } from 'express-validator';

/**
 * Validation des notifications.
 *
 * TRES PEU DE REGLES, ET C'EST NORMAL : aucune route ne cree de notification.
 * Elles naissent d'actions reelles — un like, un message — jamais d'une
 * requete qui le demanderait. Il n'y a donc pas de corps a valider, seulement
 * un identifiant et deux parametres de lecture.
 */

export const reglesIdNotification = [
  param('id').isMongoId().withMessage('Identifiant invalide'),
];

export const reglesListe = [
  /*
   * `nonLues` arrive en chaine de caracteres, comme tout parametre d'URL.
   * On le valide en tant que tel plutot qu'en booleen : `isBoolean()`
   * accepterait « 1 » et « 0 », que le controleur ne sait pas lire.
   */
  query('nonLues').optional().isIn(['true', 'false']),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limite').optional().isInt({ min: 1, max: 50 }).toInt(),
];
