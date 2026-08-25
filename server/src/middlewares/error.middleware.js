import { ApiError } from '../utils/ApiError.js';
import { estProduction } from '../config/env.js';

/**
 * Gestionnaire d'erreurs centralise.
 *
 * IMPORTANT : ce middleware doit etre monte EN DERNIER dans app.js, et sa
 * signature doit obligatoirement comporter 4 parametres — c'est a ce nombre
 * qu'Express reconnait un middleware d'erreur.
 *
 * Role : traduire n'importe quelle erreur (la notre, celle de Mongoose,
 * celle de jsonwebtoken, celle de Multer...) en une reponse JSON homogene :
 *
 *   { "succes": false, "message": "...", "details": [...] }
 *
 * Le front peut ainsi afficher `message` sans se soucier de l'origine.
 */
// eslint-disable-next-line no-unused-vars
export function errorMiddleware(erreur, req, res, next) {
  let statusCode = erreur.statusCode || 500;
  let message = erreur.message || 'Erreur interne du serveur';
  let details = erreur.details || null;

  // --- Erreurs Mongoose ---------------------------------------------------

  // ObjectId malforme : /api/users/abc alors qu'on attend un ObjectId
  if (erreur.name === 'CastError') {
    statusCode = 400;
    message = `Identifiant invalide pour le champ « ${erreur.path} »`;
  }

  // Violation d'un index unique (email ou pseudo deja pris)
  if (erreur.code === 11000) {
    statusCode = 409;
    const champ = Object.keys(erreur.keyValue || {})[0] || 'champ';
    const traduction = { email: 'Cette adresse email', pseudo: 'Ce pseudo' };
    message = `${traduction[champ] || `Ce ${champ}`} est déjà utilise`;
  }

  // Echec des validateurs declares dans les schemas
  if (erreur.name === 'ValidationError') {
    statusCode = 400;
    message = 'Données invalides';
    details = Object.values(erreur.errors).map((e) => ({
      champ: e.path,
      message: e.message,
    }));
  }

  // --- Erreurs JWT --------------------------------------------------------

  if (erreur.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Token invalide';
  }

  if (erreur.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Session expiree, veuillez vous reconnecter';
  }

  // --- Erreurs Multer (upload) -------------------------------------------

  if (erreur.code === 'LIMIT_FILE_SIZE') {
    statusCode = 400;
    message = 'Fichier trop volumineux';
  }

  if (erreur.code === 'LIMIT_UNEXPECTED_FILE') {
    statusCode = 400;
    message = 'Champ de fichier inattendu';
  }

  // --- Journalisation -----------------------------------------------------

  // On ne trace la pile complete que pour les VRAIS bugs (statut 5xx).
  // Un 404 ou un 401 est un fonctionnement normal, inutile de polluer les logs.
  if (statusCode >= 500) {
    console.error(`[ERREUR] ${req.method} ${req.originalUrl}`);
    console.error(erreur.stack);
  }

  // --- Reponse ------------------------------------------------------------

  // En production, on ne divulgue jamais le detail d'une erreur inattendue :
  // un message technique peut reveler la structure de la base ou du code.
  const estAttendue = erreur instanceof ApiError || erreur.estOperationnelle;
  if (estProduction && statusCode >= 500 && !estAttendue) {
    message = 'Erreur interne du serveur';
    details = null;
  }

  res.status(statusCode).json({
    succes: false,
    message,
    ...(details && { details }),
    // La pile n'est exposee qu'en developpement, pour le debogage.
    ...(!estProduction && { stack: erreur.stack }),
  });
}
