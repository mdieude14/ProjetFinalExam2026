import { Router } from 'express';
import {
  supprimerCommentaire,
  approuverCommentaire,
} from '../controllers/comment.controller.js';
import {
  reglesIdCommentaire,
  reglesApprobationCommentaire,
} from '../validators/post.validator.js';
import { validate } from '../middlewares/validate.middleware.js';
import { protect } from '../middlewares/auth.middleware.js';

const router = Router();

/**
 * Commentaires — /api/comments
 *
 * L'ajout et la lecture passent par /api/posts/:id/comments : un commentaire
 * n'existe pas sans sa publication, l'URL le reflete.
 *
 * La suppression, elle, ne connait que l'identifiant du commentaire — c'est
 * tout ce dont dispose le bouton dans l'interface. D'ou ce routeur separe.
 */
/**
 * Approbation d'un commentaire mis en attente par une restriction.
 *
 * PATCH et non POST : on modifie l'etat d'une ressource qui existe deja,
 * on n'en cree pas une nouvelle. Meme forme que la reponse a une demande de
 * chat au module 11.
 */
router.patch(
  '/:id/approbation',
  protect,
  reglesApprobationCommentaire,
  validate,
  approuverCommentaire
);

router.delete('/:id', protect, reglesIdCommentaire, validate, supprimerCommentaire);

export default router;
