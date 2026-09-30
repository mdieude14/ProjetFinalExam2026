import Ticket, { referenceDe } from '../models/Ticket.js';
import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { envoyerMail } from './mail.service.js';

/**
 * ===========================================================================
 *  SUPPORT — règles du journal des tickets
 * ===========================================================================
 *
 * Ce service porte les décisions qui ne doivent exister qu'à un seul endroit :
 * qui peut lire quel ticket, quand un ticket s'escalade, et ce que l'agent a
 * le droit d'écrire dedans. Les contrôleurs traduisent du HTTP ; ces règles
 * n'en dépendent pas et sont appelées aussi par la file de l'exploitant.
 *
 * DEUX ZONES DE CONFIANCE, ET ELLES NE COMMUNIQUENT QUE PAR CETTE COLLECTION.
 * La zone utilisateur — joignable depuis le widget de chat — crée et relit ses
 * propres tickets. La zone exploitant relève ceux qui ont été escaladés. Aucun
 * appel direct d'un agent à l'autre : le lien est asynchrone, et il passe par
 * la base. C'est la même précaution qu'au module 11, où le socket ne peut rien
 * écrire — une seule voie d'écriture, et elle est vérifiable.
 * ===========================================================================
 */

/** Ce qu'un agent ne tranche jamais seul : la liste est fermée à dessein. */
export const MOTIFS_ESCALADE_AUTOMATIQUE = [
  'remboursement',
  'litige_diplome',
  'contestation_moderation',
  'signalement_grave',
];

/**
 * Enregistre un échange avec l'agent.
 *
 * L'AUTEUR VIENT DU JETON, PAS DU CORPS DE LA REQUÊTE. Le contrôleur passe
 * `req.user` ; accepter un identifiant fourni par l'appelant laisserait
 * n'importe qui écrire un ticket au nom d'un autre — et, pire, lire la suite
 * de la conversation de cet autre en relisant le ticket qu'il vient de créer.
 *
 * L'ESCALADE EST DÉCIDÉE ICI, PAS PAR L'AGENT. Un modèle de langage peut se
 * laisser convaincre de ne pas escalader ; une intention `decision` escalade
 * toujours, que l'agent l'ait demandé ou non.
 *
 * CE QUE SEUL L'AGENT PEUT ÉCRIRE. `parAgent` n'est vrai que si la clé
 * d'agent a été présentée (`agentIdentifie`). Sans elle :
 *
 *   - `reponse` et `outils` sont IGNORÉS. L'utilisateur détient le même jeton
 *     que n8n ; les accepter lui permettait d'écrire « l'agent m'a promis un
 *     remboursement » et de le présenter au back-office comme tel ;
 *   - le ticket S'ESCALADE toujours. « Résolu » veut dire que l'agent a
 *     répondu : sans agent, personne n'a répondu, et un ticket classé résolu
 *     finirait dans un onglet que personne ne lit pour agir.
 */
export async function enregistrer(
  utilisateur,
  { question, origine, intention, reponse, outils, motifEscalade },
  { parAgent = false } = {}
) {
  const escalade = !parAgent || intention === 'decision' || Boolean(motifEscalade);
  const motifParDefaut = parAgent ? 'demande de décision' : 'demande sans agent';

  const ticket = await Ticket.create({
    auteur: utilisateur._id,
    roleAuteur: utilisateur.type,
    question,
    origine,
    intention,
    reponse: parAgent ? reponse : undefined,
    outils: parAgent && Array.isArray(outils) ? outils : [],
    ecritParAgent: parAgent,
    statut: escalade ? 'escalade' : 'resolu',
    motifEscalade: escalade ? motifEscalade || motifParDefaut : undefined,
    escaladeLe: escalade ? new Date() : undefined,
  });

  return ticket;
}

/**
 * Les tickets d'une personne, du plus récent au plus ancien.
 *
 * Le filtre porte sur `auteur` et rien d'autre : c'est ce qui garantit qu'on
 * ne peut pas lire ceux d'un tiers, même en devinant un identifiant.
 */
export async function mesTickets(idUtilisateur, { saut = 0, limite = 20 } = {}) {
  const [elements, total] = await Promise.all([
    Ticket.find({ auteur: idUtilisateur }).sort({ createdAt: -1 }).skip(saut).limit(limite),
    Ticket.countDocuments({ auteur: idUtilisateur }),
  ]);

  return { elements: elements.map((t) => t.versionAuteur()), total };
}

/**
 * Un ticket précis, à condition qu'il soit le sien.
 *
 * ON RENVOIE 404 ET NON 403 quand le ticket appartient à un autre. Un 403
 * dirait « il existe, mais il n'est pas à vous » et confirmerait donc son
 * existence — même raisonnement qu'au module 9 pour les ressources nominatives.
 */
export async function monTicket(idUtilisateur, idTicket) {
  const ticket = await Ticket.findOne({ _id: idTicket, auteur: idUtilisateur });
  if (!ticket) throw ApiError.notFound('Ticket introuvable');
  return ticket.versionAuteur();
}

/* ================================================================== *
 *  ZONE EXPLOITANT
 * ================================================================== */

/**
 * La file de l'exploitant.
 *
 * LES PLUS ANCIENS D'ABORD, contrairement à « mes tickets ». Une file
 * d'attente se traite dans l'ordre d'arrivée ; présenter les plus récents en
 * premier laisserait les dossiers anciens au fond indéfiniment.
 */
export async function file({ statut = 'escalade', saut = 0, limite = 20 } = {}) {
  const filtre = statut === 'tous' ? {} : { statut };

  const [elements, total] = await Promise.all([
    Ticket.find(filtre)
      .populate('auteur', 'pseudo nom prenom type avatar email')
      // Le pseudo de l'instructeur seulement — de quoi écrire « par @… » dans
      // l'historique du back-office, comme pour les signalements.
      .populate('traitePar', 'pseudo')
      .sort({ createdAt: 1 })
      .skip(saut)
      .limit(limite),
    Ticket.countDocuments(filtre),
  ]);

  return { elements: elements.map((t) => t.versionExploitant()), total };
}

/**
 * Ce que l'assistant personnel doit annoncer, et qu'il n'a pas encore annoncé.
 *
 * POURQUOI UN DRAPEAU ET NON UN HORODATAGE DE DERNIÈRE RELÈVE. Un horodatage
 * obligerait l'appelant à se souvenir de son dernier passage, et un redémarrage
 * du workflow rejouerait les notifications ou en sauterait. Le drapeau vit avec
 * le ticket : il ne peut ni se désynchroniser, ni se perdre.
 */
export async function aNotifier({ limite = 20 } = {}) {
  const tickets = await Ticket.find({ statut: 'escalade', notifieExploitant: false })
    .populate('auteur', 'pseudo nom prenom type email')
    .sort({ createdAt: 1 })
    .limit(limite);

  return tickets.map((t) => t.versionExploitant());
}

/**
 * À QUELLES CONVERSATIONS TELEGRAM UNE ESCALADE DOIT-ELLE PARTIR.
 *
 * LA DESTINATION EST UNE DONNÉE, PLUS UN RÉGLAGE RECOPIÉ À LA MAIN. Elle
 * vivait auparavant dans un champ de l'éditeur n8n, saisi une fois. Un
 * `import:workflow` — qui REMPLACE le workflow par le fichier du dépôt — l'a
 * effacée, et n8n a cessé d'exécuter la relève pendant des heures sans que
 * personne ne le sache : un paramètre requis vide met le workflow « en
 * défaut », et n8n le refuse AVANT de l'exécuter. Aucune erreur visible, aucune
 * escalade annoncée. Ce qui ne peut pas être régénéré ne doit pas vivre dans
 * un workflow.
 *
 * CE QUE CELA RÉVÈLE À LA CLÉ DE SERVICE : des identifiants de conversation
 * Telegram de l'équipe, et rien d'autre. Un tel identifiant n'ouvre rien sans
 * le jeton du bot — celui-là même que n8n détient déjà pour écrire. C'est donc
 * le strict nécessaire à ce que la relève doit faire.
 *
 * SEULS LES ADMINISTRATEURS ACTIFS. Un compte fermé par la modération cesse de
 * recevoir les dossiers, sans qu'il faille penser à le délier ; un compte qui
 * n'est plus de l'équipe non plus.
 */
export async function destinationsTelegram() {
  const equipe = await User.find({
    type: 'admin',
    isActive: true,
    'telegram.conversation': { $exists: true, $ne: null },
  }).select('+telegram.conversation pseudo');

  return equipe
    .map((u) => ({ pseudo: u.pseudo, conversation: String(u.telegram?.conversation ?? '') }))
    .filter((d) => d.conversation.length > 0);
}

/**
 * Marque des tickets comme annoncés.
 *
 * L'ÉCRITURE EST SÉPARÉE DE LA LECTURE, et c'est délibéré. Marquer au moment
 * de la lecture perdrait la notification si l'envoi Telegram échouait ensuite :
 * le ticket serait réputé annoncé sans l'avoir été. L'appelant marque APRÈS
 * avoir eu confirmation de l'envoi.
 */
export async function marquerNotifies(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 0;

  const resultat = await Ticket.updateMany(
    { _id: { $in: ids }, notifieExploitant: false },
    { $set: { notifieExploitant: true } }
  );

  return resultat.modifiedCount;
}

/**
 * Instruit un dossier escaladé.
 *
 * Le ticket est CONSERVÉ, jamais supprimé — même choix qu'au module 14 pour
 * les signalements : un dossier classé reste consultable, et l'instructeur
 * reste identifié.
 *
 * UNE DÉCISION HUMAINE NE S'ÉCRASE PAS. Le premier jet ne protégeait que le
 * statut « clos » : un dossier instruit en « resolu » pouvait l'être une
 * seconde fois, et la seconde décision remplaçait la première — `traitePar`
 * compris, si bien que l'historique perdait jusqu'à l'identité de celui qui
 * avait tranché. Le critère est donc « un humain a-t-il déjà décidé », pas
 * le statut.
 *
 * LE CONTRÔLE ET L'ÉCRITURE SONT UNE SEULE OPÉRATION. Lire, vérifier puis
 * enregistrer laisserait deux administrateurs validant au même instant
 * passer tous deux la vérification — et le dernier enregistrement
 * l'emporterait. Le filtre de `findOneAndUpdate` est évalué par MongoDB au
 * moment de l'écriture : un seul des deux peut le satisfaire.
 */
export async function trancher(idTicket, administrateur, { decision, statut = 'clos' }) {
  const ticket = await Ticket.findOneAndUpdate(
    // `traitePar: null` couvre le champ absent comme le champ nul.
    { _id: idTicket, traitePar: null, statut: { $ne: 'clos' } },
    {
      $set: {
        statut,
        decision,
        traitePar: administrateur._id,
        traiteLe: new Date(),
      },
    },
    { new: true, runValidators: true }
  );

  if (ticket) return ticket.versionExploitant();

  // Aucun document modifié : il reste à dire pourquoi.
  const existe = await Ticket.exists({ _id: idTicket });
  if (!existe) throw ApiError.notFound('Ticket introuvable');
  throw ApiError.conflict('Ce dossier a déjà été instruit');
}

/** Compteurs de la file, pour le back-office et le résumé Telegram. */
export async function statistiques() {
  const parStatut = await Ticket.aggregate([
    { $group: { _id: '$statut', total: { $sum: 1 } } },
  ]);

  const parIntention = await Ticket.aggregate([
    { $match: { intention: { $ne: null } } },
    { $group: { _id: '$intention', total: { $sum: 1 } } },
  ]);

  const enAttente = await Ticket.countDocuments({ statut: 'escalade' });

  return {
    parStatut: Object.fromEntries(parStatut.map((l) => [l._id, l.total])),
    parIntention: Object.fromEntries(parIntention.map((l) => [l._id, l.total])),
    enAttente,
  };
}

/* ================================================================== *
 *  RÉPONDRE À LA PERSONNE — brouillon, puis validation
 * ================================================================== */

/**
 * Retrouve un dossier par sa référence courte, celle qui figure dans le
 * message Telegram.
 *
 * LA RECHERCHE PORTE SUR LES HUIT DERNIERS SIGNES DE L'IDENTIFIANT, comparés
 * côté base. On ne stocke pas la référence dans un champ à part : ce serait
 * une seconde source de vérité à tenir cohérente, et les tickets déjà en base
 * en seraient dépourvus.
 *
 * DEUX DOSSIERS QUI PARTAGERAIENT LA MÊME RÉFÉRENCE SONT REFUSÉS plutôt que
 * départagés au hasard : répondre au mauvais utilisateur serait pire que de
 * demander à l'exploitant de passer par le back-office.
 */
export async function parReference(reference) {
  const cherchee = String(reference ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(cherchee)) throw ApiError.badRequest('Référence invalide');

  const trouves = await Ticket.find({
    $expr: { $eq: [{ $substrCP: [{ $toString: '$_id' }, 16, 8] }, cherchee] },
  })
    .populate('auteur', 'pseudo nom prenom type email')
    .limit(2);

  if (trouves.length === 0) throw ApiError.notFound('Dossier introuvable');
  if (trouves.length > 1) throw ApiError.conflict('Référence ambiguë : passez par le back-office');

  return trouves[0];
}

/** Le même dossier, par son identifiant complet — pour le back-office. */
export async function parIdentifiant(idTicket) {
  const ticket = await Ticket.findById(idTicket).populate('auteur', 'pseudo nom prenom type email');
  if (!ticket) throw ApiError.notFound('Dossier introuvable');
  return ticket;
}

/**
 * Enregistre un brouillon de réponse. Il se réécrit autant de fois qu'on veut.
 *
 * UN DOSSIER DÉJÀ RÉPONDU N'EN ACCEPTE PLUS : une fois le courriel parti, le
 * réécrire ne changerait rien pour la personne, et laisserait croire le
 * contraire.
 */
export async function enregistrerBrouillon(ticket, administrateur, texte) {
  const propre = String(texte ?? '').trim();
  if (propre.length < 10) throw ApiError.badRequest('Le brouillon est trop court');
  if (ticket.reponseEnvoyeeLe) throw ApiError.conflict('Une réponse a déjà été envoyée pour ce dossier');

  const maj = await Ticket.findOneAndUpdate(
    { _id: ticket._id, reponseEnvoyeeLe: null },
    { $set: { brouillonReponse: propre.slice(0, 4000), brouillonLe: new Date(), traitePar: administrateur._id } },
    { new: true, runValidators: true }
  ).populate('auteur', 'pseudo nom prenom type email');

  if (!maj) throw ApiError.conflict('Une réponse a déjà été envoyée pour ce dossier');
  return maj.versionExploitant();
}

/**
 * Valide le brouillon et l'envoie à la personne.
 *
 * L'ÉCRITURE EST ATOMIQUE, et le filtre exige qu'aucune réponse ne soit déjà
 * partie. Deux validations simultanées — une depuis Telegram, une depuis le
 * back-office — ne peuvent donc pas envoyer deux courriels.
 *
 * L'ENVOI A LIEU APRÈS le verrouillage du dossier, jamais avant : si le
 * courriel échoue, le dossier est rouvert par le même chemin, et rien n'a été
 * annoncé à tort.
 */
export async function envoyerReponse(ticket, administrateur) {
  const texte = (ticket.brouillonReponse ?? '').trim();
  if (!texte) throw ApiError.badRequest('Aucun brouillon à envoyer pour ce dossier');

  const maintenant = new Date();
  const verrouille = await Ticket.findOneAndUpdate(
    { _id: ticket._id, reponseEnvoyeeLe: null },
    {
      $set: {
        reponseExploitant: texte,
        reponseEnvoyeeLe: maintenant,
        statut: 'clos',
        traitePar: administrateur._id,
        traiteLe: maintenant,
      },
    },
    { new: true, runValidators: true }
  ).populate('auteur', 'pseudo nom prenom type email');

  if (!verrouille) throw ApiError.conflict('Une réponse a déjà été envoyée pour ce dossier');

  const adresse = verrouille.auteur?.email;
  if (!adresse) {
    // Compte supprimé entre-temps : le dossier reste clos, rien à envoyer.
    return { ticket: verrouille.versionExploitant(), canal: null };
  }

  let canal;
  try {
    canal = await envoyerMail({
      a: adresse,
      sujet: `Réponse à votre demande — CoachConnect (réf. ${referenceDe(verrouille._id)})`,
      texte,
    });
  } catch (erreur) {
    // L'envoi a échoué : on rouvre, pour que le dossier reparaisse dans la file.
    await Ticket.updateOne(
      { _id: verrouille._id },
      { $set: { statut: 'escalade' }, $unset: { reponseExploitant: 1, reponseEnvoyeeLe: 1, traiteLe: 1 } }
    );
    throw ApiError.internal(`L’envoi du courriel a échoué : ${erreur.message}`);
  }

  await Ticket.updateOne({ _id: verrouille._id }, { $set: { reponseCanal: canal } });
  verrouille.reponseCanal = canal;

  return { ticket: verrouille.versionExploitant(), canal };
}

/**
 * L'auteur a vu, dans le widget, qu'une réponse lui était partie.
 *
 * ON NE MARQUE QUE LES SIENS, et seulement ceux dont une réponse est partie :
 * un identifiant pris au hasard ne peut pas servir à sonder les dossiers des
 * autres — la réponse est la même, qu'il existe ou non.
 */
export async function marquerVueParAuteur(idAuteur, idTicket) {
  await Ticket.updateOne(
    { _id: idTicket, auteur: idAuteur, reponseEnvoyeeLe: { $ne: null }, vueParAuteurLe: null },
    { $set: { vueParAuteurLe: new Date() } }
  );
  return true;
}
