import api from './axios';

/**
 * Appels liés à la messagerie privée.
 *
 * TOUT CE QUI PERSISTE PASSE PAR ICI, PAS PAR LE SOCKET.
 * Le temps réel ne sert qu'à recevoir : envoyer un message par le socket
 * créerait un second chemin d'écriture, avec sa propre validation et ses
 * propres oublis. C'est la décision structurante du module 11, et elle se
 * lit aussi bien côté client — il n'existe ici aucun `socket.emit` d'envoi.
 */
export const messageApi = {
  /** Ouvre une conversation, ou retrouve celle qui existe déjà. */
  /*
   * A qui puis-je ecrire : mes abonnes et mes abonnements, filtres par le
   * SERVEUR. `q` est facultatif — sans saisie, la fenetre propose les comptes
   * les plus suivis parmi mes relations plutot que de s ouvrir sur un vide.
   */
  destinataires: ({ q, limite } = {}) =>
    api.get('/messages/destinataires', { params: { q: q || undefined, limite } }),

  ouvrir: (destinataire) => api.post('/messages/conversations', { destinataire }),

  /** Mes conversations, les plus récemment actives en tête. */
  conversations: ({ statut, page, limite } = {}) =>
    api.get('/messages/conversations', {
      params: {
        ...(statut ? { statut } : {}),
        ...(page ? { page } : {}),
        ...(limite ? { limite } : {}),
      },
    }),

  /**
   * Messages d'une conversation.
   * `curseur` remonte le fil vers le passé — pagination stable même si un
   * message arrive pendant la lecture.
   */
  messages: (idConversation, { curseur, limite } = {}) =>
    api.get(`/messages/conversations/${idConversation}/messages`, {
      params: {
        ...(curseur ? { curseur } : {}),
        ...(limite ? { limite } : {}),
      },
    }),

  /**
   * Envoie un message.
   *
   * `FormData` DÈS QU'IL Y A UN FICHIER, et surtout sans en-tête forcé :
   * seule la couche navigateur sait produire la frontière `boundary` du
   * multipart. Fixer `Content-Type` à la main fait recevoir au serveur un
   * corps multipart annoncé comme du JSON — Multer ne trouve alors aucun
   * fichier, et l'envoi échoue en silence.
   */
  envoyer: (idConversation, { contenu, media } = {}) => {
    if (media) {
      const donnees = new FormData();
      if (contenu) donnees.append('contenu', contenu);
      donnees.append('media', media);
      return api.post(`/messages/conversations/${idConversation}/messages`, donnees);
    }

    return api.post(`/messages/conversations/${idConversation}/messages`, { contenu });
  },

  /** Accepte ou refuse une demande de chat. */
  repondreDemande: (idConversation, action) =>
    api.patch(`/messages/conversations/${idConversation}`, { action }),

  /** Remet le compteur de non-lus à zéro. */
  marquerLu: (idConversation) =>
    api.post(`/messages/conversations/${idConversation}/lu`),

  /** Total pour la pastille de la navigation. */
  nonLus: () => api.get('/messages/non-lus'),

  /** Reecrit le texte d un de MES messages. Le serveur pose la date de modification. */
  modifier: (idMessage, contenu) => api.patch(`/messages/${idMessage}`, { contenu }),

  supprimer: (idMessage) => api.delete(`/messages/${idMessage}`),

  /*
   * Retire la conversation de MA liste, et d elle seule : l autre
   * participant garde son fil. Un nouveau message la fait revenir.
   */
  supprimerConversation: (idConversation) =>
    api.delete(`/messages/conversations/${idConversation}`),

  /** Aime un message, ou retire son like. Le serveur decide du sens. */
  basculerLike: (idMessage) => api.post(`/messages/${idMessage}/like`),
};

export default messageApi;
