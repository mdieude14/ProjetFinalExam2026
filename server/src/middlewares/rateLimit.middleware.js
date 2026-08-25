import rateLimit from 'express-rate-limit';
import { estDeveloppement } from '../config/env.js';

/**
 * Limitation du nombre de requetes par fenetre de temps.
 *
 * Sans cela, un script peut tester des milliers de mots de passe par minute
 * sur la route de connexion. bcrypt avec 12 tours ralentit chaque tentative
 * (environ 250 ms), ce qui aide, mais ne suffit pas face a des requetes
 * paralleles — et sature au passage le processeur du serveur.
 *
 * Reponse renvoyee au format habituel de l'API, avec le code 429.
 */

const reponseDepassement = (req, res) => {
  res.status(429).json({
    succes: false,
    message: 'Trop de tentatives. Réessayez dans quelques minutes.',
  });
};

const optionsCommunes = {
  standardHeaders: 'draft-7', // en-tetes RateLimit-* normalises
  legacyHeaders: false,
  handler: reponseDepassement,
  // En developpement, les limites gêneraient les tests manuels repetes.
  // On les neutralise plutot que de les rendre inoperantes en production
  // par un reglage trop permissif.
  skip: () => estDeveloppement && process.env.RATE_LIMIT_DEV !== 'true',
};

/**
 * Connexion : 5 tentatives par tranche de 15 minutes.
 *
 * `skipSuccessfulRequests` ne decompte que les ECHECS : un utilisateur
 * legitime qui se connecte et se deconnecte plusieurs fois de suite n'est
 * jamais bloque, alors qu'une attaque par force brute — qui n'enchaine que
 * des echecs — l'est au bout de cinq essais.
 */
export const limiteurConnexion = rateLimit({
  ...optionsCommunes,
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
});

/**
 * Inscription : 10 comptes par heure et par IP.
 * Freine la creation massive de faux comptes.
 */
export const limiteurInscription = rateLimit({
  ...optionsCommunes,
  windowMs: 60 * 60 * 1000,
  max: 10,
});

/**
 * Renouvellement de jeton : 30 par quart d'heure.
 * Le front en declenche un toutes les 15 minutes en usage normal ; une
 * frequence bien superieure trahit une boucle defectueuse ou un abus.
 */
export const limiteurRefresh = rateLimit({
  ...optionsCommunes,
  windowMs: 15 * 60 * 1000,
  max: 30,
});

/**
 * Limite globale de l'API : 300 requetes par quart d'heure et par IP.
 * Volontairement large — le fil d'actualite et les medias en consomment
 * beaucoup. Elle vise l'aspiration automatisee, pas l'usage humain.
 */
export const limiteurGlobal = rateLimit({
  ...optionsCommunes,
  windowMs: 15 * 60 * 1000,
  max: 300,
});
