import api from './axios';

/**
 * Appels lies aux notifications.
 *
 * AUCUNE FONCTION DE CREATION, et ce n'est pas un oubli. Une notification
 * nait d'une action reelle — un like, un message, une inscription — jamais
 * d'une requete qui la demanderait. Exposer une route de creation reviendrait
 * a laisser n'importe qui fabriquer des notifications chez n'importe qui.
 */
export const notificationApi = {
  /** Mes notifications, les plus recentes en tete. */
  liste: ({ nonLues, page, limite } = {}) =>
    api.get('/notifications', {
      params: {
        ...(nonLues ? { nonLues: 'true' } : {}),
        ...(page ? { page } : {}),
        ...(limite ? { limite } : {}),
      },
    }),

  /** Compteur pour la pastille de la navigation. */
  nonLues: () => api.get('/notifications/non-lues'),

  marquerLu: (id) => api.patch(`/notifications/${id}/lu`),

  toutMarquerLu: () => api.post('/notifications/tout-lu'),

  supprimer: (id) => api.delete(`/notifications/${id}`),
};

export default notificationApi;
