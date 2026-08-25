import { Router } from 'express';

import {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  me,
  changerMotDePasse,
} from '../controllers/auth.controller.js';

import {
  reglesInscription,
  reglesConnexion,
  reglesChangementMotDePasse,
} from '../validators/auth.validator.js';

import { validate } from '../middlewares/validate.middleware.js';
import { protect } from '../middlewares/auth.middleware.js';
import {
  limiteurConnexion,
  limiteurInscription,
  limiteurRefresh,
} from '../middlewares/rateLimit.middleware.js';

const router = Router();

/**
 * Routes d'authentification — /api/auth
 *
 * L'ORDRE DES MIDDLEWARES EST SIGNIFIANT. Express les execute de gauche a
 * droite, et chacun peut interrompre la chaine :
 *
 *   limiteur -> regles de validation -> validate -> [protect] -> controleur
 *
 * Le limiteur passe en premier : inutile de valider — donc de consommer du
 * CPU — le corps d'une requete que l'on va de toute facon rejeter en 429.
 */

/* ---------------------------- Routes publiques ---------------------------- */

// Creation de compte (utilisateur ou coach ; jamais admin)
router.post('/register', limiteurInscription, reglesInscription, validate, register);

// Connexion par email ou pseudo
router.post('/login', limiteurConnexion, reglesConnexion, validate, login);

// Renouvellement de l'access token depuis le cookie httpOnly.
// Pas de `protect` : c'est justement la route qu'on appelle quand
// l'access token est expire.
router.post('/refresh', limiteurRefresh, refresh);

// Deconnexion de l'appareil courant. Pas de `protect` non plus : supprimer
// un cookie doit fonctionner meme si la session est deja expiree, sinon
// l'utilisateur resterait coince avec un cookie mort.
router.post('/logout', logout);

/* ---------------------------- Routes protegees ---------------------------- */

router.get('/me', protect, me);
router.post('/logout-all', protect, logoutAll);
router.patch('/password', protect, reglesChangementMotDePasse, validate, changerMotDePasse);

export default router;
