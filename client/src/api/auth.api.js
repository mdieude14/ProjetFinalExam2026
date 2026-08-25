import api from './axios';

/**
 * Appels HTTP lies a l'authentification.
 *
 * Regrouper les URL ici plutot que de les ecrire dans les composants evite
 * qu'une route change de nom et laisse trainer des chaines obsoletes dans
 * dix fichiers. Les composants appellent une fonction nommee, pas une URL.
 */

export const authApi = {
  /** Creation de compte (utilisateur ou coach). */
  inscription: (donnees) => api.post('/auth/register', donnees),

  /** Connexion par email ou pseudo. */
  connexion: (identifiant, password) =>
    api.post('/auth/login', { identifiant, password }),

  /** Deconnexion de l'appareil courant. */
  deconnexion: () => api.post('/auth/logout'),

  /** Deconnexion de tous les appareils. */
  deconnexionGlobale: () => api.post('/auth/logout-all'),

  /** Profil de l'utilisateur connecte. */
  moi: () => api.get('/auth/me'),

  /** Renouvellement manuel de la session (utilise au demarrage du front). */
  renouveler: () => api.post('/auth/refresh'),

  /** Changement de mot de passe. */
  changerMotDePasse: (ancienPassword, nouveauPassword) =>
    api.patch('/auth/password', { ancienPassword, nouveauPassword }),
};

export default authApi;
