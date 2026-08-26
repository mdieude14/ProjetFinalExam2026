import { Router } from 'express';

import {
  demarrerOnboarding,
  statutConnect,
  definirTarif,
  changerActivationPremium,
  revenus,
} from '../controllers/stripe.controller.js';

import {
  reglesTarif,
  reglesActivation,
} from '../validators/subscription.validator.js';

import { validate } from '../middlewares/validate.middleware.js';
import { protect } from '../middlewares/auth.middleware.js';
import { coachCertifie } from '../middlewares/role.middleware.js';

const router = Router();

/**
 * Configuration des paiements — /api/stripe
 *
 * TOUT LE ROUTEUR EST RÉSERVÉ AUX COACHS CERTIFIÉS.
 * `coachCertifie` refuse un sportif, refuse un coach dont le diplôme n'a pas
 * été validé, et renvoie un message adapté à son statut : « soumettez votre
 * diplôme », « vérification en cours », ou le motif du refus.
 *
 * L'appliquer au routeur entier plutôt que route par route évite qu'un
 * endpoint ajouté plus tard échappe au contrôle — même raisonnement que pour
 * le back-office d'administration du module 4.
 *
 * Ce middleware, écrit au module 2, n'avait jusqu'ici aucun consommateur.
 */
router.use(protect, coachCertifie);

/* -------------------------- Compte connecté -------------------------- */

router.post('/connect/onboarding', demarrerOnboarding);

router.get('/connect/statut', statutConnect);

/* ------------------------------- Tarif ------------------------------- */

router.put('/premium/tarif', reglesTarif, validate, definirTarif);

router.patch('/premium/actif', reglesActivation, validate, changerActivationPremium);

/* ------------------------------ Revenus ------------------------------ */

router.get('/premium/revenus', revenus);

export default router;
