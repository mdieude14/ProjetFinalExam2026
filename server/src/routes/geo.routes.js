import { Router } from 'express';

import {
  coachsAutour,
  villes,
  sports,
  definirCarteVisible,
} from '../controllers/geo.controller.js';

import { reglesRecherche, reglesCarteVisible } from '../validators/geo.validator.js';
import { validate } from '../middlewares/validate.middleware.js';
import { protect, protectOptionnel } from '../middlewares/auth.middleware.js';
import { autoriser } from '../middlewares/role.middleware.js';

const router = Router();

/**
 * Géolocalisation — /api/geo
 *
 * TROIS ROUTES PUBLIQUES, UNE PROTÉGÉE, et la ligne de partage est nette :
 * consulter la carte est ouvert à tous, y figurer suppose un compte coach.
 *
 * L'ouverture des lectures est un choix, pas un oubli. Chercher un coach près
 * de chez soi est exactement ce qu'un visiteur non inscrit vient faire ;
 * exiger un compte avant de montrer l'offre reviendrait à demander de
 * s'engager avant de savoir s'il y a quelque chose à trouver.
 *
 * Ce que cette ouverture ne concède pas : seuls les coachs ayant consenti
 * apparaissent, et leur position sort arrondie à ~110 m. Ces deux garanties
 * sont portées par `geo.service.js` et `User.versionCarte()`, jamais par le
 * routeur — elles ne doivent dépendre d'aucun point d'entrée.
 */

/* --------------------------- Lecture publique --------------------------- */

/*
 * protectOptionnel A ETE AJOUTE : la carte reste ouverte aux visiteurs
 * anonymes, mais sa reponse depend desormais de qui regarde — un coach avec
 * lequel le visiteur est en blocage ne doit plus y figurer. Sans ce
 * middleware, req.user resterait vide et le filtre ne s'appliquerait jamais,
 * alors meme que le service le prevoit : une exclusion ecrite mais morte.
 */
router.get('/coachs', protectOptionnel, reglesRecherche, validate, coachsAutour);
router.get('/villes', villes);
router.get('/sports', sports);

/* ------------------------- Consentement du coach ------------------------ */

// `autoriser('coach')` et non `coachCertifie` : un coach dont le diplôme est
// encore en instruction peut vouloir se rendre visible. Le filtre « certifiés
// seulement » de la recherche laisse au visiteur le soin de trancher.
router.patch(
  '/carte-visible',
  protect,
  autoriser('coach'),
  reglesCarteVisible,
  validate,
  definirCarteVisible
);

export default router;
