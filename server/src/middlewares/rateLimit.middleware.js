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

/**
 * En developpement, les limites gêneraient les tests manuels repetes. On les
 * neutralise plutot que de les rendre inoperantes en production par un
 * reglage trop permissif. `RATE_LIMIT_DEV=true` les rallume sur place.
 *
 * EXTRAITE EN FONCTION NOMMÉE pour que les limiteurs à `skip` composé
 * puissent la rappeler. Recopier la condition aurait suffi aujourd'hui, et
 * aurait divergé au premier changement de nom de variable.
 */
const neutraliseEnDeveloppement = () =>
  estDeveloppement && process.env.RATE_LIMIT_DEV !== 'true';

const optionsCommunes = {
  standardHeaders: 'draft-7', // en-tetes RateLimit-* normalises
  legacyHeaders: false,
  handler: reponseDepassement,
  skip: neutraliseEnDeveloppement,
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
 * Mot de passe oublié — demande : 5 par heure et par IP.
 *
 * Chaque demande envoie un vrai e-mail. Sans limite, la route servirait à
 * inonder la boîte de n'importe qui, et à épuiser le quota d'envoi du compte
 * Gmail — dont tous les autres e-mails de la plateforme dépendent.
 */
export const limiteurDemandeReinitialisation = rateLimit({
  ...optionsCommunes,
  windowMs: 60 * 60 * 1000,
  max: 5,
});

/**
 * Mot de passe oublié — réinitialisation : 10 essais par quart d'heure.
 * Un jeton de 256 bits ne se devine pas ; la limite coupe surtout court à
 * un script qui essaierait quand même.
 */
export const limiteurReinitialisation = rateLimit({
  ...optionsCommunes,
  windowMs: 15 * 60 * 1000,
  max: 10,
});

/**
 * ESCALADES DEMANDÉES PAR LA PERSONNE : 5 PAR HEURE ET PAR COMPTE.
 *
 * Le parcours « support » du widget crée un dossier à coup sûr, sans passer
 * par le jugement du classifieur (`support.service.js`, `escaladeForcee`).
 * C'est voulu, et c'est précisément ce qui demande une borne : le champ est
 * rempli par le client, et rien n'empêcherait d'en envoyer cent. Le risque
 * n'est pas une fuite — un ticket ne donne accès à rien — c'est une file
 * d'attente humaine noyée, et donc les vraies demandes enterrées.
 *
 * PAR COMPTE, ET NON PAR IP. Tous les appels arrivent de n8n, donc de la même
 * adresse : le conteneur Docker. Une limite par IP compterait les escalades de
 * tout le monde ensemble, et le sixième utilisateur de l'heure serait refusé
 * pour la faute des cinq précédents. `protect` garantit que `req.user` existe
 * sur cette route, il n'y a donc pas de repli sur l'adresse à prévoir.
 *
 * COMPTÉ SEULEMENT SUR LE PARCOURS « SUPPORT ». Chaque échange du widget crée
 * un ticket, y compris les questions d'utilisation résolues par l'agent : une
 * limite de cinq sur toute la route bloquerait la sixième QUESTION de l'heure,
 * ce qui serait absurde. Le `skip` lit `parcours` — LA MÊME SOURCE que le
 * service, et non `escaladeForcee` qui n'est pas accepté du corps. Lire deux
 * champs différents aurait ouvert exactement le trou que ce limiteur bouche :
 * une escalade forcée qui ne serait pas comptée.
 *
 * LE REFUS NE REMONTE PAS TEL QUEL AU WIDGET. n8n lit ce 429 et répond 200
 * avec un texte qui explique le quota : côté widget, toute erreur d'appel
 * s'affiche « service momentanément indisponible », et un quota dépassé
 * passerait pour une panne.
 */
export const MAX_ESCALADES_PAR_HEURE = 5;

export const limiteurEscaladeSupport = rateLimit({
  ...optionsCommunes,
  windowMs: 60 * 60 * 1000,
  max: MAX_ESCALADES_PAR_HEURE,
  keyGenerator: (req) => String(req.user?._id),
  skip: (req) => neutraliseEnDeveloppement() || req.body?.parcours !== 'support',
  handler: (req, res) => {
    res.status(429).json({
      succes: false,
      message:
        `Vous avez transmis ${MAX_ESCALADES_PAR_HEURE} demandes au support ` +
        'dans la dernière heure. Réessayez plus tard : vos demandes ' +
        'précédentes sont bien enregistrées et nous y répondons.',
    });
  },
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
