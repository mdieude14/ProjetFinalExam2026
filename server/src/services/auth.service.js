import jwt from 'jsonwebtoken';
import { config, estProduction } from '../config/env.js';

/**
 * Service de gestion des jetons JWT.
 *
 * ---------------------------------------------------------------------------
 *  STRATEGIE A DEUX JETONS — pourquoi ?
 * ---------------------------------------------------------------------------
 * Un JWT ne peut pas etre revoque : une fois emis, il reste valable jusqu'a
 * son expiration. Deux mecanismes complementaires resolvent le probleme :
 *
 *  ACCESS TOKEN   duree 15 min · renvoye dans le corps JSON
 *                 -> stocke EN MEMOIRE par le front (variable React), jamais
 *                    dans localStorage : une faille XSS pourrait l'y lire.
 *                 -> sa duree courte limite les degats en cas de vol.
 *
 *  REFRESH TOKEN  duree 7 jours · pose dans un cookie httpOnly
 *                 -> inaccessible au JavaScript de la page, donc immunise
 *                    contre le vol par XSS.
 *                 -> porte le numero de version des sessions (voir plus bas),
 *                    ce qui le rend revocable.
 *
 * REVOCATION SANS LISTE NOIRE
 * Le refresh token embarque `refreshTokenVersion`, recopie depuis le document
 * utilisateur. A chaque changement de mot de passe ou deconnexion globale, ce
 * compteur est incremente en base. Les jetons emis avant portent alors une
 * version perimee et sont refuses. Aucune liste de jetons revoques a stocker
 * ni a purger.
 * ---------------------------------------------------------------------------
 */

const NOM_COOKIE_REFRESH = 'refreshToken';

/**
 * Access token : identifie l'utilisateur sur les routes protegees.
 * On y met le strict minimum. Un JWT est signe, pas chiffre : n'importe qui
 * peut lire son contenu sur jwt.io. Aucune donnee sensible ne doit y figurer.
 */
export function genererAccessToken(utilisateur) {
  return jwt.sign(
    {
      sub: utilisateur._id.toString(), // « subject » : identifiant du porteur
      type: utilisateur.type, // evite un aller-retour en base pour les roles
    },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessExpires }
  );
}

/**
 * Refresh token : sert uniquement a obtenir un nouvel access token.
 * Il est signe avec un secret DIFFERENT de l'access token. Ainsi, si le secret
 * d'acces fuite, un attaquant ne peut pas forger de refresh token, et
 * inversement.
 */
export function genererRefreshToken(utilisateur) {
  return jwt.sign(
    {
      sub: utilisateur._id.toString(),
      v: utilisateur.refreshTokenVersion, // numero de version des sessions
    },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpires }
  );
}

/** Verifie un access token. Leve JsonWebTokenError ou TokenExpiredError. */
export function verifierAccessToken(token) {
  return jwt.verify(token, config.jwt.accessSecret);
}

/** Verifie un refresh token. Leve JsonWebTokenError ou TokenExpiredError. */
export function verifierRefreshToken(token) {
  return jwt.verify(token, config.jwt.refreshSecret);
}

/**
 * Convertit « 7d », « 15m », « 30s » en millisecondes.
 * Necessaire parce que jsonwebtoken accepte ce format textuel alors que
 * l'option maxAge d'un cookie exige un nombre de millisecondes.
 */
function dureeEnMs(duree) {
  const correspondance = /^(\d+)([smhd])$/.exec(duree);
  if (!correspondance) return 7 * 24 * 60 * 60 * 1000; // 7 jours par defaut

  const valeur = Number(correspondance[1]);
  const multiplicateurs = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return valeur * multiplicateurs[correspondance[2]];
}

/**
 * Pose le refresh token dans un cookie securise.
 *
 *  httpOnly : le JavaScript de la page ne peut pas lire le cookie (anti-XSS).
 *  secure   : transmis uniquement en HTTPS. Desactive en local, ou l'on est
 *             en HTTP, sinon le navigateur refuserait de poser le cookie.
 *  sameSite : « lax » en local (front et API partagent le domaine localhost).
 *             « none » en production, ou le front est sur un autre domaine que
 *             l'API — ce qui impose secure: true, exige par les navigateurs.
 *  path     : le cookie n'est envoye qu'aux routes /api/auth. Il ne circule
 *             donc pas inutilement sur les centaines d'autres requetes de
 *             l'application, ce qui reduit sa surface d'exposition.
 */
export function poserCookieRefresh(res, refreshToken) {
  res.cookie(NOM_COOKIE_REFRESH, refreshToken, {
    httpOnly: true,
    secure: estProduction,
    sameSite: estProduction ? 'none' : 'lax',
    path: '/api/auth',
    maxAge: dureeEnMs(config.jwt.refreshExpires),
  });
}

/**
 * Supprime le cookie (deconnexion).
 * Les options doivent etre IDENTIQUES a celles de la pose, sinon le navigateur
 * considere qu'il s'agit d'un autre cookie et ne le supprime pas.
 */
export function supprimerCookieRefresh(res) {
  res.clearCookie(NOM_COOKIE_REFRESH, {
    httpOnly: true,
    secure: estProduction,
    sameSite: estProduction ? 'none' : 'lax',
    path: '/api/auth',
  });
}

/** Lit le refresh token depuis les cookies de la requete. */
export function lireCookieRefresh(req) {
  return req.cookies?.[NOM_COOKIE_REFRESH];
}

/**
 * Emet le couple de jetons et pose le cookie.
 * Regroupe ici pour que register, login et refresh partagent exactement
 * la meme logique — une divergence entre ces trois chemins serait une faille.
 */
export function emettreSession(res, utilisateur) {
  const accessToken = genererAccessToken(utilisateur);
  poserCookieRefresh(res, genererRefreshToken(utilisateur));
  return accessToken;
}
