import Conversation from '../models/Conversation.js';
import { salleDe } from './index.js';

/**
 * ===========================================================================
 *  ÉVÉNEMENTS DE CONVERSATION
 * ===========================================================================
 *
 * CE FICHIER NE CONTIENT AUCUNE ÉCRITURE EN BASE, et ce n'est pas un oubli.
 * Les seuls événements acceptés du client sont ÉPHÉMÈRES : « je suis en train
 * d'écrire », « j'ai arrêté ». Ils ne laissent aucune trace, n'accordent
 * aucun droit, et leur perte n'a aucune conséquence — exactement ce qu'on
 * peut se permettre de confier à un canal temps réel.
 *
 * Tout ce qui persiste passe par HTTP.
 */

/** Au-delà, l'indicateur de saisie s'éteint tout seul. */
const SAISIE_MS = 4000;

/**
 * Vérifie que l'appelant participe bien à la conversation qu'il désigne.
 *
 * INDISPENSABLE MÊME POUR UN INDICATEUR DE SAISIE.
 * L'identifiant de conversation vient du client : sans ce contrôle, on peut
 * envoyer « X est en train d'écrire » dans n'importe quel fil, y compris
 * ceux où l'on n'a rien à faire. Le dégât est modeste — un faux indicateur —
 * mais c'est une fuite : elle révèle qu'une conversation existe, et permet de
 * se signaler à quelqu'un qui a précisément refusé le contact.
 */
async function participantsAutorises(idConversation, idUtilisateur) {
  if (!idConversation || typeof idConversation !== 'string') return null;

  const conversation = await Conversation.findById(idConversation)
    .select('participants statut')
    .lean();

  if (!conversation) return null;

  const participe = conversation.participants.some(
    (p) => String(p) === String(idUtilisateur)
  );
  if (!participe) return null;

  // Une conversation refusée ne doit plus rien laisser passer, pas même un
  // indicateur de saisie : ce serait un moyen détourné de se rappeler au
  // souvenir de quelqu'un qui a dit non.
  if (conversation.statut === 'refuse') return null;

  return conversation.participants.map(String);
}

export function brancherChat(io, socket) {
  const moi = socket.utilisateur._id;

  /**
   * « Je suis en train d'écrire. »
   *
   * ÉMIS VERS L'AUTRE, JAMAIS VERS SOI. Se voir soi-même « en train
   * d'écrire » est le défaut classique de ces indicateurs : on diffuse à la
   * salle de la conversation en oubliant d'exclure l'émetteur.
   */
  socket.on('saisie:debut', async ({ conversation } = {}) => {
    const participants = await participantsAutorises(conversation, moi);
    if (!participants) return;

    for (const id of participants) {
      if (id === moi) continue;
      io.to(salleDe(id)).emit('saisie:debut', {
        conversation,
        utilisateur: moi,
        expireDans: SAISIE_MS,
      });
    }
  });

  socket.on('saisie:fin', async ({ conversation } = {}) => {
    const participants = await participantsAutorises(conversation, moi);
    if (!participants) return;

    for (const id of participants) {
      if (id === moi) continue;
      io.to(salleDe(id)).emit('saisie:fin', { conversation, utilisateur: moi });
    }
  });

  /**
   * Sonde de bon fonctionnement, utilisée par les tests.
   *
   * Elle renvoie l'identité que le SERVEUR attribue au socket — pas celle que
   * le client prétend avoir. C'est ce qui permet de vérifier noir sur blanc
   * qu'un jeton falsifié n'obtient pas l'identité qu'il revendique.
   */
  socket.on('moi', (repondre) => {
    if (typeof repondre === 'function') {
      repondre({ _id: moi, pseudo: socket.utilisateur.pseudo, salle: salleDe(moi) });
    }
  });
}
