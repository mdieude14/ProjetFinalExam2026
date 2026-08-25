import api from './axios';

/**
 * Appels lies au suivi (follow gratuit).
 *
 * A ne pas confondre avec l'abonnement premium du module 7, qui passera par
 * `subscription.api.js` : ici tout est gratuit et instantane.
 */
export const followApi = {
  /**
   * Suivre un profil. Sur un profil prive, cree une demande en attente.
   * La reponse contient `statut` : « accepte » ou « en_attente ».
   */
  suivre: (identifiant) => api.post(`/follows/${identifiant}`),

  /** Se desabonner, ou annuler une demande encore en attente. */
  nePlusSuivre: (identifiant) => api.delete(`/follows/${identifiant}`),

  /* ----------------------------- Demandes ----------------------------- */

  demandes: ({ page = 1, limite = 20 } = {}) =>
    api.get('/follows/demandes', { params: { page, limite } }),

  /** Compteur seul, pour la pastille de la barre de navigation. */
  nombreDemandes: () => api.get('/follows/demandes/nombre'),

  accepter: (idDemande) => api.post(`/follows/demandes/${idDemande}/accepter`),

  refuser: (idDemande) => api.post(`/follows/demandes/${idDemande}/refuser`),

  /* ------------------------------ Listes ------------------------------ */

  abonnes: (identifiant, { page = 1, limite = 20 } = {}) =>
    api.get(`/follows/${identifiant}/abonnes`, { params: { page, limite } }),

  abonnements: (identifiant, { page = 1, limite = 20 } = {}) =>
    api.get(`/follows/${identifiant}/abonnements`, { params: { page, limite } }),

  /** Retirer quelqu'un de ses propres abonnes. */
  retirerAbonne: (identifiant) => api.delete(`/follows/abonnes/${identifiant}`),

  /** Coachs certifies suggeres, meme ville en priorite. */
  suggestions: (limite = 6) => api.get('/follows/suggestions', { params: { limite } }),
};

export default followApi;
