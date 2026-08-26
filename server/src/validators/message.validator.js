import { body, param, query } from 'express-validator';

/**
 * Validation de la messagerie.
 *
 * PAS DE `.escape()` SUR LE CONTENU, et c'est un choix qu'il faut assumer.
 * Échapper ici transformerait « l'entraînement » en « l&#x27;entraînement »
 * **en base** : le texte serait stocké abîmé, et réafficherait ses entités à
 * l'écran chez tout le monde, pour toujours. La protection contre le XSS se
 * joue à l'affichage, et React échappe déjà tout ce qu'il rend — le danger
 * n'apparaîtrait qu'avec un `dangerouslySetInnerHTML`, qui n'existe nulle
 * part dans ce projet.
 *
 * On conserve en revanche `trim` et un plafond de longueur : ce sont des
 * règles de contenu, pas de sécurité d'affichage.
 */

const idMongo = (nom, emplacement = param) =>
  emplacement(nom).isMongoId().withMessage('Identifiant invalide');

export const reglesOuverture = [
  body('destinataire').isMongoId().withMessage('Destinataire invalide'),
];

export const reglesIdConversation = [idMongo('id')];

export const reglesIdMessage = [idMongo('id')];

/**
 * Le contenu est FACULTATIF au niveau HTTP, alors qu'un message vide est
 * refusé.
 *
 * Ce n'est pas une contradiction : un message peut n'être qu'une image. La
 * règle « du texte OU un média » ne peut pas s'exprimer sur un seul champ,
 * et la vérifier ici obligerait à connaître l'état de l'upload — que Multer
 * n'a pas encore traité au moment où ces règles s'appliquent. Elle vit donc
 * dans le schéma Mongoose, où elle vaut pour tout appelant.
 */
export const reglesEnvoi = [
  idMongo('id'),
  body('contenu')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Un message ne peut dépasser 2000 caractères'),
];

export const reglesReponseDemande = [
  idMongo('id'),
  body('action')
    .isIn(['accepter', 'refuser'])
    .withMessage('Action attendue : accepter ou refuser'),
];

export const reglesListeMessages = [
  idMongo('id'),
  query('curseur').optional().isMongoId().withMessage('Curseur invalide'),
  query('limite').optional().isInt({ min: 1, max: 100 }).toInt(),
];

export const reglesListeConversations = [
  query('statut').optional().isIn(['en_attente', 'accepte', 'refuse']),
];
