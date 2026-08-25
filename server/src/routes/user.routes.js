import { Router } from 'express';

import {
  monProfil,
  profilPublic,
  modifierProfil,
  changerVisibilite,
  changerLocalisation,
  soumettreDiplome,
  televerserJustificatif,
  changerAvatar,
  desactiverCompte,
} from '../controllers/user.controller.js';

import {
  reglesEditionProfil,
  reglesVisibilite,
  reglesLocalisation,
  reglesDiplome,
} from '../validators/user.validator.js';

import { validate } from '../middlewares/validate.middleware.js';
import { protect, protectOptionnel } from '../middlewares/auth.middleware.js';
import { autoriser } from '../middlewares/role.middleware.js';
import {
  uploadAvatar,
  uploadJustificatif,
  exigerFichier,
  verifierTaillesMedias,
} from '../middlewares/upload.middleware.js';

const router = Router();

/**
 * Routes de profil — /api/users
 *
 * ATTENTION A L'ORDRE DES DECLARATIONS.
 * Express teste les routes de haut en bas et s'arrete a la premiere qui
 * correspond. Toutes les routes fixes (« /me », « /me/visibilite ») doivent
 * donc precederer la route parametree « /:identifiant » : declaree avant,
 * cette derniere capturerait « me » comme un pseudo et l'on chercherait un
 * utilisateur dont le pseudo serait litteralement « me ».
 */

/* ------------------------- Compte du proprietaire ------------------------- */

router.get('/me', protect, monProfil);

router.patch('/me', protect, reglesEditionProfil, validate, modifierProfil);

router.patch('/me/visibilite', protect, reglesVisibilite, validate, changerVisibilite);

router.patch('/me/localisation', protect, reglesLocalisation, validate, changerLocalisation);

// Reserve aux coachs : un sportif n'a pas de diplome a faire verifier.
router.post(
  '/me/diplome',
  protect,
  autoriser('coach'),
  reglesDiplome,
  validate,
  soumettreDiplome
);

// Photo de profil (module 5)
router.patch(
  '/me/avatar',
  protect,
  uploadAvatar,
  exigerFichier,
  verifierTaillesMedias,
  changerAvatar
);

// Justificatif de diplome — image ou PDF (module 5)
router.post(
  '/me/diplome/justificatif',
  protect,
  autoriser('coach'),
  uploadJustificatif,
  exigerFichier,
  verifierTaillesMedias,
  televerserJustificatif
);

router.delete('/me', protect, desactiverCompte);

/* ---------------------------- Profils consultes --------------------------- */

// `protectOptionnel` : accessible aux visiteurs anonymes pour les profils
// publics, tout en enrichissant la reponse (relation de suivi) si le
// visiteur est connecte.
router.get('/:identifiant', protectOptionnel, profilPublic);

export default router;
