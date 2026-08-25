import { Router } from 'express';

import {
  suivre,
  nePlusSuivre,
  demandesRecues,
  nombreDemandes,
  accepterDemande,
  refuserDemande,
  retirerAbonne,
  listerAbonnes,
  listerAbonnements,
  listerSuggestions,
} from '../controllers/follow.controller.js';

import {
  reglesIdentifiant,
  reglesIdDemande,
  reglesSuggestions,
} from '../validators/follow.validator.js';

import { reglesPagination } from '../validators/user.validator.js';
import { validate } from '../middlewares/validate.middleware.js';
import { protect, protectOptionnel } from '../middlewares/auth.middleware.js';

const router = Router();

/**
 * Suivi — /api/follows
 *
 * ORDRE DES DECLARATIONS CRITIQUE.
 * Express s'arrete a la premiere route qui correspond. Toutes les routes
 * commencant par un segment fixe — « demandes », « suggestions », « abonnes »
 * — doivent donc etre declarees AVANT « /:identifiant ». Sans cela, une
 * requete vers /api/follows/demandes serait interpretee comme « suivre
 * l'utilisateur dont le pseudo est demandes ».
 */

/* --------------------------- Segments fixes --------------------------- */

router.get('/demandes', protect, reglesPagination, validate, demandesRecues);

// Endpoint dedie au compteur de la barre de navigation : renvoyer la liste
// complete pour n'afficher qu'un chiffre serait du gaspillage a chaque page.
router.get('/demandes/nombre', protect, nombreDemandes);

router.post('/demandes/:id/accepter', protect, reglesIdDemande, validate, accepterDemande);
router.post('/demandes/:id/refuser', protect, reglesIdDemande, validate, refuserDemande);

router.get('/suggestions', protect, reglesSuggestions, validate, listerSuggestions);

router.delete('/abonnes/:identifiant', protect, reglesIdentifiant, validate, retirerAbonne);

/* ------------------------- Routes parametrees ------------------------- */

// Listes consultables sans etre connecte pour un profil public ;
// `protectOptionnel` permet en plus d'indiquer l'etat de MA relation avec
// chaque personne affichee, quand je suis connecte.
router.get(
  '/:identifiant/abonnes',
  protectOptionnel,
  reglesIdentifiant,
  reglesPagination,
  validate,
  listerAbonnes
);

router.get(
  '/:identifiant/abonnements',
  protectOptionnel,
  reglesIdentifiant,
  reglesPagination,
  validate,
  listerAbonnements
);

router.post('/:identifiant', protect, reglesIdentifiant, validate, suivre);
router.delete('/:identifiant', protect, reglesIdentifiant, validate, nePlusSuivre);

export default router;
