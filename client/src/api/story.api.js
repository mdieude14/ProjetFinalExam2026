import api from './axios';

/** Appels lies aux stories. */
export const storyApi = {
  /** Barre de stories : comptes suivis + les siennes, groupees par auteur. */
  barre: () => api.get('/stories'),

  /** Stories encore valides d'un profil. */
  parUtilisateur: (identifiant) => api.get(`/stories/utilisateur/${identifiant}`),

  /** Publication d'une story (visible 24 h). */
  creer: (fichier, { texte, estPremium } = {}, surProgression) => {
    const donnees = new FormData();
    donnees.append('media', fichier);
    if (texte) donnees.append('texte', texte);
    if (estPremium) donnees.append('estPremium', 'true');

    return api.post('/stories', donnees, {
      onUploadProgress: (evenement) => {
        if (surProgression && evenement.total) {
          surProgression(Math.round((evenement.loaded * 100) / evenement.total));
        }
      },
      timeout: 300000,
    });
  },

  /** Enregistre la consultation. Le serveur ne compte qu'une vue par personne. */
  marquerVue: (id) => api.post(`/stories/${id}/vue`),

  /** Spectateurs — reserve a l'auteur. */
  vues: (id) => api.get(`/stories/${id}/vues`),

  supprimer: (id) => api.delete(`/stories/${id}`),
};

export default storyApi;
