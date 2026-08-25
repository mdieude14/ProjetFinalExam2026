import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { verifierAccessToken } from '../services/auth.service.js';
import User from '../models/User.js';

/**
 * Extrait le jeton de l'en-tete « Authorization: Bearer <token> ».
 * Renvoie null si l'en-tete est absent ou mal forme.
 */
function extraireToken(req) {
  const entete = req.headers.authorization;
  if (!entete || !entete.startsWith('Bearer ')) return null;
  return entete.slice(7).trim() || null;
}

/**
 * Middleware d'authentification — a poser sur toute route protegee.
 *
 * Deroulement :
 *   1. lecture du jeton dans l'en-tete Authorization
 *   2. verification de la signature et de l'expiration
 *   3. rechargement de l'utilisateur EN BASE
 *   4. injection dans req.user pour les middlewares et controleurs suivants
 *
 * POURQUOI RECHARGER L'UTILISATEUR EN BASE ?
 * On pourrait se contenter du contenu du jeton, ce qui eviterait une requete.
 * Mais un JWT est une photographie figee au moment de son emission : si le
 * compte est desactive, si un coach vient d'etre certifie ou si un admin est
 * retrograde, le jeton continue d'affirmer l'ancienne verite pendant 15 min.
 * Sur des routes qui manipulent de l'argent et de la moderation, ce decalage
 * n'est pas acceptable. La requete supplementaire est indexee sur _id, donc
 * negligeable.
 */
export const protect = asyncHandler(async (req, res, next) => {
  const token = extraireToken(req);
  if (!token) {
    throw ApiError.unauthorized('Authentification requise');
  }

  // Peut lever JsonWebTokenError (signature invalide, jeton falsifie)
  // ou TokenExpiredError. Les deux sont traduits en 401 par le middleware
  // d'erreurs centralise.
  const charge = verifierAccessToken(token);

  const utilisateur = await User.findById(charge.sub);
  if (!utilisateur) {
    // Le compte a ete supprime alors qu'un jeton valide circulait encore.
    throw ApiError.unauthorized('Compte introuvable');
  }

  if (!utilisateur.isActive) {
    throw ApiError.forbidden('Ce compte a été désactivé');
  }

  req.user = utilisateur;
  next();
});

/**
 * Variante souple : n'exige pas de jeton, mais renseigne req.user s'il y en
 * a un de valide.
 *
 * Utile sur les routes publiques dont la reponse depend du visiteur : le
 * profil d'un coach est visible par tous, mais on doit savoir si le visiteur
 * le suit deja, s'il y est abonne en premium, ou si le contenu doit apparaitre
 * floute. Un jeton absent ou expire n'est pas une erreur ici, simplement un
 * visiteur anonyme.
 */
export const protectOptionnel = asyncHandler(async (req, res, next) => {
  const token = extraireToken(req);
  if (!token) return next();

  try {
    const charge = verifierAccessToken(token);
    const utilisateur = await User.findById(charge.sub);
    if (utilisateur?.isActive) req.user = utilisateur;
  } catch {
    // Jeton invalide ou expire : on poursuit en visiteur anonyme.
  }

  next();
});
