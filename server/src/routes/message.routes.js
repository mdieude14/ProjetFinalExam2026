import { Router } from 'express';

import {
  ouvrir,
  listeConversations,
  listeMessages,
  envoyer,
  repondreDemande,
  marquerLu,
  nonLus,
  supprimer,
} from '../controllers/message.controller.js';

import {
  reglesOuverture,
  reglesIdConversation,
  reglesIdMessage,
  reglesEnvoi,
  reglesReponseDemande,
  reglesListeMessages,
  reglesListeConversations,
} from '../validators/message.validator.js';

import { validate } from '../middlewares/validate.middleware.js';
import { protect } from '../middlewares/auth.middleware.js';
import { uploadPieceJointe } from '../middlewares/upload.middleware.js';

const router = Router();

/**
 * Messagerie — /api/messages
 *
 * TOUT EST PROTÉGÉ, SANS EXCEPTION. Contrairement aux événements ou à la
 * recherche, il n'existe ici aucune vitrine : une conversation privée n'a
 * pas de version publique appauvrie. `protectOptionnel` n'aurait aucun sens.
 *
 * ORDRE DES ROUTES : les segments fixes AVANT les paramétrés — `/non-lus`
 * doit être déclaré avant tout `/:id`, sans quoi il serait lu comme un
 * identifiant de conversation. Même piège qu'aux modules 6, 7, 9 et 10.
 */

/* --------------------------- Segments fixes --------------------------- */

router.get('/non-lus', protect, nonLus);

router.get(
  '/conversations',
  protect,
  reglesListeConversations,
  validate,
  listeConversations
);

router.post('/conversations', protect, reglesOuverture, validate, ouvrir);

/* ------------------------- Une conversation ------------------------- */

router.get(
  '/conversations/:id/messages',
  protect,
  reglesListeMessages,
  validate,
  listeMessages
);

/*
 * L'ordre des middlewares reprend celui du module 9, et pour la même raison :
 *   protect   établit qui appelle
 *   upload    lit le corps multipart et remplit req.body / req.file
 *   validate  contrôle les champs que l'upload vient de peupler
 *
 * `validate` avant `upload` ne verrait qu'un corps vide sur un envoi
 * multipart, et refuserait un message pourtant complet.
 */
router.post(
  '/conversations/:id/messages',
  protect,
  uploadPieceJointe,
  reglesEnvoi,
  validate,
  envoyer
);

router.patch(
  '/conversations/:id',
  protect,
  reglesReponseDemande,
  validate,
  repondreDemande
);

router.post(
  '/conversations/:id/lu',
  protect,
  reglesIdConversation,
  validate,
  marquerLu
);

/* ---------------------------- Un message ---------------------------- */

router.delete('/:id', protect, reglesIdMessage, validate, supprimer);

export default router;
