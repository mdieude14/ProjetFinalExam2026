import { Router } from 'express';

import {
  creerPost,
  feed,
  postsUtilisateur,
  unPost,
  supprimerPost,
  basculerLike,
} from '../controllers/post.controller.js';

import {
  ajouterCommentaire,
  listerCommentaires,
} from '../controllers/comment.controller.js';

import {
  reglesCreationPost,
  reglesIdPost,
  reglesCurseur,
  reglesCommentaire,
} from '../validators/post.validator.js';

import { reglesPagination } from '../validators/user.validator.js';
import { validate } from '../middlewares/validate.middleware.js';
import { protect, protectOptionnel } from '../middlewares/auth.middleware.js';
import {
  uploadPostMedias,
  verifierTaillesMedias,
  exigerFichier,
} from '../middlewares/upload.middleware.js';

const router = Router();

/**
 * Publications — /api/posts
 *
 * ORDRE DES MIDDLEWARES SUR LA CREATION :
 *
 *   protect -> upload -> exigerFichier -> tailles -> validation -> controleur
 *
 * `uploadPostMedias` doit passer AVANT les validateurs : tant que Multer n'a
 * pas analyse le corps multipart, `req.body` est vide et express-validator
 * ne verrait aucun champ a controler.
 *
 * `protect` reste en tete : inutile de recevoir 100 Mo de video avant de
 * decouvrir que la personne n'est pas authentifiee.
 */

/* ------------------------------- Lecture ------------------------------- */

// Declaree avant « /:id », sinon « feed » serait interprete comme un
// identifiant de publication.
router.get('/feed', protect, reglesCurseur, validate, feed);

router.get(
  '/utilisateur/:identifiant',
  protectOptionnel,
  reglesCurseur,
  validate,
  postsUtilisateur
);

router.get('/:id', protectOptionnel, reglesIdPost, validate, unPost);

/* ------------------------------- Ecriture ------------------------------ */

router.post(
  '/',
  protect,
  uploadPostMedias,
  exigerFichier,
  verifierTaillesMedias,
  reglesCreationPost,
  validate,
  creerPost
);

router.delete('/:id', protect, reglesIdPost, validate, supprimerPost);

router.post('/:id/like', protect, reglesIdPost, validate, basculerLike);

/* ----------------------------- Commentaires ---------------------------- */

router.get(
  '/:id/comments',
  protectOptionnel,
  reglesIdPost,
  reglesPagination,
  validate,
  listerCommentaires
);

router.post('/:id/comments', protect, reglesCommentaire, validate, ajouterCommentaire);

export default router;
