import { asyncHandler } from '../utils/asyncHandler.js';
import { lirePagination, reponsePaginee } from '../utils/pagination.js';
import * as support from '../services/support.service.js';
import * as connaissances from '../services/connaissances.service.js';
import * as telegram from '../services/telegram.service.js';

/**
 * ===========================================================================
 *  SUPPORT — traduction HTTP
 * ===========================================================================
 *
 * TROIS FAMILLES DE ROUTES, TROIS AUTHENTIFICATIONS DIFFÉRENTES, et elles ne
 * doivent jamais se confondre :
 *
 *   utilisateur  `protect`           le jeton de la personne qui écrit
 *   service      `serviceAutorise`   la clé de n8n — aucun `req.user`
 *   exploitant   `protect` + admin   un humain dans le back-office
 *
 * Les handlers de la famille « service » ne lisent JAMAIS `req.user` : il n'y
 * a pas d'utilisateur derrière un processus automatisé, et le lire renverrait
 * `undefined` sans erreur — un défaut silencieux qui ne se verrait qu'à
 * l'exécution.
 * ===========================================================================
 */

/* ================================================================== *
 *  ZONE UTILISATEUR
 * ================================================================== */

/**
 * POST /api/support/tickets
 *
 * Enregistre un échange avec l'agent. Appelé par n8n, mais AVEC LE JETON DE
 * L'UTILISATEUR : le ticket appartient donc à la personne qui a posé la
 * question, jamais au service. C'est ce qui garantit qu'on ne peut pas écrire
 * un ticket au nom d'un autre, même en connaissant son identifiant.
 */
export const creerTicket = asyncHandler(async (req, res) => {
  // `req.agent` n'existe que si la clé d'agent a été vérifiée.
  const ticket = await support.enregistrer(req.user, req.body, { parAgent: Boolean(req.agent) });

  return res.status(201).json({
    succes: true,
    message:
      ticket.statut === 'escalade'
        ? 'Votre demande a été transmise à un conseiller'
        : 'Échange enregistré',
    ticket: ticket.versionAuteur(),
  });
});

/** GET /api/support/tickets — les siens, du plus récent au plus ancien. */
export const mesTickets = asyncHandler(async (req, res) => {
  const { page, limite, saut } = lirePagination(req);
  const { elements, total } = await support.mesTickets(req.user._id, { saut, limite });

  return res.json(reponsePaginee(elements, total, { page, limite }));
});

/** GET /api/support/tickets/:id — le sien, ou 404. */
export const monTicket = asyncHandler(async (req, res) => {
  const ticket = await support.monTicket(req.user._id, req.params.id);
  return res.json({ succes: true, ticket });
});

/*
 * BASE DE CONNAISSANCES — même zone, même jeton. L'agent lit les fiches AVEC
 * LE JETON DE LA PERSONNE QUI DEMANDE : c'est son type de compte qui décide
 * des fiches qu'elle peut recevoir, pas une liste fournie par l'agent.
 */

/** GET /api/support/fiches — les fiches accessibles à ce compte. */
export const catalogueFiches = asyncHandler(async (req, res) => {
  const fiches = connaissances.catalogue(req.user.type);
  return res.json({ succes: true, total: fiches.length, fiches });
});

/** GET /api/support/fiches/recherche?q= — les plus pertinentes pour une question. */
export const rechercherFiches = asyncHandler(async (req, res) => {
  const resultats = connaissances.rechercher(req.query.q, req.user.type, {
    limite: req.query.limite ?? 3,
  });
  return res.json({ succes: true, resultats });
});

/** GET /api/support/fiches/:slug — une fiche entière. */
export const lireFiche = asyncHandler(async (req, res) => {
  const fiche = connaissances.lire(req.params.slug, req.user.type);
  return res.json({ succes: true, fiche });
});

/* ================================================================== *
 *  ZONE SERVICE — n8n, clé dédiée
 * ================================================================== */

/**
 * LE RÔLE LE MOINS DOTÉ, TOUJOURS.
 *
 * Les canaux Telegram et courriel n'ont pas de jeton : personne n'y est
 * identifié. Ils lisent donc la base de connaissances avec le rôle d'un
 * sportif ordinaire, jamais celui d'un coach — sans quoi un inconnu recevrait
 * par message privé les étapes d'écrans qu'il n'a pas.
 */
const ROLE_PUBLIC = 'utilisateur';

/**
 * GET /api/support/service/fiches/recherche
 *
 * Les fiches d'aide PUBLIQUES qui répondent le mieux à une question.
 *
 * POURQUOI CETTE ROUTE EXISTE, ALORS QUE `/support/fiches/recherche` FAIT
 * DÉJÀ CELA. Celle-là exige le jeton de la personne : c'est ce jeton qui
 * décide des fiches auxquelles elle a droit. Un bot Telegram ou une boîte aux
 * lettres n'en ont aucun. Plutôt que de leur prêter le jeton de quelqu'un —
 * ou pire, un jeton d'administrateur — on leur ouvre une route qui ne sert
 * que l'aide publique, et rien d'autre.
 *
 * ELLE REND LES FICHES ENTIÈRES, contrairement à la route utilisateur qui
 * n'en donne qu'un extrait. Là-bas, l'agent CHOISIT ensuite quoi lire dans
 * une liste fermée : la séparation est un garde-fou. Ici il n'y a rien à
 * choisir — l'aide publique est publique — et un second aller-retour ne
 * protégerait de rien.
 *
 * LA LIMITE EST BORNÉE À TROIS, plus bas que le validateur ne l'autorise :
 * ces fiches partent dans un prompt facturé au jeton.
 */
export const rechercherFichesService = asyncHandler(async (req, res) => {
  const limite = Math.min(Number(req.query.limite) || 3, 3);

  const resultats = connaissances.rechercher(req.query.q, ROLE_PUBLIC, { limite }).map((r) => ({
    ...r,
    corps: connaissances.lire(r.slug, ROLE_PUBLIC).corps,
  }));

  return res.json({ succes: true, nombre: resultats.length, resultats });
});

/**
 * GET /api/support/service/a-notifier
 *
 * Ce que l'assistant personnel doit annoncer sur Telegram, et qu'il n'a pas
 * encore annoncé.
 *
 * CETTE ROUTE NE MARQUE RIEN. La relève et le marquage sont deux appels
 * distincts, et c'est délibéré : marquer ici perdrait la notification si
 * l'envoi Telegram échouait juste après — le ticket serait réputé annoncé
 * sans l'avoir été, et personne ne le saurait.
 */
export const releverANotifier = asyncHandler(async (req, res) => {
  const [tickets, destinations] = await Promise.all([
    support.aNotifier({ limite: req.query.limite ?? 20 }),
    support.destinationsTelegram(),
  ]);

  /*
   * UNE FILE QUI S'ALLONGE SANS PERSONNE POUR LA LIRE DOIT SE VOIR.
   *
   * Sans conversation rattachée, la relève n'a nulle part où annoncer : les
   * dossiers restent en attente, indéfiniment, et rien ne le signale — c'est
   * exactement la panne du 24 septembre, vécue à l'envers. Une ligne dans le
   * journal du serveur coûte moins qu'une journée d'escalades silencieuses.
   */
  if (tickets.length > 0 && destinations.length === 0) {
    console.warn(
      `[SUPPORT] ${tickets.length} dossier(s) à annoncer, mais AUCUNE conversation Telegram ` +
      'rattachée à un compte de l’équipe. Rattachez-en une depuis Paramètres → Assistant sur Telegram.'
    );
  }

  return res.json({
    succes: true,
    nombre: tickets.length,
    tickets,
    // Les pseudos accompagnent les identifiants : une exécution n8n devient
    // lisible sans avoir à retrouver à qui appartient un numéro.
    destinations,
  });
});

/**
 * POST /api/support/service/notifies
 *
 * Marque comme annoncés les tickets dont l'envoi est confirmé.
 */
export const marquerNotifies = asyncHandler(async (req, res) => {
  const marques = await support.marquerNotifies(req.body.ids);

  return res.json({ succes: true, marques });
});

/* ================================================================== *
 *  ZONE EXPLOITANT — back-office humain
 * ================================================================== */

/** GET /api/admin/support/tickets — la file, les plus anciens d'abord. */
export const listerTickets = asyncHandler(async (req, res) => {
  const { page, limite, saut } = lirePagination(req);
  const { elements, total } = await support.file({
    statut: req.query.statut ?? 'escalade',
    saut,
    limite,
  });

  return res.json(reponsePaginee(elements, total, { page, limite }));
});

/**
 * PATCH /api/admin/support/tickets/:id
 *
 * Instruit un dossier escaladé.
 *
 * VOLONTAIREMENT HORS DE PORTÉE DE n8n. Trancher est une décision humaine :
 * la clé de service n'ouvre pas cette route, et ne doit jamais l'ouvrir.
 * L'agent lit et signale ; il ne décide pas.
 */
export const trancherTicket = asyncHandler(async (req, res) => {
  const ticket = await support.trancher(req.params.id, req.user, req.body);

  return res.json({ succes: true, message: 'Dossier instruit', ticket });
});

/** GET /api/admin/support/stats — compteurs de la file. */
export const statistiquesSupport = asyncHandler(async (req, res) => {
  const stats = await support.statistiques();
  return res.json({ succes: true, ...stats });
});

/* ================================================================== *
 *  RATTACHEMENT TELEGRAM
 * ================================================================== */

/** POST /api/support/telegram/code — un code à envoyer au bot. */
export const genererCodeTelegram = asyncHandler(async (req, res) => {
  const { code, expireLe } = await telegram.genererCode(req.user._id);
  return res.status(201).json({ succes: true, code, expireLe });
});

/** GET /api/support/telegram — rattaché ou non. Jamais à quelle conversation. */
export const etatTelegram = asyncHandler(async (req, res) => {
  const etat = await telegram.etat(req.user._id);
  return res.json({ succes: true, ...etat });
});

/** DELETE /api/support/telegram — délier depuis l'application. */
export const delierTelegram = asyncHandler(async (req, res) => {
  const delie = await telegram.delierCompte(req.user._id);
  return res.json({ succes: true, delie });
});

/** POST /api/support/service/telegram/lier — le bot présente un code reçu. */
export const lierTelegramService = asyncHandler(async (req, res) => {
  const { pseudo } = await telegram.lier(req.body.code, req.body.conversation);
  return res.json({ succes: true, pseudo });
});

/** POST /api/support/service/telegram/delier — `/delier` envoyé au bot. */
export const delierTelegramService = asyncHandler(async (req, res) => {
  const delie = await telegram.delierConversation(req.body.conversation);
  return res.json({ succes: true, delie });
});

/** GET /api/support/service/telegram/compte — le résumé étroit du compte rattaché. */
export const compteTelegramService = asyncHandler(async (req, res) => {
  const compte = await telegram.resumeCompte(req.query.conversation);
  return res.json({ succes: true, compte });
});

/* ================================================================== *
 *  RÉPONDRE À LA PERSONNE — depuis Telegram ou depuis le back-office
 * ================================================================== */

/**
 * QUI AGIT, DERRIÈRE LA CLÉ DE SERVICE ?
 *
 * La clé prouve que l'appel vient de n8n ; elle ne dit pas qui parle. Ces
 * trois routes exigent donc, EN PLUS, une conversation Telegram rattachée à un
 * compte administrateur : c'est elle qui porte l'identité, et le dossier est
 * ensuite instruit à ce nom-là, pas au nom du service.
 */
const administrateurDuBot = (req) =>
  telegram.administrateurDeConversation(req.body?.conversation ?? req.query?.conversation);

/** GET /api/support/service/tickets/:reference — le dossier à traiter. */
export const dossierParReferenceService = asyncHandler(async (req, res) => {
  const administrateur = await administrateurDuBot(req);
  const ticket = await support.parReference(req.params.reference);

  return res.json({
    succes: true,
    administrateur: administrateur.pseudo,
    dossier: ticket.versionExploitant(),
  });
});

/** POST /api/support/service/tickets/:reference/brouillon — l'agent a rédigé. */
export const brouillonService = asyncHandler(async (req, res) => {
  const administrateur = await administrateurDuBot(req);
  const ticket = await support.parReference(req.params.reference);
  const dossier = await support.enregistrerBrouillon(ticket, administrateur, req.body.texte);

  return res.json({ succes: true, dossier });
});

/** POST /api/support/service/tickets/:reference/envoyer — l'exploitant a validé. */
export const envoyerService = asyncHandler(async (req, res) => {
  const administrateur = await administrateurDuBot(req);
  const ticket = await support.parReference(req.params.reference);
  const { ticket: dossier, canal } = await support.envoyerReponse(ticket, administrateur);

  return res.json({ succes: true, canal, dossier });
});

/** PATCH /api/admin/support/tickets/:id/brouillon — le même brouillon, au clavier. */
export const brouillonAdmin = asyncHandler(async (req, res) => {
  const ticket = await support.parIdentifiant(req.params.id);
  const dossier = await support.enregistrerBrouillon(ticket, req.user, req.body.texte);

  return res.json({ succes: true, dossier });
});

/** POST /api/admin/support/tickets/:id/envoyer — validation depuis le back-office. */
export const envoyerAdmin = asyncHandler(async (req, res) => {
  const ticket = await support.parIdentifiant(req.params.id);
  const { ticket: dossier, canal } = await support.envoyerReponse(ticket, req.user);

  return res.json({ succes: true, canal, dossier });
});

/**
 * POST /api/support/tickets/:id/vu
 *
 * L'auteur a vu, dans le widget, qu'une réponse lui était partie par courriel.
 * Sans cela, l'avis se réafficherait à chaque ouverture.
 */
export const marquerTicketVu = asyncHandler(async (req, res) => {
  await support.marquerVueParAuteur(req.user._id, req.params.id);
  return res.json({ succes: true });
});
