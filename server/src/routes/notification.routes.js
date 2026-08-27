import { Router } from 'express';

import {
  liste,
  nonLues,
  marquerLu,
  toutMarquerLu,
  supprimer,
} from '../controllers/notification.controller.js';

import {
  reglesIdNotification,
  reglesListe,
} from '../validators/notification.validator.js';

import { validate } from '../middlewares/validate.middleware.js';
import { protect } from '../middlewares/auth.middleware.js';

const router = Router();

/**
 * Notifications — /api/notifications
 *
 * TOUT EST PROTEGE : une notification est nominative par nature, il n'existe
 * aucune version publique a en donner.
 *
 * ORDRE DES ROUTES : les segments fixes AVANT les parametres. `/non-lues` et
 * `/tout-lu` doivent etre declares avant tout `/:id`, sans quoi ils seraient
 * lus comme des identifiants — meme piege qu'aux modules 6, 7, 9, 10 et 11.
 */

router.get('/non-lues', protect, nonLues);

router.post('/tout-lu', protect, toutMarquerLu);

router.get('/', protect, reglesListe, validate, liste);

router.patch('/:id/lu', protect, reglesIdNotification, validate, marquerLu);

router.delete('/:id', protect, reglesIdNotification, validate, supprimer);

export default router;
