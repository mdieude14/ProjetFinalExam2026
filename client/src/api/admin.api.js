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

  /**
   * File des tickets de support. Par defaut les dossiers escalades, du plus
   * ancien au plus recent — une file se traite dans l'ordre d'arrivee.
   * @param {'escalade'|'clos'|'resolu'|'tous'} statut
   */
  tickets: ({ statut = 'escalade', page = 1, limite = 20 } = {}) =>
    api.get('/admin/support/tickets', { params: { statut, page, limite } }),

  /**
   * Instruction d'un ticket. La decision est obligatoire : l'auteur la lira.
   * Un dossier deja instruit renvoie 409 — une decision humaine ne s'ecrase pas.
   */
  trancherTicket: (idTicket, decision) =>
    api.patch(`/admin/support/tickets/${idTicket}`, { decision, statut: 'clos' }),

  /**
   * Le courriel de reponse, tant qu'il n'est pas parti.
   *
   * LE MEME BROUILLON QUE CELUI DE TELEGRAM, a la ligne pres : les deux voies
   * ecrivent le meme champ du meme dossier. Un brouillon dicte au bot se relit
   * et se corrige ici, et reciproquement — c'est ce qui permet de commencer sur
   * un telephone et de finir au clavier.
   */
  enregistrerBrouillon: (idTicket, texte) =>
    api.patch(`/admin/support/tickets/${idTicket}/brouillon`, { texte }),

  /**
   * Validation : le brouillon EN BASE part chez l'auteur, et le dossier se clot.
   *
   * AUCUN TEXTE N'EST TRANSMIS ICI, et c'est voulu. Ce qui part est ce qui a
   * ete relu, pas ce que l'ecran croyait afficher. Un dossier deja repondu
   * renvoie 409 — deux validations ne font jamais deux courriels.
   */
  envoyerReponse: (idTicket) => api.post(`/admin/support/tickets/${idTicket}/envoyer`),

  /** Compteurs de la file de support. */
  statsSupport: () => api.get('/admin/support/stats'),
};

export default adminApi;
