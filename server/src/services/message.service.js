import mongoose from 'mongoose';

import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import Follow from '../models/Follow.js';
import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * ===========================================================================
 *  MESSAGERIE — LOGIQUE MÉTIER
 * ===========================================================================
 *
 * TOUT PASSE PAR CE FICHIER, y compris ce qui sera diffusé en temps réel.
 * Le module 11 aurait pu écrire les messages dans le gestionnaire de socket —
 * c'est plus direct, et c'est ce que montrent la plupart des exemples. Ce
 * serait aussi le moyen le plus sûr d'obtenir DEUX chemins d'écriture
 * divergents, chacun avec sa validation et ses oublis.
 *
 * Le socket ne fait que DIFFUSER ce que ce service a déjà écrit et autorisé.
 * ===========================================================================
 */

/** Extrait affiché dans la liste des conversations. */
const EXTRAIT_MAX = 200;

/* ================================================================== *
 *  OUVERTURE D'UNE CONVERSATION
 * ================================================================== */

/**
 * Ouvre — ou retrouve — la conversation entre deux personnes.
 *
 * LA RÈGLE DU SAS D'ENTRÉE.
 * Si la cible suit déjà l'initiateur, elle a manifesté un intérêt : la
 * conversation s'ouvre directement. Sinon, elle démarre `en_attente` — un
 * message passe, il faut bien pouvoir se présenter, mais les suivants
 * attendent un accord. Sans ce sas, n'importe qui écrit à n'importe qui
 * autant de fois qu'il le veut : c'est la définition du harcèlement par
 * messagerie.
 *
 * LA COURSE À L'OUVERTURE, ET POURQUOI ON NE LA TRAITE PAS « EN AMONT ».
 * Deux requêtes simultanées « ouvrir avec X » liraient toutes deux « aucune
 * conversation » et en créeraient deux. Chercher-puis-créer laisse exactement
 * cette fenêtre. On laisse donc la BASE trancher, via l'index unique sur la
 * paire triée : la seconde écriture échoue en 11000, et l'on relit ce que la
 * première a créé.
 */
export async function ouvrirConversation(initiateur, idCible) {
  if (String(initiateur._id) === String(idCible)) {
    throw ApiError.badRequest('Vous ne pouvez pas vous écrire à vous-même');
  }

  const cible = await User.findById(idCible);
  if (!cible || !cible.isActive) {
    throw ApiError.notFound('Utilisateur introuvable');
  }

  const paire = [initiateur._id, cible._id].sort((a, b) =>
    String(a).localeCompare(String(b))
  );

  const cle = Conversation.cleDe(initiateur._id, cible._id);

  const existante = await Conversation.findOne({ cle });
  if (existante) return existante;

  /*
   * « La cible me suit-elle ? » — donc `follower: cible`, `following: moi`.
   * L'inverse (moi qui la suis) ne prouve rien : suivre quelqu'un n'est pas
   * consentir à recevoir ses messages privés.
   */
  const relation = await Follow.statutRelation(cible._id, initiateur._id);
  const dejaSollicitee = relation === 'accepte';

  try {
    return await Conversation.create({
      participants: paire,
      demandeur: initiateur._id,
      statut: dejaSollicitee ? 'accepte' : 'en_attente',
    });
  } catch (erreur) {
    if (erreur?.code === 11000) {
      // L'autre requête a gagné la course : sa conversation fait foi.
      return Conversation.findOne({ cle });
    }
    throw erreur;
  }
}

/* ================================================================== *
 *  ENVOI D'UN MESSAGE
 * ================================================================== */

/**
 * Le droit d'écrire dans cette conversation, à cet instant.
 *
 * ISOLÉ DANS SA PROPRE FONCTION parce que la règle est appelée depuis l'envoi
 * ET vérifiée par les tests. Recopiée dans le contrôleur, elle finirait par
 * diverger de celle du service.
 */
async function verifierDroitEcriture(conversation, expediteur) {
  if (!conversation.contient(expediteur._id)) {
    throw ApiError.forbidden('Vous ne participez pas à cette conversation');
  }

  if (conversation.statut === 'refuse') {
    throw ApiError.forbidden('Cette conversation a été refusée');
  }

  if (conversation.statut === 'en_attente') {
    const estDemandeur = String(conversation.demandeur) === String(expediteur._id);

    /*
     * LE DEMANDEUR N'A DROIT QU'À UN SEUL MESSAGE tant que sa demande n'est
     * pas acceptée. C'est tout l'intérêt du sas : sans ce plafond, « en
     * attente » ne changerait rien pour l'expéditeur et le destinataire
     * recevrait autant de messages qu'auparavant.
     *
     * La cible, elle, écrit librement : lui répondre VAUT acceptation, et
     * l'obliger à cliquer « accepter » avant de pouvoir répondre serait une
     * étape de plus pour rien.
     */
    if (estDemandeur) {
      const dejaEnvoyes = await Message.countDocuments({
        conversation: conversation._id,
        expediteur: expediteur._id,
      });

      if (dejaEnvoyes >= 1) {
        throw ApiError.forbidden(
          'Votre demande n’a pas encore été acceptée : un seul message est permis'
        );
      }
    }
  }
}

/**
 * Écrit un message et met à jour le fil, en une seule transaction.
 *
 * TROIS ÉCRITURES QUI DOIVENT TENIR OU ÉCHOUER ENSEMBLE :
 *   1. le message lui-même ;
 *   2. l'extrait « dernier message » de la conversation ;
 *   3. le compteur de non-lus du destinataire.
 *
 * Séparées, un incident entre deux laisse un fil incohérent : un message
 * invisible dans la liste, ou une pastille qui ne correspond à rien et que
 * plus aucune lecture ne remet à zéro.
 *
 * @returns {Promise<{message: object, conversation: object}>}
 */
export async function envoyer(idConversation, expediteur, { contenu, media }) {
  const session = await mongoose.startSession();

  try {
    let message;
    let conversation;

    await session.withTransaction(async () => {
      conversation = await Conversation.findById(idConversation).session(session);
      if (!conversation) throw ApiError.notFound('Conversation introuvable');

      await verifierDroitEcriture(conversation, expediteur);

      const [creee] = await Message.create(
        [{ conversation: idConversation, expediteur: expediteur._id, contenu, media }],
        { session }
      );
      message = creee;

      const destinataire = conversation.interlocuteurDe(expediteur._id);

      /*
       * `$inc` SUR UNE CLÉ DE `Map`. La syntaxe pointée `nonLus.<id>` est la
       * seule qui permette d'incrémenter sans relire la Map entière : relire
       * puis réécrire rouvrirait la course que la transaction sert justement
       * à fermer.
       */
      await Conversation.updateOne(
        { _id: idConversation },
        {
          $set: {
            dernierMessage: {
              texte: (contenu || '').slice(0, EXTRAIT_MAX),
              expediteur: expediteur._id,
              date: creee.createdAt,
              avecMedia: Boolean(media),
            },
          },
          $inc: { [`nonLus.${String(destinataire)}`]: 1 },
        },
        { session }
      );
    });

    // Relu hors transaction pour renvoyer l'état à jour à l'appelant.
    const aJour = await Conversation.findById(idConversation);
    await message.populate('expediteur', 'pseudo nom prenom avatar');

    return { message, conversation: aJour };
  } finally {
    await session.endSession();
  }
}

/* ================================================================== *
 *  ACCEPTER, REFUSER
 * ================================================================== */

/**
 * Répond à une demande de chat.
 *
 * RÉSERVÉ À LA CIBLE. Laisser le demandeur accepter sa propre demande
 * viderait le sas de tout son sens — ce serait un bouton « ignorer le
 * consentement ».
 */
export async function repondreDemande(idConversation, utilisateur, accepter) {
  const conversation = await Conversation.findById(idConversation);
  if (!conversation) throw ApiError.notFound('Conversation introuvable');

  if (!conversation.contient(utilisateur._id)) {
    throw ApiError.forbidden('Vous ne participez pas à cette conversation');
  }

  if (String(conversation.demandeur) === String(utilisateur._id)) {
    throw ApiError.forbidden(
      'C’est à votre interlocuteur de répondre à votre demande'
    );
  }

  if (conversation.statut !== 'en_attente') {
    throw ApiError.conflict('Cette demande a déjà été traitée');
  }

  conversation.statut = accepter ? 'accepte' : 'refuse';
  await conversation.save();

  return conversation;
}

/* ================================================================== *
 *  LECTURE
 * ================================================================== */

/**
 * Marque la conversation comme lue pour cet utilisateur.
 *
 * DEUX ÉCRITURES, DEUX PORTÉES. Le compteur du fil retombe à zéro, et les
 * messages REÇUS passent à `lu`. On ne touche pas aux messages envoyés :
 * ouvrir une conversation ne signifie pas que l'autre a lu les nôtres.
 */
export async function marquerLu(idConversation, utilisateur) {
  const conversation = await Conversation.findById(idConversation);
  if (!conversation) throw ApiError.notFound('Conversation introuvable');

  if (!conversation.contient(utilisateur._id)) {
    throw ApiError.forbidden('Vous ne participez pas à cette conversation');
  }

  const [, resultat] = await Promise.all([
    Conversation.updateOne(
      { _id: idConversation },
      { $set: { [`nonLus.${String(utilisateur._id)}`]: 0 } }
    ),
    Message.updateMany(
      { conversation: idConversation, expediteur: { $ne: utilisateur._id }, lu: false },
      { $set: { lu: true } }
    ),
  ]);

  return resultat.modifiedCount;
}

/**
 * Conversations d'un utilisateur, les plus récemment actives en tête.
 *
 * ON TRIE SUR `updatedAt` ET NON SUR `dernierMessage.date` : une conversation
 * tout juste ouverte n'a pas encore de dernier message, et un tri sur une
 * date absente la reléguerait tout en bas — là où le destinataire d'une
 * demande de chat ne la verrait jamais.
 */
export async function listeConversations(utilisateur, { statut, page = 1, limite = 20 } = {}) {
  const filtre = { participants: utilisateur._id };
  if (statut) filtre.statut = statut;

  const saut = (page - 1) * limite;

  const [conversations, total] = await Promise.all([
    Conversation.find(filtre)
      .sort({ updatedAt: -1 })
      .skip(saut)
      .limit(limite)
      .populate('participants', 'pseudo nom prenom avatar type diplome isActive'),
    Conversation.countDocuments(filtre),
  ]);

  return { conversations, total };
}

/**
 * Messages d'une conversation, pagination par curseur.
 *
 * CURSEUR PLUTÔT QUE `skip`, pour la même raison qu'au module 5 : un message
 * qui arrive pendant qu'on remonte le fil décale tout, et l'on relit deux
 * fois la même bulle — ou l'on en saute une. Le curseur pointe sur un
 * élément précis, ce que l'arrivée d'un message ne déplace pas.
 */
export async function listeMessages(idConversation, utilisateur, { curseur, limite = 30 } = {}) {
  const conversation = await Conversation.findById(idConversation);
  if (!conversation) throw ApiError.notFound('Conversation introuvable');

  if (!conversation.contient(utilisateur._id)) {
    throw ApiError.forbidden('Vous ne participez pas à cette conversation');
  }

  const filtre = { conversation: idConversation };
  if (curseur) filtre._id = { $lt: new mongoose.Types.ObjectId(String(curseur)) };

  const messages = await Message.find(filtre)
    .sort({ _id: -1 })
    .limit(limite + 1)
    .populate('expediteur', 'pseudo nom prenom avatar');

  const encore = messages.length > limite;
  if (encore) messages.pop();

  return {
    conversation,
    // Renvoyés du plus ancien au plus récent : c'est l'ordre d'affichage,
    // et le faire ici évite que chaque appelant le refasse.
    messages: messages.reverse(),
    curseurSuivant: encore ? String(messages[0]._id) : null,
  };
}

/** Total de messages non lus, toutes conversations confondues. */
export async function totalNonLus(idUtilisateur) {
  const conversations = await Conversation.find(
    { participants: idUtilisateur, statut: { $ne: 'refuse' } },
    { nonLus: 1 }
  ).lean();

  const cle = String(idUtilisateur);

  /*
   * `.lean()` renvoie la Map sous forme d'objet simple : `get()` n'existe
   * pas ici, et l'appeler donnerait un `TypeError` à la première pastille.
   */
  return conversations.reduce(
    (total, conversation) => total + (conversation.nonLus?.[cle] || 0),
    0
  );
}

/**
 * Recalcule l'extrait « dernier message » d'une conversation.
 *
 * APPELÉ APRÈS UNE SUPPRESSION, et c'est le seul moment où il le faut.
 * L'extrait est une COPIE du texte, tenue à jour à chaque envoi. Supprimer
 * un message ne la touche pas : la phrase retirée continuerait de s'afficher
 * dans la liste des conversations — et de circuler dans la réponse HTTP.
 * C'est le prix de la dénormalisation, et l'oublier annule la suppression
 * là où elle est le plus visible.
 *
 * On relit le dernier message réel plutôt que de vider l'extrait : la
 * conversation retomberait sinon tout en bas de la liste, comme si plus rien
 * ne s'y était dit.
 */
export async function rafraichirExtrait(idConversation) {
  const dernier = await Message.findOne({ conversation: idConversation })
    .sort({ _id: -1 })
    .lean();

  if (!dernier) {
    await Conversation.updateOne(
      { _id: idConversation },
      { $unset: { dernierMessage: '' } }
    );
    return null;
  }

  const extrait = {
    texte: dernier.supprime ? '' : (dernier.contenu || '').slice(0, EXTRAIT_MAX),
    expediteur: dernier.expediteur,
    date: dernier.createdAt,
    avecMedia: Boolean(dernier.media) && !dernier.supprime,
    supprime: Boolean(dernier.supprime),
  };

  await Conversation.updateOne(
    { _id: idConversation },
    { $set: { dernierMessage: extrait } }
  );

  return extrait;
}
