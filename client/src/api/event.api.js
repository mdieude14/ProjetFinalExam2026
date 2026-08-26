import api from './axios';

/**
 * Appels lies aux evenements sportifs.
 *
 * DEUX FORMATS D'ENVOI, ET LE CHOIX N'EST PAS LIBRE.
 *
 *   creer()    multipart, parce qu'une affiche peut accompagner l'evenement
 *   modifier() JSON, parce que l'affiche n'est pas modifiable apres coup
 *
 * DANS UN FormData, LES CHAMPS IMBRIQUES S'ECRIVENT AVEC DES CROCHETS :
 * `lieu[ville]`, jamais `lieu.ville`. Multer reconstruit l'objet a partir de
 * la notation a crochets ; avec un point, il cree une cle plate litterale
 * « lieu.ville » et le serveur ne trouve aucune ville — l'evenement est
 * refuse pour un champ pourtant rempli, ce qui est incomprehensible cote
 * interface. Le detail est minuscule et la panne, totale.
 */
export const eventApi = {
  /**
   * Cree un evenement. Reserve aux coachs certifies (le serveur le verifie).
   *
   * @param {object} donnees champs du formulaire, `affiche` en `File`
   */
  creer: (donnees) => {
    const fd = new FormData();

    fd.append('titre', donnees.titre);
    fd.append('dateDebut', donnees.dateDebut);
    fd.append('dateFin', donnees.dateFin);
    fd.append('lieu[ville]', donnees.ville);

    if (donnees.description) fd.append('description', donnees.description);
    if (donnees.sport) fd.append('sport', donnees.sport);
    if (donnees.type) fd.append('type', donnees.type);
    if (donnees.adresse) fd.append('lieu[adresse]', donnees.adresse);
    if (donnees.codePostal) fd.append('lieu[codePostal]', donnees.codePostal);

    /*
     * UN CHAMP VIDE N'EST PAS UN CHAMP ABSENT.
     * Envoyer `capaciteMax: ''` ferait echouer `isInt()` cote serveur, alors
     * que l'intention — « pas de limite » — est justement de ne rien imposer.
     * On n'ajoute la cle que si une valeur existe reellement.
     */
    if (donnees.capaciteMax) fd.append('capaciteMax', donnees.capaciteMax);

    // Les coordonnees sont indissociables : le serveur refuse l'une sans
    // l'autre. On applique la meme regle ici plutot que de decouvrir le
    // refus apres l'envoi de l'affiche.
    if (donnees.longitude !== undefined && donnees.latitude !== undefined) {
      fd.append('lieu[longitude]', donnees.longitude);
      fd.append('lieu[latitude]', donnees.latitude);
    }

    if (donnees.affiche) fd.append('affiche', donnees.affiche);

    return api.post('/events', fd);
  },

  /** Evenements a venir, filtrables et pagines. */
  liste: ({ ville, sport, type, page, limite } = {}) =>
    api.get('/events', {
      params: {
        ...(ville ? { ville } : {}),
        ...(sport ? { sport } : {}),
        ...(type ? { type } : {}),
        ...(page ? { page } : {}),
        ...(limite ? { limite } : {}),
      },
    }),

  /**
   * Evenements autour d'un point.
   *
   * COORDONNEES NOMMEES, JAMAIS POSITIONNELLES — meme precaution qu'au
   * module 8 : le navigateur expose `latitude` puis `longitude`, GeoJSON
   * attend l'inverse, et une inversion ne leve aucune erreur. Elle deplace
   * simplement la recherche a l'autre bout du monde.
   */
  proches: ({ lng, lat, rayon, sport } = {}) =>
    api.get('/events/proches', {
      params: {
        lng,
        lat,
        ...(rayon ? { rayon } : {}),
        ...(sport ? { sport } : {}),
      },
    }),

  /** Detail d'un evenement — participants inclus si l'on est l'organisateur. */
  detail: (id) => api.get(`/events/${id}`),

  /** Modification, reservee a l'organisateur. */
  modifier: (id, champs) => api.patch(`/events/${id}`, champs),

  /**
   * Annule l'evenement. Le verbe HTTP est DELETE, mais RIEN N'EST SUPPRIME :
   * le statut passe a « annule » et les inscrits peuvent le constater.
   */
  annuler: (id, motifAnnulation) =>
    api.delete(`/events/${id}`, { data: { motifAnnulation } }),

  /** Prendre une place. */
  sInscrire: (id, message) => api.post(`/events/${id}/inscription`, { message }),

  /** Rendre sa place. */
  seDesinscrire: (id) => api.delete(`/events/${id}/inscription`),

  /** Mes inscriptions — celles qui tiennent encore, sauf `tout`. */
  mesInscriptions: ({ page, limite, tout } = {}) =>
    api.get('/events/mes-inscriptions', {
      params: {
        ...(page ? { page } : {}),
        ...(limite ? { limite } : {}),
        ...(tout ? { tout: true } : {}),
      },
    }),
};

export default eventApi;
