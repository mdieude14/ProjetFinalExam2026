/**
 * Erreur applicative « attendue », c'est-a-dire une erreur que l'on declenche
 * volontairement (droits insuffisants, ressource introuvable, donnee invalide).
 *
 * Elle se distingue d'un bug : `estOperationnelle` vaut true, ce qui autorise
 * le middleware d'erreurs a renvoyer le message tel quel au client.
 * Pour une erreur inattendue (bug), on renverra un message generique afin de
 * ne pas divulguer la structure interne de l'application.
 */
export class ApiError extends Error {
  /**
   * @param {number} statusCode - code HTTP a renvoyer
   * @param {string} message    - message lisible par l'utilisateur final
   * @param {Array}  details    - detail des champs invalides (validation)
   */
  constructor(statusCode, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.estOperationnelle = true;

    // Retire le constructeur de la pile d'appels pour garder une trace lisible.
    Error.captureStackTrace(this, this.constructor);
  }

  // Raccourcis pour les cas les plus frequents : `throw ApiError.notFound(...)`
  // se lit mieux que `throw new ApiError(404, ...)`.

  static badRequest(message = 'Requete invalide', details = null) {
    return new ApiError(400, message, details);
  }

  static unauthorized(message = 'Authentification requise') {
    return new ApiError(401, message);
  }

  static forbidden(message = 'Acces refusé') {
    return new ApiError(403, message);
  }

  static notFound(message = 'Ressource introuvable') {
    return new ApiError(404, message);
  }

  static conflict(message = 'Conflit avec une ressource existante') {
    return new ApiError(409, message);
  }

  /*
   * 422 : LA REQUÊTE EST BIEN FORMÉE, MAIS INTRAITABLE.
   *
   * La distinction avec 400 n'est pas cosmétique. 400 dit « vous avez mal
   * rempli votre demande », et invite à la corriger. 422 dit « votre demande
   * est correcte, c'est le monde extérieur qui ne suit pas » — une ville
   * orthographiée correctement mais que Nominatim ne connaît pas, par
   * exemple. Le client n'affiche pas la même chose dans les deux cas, et il ne
   * doit pas avoir à lire le message pour le savoir.
   */
  static unprocessable(message = 'Demande correcte mais intraitable') {
    return new ApiError(422, message);
  }

  static tooManyRequests(message = 'Trop de requetes, réessayez plus tard') {
    return new ApiError(429, message);
  }

  static internal(message = 'Erreur interne du serveur') {
    return new ApiError(500, message);
  }
}
