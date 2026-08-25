/**
 * Outils de pagination partages par toutes les listes de l'API.
 *
 * Uniformiser la forme des reponses paginees evite au front d'avoir a se
 * souvenir que les posts renvoient `total` mais les evenements `count`.
 */

const LIMITE_DEFAUT = 20;
const LIMITE_MAX = 50;

/**
 * Extrait et borne les parametres de pagination de la requete.
 *
 * Le plafond a 50 est une protection, pas un confort : sans lui, un appel
 * avec `?limite=1000000` chargerait toute la collection en memoire et
 * suffirait a faire tomber le serveur.
 */
export function lirePagination(req) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limite = Math.min(LIMITE_MAX, Math.max(1, Number(req.query.limite) || LIMITE_DEFAUT));

  return { page, limite, saut: (page - 1) * limite };
}

/**
 * Enveloppe une liste et son total dans la reponse paginee standard.
 */
export function reponsePaginee(elements, total, { page, limite }) {
  return {
    succes: true,
    elements,
    pagination: {
      page,
      limite,
      total,
      pages: Math.ceil(total / limite) || 1,
      // Le front s'en sert pour savoir s'il doit charger la suite au
      // defilement, sans avoir a recalculer la comparaison lui-meme.
      aSuivante: page * limite < total,
    },
  };
}
