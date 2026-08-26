import { Router } from 'express';

import {
  creerCheckout,
  mesAbonnements,
  mesAbonnes,
  statutAvecCoach,
  resilier,
  reprendre,
} from '../controllers/subscription.controller.js';

import {
  reglesIdentifiantCoach,
  reglesIdAbonnement,
} from '../validators/subscription.validator.js';

import { reglesPagination } from '../validators/user.validator.js';
import { validate } from '../middlewares/validate.middleware.js';
import { protect } from '../middlewares/auth.middleware.js';
import { autoriser } from '../middlewares/role.middleware.js';

const router = Router();

/**
 * Abonnements premium — /api/subscriptions
 *
 * Toutes ces routes exigent une session : on ne s'abonne pas anonymement.
 *
 * MÊME PIÈGE D'ORDRE QUE POUR LES AUTRES ROUTEURS : les segments fixes
 * (« abonnes », « statut ») doivent précéder « /:id », faute de quoi une
 * requête vers /api/subscriptions/abonnes serait lue comme une résiliation
 * de l'abonnement dont l'identifiant serait « abonnes ».
 */
router.use(protect);

/* --------------------------- Segments fixes --------------------------- */

router.get('/', reglesPagination, validate, mesAbonnements);

// Réservé aux coachs : un sportif n'a pas d'abonnés payants.
router.get('/abonnes', autoriser('coach'), reglesPagination, validate, mesAbonnes);

router.get(
  '/statut/:identifiant',
  reglesIdentifiantCoach,
  validate,
  statutAvecCoach
);

router.post(
  '/:identifiant/checkout',
  reglesIdentifiantCoach,
  validate,
  creerCheckout
);

/* ------------------------- Routes paramétrées ------------------------- */

router.post('/:id/reprendre', reglesIdAbonnement, validate, reprendre);

router.delete('/:id', reglesIdAbonnement, validate, resilier);

export default router;
