import { Router } from 'express';

import {
  creer,
  liste,
  proches,
  detail,
  modifier,
  annuler,
  sInscrire,
  seDesinscrire,
  mesInscriptions,
} from '../controllers/event.controller.js';

import {
  reglesCreation,
  reglesModification,
  reglesAnnulation,
  reglesInscription,
  reglesIdEvenement,
  reglesListe,
  reglesProximite,
} from '../validators/event.validator.js';

import { validate } from '../middlewares/validate.middleware.js';
import { protect, protectOptionnel } from '../middlewares/auth.middleware.js';
import { coachCertifie } from '../middlewares/role.middleware.js';
import { uploadAfficheEvenement } from '../middlewares/upload.middleware.js';

const router = Router();

/**
 * Événements sportifs — /api/events
 *
 * ORDRE DES ROUTES : les segments fixes AVANT `/:id`.
 * Sans cela, une requête vers `/api/events/proches` serait interprétée comme
 * la consultation de l'événement dont l'identifiant serait « proches » — et
 * répondrait 400 sur un identifiant invalide, ce qui est parfaitement
 * incompréhensible pour qui appelle la route. Même piège qu'aux modules 6 et 7.
 *
 * LECTURE OUVERTE, ÉCRITURE RESTREINTE.
 * Consulter les événements ne demande pas de compte : c'est une vitrine, et
 * exiger une inscription pour savoir ce qui se passe près de chez soi
 * découragerait exactement les gens qu'on veut attirer. `protectOptionnel`
 * enrichit la requête quand une session existe — ce qui permet de déverrouiller
 * les événements privés d'un abonné — sans jamais l'exiger.
 */

/* --------------------------- Segments fixes --------------------------- */

router.get('/proches', protectOptionnel, reglesProximite, validate, proches);

// Avant `/:id`, et protégée : « mes » inscriptions suppose de savoir qui « je » suis.
router.get('/mes-inscriptions', protect, mesInscriptions);

router.get('/', protectOptionnel, reglesListe, validate, liste);

/*
 * Création réservée aux coachs certifiés.
 *
 * L'ORDRE DES MIDDLEWARES N'EST PAS INTERCHANGEABLE :
 *   protect          établit qui appelle
 *   coachCertifie    vérifie le droit — impossible avant de savoir qui c'est
 *   upload           lit le corps multipart et remplit req.body / req.file
 *   validate         contrôle des champs que l'upload vient de peupler
 *
 * Placer `upload` avant `coachCertifie` ferait téléverser l'affiche d'un
 * utilisateur qu'on s'apprête à refuser : du trafic et du stockage consommés
 * pour rien, et un fichier orphelin chez Cloudinary.
 */
router.post(
  '/',
  protect,
  coachCertifie,
  uploadAfficheEvenement,
  reglesCreation,
  validate,
  creer
);

/* ------------------------- Routes paramétrées ------------------------- */

router.get('/:id', protectOptionnel, reglesIdEvenement, validate, detail);

router.patch(
  '/:id',
  protect,
  reglesIdEvenement,
  reglesModification,
  validate,
  modifier
);

// DELETE annule, ne supprime pas : les inscrits doivent pouvoir le constater.
router.delete(
  '/:id',
  protect,
  reglesIdEvenement,
  reglesAnnulation,
  validate,
  annuler
);

/* ---------------------------- Inscriptions ---------------------------- */

router.post(
  '/:id/inscription',
  protect,
  reglesIdEvenement,
  reglesInscription,
  validate,
  sInscrire
);

router.delete(
  '/:id/inscription',
  protect,
  reglesIdEvenement,
  validate,
  seDesinscrire
);

export default router;
