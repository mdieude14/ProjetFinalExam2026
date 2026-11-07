import mongoose from 'mongoose';

import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import Follow from '../models/Follow.js';
import Relation from '../models/Relation.js';
import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { motifPrefixe } from '../utils/texte.js';
import { idsMasquesPour } from './access.service.js';

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
 *  CHOISIR UN DESTINATAIRE
 * ================================================================== */

/** Nombre de destinataires proposés, et plafond dur. */
const DESTINATAIRES_DEFAUT = 10;
const DESTINATAIRES_MAX = 30;

/** Les champs dont `versionPublique()` a besoin pour être complète. */
const CHAMPS_PUBLICS =
  'pseudo nom prenom avatar bio type ville sports diplome premium stripeAccount stats visibilite createdAt';

/**
 * Cherche, parmi MES relations acceptées, à qui je peux écrire.
 *
 * POURQUOI CE POINT D'ENTRÉE EXISTE PLUTÔT QUE DE RÉUTILISER LES LISTES
 * D'ABONNÉS. `GET /follow/:identifiant/abonnes` est paginé, n'accepte aucun
 * filtre texte, et RECALE au passage le compteur dénormalisé du profil. Le
 * réutiliser pour une saisie au clavier voudrait dire charger des pages
 * entières pour les filtrer dans le navigateur — donc ne jamais trouver
 * quelqu'un au-delà de la première page — et déclencher une écriture à
 * chaque frappe.
 *
 * LES DEUX SENS COMPTENT. Un abonné (il me suit) comme un abonnement (je le
 * suis) sont des liens que l'un des deux a posés, et les deux ouvrent le
 * droit d'écrire. Ce n'est pas pour autant un droit d'être LU :
 * `ouvrirConversation` place ensuite la conversation dans le sas quand la
 * cible ne me suit pas, et la restriction l'y remet même entre abonnés.
 *
 * CE QUI EST EXCLU ICI L'EST POUR LA MÊME RAISON QU'AILLEURS — un blocage
 * dans l'un ou l'autre sens, un compte désactivé — et par les MÊMES helpers.
 * Proposer quelqu'un que `ouvrirConversation` refuserait ensuite en 404
 * offrirait une impasse à l'utilisateur, et le 404 y perdrait sa discrétion :
 * la liste aurait déjà confirmé que le compte existe.
 */
export async function rechercherDestinataires(utilisateur, { q, limite } = {}) {
  const plafond = Math.min(
    Math.max(Number.parseInt(limite, 10) || DESTINATAIRES_DEFAUT, 1),
    DESTINATAIRES_MAX
  );

  /*
   * LES DEUX SENS EN UNE SEULE REQUÊTE. `statut: 'accepte'` écarte les
   * demandes de suivi encore pendantes : une demande non acceptée n'est pas
   * un lien, et s'en servir pour écrire contournerait le profil privé.
   */
  const liens = await Follow.find({
    statut: 'accepte',
    $or: [{ follower: utilisateur._id }, { following: utilisateur._id }],
  })
    .select('follower following')
    .lean();

  if (liens.length === 0) return [];

  const moi = String(utilisateur._id);
  const ids = [
    ...new Set(
      liens.map((l) => (String(l.follower) === moi ? String(l.following) : String(l.follower)))
    ),
  ].filter((id) => id !== moi);

  if (ids.length === 0) return [];

  const masques = (await idsMasquesPour(utilisateur)).map(String);
  const retenus = masques.length ? ids.filter((id) => !masques.includes(id)) : ids;
  if (retenus.length === 0) return [];

  const filtre = { _id: { $in: retenus }, isActive: true };

  /*
   * RECHERCHE PAR PRÉFIXE, PAS PAR `$text`. On répond à une frappe au
   * clavier : `$text` cherche des mots entiers et ne trouve jamais « Martin »
   * sur « mar ». Même choix et même index que `suggestions()` du module 10.
   *
   * En dessous de deux lettres, `motifPrefixe` rend `null` : on ne propose
   * alors RIEN plutôt que tout le carnet d'adresses, qui n'aiderait personne
   * à choisir.
   */
  const saisie = typeof q === 'string' ? q.trim() : '';
  if (saisie) {
    const motif = motifPrefixe(saisie);
    if (!motif) return [];
    filtre.termesRecherche = motif;
  }

  /*
   * SANS SAISIE, ON PROPOSE QUAND MÊME. Ouvrir la fenêtre sur une liste vide
   * obligerait à deviner un nom avant de voir quoi que ce soit ; les comptes
   * les plus suivis d'abord donnent un point de départ.
   */
  const trouves = await User.find(filtre)
    .select(CHAMPS_PUBLICS)
    .sort({ 'stats.followersCount': -1, pseudo: 1 })
    .limit(plafond);

  return trouves.map((u) => u.versionPublique());
}

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

  /*
   * UN BLOCAGE FERME LA MESSAGERIE, DANS LES DEUX SENS.
   *
   * On repond 404 et non 403, comme partout ailleurs : un 403 confirmerait
   * l'existence du compte ET l'existence du blocage. Celui qui a bloque
   * apprendrait ainsi que l'autre a essaye de le joindre, et celui qui est
   * bloque saurait qu'il l'est precisement — deux informations qu'aucun des
   * deux n'a besoin d'obtenir par ce chemin.
   *
   * Le test porte sur les DEUX SENS : bloquer quelqu'un doit aussi
   * m'empecher de lui ecrire, sans quoi le blocage serait une passoire a
   * sens unique.
   */
  if (await Relation.blocageEntre(initiateur._id, cible._id)) {
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

  /*
   * LA RESTRICTION REMET LA CONVERSATION DANS LE SAS, meme entre abonnes.
   *
   * Sans cette ligne, restreindre quelqu'un qui vous suit deja ne changerait
   * rien a la messagerie : sa conversation s'ouvrirait directement en
   * « accepte », et ses messages continueraient d'arriver dans le fil
   * principal. C'est precisement ce que la restriction doit empecher.
   *
   * Et cela reste SILENCIEUX : l'expediteur voit une conversation ordinaire,
   * il ignore que ses messages attendent dans les demandes de l'autre.
   */
  const restreint = await Relation.estRestreintPar(cible._id, initiateur._id);
  const dejaSollicitee = relation === 'accepte' && !restreint;

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

  /*
   * LE BLOCAGE EST REVERIFIE A CHAQUE ENVOI, ET NON SEULEMENT A L'OUVERTURE.
   *
   * Le cas courant est celui-ci : la conversation existe depuis des mois,
   * puis l'un bloque l'autre. Sans ce controle, le fil deja ouvert resterait
   * une porte derobee — celui qui vient d'etre bloque continuerait d'ecrire
   * a celui qui l'a bloque, ce qui est exactement ce que le blocage vise a
   * empecher.
   */
  const autre = conversation.interlocuteurDe(expediteur._id);

  if (autre && (await Relation.blocageEntre(expediteur._id, autre._id || autre))) {
    throw ApiError.forbidden('Vous ne pouvez plus écrire dans cette conversation');
  }

  if (conversation.statut === 'refuse') {
    throw ApiError.forbidden('Cette conversation a été refusée');
  }

  /*
   * LE PLAFOND DU SAS NE S'APPLIQUE PAS A UN EXPEDITEUR RESTREINT, et cette
   * derogation est la condition du SILENCE.
   *
   * La restriction range la conversation dans les demandes (voir plus bas
   * dans envoyer()). Or une demande limite son auteur a un seul message tant
   * qu'elle n'est pas acceptee : sans cette derogation, la personne
   * restreinte se verrait refuser son deuxieme message par une erreur 403 —
   * et comprendrait immediatement qu'on l'a mise a l'ecart.
   *
   * On la laisse donc ecrire autant qu'elle veut. Ses messages partent dans
   * le dossier des demandes, ou ils attendent sans notifier personne.
   */
  const restreint = autre
    ? await Relation.estRestreintPar(autre._id || autre, expediteur._id)
    : false;

  if (restreint) return;

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
       * UNE RESTRICTION POSEE APRES COUP DOIT RETROGRADER LE FIL EXISTANT.
       *
       * Le cas ordinaire est celui-la : on discute depuis des semaines, puis
       * l'echange derape et l'on restreint. Si le fil restait « accepte »,
       * la restriction n'aurait aucun effet sur la messagerie — les messages
       * continueraient d'arriver dans la boite principale, ce qui est
       * exactement ce qu'elle sert a eviter.
       *
       * On le repasse donc en demande, avec l'expediteur pour demandeur. Le
       * destinataire retrouve l'echange dans son dossier « Demandes » et
       * decide s'il le rouvre ; l'expediteur, lui, ne voit rien changer.
       */
      const misALEcart =
        conversation.statut === 'accepte' &&
        (await Relation.estRestreintPar(destinataire?._id || destinataire, expediteur._id));

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
            ...(misALEcart
              ? { statut: 'en_attente', demandeur: expediteur._id }
              : {}),
          },
          $inc: { [`nonLus.${String(destinataire)}`]: 1 },

          /*
           * UN NOUVEAU MESSAGE RESSORT LA CONVERSATION DE LA CORBEILLE,
           * ET POUR LES DEUX PARTICIPANTS.
           *
           * Pour le DESTINATAIRE, c est une question de messages perdus : s il
           * avait supprime le fil, le message suivant lui serait invisible, et
           * supprimer vaudrait blocage silencieux.
           *
           * Pour l EXPEDITEUR aussi : ecrire a quelqu un apres avoir efface le
           * fil doit le rouvrir, sans quoi il enverrait dans le vide un message
           * qu il ne verrait nulle part.
           */
          $pull: { supprimeePar: { $in: [expediteur._id, destinataire] } },
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
  /*
   * UNE CONVERSATION QUE J AI SUPPRIMEE NE REVIENT PAS DANS MA LISTE.
   * Le filtre porte sur MOI seul : l autre garde son fil intact, puisque
   * supprimer une conversation ne la supprime que pour soi.
   */
  const filtre = {
    participants: utilisateur._id,
    supprimeePar: { $ne: utilisateur._id },
  };
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

/**
 * Les accuses de lecture sont-ils visibles de `idQuiApprend` ?
 *
 * LA DOUBLE COCHE EST UNE INFORMATION SUR LE DESTINATAIRE, pas sur le
 * message : elle dit « je t'ai lu ». Une personne restreinte ne doit pas
 * l'obtenir — sinon elle saurait que ses messages sont lus alors qu'ils
 * dorment dans le dossier des demandes, et pourrait s'etonner du silence.
 *
 * LA REGLE VIT ICI ET NON DANS LES DEUX CONTROLEURS qui la posent (la
 * lecture du fil et la diffusion temps reel). Ecrite deux fois, il suffirait
 * d'en corriger une pour que la coche reapparaisse par le second chemin.
 */
export async function accusesLectureVisibles(idQuiApprend, idQuiALu) {
  if (!idQuiApprend || !idQuiALu) return true;
  return !(await Relation.estRestreintPar(idQuiALu, idQuiApprend));
}

/**
 * Les messages de `idExpediteur` vers `idDestinataire` sont-ils mis a l'ecart ?
 *
 * MEME QUESTION QUE CI-DESSUS, POSEE DANS L'AUTRE SENS — d'ou une fonction
 * distincte plutot qu'une negation de la precedente au point d'appel. Lire
 * « accuses de lecture visibles » la ou l'on decide d'envoyer une
 * notification obligerait a refaire mentalement le raisonnement a chaque
 * relecture, et c'est ainsi qu'un sens finit par etre inverse.
 */
export async function messagesMisALEcart(idExpediteur, idDestinataire) {
  if (!idExpediteur || !idDestinataire) return false;
  return Relation.estRestreintPar(idDestinataire, idExpediteur);
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

/* ================================================================== *
 *  MODIFIER UN MESSAGE
 * ================================================================== */

/**
 * Réécrit le texte d'un message que J'AI envoyé.
 *
 * TROIS REFUS, ET CHACUN PROTÈGE AUTRE CHOSE.
 *
 *   1. `403` si je ne suis pas l'expéditeur. Réécrire les mots de quelqu'un
 *      d'autre serait la pire chose qu'une messagerie puisse permettre — pire
 *      qu'une suppression, parce qu'une suppression se voit.
 *   2. `409` sur un message déjà supprimé. Son contenu a été effacé, et le
 *      ressusciter par une modification contournerait la suppression.
 *   3. `400` sur un texte vide. « Modifier pour effacer » doit passer par la
 *      suppression, qui marque le message comme tel au lieu de laisser une
 *      bulle muette dans le fil.
 *
 * LA DATE EST POSÉE ICI, ET ELLE EST NON NÉGOCIABLE : c'est elle qui permet à
 * l'interface d'afficher « modifié ». Sans elle, une retouche serait
 * indétectable, et la messagerie cesserait d'être un compte rendu fiable de ce
 * qui a été dit.
 */
export async function modifierMessage(idMessage, utilisateur, contenu) {
  const message = await Message.findById(idMessage);
  if (!message) throw ApiError.notFound('Message introuvable');

  if (String(message.expediteur) !== String(utilisateur._id)) {
    throw ApiError.forbidden('Vous ne pouvez modifier que vos propres messages');
  }

  if (message.supprime) {
    throw ApiError.conflict('Ce message a été supprimé et ne peut plus être modifié');
  }

  const texte = String(contenu ?? '').trim();
  if (!texte) {
    throw ApiError.badRequest('Un message modifié ne peut pas être vide — supprimez-le plutôt');
  }

  /*
   * LA CONVERSATION DOIT ENCORE ÊTRE OUVERTE. Un blocage survenu depuis
   * l'envoi ferme la messagerie dans les deux sens : laisser modifier
   * contournerait cette fermeture, et notifierait l'autre d'une activité
   * qu'il a précisément cessé d'accepter.
   */
  const conversation = await Conversation.findById(message.conversation);
  if (!conversation) throw ApiError.notFound('Conversation introuvable');

  const autre = conversation.interlocuteurDe(utilisateur._id);
  if (autre && (await Relation.blocageEntre(utilisateur._id, autre._id || autre))) {
    throw ApiError.notFound('Conversation introuvable');
  }

  message.contenu = texte;
  message.modifieLe = new Date();
  await message.save();

  /*
   * L'EXTRAIT DE LA LISTE CONTIENT UNE COPIE DU TEXTE. Sans ce
   * rafraîchissement, la liste des conversations continuerait d'afficher
   * l'ancienne phrase — exactement le défaut que la suppression avait déjà
   * rencontré, et pour la même raison.
   */
  await rafraichirExtrait(message.conversation);

  return { message, conversation };
}

/* ================================================================== *
 *  SUPPRIMER UNE CONVERSATION — POUR SOI
 * ================================================================== */

/**
 * Retire la conversation de MA liste, et d'elle seule.
 *
 * POURQUOI CE N'EST PAS UNE SUPPRESSION TOUT COURT. Une conversation
 * appartient à deux personnes. L'effacer pour les deux détruirait les données
 * de quelqu'un qui n'a rien demandé — et rien, du côté de celui qui supprime,
 * ne justifie ce pouvoir sur l'autre. Les messages restent donc en base, et
 * l'autre garde son fil intact.
 *
 * `404` ET NON `403` SI JE N'EN FAIS PAS PARTIE : un 403 confirmerait que
 * cette conversation existe, et entre qui. Même règle qu'à l'ouverture.
 *
 * IDEMPOTENT PAR CONSTRUCTION : `$addToSet` ne crée pas de doublon, donc
 * deux clics sur « Supprimer » ne produisent pas deux états différents.
 */
export async function supprimerConversationPour(idConversation, utilisateur) {
  const conversation = await Conversation.findById(idConversation);
  if (!conversation || !conversation.contient(utilisateur._id)) {
    throw ApiError.notFound('Conversation introuvable');
  }

  /*
   * LE COMPTEUR DE NON-LUS EST REMIS À ZÉRO EN MÊME TEMPS.
   * Le laisser garnirait la pastille globale de messages non lus pour un fil
   * que l'utilisateur ne voit plus : un compteur qu'on ne peut pas faire
   * retomber, puisque la conversation a disparu de sa liste.
   */
  await Conversation.updateOne(
    { _id: conversation._id },
    {
      $addToSet: { supprimeePar: utilisateur._id },
      $set: { [`nonLus.${String(utilisateur._id)}`]: 0 },
    }
  );

  return conversation;
}

