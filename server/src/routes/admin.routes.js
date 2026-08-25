import { Router } from 'express';

import {
  listerDiplomes,
  deciderDiplome,
  changerStatutCompte,
  statistiques,
} from '../controllers/admin.controller.js';

import {
  reglesDecisionDiplome,
  reglesStatutCompte,
  reglesPagination,
} from '../validators/user.validator.js';

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

/* ----------------------------- Statistiques --------------------------- */

router.get('/stats', statistiques);

export default router;
