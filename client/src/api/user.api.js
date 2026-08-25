import api from './axios';

/** Appels lies aux profils utilisateurs. */
export const userApi = {
  /** Profil complet du compte connecte (justificatif de diplome compris). */
  monProfil: () => api.get('/users/me'),

  /**
   * Profil d'un tiers, par ObjectId ou par pseudo.
   * Accessible sans etre connecte pour les profils publics.
   */
  profil: (identifiant) => api.get(`/users/${identifiant}`),

  /** Edition du profil. Seuls les champs autorises par le serveur sont pris. */
  modifier: (champs) => api.patch('/users/me', champs),

  /** Bascule public / prive. */
  changerVisibilite: (visibilite) =>
    api.patch('/users/me/visibilite', { visibilite }),

  /** Position GeoJSON — attention a l'ordre [longitude, latitude]. */
  changerLocalisation: (coordinates, ville) =>
    api.patch('/users/me/localisation', { coordinates, ville }),

  /** Soumission d'un diplome pour verification (coachs). */
  soumettreDiplome: (intitule, organisme) =>
    api.post('/users/me/diplome', { intitule, organisme }),

  /**
   * Photo de profil. L'ancienne image est supprimee du stockage par le
   * serveur : sans cela, chaque changement laisserait un fichier facture.
   */
  changerAvatar: (fichier) => {
    const donnees = new FormData();
    donnees.append('avatar', fichier);
    return api.patch('/users/me/avatar', donnees, { timeout: 120000 });
  },

  /** Justificatif de diplome — image ou PDF. Remet le dossier en attente. */
  televerserJustificatif: (fichier) => {
    const donnees = new FormData();
    donnees.append('justificatif', fichier);
    return api.post('/users/me/diplome/justificatif', donnees, { timeout: 120000 });
  },

  /** Desactivation du compte (le document est conserve). */
  desactiverCompte: () => api.delete('/users/me'),
};

export default userApi;
