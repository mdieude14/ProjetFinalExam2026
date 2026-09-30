import { body, param, query } from 'express-validator';

import { INTENTIONS, STATUTS } from '../models/Ticket.js';

/**
 * ===========================================================================
 *  VALIDATION DES ROUTES DE SUPPORT
 * ===========================================================================
 *
 * CE QUI ARRIVE ICI VIENT D'UN AGENT, DONC D'UN MODÈLE DE LANGAGE.
 * C'est la différence avec les autres validateurs du projet, où la donnée
 * vient d'un formulaire. Un modèle peut inventer une valeur d'énumération
 * plausible — `intention: "facturation"` — sans la moindre mauvaise
 * intention. La liste fermée n'est donc pas une formalité : c'est le seul
 * endroit qui garantit que l'aiguillage du workflow reste vérifiable.
 * ===========================================================================
 */

/** Création d'un ticket par la zone utilisateur. */
export const reglesCreationTicket = [
  body('question')
    .exists().withMessage('La question est requise').bail()
    .isString().trim()
    .isLength({ min: 3, max: 2000 })
    .withMessage('La question doit contenir entre 3 et 2000 caractères'),

  body('origine').optional().isString().trim().isLength({ max: 120 }),

  body('intention')
    .optional()
    .isIn(INTENTIONS)
    .withMessage(`L'intention doit valoir : ${INTENTIONS.join(', ')}`),

  body('reponse').optional().isString().trim().isLength({ max: 4000 }),

  /*
   * LES OUTILS SONT UNE TRACE, PAS UNE COMMANDE. On borne le tableau pour
   * qu'un agent en boucle ne puisse pas gonfler indéfiniment un document —
   * vingt appels suffisent largement à répondre à une question de support.
   */
  body('outils').optional().isArray({ max: 20 })
    .withMessage('Au plus 20 appels d’outil par ticket'),
  body('outils.*.outil').optional().isString().trim().isLength({ max: 80 }),
  body('outils.*.statut').optional().isInt({ min: 100, max: 599 }).toInt(),
  body('outils.*.dureeMs').optional().isInt({ min: 0, max: 600000 }).toInt(),

  body('motifEscalade').optional().isString().trim().isLength({ max: 300 }),
];

/** Lecture paginée. */
export const reglesListeTickets = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limite').optional().isInt({ min: 1, max: 50 }).toInt(),
];

export const reglesIdTicket = [
  param('id').isMongoId().withMessage('Identifiant de ticket invalide'),
];

/** File de l'exploitant, filtrable par statut. */
export const reglesFileTickets = [
  query('statut')
    .optional()
    .isIn([...STATUTS, 'tous'])
    .withMessage(`Le statut doit valoir : ${[...STATUTS, 'tous'].join(', ')}`),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limite').optional().isInt({ min: 1, max: 50 }).toInt(),
];

/**
 * Instruction d'un dossier par un administrateur humain.
 *
 * LA DÉCISION EST OBLIGATOIRE, comme pour un refus de diplôme au module 4.
 * Clore un dossier sans motif laisserait l'utilisateur devant un statut sans
 * explication, et l'administration sans trace de son propre raisonnement.
 */
export const reglesDecisionTicket = [
  param('id').isMongoId().withMessage('Identifiant de ticket invalide'),

  body('decision')
    .exists().withMessage('La décision est requise').bail()
    .isString().trim()
    .isLength({ min: 3, max: 2000 })
    .withMessage('La décision doit contenir entre 3 et 2000 caractères'),

  body('statut')
    .optional()
    .isIn(['clos', 'resolu'])
    .withMessage('Le statut doit valoir « clos » ou « resolu »'),
];

/**
 * Marquage des tickets annoncés, par le service.
 *
 * On borne la taille du lot : un appel qui marquerait mille tickets d'un coup
 * signalerait une boucle défectueuse plutôt qu'un usage normal.
 */
export const reglesMarquageNotifies = [
  body('ids')
    .exists().withMessage('La liste d’identifiants est requise').bail()
    .isArray({ min: 1, max: 50 })
    .withMessage('Entre 1 et 50 identifiants'),
  body('ids.*').isMongoId().withMessage('Identifiant de ticket invalide'),
];

/** Relève par le service : on borne ce qu'un passage peut ramener. */
export const reglesReleve = [
  query('limite').optional().isInt({ min: 1, max: 50 }).toInt(),
];

/**
 * Recherche dans la base de connaissances. La question vient d'un agent qui
 * reformule celle de l'utilisateur : bornée, pour qu'un texte collé entier ne
 * devienne pas une recherche sur cinq cents mots.
 */
export const reglesRechercheFiches = [
  query('q')
    .exists().withMessage('La question est requise').bail()
    .isString().trim()
    .isLength({ min: 2, max: 500 })
    .withMessage('La question doit contenir entre 2 et 500 caractères'),
  query('limite').optional().isInt({ min: 1, max: 10 }).toInt(),
];

/** Identifiant de fiche : le nom de son fichier, rien qui ressemble à un chemin. */
export const reglesSlugFiche = [
  param('slug')
    .isLength({ max: 80 })
    .matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .withMessage('Identifiant de fiche invalide'),
];

/* ------------------------------------------------------------------ *
 *  RATTACHEMENT TELEGRAM
 * ------------------------------------------------------------------ */

/*
 * UNE CONVERSATION PRIVÉE, ET SEULEMENT ELLE.
 *
 * Telegram numérote les conversations privées en POSITIF (c'est l'identifiant
 * de la personne) et les groupes en NÉGATIF. Refuser le signe moins ici, c'est
 * refuser qu'un groupe soit jamais rattaché à un compte — ce qui exposerait
 * les données de ce compte à tous ses membres. Le workflow le vérifie aussi ;
 * l'API ne compte pas sur lui.
 *
 * L'identifiant arrive en nombre dans un corps JSON, en texte dans une URL :
 * on le ramène à une chaîne, la seule forme stockée (voir le modèle User).
 */
const conversationPrivee = (champ) =>
  champ
    .exists().withMessage('La conversation est requise').bail()
    .customSanitizer((v) => String(v).trim())
    .matches(/^[1-9]\d{0,19}$/)
    .withMessage('Seule une conversation privée peut être rattachée');

export const reglesLierTelegram = [
  body('code')
    .exists().withMessage('Le code est requis').bail()
    .isString().isLength({ min: 8, max: 12 })
    .withMessage('Code invalide ou expiré'),
  conversationPrivee(body('conversation')),
];

export const reglesDelierTelegram = [conversationPrivee(body('conversation'))];

export const reglesCompteTelegram = [conversationPrivee(query('conversation'))];

/* ------------------------------------------------------------------ *
 *  RÉPONDRE À LA PERSONNE
 * ------------------------------------------------------------------ */

/**
 * La référence courte d'un dossier : huit signes hexadécimaux, les derniers de
 * son identifiant. Bornée ici pour qu'une valeur fantaisiste n'atteigne jamais
 * la base.
 */
const referenceDossier = param('reference')
  .exists().withMessage('La référence est requise').bail()
  .customSanitizer((v) => String(v).trim().toLowerCase())
  .matches(/^[0-9a-f]{8}$/)
  .withMessage('Référence invalide');

/**
 * Le texte d'un brouillon.
 *
 * DIX SIGNES AU MINIMUM : « ok » n'est pas une réponse, et une validation
 * accidentelle sur un message vide partirait chez un utilisateur.
 */
const texteBrouillon = body('texte')
  .exists().withMessage('Le texte est requis').bail()
  .isString().trim()
  .isLength({ min: 10, max: 4000 })
  .withMessage('Le brouillon doit contenir entre 10 et 4000 caractères');

export const reglesDossierService = [referenceDossier, conversationPrivee(query('conversation'))];

export const reglesBrouillonService = [
  referenceDossier,
  conversationPrivee(body('conversation')),
  texteBrouillon,
];

export const reglesEnvoiService = [referenceDossier, conversationPrivee(body('conversation'))];

export const reglesBrouillonAdmin = [
  param('id').isMongoId().withMessage('Identifiant de ticket invalide'),
  texteBrouillon,
];
