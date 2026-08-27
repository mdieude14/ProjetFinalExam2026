import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { lirePagination, reponsePaginee } from '../utils/pagination.js';

import Conversation from '../models/Conversation.js';
import * as messageService from '../services/message.service.js';
import * as storage from '../services/storage.service.js';
import { diffuserA } from '../sockets/index.js';
import * as notifications from '../services/notification.service.js';

/**
 * ===========================================================================
 *  MESSAGERIE
 * ===========================================================================
 *
 * LE SCHÉMA EST TOUJOURS LE MÊME, ET C'EST VOULU :
 *   1. le service écrit et autorise ;
 *   2. le contrôleur répond en HTTP ;
 *   3. puis, et seulement ensuite, on diffuse aux sockets concernés.
 *
 * La diffusion vient EN DERNIER parce qu'elle ne doit jamais conditionner
 * l'écriture. Si le temps réel est indisponible — serveur redémarré, client
 * hors ligne —, le message est déjà en base et l'appelant a déjà sa réponse.
 * Le destinataire le verra à sa prochaine lecture. L'inverse, diffuser avant
 * d'écrire, produirait des messages affichés puis disparus.
 */

/** Identifiants des deux participants, en chaînes. */
const idsDe = (conversation) =>
  conversation.participants.map((p) => String(p?._id || p));

/* ================================================================== *
 *  POST /api/messages/conversations
 * ================================================================== */

/** Ouvre une conversation avec quelqu'un, ou retrouve celle qui existe. */
export const ouvrir = asyncHandler(async (req, res) => {
  const conversation = await messageService.ouvrirConversation(
    req.user,
    req.body.destinataire
  );

  await conversation.populate(
    'participants',
    'pseudo nom prenom avatar type diplome isActive'
  );

  return res.status(201).json({
    succes: true,
    message: 'Conversation ouverte',
    conversation: conversation.versionPour(req.user._id),
  });
});

/* ================================================================== *
 *  GET /api/messages/conversations
 * ================================================================== */

export const listeConversations = asyncHandler(async (req, res) => {
  const { page, limite } = lirePagination(req);

  const { conversations, total } = await messageService.listeConversations(req.user, {
    statut: req.query.statut,
    page,
    limite,
  });

  const elements = conversations.map((c) => c.versionPour(req.user._id));

  return res.json(reponsePaginee(elements, total, { page, limite }));
});

/* ================================================================== *
 *  GET /api/messages/conversations/:id/messages
 * ================================================================== */

export const listeMessages = asyncHandler(async (req, res) => {
  const { conversation, messages, curseurSuivant } = await messageService.listeMessages(
    req.params.id,
    req.user,
    { curseur: req.query.curseur, limite: Number(req.query.limite) || 30 }
  );

  await conversation.populate(
    'participants',
    'pseudo nom prenom avatar type diplome isActive'
  );

  return res.json({
    succes: true,
    conversation: conversation.versionPour(req.user._id),
    messages: messages.map((m) => m.versionPublique()),
    curseurSuivant,
  });
});

/* ================================================================== *
 *  POST /api/messages/conversations/:id/messages
 * ================================================================== */

/**
 * Envoie un message.
 *
 * LE MÉDIA EST TÉLÉVERSÉ AVANT L'ÉCRITURE, comme aux modules 5 et 9 : si le
 * stockage échoue, aucun message fantôme ne reste en base. Et si c'est
 * l'écriture qui échoue, on nettoie le fichier — sans quoi chaque tentative
 * ratée laisserait chez Cloudinary une image que plus rien ne référence,
 * donc impossible à retrouver.
 */
export const envoyer = asyncHandler(async (req, res) => {
  let media;

  if (req.file) {
    const televerse = await storage.televerser(req.file, 'messages');
    media = {
      url: televerse.url,
      publicId: televerse.publicId,
      type: televerse.type || 'image',
      largeur: televerse.largeur,
      hauteur: televerse.hauteur,
    };
  }

  let resultat;
  try {
    resultat = await messageService.envoyer(req.params.id, req.user, {
      contenu: req.body.contenu,
      media,
    });
  } catch (erreur) {
    if (media?.publicId) await storage.supprimer(media.publicId, media.type);
    throw erreur;
  }

  const { message, conversation } = resultat;
  const vue = message.versionPublique();

  /*
   * DIFFUSION VERS LES DEUX PARTICIPANTS, y compris l'expéditeur.
   *
   * L'inclure paraît redondant — il vient de recevoir le message dans la
   * réponse HTTP. Mais il peut avoir plusieurs onglets ou appareils ouverts :
   * sans cette diffusion, le message écrit sur le téléphone n'apparaîtrait
   * jamais dans l'onglet resté ouvert sur l'ordinateur.
   *
   * Les destinataires sont relus DEPUIS LA CONVERSATION en base, jamais pris
   * dans la requête : c'est ce qui empêche d'adresser un message à quelqu'un
   * qui n'y participe pas.
   */
  diffuserA(idsDe(conversation), 'message:nouveau', {
    conversation: String(conversation._id),
    message: vue,
  });

  // Chaque participant reçoit SA vue de la conversation : les compteurs de
  // non-lus n'ont pas la même valeur des deux côtés.
  for (const id of idsDe(conversation)) {
    diffuserA([id], 'conversation:maj', {
      conversation: conversation.versionPour(id),
    });
  }

  /*
   * DEUX TYPES SELON L'ETAT DU FIL, et la distinction compte.
   *
   * Un premier message dans une conversation « en attente » est une DEMANDE :
   * le destinataire doit decider s'il accepte le contact. Un message dans une
   * conversation ouverte est un message ordinaire.
   *
   * Les confondre noierait les demandes parmi les messages courants — et une
   * demande qu'on ne remarque pas reste sans reponse, ce qui bloque
   * l'expediteur au premier message pour toujours.
   */
  const estPremiereDemande =
    conversation.statut === 'en_attente' &&
    String(conversation.demandeur) === String(req.user._id);

  await notifications.creerOuRegrouper({
    destinataire: idsDe(conversation).find((id) => id !== String(req.user._id)),
    emetteur: req.user._id,
    type: estPremiereDemande ? 'demande_chat' : 'message',
    cibleType: 'Conversation',
    cible: conversation._id,
  });

  return res.status(201).json({
    succes: true,
    message: 'Message envoyé',
    donnees: vue,
  });
});

/* ================================================================== *
 *  PATCH /api/messages/conversations/:id
 * ================================================================== */

/** Accepte ou refuse une demande de chat. */
export const repondreDemande = asyncHandler(async (req, res) => {
  const conversation = await messageService.repondreDemande(
    req.params.id,
    req.user,
    req.body.action === 'accepter'
  );

  await conversation.populate(
    'participants',
    'pseudo nom prenom avatar type diplome isActive'
  );

  for (const id of idsDe(conversation)) {
    diffuserA([id], 'conversation:maj', {
      conversation: conversation.versionPour(id),
    });
  }

  return res.json({
    succes: true,
    message:
      conversation.statut === 'accepte'
        ? 'Demande acceptée'
        : 'Demande refusée. Cette personne ne pourra plus vous écrire.',
    conversation: conversation.versionPour(req.user._id),
  });
});

/* ================================================================== *
 *  POST /api/messages/conversations/:id/lu
 * ================================================================== */

export const marquerLu = asyncHandler(async (req, res) => {
  const marques = await messageService.marquerLu(req.params.id, req.user);

  const conversation = await Conversation.findById(req.params.id);

  /*
   * ON PRÉVIENT L'EXPÉDITEUR QUE SES MESSAGES ONT ÉTÉ LUS.
   * C'est la double coche. Sans cette diffusion, elle n'apparaîtrait qu'au
   * rechargement de la page — c'est-à-dire jamais, dans un onglet resté
   * ouvert sur la conversation.
   */
  const autre = String(conversation.interlocuteurDe(req.user._id));
  diffuserA([autre], 'messages:lus', {
    conversation: String(conversation._id),
    par: String(req.user._id),
  });

  diffuserA([String(req.user._id)], 'conversation:maj', {
    conversation: conversation.versionPour(req.user._id),
  });

  return res.json({ succes: true, message: 'Conversation lue', marques });
});

/* ================================================================== *
 *  GET /api/messages/non-lus
 * ================================================================== */

/** Total pour la pastille de la navigation. */
export const nonLus = asyncHandler(async (req, res) => {
  const total = await messageService.totalNonLus(req.user._id);
  return res.json({ succes: true, nombre: total });
});

/* ================================================================== *
 *  DELETE /api/messages/:id
 * ================================================================== */

/**
 * Supprime un message — en douceur.
 *
 * SEUL L'EXPÉDITEUR SUPPRIME, ET LE DOCUMENT RESTE. Le retirer laisserait un
 * trou dans un fil que l'autre a déjà lu, et fausserait des compteurs déjà
 * incrémentés. Le média, lui, est réellement effacé du stockage : c'est le
 * contenu qu'on veut faire disparaître, pas la trace de l'échange.
 */
export const supprimer = asyncHandler(async (req, res) => {
  const Message = (await import('../models/Message.js')).default;

  const message = await Message.findById(req.params.id);
  if (!message) throw ApiError.notFound('Message introuvable');

  if (String(message.expediteur) !== String(req.user._id)) {
    throw ApiError.forbidden('Vous ne pouvez supprimer que vos propres messages');
  }

  if (message.media?.publicId) {
    await storage.supprimer(message.media.publicId, message.media.type);
  }

  message.supprime = true;
  message.media = undefined;
  message.contenu = undefined;
  await message.save();

  // L'extrait de la conversation contient une COPIE du texte : sans ce
  // rafraichissement, la phrase supprimee resterait affichee dans la liste.
  await messageService.rafraichirExtrait(message.conversation);

  const conversation = await Conversation.findById(message.conversation)
    .populate('participants', 'pseudo nom prenom avatar type diplome isActive');

  for (const id of idsDe(conversation)) {
    diffuserA([id], 'conversation:maj', { conversation: conversation.versionPour(id) });
  }

  diffuserA(idsDe(conversation), 'message:supprime', {
    conversation: String(conversation._id),
    message: String(message._id),
  });

  return res.json({ succes: true, message: 'Message supprimé' });
});
