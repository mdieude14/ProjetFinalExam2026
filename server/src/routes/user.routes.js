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
  bloquer,
  debloquer,
  restreindre,
  leverRestriction,
  signaler,
  etat as etatModeration,
  mesBloques,
  mesRestreints,
} from '../controllers/moderation.controller.js';

import {
  reglesCibleModeration,
  reglesSignalement,
} from '../validators/moderation.validator.js';

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

/* ------------------------------ Moderation -------------------------------- */

/**
 * Bloquer, restreindre, signaler.
 *
 * CES ROUTES SONT DECLAREES AVANT « /:identifiant », comme l'avertissement en
 * tete de fichier l'impose. « /me/bloques » est une route FIXE : placee apres
 * la route parametree, elle serait capturee comme un profil dont le pseudo
 * serait « me », et l'ecran des comptes bloques renverrait un 404.
 *
 * TOUTES EXIGENT `protect`, sans exception. Un visiteur anonyme n'a personne
 * a bloquer : la relation part de quelqu'un, elle n'existe pas sans lui.
 */
router.get('/me/bloques', protect, mesBloques);
router.get('/me/restreints', protect, mesRestreints);

/*
 * POST pose la relation, DELETE la retire. Le verbe porte l'effet : un seul
 * point d'entree avec un drapeau « bloquer: true/false » rendrait un appel
 * mal forme capable de DEbloquer alors qu'on voulait bloquer.
 */
router.post('/:id/blocage', protect, reglesCibleModeration, validate, bloquer);
router.delete('/:id/blocage', protect, reglesCibleModeration, validate, debloquer);

router.post('/:id/restriction', protect, reglesCibleModeration, validate, restreindre);
router.delete(
  '/:id/restriction',
  protect,
  reglesCibleModeration,
  validate,
  leverRestriction
);

/*
 * Pas de DELETE sur le signalement : il ne se retire pas. Il est instruit par
 * l'administration, qui le classe — voir l'en-tete du controleur.
 */
router.post('/:id/signalement', protect, reglesSignalement, validate, signaler);

/*
 * Etat des trois actions, pour le menu « ⋯ » affiche hors d'une page de
 * profil — dans une conversation, par exemple. Declaree ici, avant
 * « /:identifiant », pour la meme raison que les precedentes.
 */
router.get('/:id/moderation', protect, reglesCibleModeration, validate, etatModeration);

/* ---------------------------- Profils consultes --------------------------- */

// `protectOptionnel` : accessible aux visiteurs anonymes pour les profils
// publics, tout en enrichissant la reponse (relation de suivi) si le
// visiteur est connecte.
router.get('/:identifiant', protectOptionnel, profilPublic);

export default router;
