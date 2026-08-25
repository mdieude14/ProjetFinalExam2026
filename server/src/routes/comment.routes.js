import { Router } from 'express';
import { supprimerCommentaire } from '../controllers/comment.controller.js';
import { reglesIdCommentaire } from '../validators/post.validator.js';
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
router.delete('/:id', protect, reglesIdCommentaire, validate, supprimerCommentaire);

export default router;
