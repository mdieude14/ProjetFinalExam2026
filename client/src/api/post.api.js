import api from './axios';

/**
 * Appels lies aux publications et aux commentaires.
 *
 * LES ENVOIS DE MEDIAS UTILISENT FormData, PAS JSON.
 * On ne fixe surtout pas l'en-tete Content-Type a la main : le navigateur
 * doit generer lui-meme `multipart/form-data; boundary=----...`. Ecrire
 * `Content-Type: multipart/form-data` sans frontiere casserait l'analyse
 * cote serveur, et Multer ne trouverait aucun fichier.
 *
 * Axios detecte un FormData et retire l'en-tete JSON par defaut, a condition
 * qu'on ne le force pas.
 */
export const postApi = {
  /**
   * Creation d'une publication.
   * @param {File[]} fichiers
   * @param {{titre?, description?, estPremium?}} champs
   * @param {(pourcent:number)=>void} surProgression
   */
  creer: (fichiers, champs = {}, surProgression) => {
    const donnees = new FormData();
    for (const fichier of fichiers) donnees.append('medias', fichier);
    if (champs.titre) donnees.append('titre', champs.titre);
    if (champs.description) donnees.append('description', champs.description);
    if (champs.estPremium) donnees.append('estPremium', 'true');

    return api.post('/posts', donnees, {
      // Une video de plusieurs dizaines de mega-octets prend du temps :
      // sans barre de progression, l'utilisateur croit l'application figee
      // et recharge la page au milieu de l'envoi.
      onUploadProgress: (evenement) => {
        if (surProgression && evenement.total) {
          surProgression(Math.round((evenement.loaded * 100) / evenement.total));
        }
      },
      // Le delai par defaut de 20 s est trop court pour un gros fichier.
      timeout: 300000,
    });
  },

  /** Fil d'actualite, pagine par curseur. */
  feed: ({ curseur, limite = 10 } = {}) =>
    api.get('/posts/feed', { params: { curseur, limite } }),

  /** Publications d'un profil. */
  parUtilisateur: (identifiant, { curseur, limite = 12 } = {}) =>
    api.get(`/posts/utilisateur/${identifiant}`, { params: { curseur, limite } }),

  /** Publication unique. */
  une: (id) => api.get(`/posts/${id}`),

  supprimer: (id) => api.delete(`/posts/${id}`),

  /** Bascule like / unlike. */
  basculerLike: (id) => api.post(`/posts/${id}/like`),

  /* ---------------------------- Commentaires ---------------------------- */

  commentaires: (idPost, { page = 1, limite = 10, parent } = {}) =>
    api.get(`/posts/${idPost}/comments`, { params: { page, limite, parent } }),

  commenter: (idPost, texte, parent) =>
    api.post(`/posts/${idPost}/comments`, { texte, parent }),

  supprimerCommentaire: (id) => api.delete(`/comments/${id}`),
};

export default postApi;
