import { Router } from 'express';

import {
  listerDiplomes,
  deciderDiplome,
  changerStatutCompte,
  statistiques,
  listerSignalements,
  deciderSignalement,
} from '../controllers/admin.controller.js';

import {
  reglesDecisionDiplome,
  reglesStatutCompte,
  reglesPagination,
} from '../validators/user.validator.js';

import {
  reglesDecisionSignalement,
  reglesFileSignalements,
} from '../validators/moderation.validator.js';

import { validate } from '../middlewares/validate.middleware.js';
import { protect } from '../middlewares/auth.middleware.js';
import { autoriser } from '../middlewares/role.middleware.js';

const router = Router();

/**
 * Back-office de moderation — /api/admin
 *
 * PROTECTION AU NIVEAU DU ROUTEUR, PAS ROUTE PAR ROUTE.
 * Les deux middlewares ci-dessous s'appliquent a TOUT ce qui est declare
 * en dessous, y compris aux routes qui seront ajoutees plus tard.
 *
 * C'est le meme raisonnement que pour les gardes du routeur React : rendre
 * l'oubli impossible plutot que de compter sur la vigilance. Repeter
 * `autoriser('admin')` sur chaque ligne fonctionnerait aussi — jusqu'au jour
 * ou quelqu'un ajoute un endpoint a la hate.
 */
router.use(protect, autoriser('admin'));

/* ------------------------------ Diplomes ------------------------------ */

router.get('/diplomes', reglesPagination, validate, listerDiplomes);

router.patch('/diplomes/:id', reglesDecisionDiplome, validate, deciderDiplome);

/* ------------------------------- Comptes ------------------------------ */

router.patch('/users/:id/statut', reglesStatutCompte, validate, changerStatutCompte);

/* ---------------------------- Signalements ---------------------------- */

/*
 * Les signalements deposes par les utilisateurs. Ils n'arrivent QUE ici :
 * ni le signaleur ni la personne signalee ne peuvent les relire, et c'est
 * `autoriser('admin')` pose en tete de ce routeur qui le garantit.
 */
router.get('/signalements', reglesFileSignalements, validate, listerSignalements);

router.patch(
  '/signalements/:id',
  reglesDecisionSignalement,
  validate,
  deciderSignalement
);

/* ----------------------------- Statistiques --------------------------- */

router.get('/stats', statistiques);

export default router;
