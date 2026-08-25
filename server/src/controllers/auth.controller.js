import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  emettreSession,
  supprimerCookieRefresh,
  lireCookieRefresh,
  verifierRefreshToken,
} from '../services/auth.service.js';

/**
 * Hash factice servant de leurre contre les attaques temporelles.
 *
 * Quand l'identifiant saisi n'existe pas, on compare quand meme le mot de
 * passe fourni a ce hash. Sans cette precaution, une reponse « identifiants
 * invalides » quasi instantanee signalerait « ce compte n'existe pas », tandis
 * qu'une reponse apres 250 ms de bcrypt signalerait « ce compte existe, mais
 * le mot de passe est faux ». En chronometrant, un attaquant enumererait
 * ainsi les comptes valides.
 *
 * Calcule une seule fois au demarrage.
 */
const HASH_LEURRE = bcrypt.hashSync('mot-de-passe-inexistant-leurre', 12);

/**
 * Reponse d'authentification commune a l'inscription, la connexion et le
 * renouvellement. Centralisee pour que le front recoive toujours la meme
 * structure, quel que soit le chemin emprunte.
 */
function reponseAuth(res, statut, utilisateur, accessToken, message) {
  return res.status(statut).json({
    succes: true,
    message,
    accessToken,
    // versionPrivee : la vue du proprietaire sur son propre compte. Contient
    // son email et le detail de son diplome, jamais le mot de passe ni les
    // identifiants techniques Stripe.
    utilisateur: utilisateur.versionPrivee(),
  });
}

/* ================================================================== *
 *  POST /api/auth/register
 * ================================================================== */

/**
 * Inscription d'un utilisateur ou d'un coach.
 *
 * Le type « admin » est refuse ici de maniere explicite. Le validateur le
 * bloque deja, mais on double la protection : c'est le seul endroit du code
 * ou un compte est cree a partir de donnees venues du client, et une
 * escalade de privileges y serait la faille la plus grave du projet.
 */
export const register = asyncHandler(async (req, res) => {
  const { type = 'utilisateur', nom, prenom, pseudo, email, password, ville, localisation, diplome } = req.body;

  if (type === 'admin') {
    throw ApiError.forbidden('Un compte administrateur ne peut pas être créé via l’API');
  }

  const donnees = { type, nom, prenom, pseudo, email, password, ville };

  // Coordonnees fournies par la geolocalisation du navigateur, facultatives.
  // Rappel : GeoJSON attend [longitude, latitude], dans cet ordre.
  if (Array.isArray(localisation?.coordinates) && localisation.coordinates.length === 2) {
    donnees.localisation = {
      type: 'Point',
      coordinates: localisation.coordinates.map(Number),
    };
  }

  // Un coach qui renseigne son diplome des l'inscription entre directement
  // dans la file d'attente de moderation.
  if (type === 'coach' && (diplome?.intitule || diplome?.organisme)) {
    donnees.diplome = {
      intitule: diplome.intitule,
      organisme: diplome.organisme,
      statut: 'en_attente',
      dateSoumission: new Date(),
    };
    // Le justificatif lui-meme sera televerse separement (module 5), une fois
    // le pipeline d'upload en place.
  }

  // Les doublons d'email ou de pseudo remontent en erreur 11000, traduite
  // en 409 par le middleware d'erreurs centralise.
  const utilisateur = await User.create(donnees);

  const accessToken = emettreSession(res, utilisateur);

  return reponseAuth(res, 201, utilisateur, accessToken, 'Compte créé avec succes');
});

/* ================================================================== *
 *  POST /api/auth/login
 * ================================================================== */

/**
 * Connexion par email OU pseudo.
 *
 * Le message d'erreur est volontairement identique dans tous les cas
 * d'echec — compte inexistant, mauvais mot de passe, compte desactive.
 * Preciser « cet email n'existe pas » offrirait a un attaquant un moyen de
 * verifier quelles adresses sont inscrites sur la plateforme.
 */
export const login = asyncHandler(async (req, res) => {
  const identifiant = String(req.body.identifiant || '').toLowerCase().trim();
  const password = String(req.body.password || '');

  const utilisateur = await User.findOne({
    $or: [{ email: identifiant }, { pseudo: identifiant }],
  }).select('+password');

  // Compte inexistant : on consomme quand meme le temps d'un bcrypt.compare
  // pour que la duree de reponse soit indistinguable d'un mot de passe faux.
  if (!utilisateur) {
    await bcrypt.compare(password, HASH_LEURRE);
    throw ApiError.unauthorized('Identifiants invalides');
  }

  const motDePasseValide = await utilisateur.comparePassword(password);
  if (!motDePasseValide) {
    throw ApiError.unauthorized('Identifiants invalides');
  }

  if (!utilisateur.isActive) {
    throw ApiError.unauthorized('Identifiants invalides');
  }

  // Trace de connexion. updateOne plutot que save() : on evite de declencher
  // le hook pre-save et de reecrire tout le document pour un seul champ.
  await User.updateOne({ _id: utilisateur._id }, { derniereConnexion: new Date() });

  const accessToken = emettreSession(res, utilisateur);

  return reponseAuth(res, 200, utilisateur, accessToken, 'Connexion réussie');
});

/* ================================================================== *
 *  POST /api/auth/refresh
 * ================================================================== */

/**
 * Delivre un nouvel access token a partir du refresh token du cookie.
 *
 * Appelee automatiquement par le front lorsqu'une requete echoue en 401,
 * ce qui rend l'expiration des 15 minutes invisible pour l'utilisateur.
 *
 * Le controle de version est le mecanisme de revocation : si le compteur du
 * jeton ne correspond plus a celui du document utilisateur, c'est qu'un
 * changement de mot de passe ou une deconnexion globale a eu lieu depuis
 * l'emission. Le jeton est alors refuse malgre une signature valide.
 */
export const refresh = asyncHandler(async (req, res) => {
  const token = lireCookieRefresh(req);
  if (!token) {
    throw ApiError.unauthorized('Aucune session active');
  }

  // Signature invalide ou jeton expire : traduit en 401 par le middleware.
  const charge = verifierRefreshToken(token);

  const utilisateur = await User.findById(charge.sub);
  if (!utilisateur || !utilisateur.isActive) {
    supprimerCookieRefresh(res);
    throw ApiError.unauthorized('Session invalide');
  }

  if (charge.v !== utilisateur.refreshTokenVersion) {
    supprimerCookieRefresh(res);
    throw ApiError.unauthorized('Session revoquee, veuillez vous reconnecter');
  }

  // Rotation : un nouveau refresh token remplace l'ancien a chaque appel.
  // Cela reduit la fenetre pendant laquelle un jeton intercepte reste utile.
  const accessToken = emettreSession(res, utilisateur);

  return reponseAuth(res, 200, utilisateur, accessToken, 'Session renouvelee');
});

/* ================================================================== *
 *  POST /api/auth/logout
 * ================================================================== */

/**
 * Deconnexion de l'appareil courant : suppression du cookie.
 *
 * L'access token deja emis reste techniquement valide jusqu'a son expiration
 * (15 min au maximum) — c'est la contrepartie assumee des JWT sans etat.
 * Le front le supprime de sa memoire, et sans refresh token il ne peut plus
 * en obtenir de nouveau.
 */
export const logout = asyncHandler(async (req, res) => {
  supprimerCookieRefresh(res);
  return res.json({ succes: true, message: 'Déconnexion réussie' });
});

/* ================================================================== *
 *  POST /api/auth/logout-all
 * ================================================================== */

/**
 * Deconnexion de TOUS les appareils.
 * L'increment du compteur de version perime instantanement l'ensemble des
 * refresh tokens en circulation pour ce compte.
 */
export const logoutAll = asyncHandler(async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $inc: { refreshTokenVersion: 1 } });
  supprimerCookieRefresh(res);
  return res.json({
    succes: true,
    message: 'Déconnexion effectuée sur tous les appareils',
  });
});

/* ================================================================== *
 *  GET /api/auth/me
 * ================================================================== */

/**
 * Profil de l'utilisateur connecte.
 * Appelee au demarrage du front pour restaurer la session : le refresh token
 * est dans un cookie httpOnly, donc React ne peut pas savoir qui est connecte
 * sans interroger le serveur.
 */
export const me = asyncHandler(async (req, res) => {
  return res.json({ succes: true, utilisateur: req.user.versionPrivee() });
});

/* ================================================================== *
 *  PATCH /api/auth/password
 * ================================================================== */

/**
 * Changement de mot de passe.
 *
 * L'ancien mot de passe est exige meme si l'utilisateur est deja authentifie :
 * cela protege le compte lorsqu'une session est restee ouverte sur un poste
 * accessible a d'autres personnes.
 *
 * Le hook pre-save du modele se charge du hachage ET incremente
 * refreshTokenVersion, ce qui deconnecte automatiquement tous les autres
 * appareils. On reemet ensuite une session pour que l'appareil courant,
 * lui, reste connecte.
 */
export const changerMotDePasse = asyncHandler(async (req, res) => {
  const { ancienPassword, nouveauPassword } = req.body;

  const utilisateur = await User.findById(req.user._id).select('+password');

  const ancienValide = await utilisateur.comparePassword(ancienPassword);
  if (!ancienValide) {
    throw ApiError.unauthorized('Mot de passe actuel incorrect');
  }

  utilisateur.password = nouveauPassword;
  await utilisateur.save(); // hachage + increment de version

  const accessToken = emettreSession(res, utilisateur);

  return res.json({
    succes: true,
    message: 'Mot de passe modifie. Les autres appareils ont été deconnectes.',
    accessToken,
  });
});
