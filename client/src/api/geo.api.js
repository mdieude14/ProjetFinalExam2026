import api from './axios';

/**
 * Appels lies a la geolocalisation et a la carte des coachs.
 *
 * CE QUE CETTE API NE RENVOIE JAMAIS : une position exacte.
 * Le serveur arrondit les coordonnees a trois decimales (~110 m) avant de
 * les publier, et calcule lui-meme les distances. Le front ne peut donc pas
 * reconstituer l'adresse d'un coach, et ce n'est pas a lui d'essayer : s'il
 * fallait afficher une position plus fine un jour, la decision se prendrait
 * cote serveur, dans `User.versionCarte()`.
 */
export const geoApi = {
  /**
   * Coachs autour d'un point, du plus proche au plus lointain.
   *
   * LES COORDONNEES SONT NOMMEES, JAMAIS POSITIONNELLES.
   * L'API du navigateur expose `latitude` puis `longitude` ; GeoJSON attend
   * l'inverse. Une inversion ne leve aucune erreur — elle deplace simplement
   * le point a l'autre bout du monde. Des parametres nommes rendent la faute
   * visible a la lecture.
   *
   * @param {object} p
   * @param {number} p.lng longitude
   * @param {number} p.lat latitude
   * @param {number} [p.rayon] en metres, 1 000 a 100 000
   */
  coachsAutour: ({ lng, lat, rayon, sport, certifies, offre, limite } = {}) =>
    api.get('/geo/coachs', {
      params: {
        lng,
        lat,
        ...(rayon ? { rayon } : {}),
        ...(sport ? { sport } : {}),
        ...(certifies ? { certifies: true } : {}),
        ...(offre ? { offre: true } : {}),
        ...(limite ? { limite } : {}),
      },
    }),

  /** Villes ou des coachs sont visibles — repli sans geolocalisation. */
  villes: () => api.get('/geo/villes'),

  /** Sports reellement proposes, pour alimenter le filtre. */
  sports: () => api.get('/geo/sports'),

  /** Consentement du coach a figurer sur la carte publique. */
  definirCarteVisible: (carteVisible) =>
    api.patch('/geo/carte-visible', { carteVisible }),
};

export default geoApi;
