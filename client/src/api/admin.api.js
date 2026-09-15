import api from './axios';

/**
 * Appels du back-office de moderation.
 * Toutes ces routes renvoient 403 si le compte connecte n'est pas admin :
 * la garde AdminRoute cote front n'est qu'un confort d'affichage.
 */
export const adminApi = {
  /**
   * File d'attente de verification des diplomes.
   * @param {'non_soumis'|'en_attente'|'verifie'|'refuse'} statut
   */
  diplomes: ({ statut = 'en_attente', page = 1, limite = 20 } = {}) =>
    api.get('/admin/diplomes', { params: { statut, page, limite } }),

  /** Verification ou refus. Le motif est obligatoire en cas de refus. */
  deciderDiplome: (idCoach, decision, motifRefus) =>
    api.patch(`/admin/diplomes/${idCoach}`, { decision, motifRefus }),

  /** Activation ou desactivation d'un compte. */
  changerStatutCompte: (idUtilisateur, isActive) =>
    api.patch(`/admin/users/${idUtilisateur}/statut`, { isActive }),

  /**
   * File des signalements. Par defaut les dossiers ouverts, du plus ancien
   * au plus recent — celui qui attend depuis trois jours passe en premier.
   */
  signalements: ({ statut = 'ouvert', page = 1, limite = 20 } = {}) =>
    api.get('/admin/signalements', { params: { statut, page, limite } }),

  /**
   * Instruction d'un signalement.
   * @param {'traiter'|'rejeter'} decision
   */
  deciderSignalement: (idSignalement, decision, commentaire) =>
    api.patch(`/admin/signalements/${idSignalement}`, { decision, commentaire }),

  /** Indicateurs de la plateforme. */
  stats: () => api.get('/admin/stats'),
};

export default adminApi;
