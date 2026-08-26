import api from './axios';

/**
 * Appels de recherche.
 *
 * CHAQUE FONCTION ACCEPTE UN `signal`, ET CE N'EST PAS UN LUXE.
 * Une barre de recherche envoie des requêtes en rafale. Rien ne garantit
 * qu'elles reviennent dans l'ordre où elles sont parties : la réponse à
 * « nat » peut arriver APRÈS celle à « natation » et écraser des résultats
 * plus récents par des plus anciens. L'utilisateur voit alors la liste
 * régresser sous ses yeux, sans comprendre pourquoi.
 *
 * `AbortController` règle le problème à la source : on annule la requête
 * précédente avant d'en lancer une nouvelle. Le tri d'après l'ordre d'arrivée
 * ne se pose plus, puisqu'une seule requête est en vol à la fois.
 */
export const searchApi = {
  /**
   * Suggestions pendant la frappe — route dédiée, volontairement frugale.
   * Huit résultats au plus, juste de quoi remplir une liste déroulante.
   */
  suggestions: (q, { limite, signal } = {}) =>
    api.get('/search/suggestions', {
      params: { q, ...(limite ? { limite } : {}) },
      signal,
    }),

  /** Recherche globale : personnes, publications et événements d'un coup. */
  globale: (q, { limite, signal } = {}) =>
    api.get('/search', {
      params: { q, ...(limite ? { limite } : {}) },
      signal,
    }),

  utilisateurs: (q, { type, ville, limite, signal } = {}) =>
    api.get('/search/utilisateurs', {
      params: {
        q,
        ...(type ? { type } : {}),
        ...(ville ? { ville } : {}),
        ...(limite ? { limite } : {}),
      },
      signal,
    }),

  publications: (q, { limite, signal } = {}) =>
    api.get('/search/publications', {
      params: { q, ...(limite ? { limite } : {}) },
      signal,
    }),

  evenements: (q, { limite, signal } = {}) =>
    api.get('/search/evenements', {
      params: { q, ...(limite ? { limite } : {}) },
      signal,
    }),
};

export default searchApi;
