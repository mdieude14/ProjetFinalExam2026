import api from './axios';

/**
 * Modération personnelle — bloquer, restreindre, signaler.
 *
 * TROIS ACTIONS QUI NE SONT PAS DES DEGRÉS D'UNE MÊME ÉCHELLE :
 *
 *   bloquer      coupe l'accès dans les deux sens, rompt les suivis, se voit
 *   restreindre  ne coupe rien et NE SE VOIT PAS
 *   signaler     ne change rien à la relation, ouvre un dossier
 *
 * LE VERBE HTTP PORTE L'EFFET. `POST` pose la relation, `DELETE` la retire.
 * Un point d'entrée unique avec un drapeau `{ bloquer: true/false }` rendrait
 * un appel mal formé capable de DÉbloquer alors qu'on voulait bloquer.
 *
 * Pas de `retirerSignalement` : un signalement ne se retire pas. Il est
 * instruit par l'administration, qui le classe.
 */
export const moderationApi = {
  bloquer: (idUtilisateur) => api.post(`/users/${idUtilisateur}/blocage`),
  debloquer: (idUtilisateur) => api.delete(`/users/${idUtilisateur}/blocage`),

  restreindre: (idUtilisateur) => api.post(`/users/${idUtilisateur}/restriction`),
  leverRestriction: (idUtilisateur) => api.delete(`/users/${idUtilisateur}/restriction`),

  /**
   * @param {string} motif - l'un des motifs fermés du serveur
   * @param {string} [commentaire] - détail libre, 500 caractères au plus
   */
  signaler: (idUtilisateur, { motif, commentaire } = {}) =>
    api.post(`/users/${idUtilisateur}/signalement`, { motif, commentaire }),

  /**
   * État des trois actions vis-à-vis d'un compte.
   *
   * UTILE LÀ OÙ AUCUN PROFIL N'EST CHARGÉ — la conversation. Sur une page de
   * profil, l'état arrive déjà dans la réponse : y ajouter cet appel ferait
   * une requête pour une donnée qu'on tient déjà.
   */
  etat: (idUtilisateur) => api.get(`/users/${idUtilisateur}/moderation`),

  /* ------------------------------ Écrans ------------------------------ */

  mesBloques: () => api.get('/users/me/bloques'),
  mesRestreints: () => api.get('/users/me/restreints'),
};

/**
 * Motifs de signalement, alignés sur l'énumération du modèle serveur.
 *
 * LES LIBELLÉS SONT ICI, LES VALEURS VIENNENT DU SERVEUR. Traduire côté
 * serveur mêlerait la présentation aux règles ; inventer des valeurs côté
 * client ferait échouer la validation avec un message incompréhensible.
 */
export const MOTIFS_SIGNALEMENT = [
  { valeur: 'spam', libelle: 'Spam ou publicité' },
  { valeur: 'harcelement', libelle: 'Harcèlement ou intimidation' },
  { valeur: 'contenu_inapproprie', libelle: 'Contenu inapproprié' },
  { valeur: 'usurpation', libelle: "Usurpation d'identité" },
  { valeur: 'fausse_qualification', libelle: 'Fausse qualification de coach' },
  { valeur: 'autre', libelle: 'Autre' },
];

export default moderationApi;
