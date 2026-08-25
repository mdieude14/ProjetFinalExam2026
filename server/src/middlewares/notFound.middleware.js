import { ApiError } from '../utils/ApiError.js';

/**
 * Attrape toutes les requetes qui n'ont matche aucune route.
 * Monte juste AVANT le middleware d'erreurs, il transforme un « rien trouve »
 * en une erreur 404 propre au lieu de la page HTML par defaut d'Express.
 */
export function notFoundMiddleware(req, res, next) {
  next(ApiError.notFound(`Route introuvable : ${req.method} ${req.originalUrl}`));
}
