import { Router } from 'express';

import {
  suggestions,
  globale,
  utilisateurs,
  publications,
  evenements,
} from '../controllers/search.controller.js';

import {
  reglesRecherche,
  reglesRechercheUtilisateurs,
  reglesSuggestions,
} from '../validators/search.validator.js';

import { validate } from '../middlewares/validate.middleware.js';
import { protectOptionnel } from '../middlewares/auth.middleware.js';

const router = Router();

/**
 * Recherche — /api/search
 *
 * `protectOptionnel` PARTOUT, ET LA NUANCE EST IMPORTANTE.
 * Chercher ne demande pas de compte : c'est la porte d'entrée de
 * l'application, et l'exiger fermerait la vitrine. Mais la session, quand
 * elle existe, CHANGE LES RÉSULTATS — elle ouvre les publications des comptes
 * privés que l'on suit, déverrouille le contenu premium auquel on est abonné,
 * révèle l'adresse des événements réservés. Un visiteur anonyme obtient donc
 * une réponse correcte, simplement plus pauvre.
 *
 * ORDRE DES ROUTES : les segments fixes AVANT tout le reste, comme aux
 * modules 6, 7 et 9. Ici la racine `/` est déclarée en dernier pour la même
 * raison de lisibilité, même si aucun `/:id` ne vient créer d'ambiguïté.
 *
 * PAS DE LIMITEUR SPÉCIFIQUE. La question s'est posée : l'autocomplétion est
 * la route la plus appelée du projet. Elle reste couverte par le limiteur
 * global (300 requêtes par quart d'heure), et la vraie réduction du trafic
 * se fait côté client, par le délai d'attente sur la frappe — une requête
 * par mot saisi, pas une par lettre. Un limiteur serré ici punirait d'abord
 * l'utilisateur qui tape vite.
 */

router.get('/suggestions', protectOptionnel, reglesSuggestions, validate, suggestions);

router.get(
  '/utilisateurs',
  protectOptionnel,
  reglesRechercheUtilisateurs,
  validate,
  utilisateurs
);

router.get('/publications', protectOptionnel, reglesRecherche, validate, publications);

router.get('/evenements', protectOptionnel, reglesRecherche, validate, evenements);

router.get('/', protectOptionnel, reglesRecherche, validate, globale);

export default router;
