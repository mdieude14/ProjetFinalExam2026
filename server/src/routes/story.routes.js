import { Router } from 'express';

import {
  creerStory,
  barreStories,
  marquerVue,
  listerVues,
  supprimerStory,
  storiesUtilisateur,
} from '../controllers/story.controller.js';

import {
  reglesCreationStory,
  reglesIdStory,
} from '../validators/post.validator.js';

import { validate } from '../middlewares/validate.middleware.js';
import { protect, protectOptionnel } from '../middlewares/auth.middleware.js';
import {
  uploadStoryMedia,
  verifierTaillesMedias,
  exigerFichier,
} from '../middlewares/upload.middleware.js';

const router = Router();

/** Stories — /api/stories */

// Route fixe avant la route parametree.
router.get('/', protect, barreStories);

router.get('/utilisateur/:identifiant', protectOptionnel, storiesUtilisateur);

router.post(
  '/',
  protect,
  uploadStoryMedia,
  exigerFichier,
  verifierTaillesMedias,
  reglesCreationStory,
  validate,
  creerStory
);

router.post('/:id/vue', protect, reglesIdStory, validate, marquerVue);

router.get('/:id/vues', protect, reglesIdStory, validate, listerVues);

router.delete('/:id', protect, reglesIdStory, validate, supprimerStory);

export default router;
