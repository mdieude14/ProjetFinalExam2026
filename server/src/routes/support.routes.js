import { Router } from 'express';

import {
  creerTicket,
  mesTickets,
  monTicket,
  catalogueFiches,
  rechercherFiches,
  lireFiche,
  rechercherFichesService,
  genererCodeTelegram,
  etatTelegram,
  delierTelegram,
  lierTelegramService,
  delierTelegramService,
  compteTelegramService,
  dossierParReferenceService,
  brouillonService,
  envoyerService,
  marquerTicketVu,
  releverANotifier,
  marquerNotifies,
} from '../controllers/support.controller.js';

import {
  reglesCreationTicket,
  reglesListeTickets,
  reglesIdTicket,
  reglesRechercheFiches,
  reglesSlugFiche,
  reglesMarquageNotifies,
  reglesReleve,
  reglesLierTelegram,
  reglesDelierTelegram,
  reglesCompteTelegram,
  reglesDossierService,
  reglesBrouillonService,
  reglesEnvoiService,
} from '../validators/support.validator.js';

import { validate } from '../middlewares/validate.middleware.js';
import { protect } from '../middlewares/auth.middleware.js';
import { serviceAutorise, agentIdentifie } from '../middlewares/service.middleware.js';
import { autoriser } from '../middlewares/role.middleware.js';

const router = Router();

/**
 * ===========================================================================
 *  SUPPORT — module 15
 * ===========================================================================
 *
 * DEUX ZONES DE CONFIANCE DANS UN MÊME ROUTEUR, ET ELLES NE PARTAGENT AUCUNE
 * AUTHENTIFICATION.
 *
 *   /tickets/*   `protect`          le jeton de la personne qui écrit
 *                + `agentIdentifie` à la création : la clé d'AGENT atteste
 *                                   que la réponse vient de l'agent
 *   /service/*   `serviceAutorise`  la clé de RELÈVE, et rien d'autre
 *
 * Les deux clés sont distinctes, et l'API refuse de démarrer si elles ont la
 * même valeur (`config/env.js`).
 *
 * Il n'y a délibérément PAS de `router.use()` commun en tête, contrairement à
 * `admin.routes.js`. Un garde posé sur tout le routeur serait forcément le
 * plus permissif des deux, et ouvrirait l'une des zones à l'autre. Chaque
 * ligne porte donc son propre contrôle, visible à la lecture.
 *
 * CE QUI N'EST PAS ICI, ET QUI EST VOLONTAIRE : instruire un dossier. Cette
 * action vit dans `admin.routes.js`, sous `autoriser('admin')`. Trancher est
 * une décision humaine — la clé de service ne l'ouvre pas, et ne doit jamais
 * l'ouvrir.
 * ===========================================================================
 */

/* ================================================================== *
 *  ZONE UTILISATEUR
 * ================================================================== */

/**
 * Enregistre un échange avec l'agent.
 *
 * Appelé par n8n, mais AVEC LE JETON DE L'UTILISATEUR : le ticket appartient
 * à la personne qui a posé la question. Un service ne peut pas en créer un au
 * nom de quelqu'un d'autre, faute de pouvoir présenter son jeton.
 *
 * `agentIdentifie` APRÈS `protect` : il ajoute une attestation à l'identité
 * de l'utilisateur, il ne la remplace pas. Sans clé d'agent, l'écriture reste
 * possible mais ne porte ni réponse ni outils, et remonte à un humain.
 */
router.post('/tickets', protect, agentIdentifie, reglesCreationTicket, validate, creerTicket);

router.get('/tickets', protect, reglesListeTickets, validate, mesTickets);

/*
 * SEGMENT PARAMÉTRÉ EN DERNIER de sa famille. Le piège rencontré dans cinq
 * modules : une route fixe déclarée après `/:id` se fait interpréter comme un
 * identifiant, et répond 400 sur un message incompréhensible pour l'appelant.
 */
router.get('/tickets/:id', protect, reglesIdTicket, validate, monTicket);

/*
 * L'auteur a vu l'avis « une réponse vous a été envoyée par courriel ». Sans
 * cette trace, le widget le réafficherait à chaque ouverture.
 */
router.post('/tickets/:id/vu', protect, reglesIdTicket, validate, marquerTicketVu);

/*
 * Base de connaissances. `/fiches/recherche` AVANT `/fiches/:slug` — même
 * règle : déclaré après, « recherche » serait lu comme l'identifiant d'une
 * fiche et répondrait 404.
 */
router.get('/fiches', protect, catalogueFiches);
router.get('/fiches/recherche', protect, reglesRechercheFiches, validate, rechercherFiches);
router.get('/fiches/:slug', protect, reglesSlugFiche, validate, lireFiche);

/*
 * Rattachement Telegram, côté APPLICATION — RÉSERVÉ AUX ADMINISTRATEURS.
 *
 * Le bot Telegram est la console de l'exploitant : il reçoit les escalades et
 * sert à y répondre. Il n'a rien à faire entre les mains d'un utilisateur, qui
 * dispose du widget pour poser ses questions.
 *
 * UNE PREMIÈRE VERSION N'EXIGEAIT QUE `protect`, et n'importe quel compte
 * pouvait donc rattacher son Telegram. C'était une dérive par rapport à la
 * section 15.1 du journal, qui veut la zone exploitant « joignable par
 * personne de l'extérieur ». Le code ne se génère plus que derrière une
 * session ADMINISTRATEUR.
 */
router.post('/telegram/code', protect, autoriser('admin'), genererCodeTelegram);
router.get('/telegram', protect, autoriser('admin'), etatTelegram);
router.delete('/telegram', protect, autoriser('admin'), delierTelegram);

/* ================================================================== *
 *  ZONE SERVICE — n8n
 * ================================================================== */

/**
 * L'aide PUBLIQUE, pour les canaux où personne n'est identifié.
 *
 * Telegram et le courriel n'apportent aucun jeton : un compte Telegram ne
 * prouve rien, une adresse d'expéditeur se falsifie. Cette route sert donc
 * les fiches du rôle le moins doté, et rien d'autre. La seule donnée de
 * compte joignable avec la clé de service est le résumé étroit d'un compte
 * qui a LUI-MÊME rattaché sa conversation Telegram (routes suivantes).
 *
 * `/service/fiches/recherche` est un chemin fixe : il n'y a pas de
 * `/service/fiches/:slug` derrière lequel il pourrait se faire prendre pour
 * un identifiant. La route utilisateur, elle, a les deux — d'où l'ordre de
 * déclaration plus haut.
 */
router.get(
  '/service/fiches/recherche',
  serviceAutorise,
  reglesRechercheFiches,
  validate,
  rechercherFichesService
);

/**
 * Rattachement Telegram, côté BOT.
 *
 * La clé de service ouvre ici trois routes de plus, et elles restent
 * étroites : présenter un code (qui ne se fabrique que derrière une session),
 * délier SA conversation, et lire un résumé sans aucune donnée financière.
 * La conversation doit être privée — l'API refuse un identifiant de groupe.
 */
router.post('/service/telegram/lier', serviceAutorise, reglesLierTelegram, validate, lierTelegramService);
router.post('/service/telegram/delier', serviceAutorise, reglesDelierTelegram, validate, delierTelegramService);
router.get('/service/telegram/compte', serviceAutorise, reglesCompteTelegram, validate, compteTelegramService);

/**
 * Ce que l'assistant personnel doit annoncer et n'a pas encore annoncé.
 *
 * `serviceAutorise` s'utilise SEUL, jamais après `protect` : il n'y a pas
 * d'utilisateur derrière un processus automatisé, et `req.user` reste vide.
 */
/**
 * RÉPONDRE À UN DOSSIER, DEPUIS TELEGRAM.
 *
 * La clé de service ne suffit pas : ces trois routes exigent aussi une
 * conversation rattachée à un compte ADMINISTRATEUR. La clé dit d'où vient
 * l'appel, le rattachement dit qui agit — et le dossier est instruit à ce
 * nom-là. Sans cette seconde condition, quiconque détiendrait la clé pourrait
 * écrire aux utilisateurs au nom de l'équipe.
 */
router.get(
  '/service/tickets/:reference',
  serviceAutorise,
  reglesDossierService,
  validate,
  dossierParReferenceService
);
router.post(
  '/service/tickets/:reference/brouillon',
  serviceAutorise,
  reglesBrouillonService,
  validate,
  brouillonService
);
router.post(
  '/service/tickets/:reference/envoyer',
  serviceAutorise,
  reglesEnvoiService,
  validate,
  envoyerService
);

router.get('/service/a-notifier', serviceAutorise, reglesReleve, validate, releverANotifier);

/**
 * Marque comme annoncés les tickets dont l'envoi est confirmé.
 *
 * SÉPARÉ DE LA RELÈVE, et c'est le point de la conception : marquer au moment
 * de la lecture perdrait la notification si l'envoi Telegram échouait ensuite.
 * Le ticket serait réputé annoncé sans l'avoir été, et personne ne le saurait.
 */
router.post('/service/notifies', serviceAutorise, reglesMarquageNotifies, validate, marquerNotifies);

export default router;
