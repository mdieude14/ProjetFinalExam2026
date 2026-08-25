import { validationResult } from 'express-validator';
import { ApiError } from '../utils/ApiError.js';

/**
 * Recolte les erreurs accumulees par les regles express-validator declarees
 * en amont sur la route, et les transforme en une reponse 400 homogene.
 *
 * On le monte APRES le tableau de regles :
 *   router.post('/register', reglesInscription, validate, controleur)
 *
 * express-validator ne bloque rien tout seul : chaque regle se contente
 * d'empiler ses erreurs dans la requete. Sans ce middleware, un corps invalide
 * arriverait tel quel dans le controleur.
 *
 * Reponse produite :
 *   {
 *     "succes": false,
 *     "message": "Donnees invalides",
 *     "details": [ { "champ": "email", "message": "Adresse email invalide" } ]
 *   }
 *
 * Ce format permet au front d'afficher l'erreur sous le bon champ du
 * formulaire plutot qu'un message global peu exploitable.
 */
export function validate(req, res, next) {
  const erreurs = validationResult(req);
  if (erreurs.isEmpty()) return next();

  const details = erreurs.array().map((e) => ({
    champ: e.path || e.param,
    message: e.msg,
  }));

  return next(ApiError.badRequest('Données invalides', details));
}
