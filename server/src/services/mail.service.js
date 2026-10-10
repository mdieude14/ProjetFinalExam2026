import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import nodemailer from 'nodemailer';

import { config, estProduction } from '../config/env.js';

/**
 * ===========================================================================
 *  ENVOI D'E-MAILS
 * ===========================================================================
 *
 * DEUX DESTINATIONS, ET LA SECONDE N'EXISTE PAS EN PRODUCTION.
 *
 *   SMTP (Gmail)          les adresses réelles
 *   boîte de dépôt        `server/.boite-mails/`, un fichier JSON par e-mail
 *
 * POURQUOI UNE BOÎTE DE DÉPÔT. Les suites de test créent des comptes jetables
 * en `@….local` — un domaine réservé (RFC 6762) qui ne reçoit aucun e-mail.
 * Les envoyer par Gmail produirait des rebonds, et un compte d'envoi qui
 * rebondit voit sa réputation baisser : ses vrais e-mails finissent en
 * indésirables. Les tests ont en revanche besoin de LIRE l'e-mail pour
 * suivre le lien. D'où la règle, hors production uniquement :
 *
 *   destinataire en .local            boîte de dépôt, jamais Gmail
 *   identifiants SMTP non renseignés  boîte de dépôt, avec un avertissement
 *
 * La boîte est ignorée par git : elle contient des liens de réinitialisation
 * valides — courts et à usage unique, mais valides.
 * ===========================================================================
 */

const BOITE = fileURLToPath(new URL('../../.boite-mails/', import.meta.url));

/**
 * DEUX FAÇONS DE S'AUTHENTIFIER AUPRÈS DE GMAIL, ET L'ORDRE N'EST PAS NEUTRE.
 *
 * OAuth2 D'ABORD, parce que c'est la méthode que Google recommande et la seule
 * qui reste ouverte à tous les comptes. La page des mots de passe d'application
 * exige la validation en deux étapes — qu'une clé d'accès NE remplace PAS — et
 * Google la ferme sur les comptes récents ou sous Protection avancée. Le
 * 6 octobre, elle répondait « Le paramètre que vous recherchez n'est pas
 * disponible pour votre compte » sur la boîte dédiée du projet.
 *
 * LE MOT DE PASSE D'APPLICATION RESTE ACCEPTÉ, en second : une installation qui
 * en détient déjà un ne doit pas cesser de fonctionner.
 *
 * LE MÊME CLIENT OAUTH SERT L'ASSISTANT DE MESSAGERIE (module 15). Un seul
 * mécanisme pour lire la boîte et pour en envoyer, au lieu de deux secrets de
 * natures différentes pour le même compte.
 */
const oauthConfigure = () => Boolean(
  config.mail.utilisateur &&
  config.mail.oauth?.clientId &&
  config.mail.oauth?.clientSecret &&
  config.mail.oauth?.refreshToken
);

const motDePasseConfigure = () => Boolean(config.mail.utilisateur && config.mail.motDePasse);

/** L'envoi est-il configuré, par l'une ou l'autre voie ? */
const smtpConfigure = () => oauthConfigure() || motDePasseConfigure();

/** Quel mode sera employé — utile aux diagnostics, et aux messages d'erreur. */
export function modeEnvoi() {
  if (oauthConfigure()) return 'oauth2';
  if (motDePasseConfigure()) return 'mot de passe';
  return 'aucun';
}

let transporteur = null;
function transporteurSmtp() {
  /*
   * NODEMAILER RAFRAÎCHIT LE JETON LUI-MÊME. On ne lui donne que le jeton de
   * RAFRAÎCHISSEMENT : il obtient un jeton d'accès quand il en a besoin, et le
   * renouvelle à l'expiration. Rien à planifier de notre côté.
   */
  const auth = oauthConfigure()
    ? {
        type: 'OAuth2',
        user: config.mail.utilisateur,
        clientId: config.mail.oauth.clientId,
        clientSecret: config.mail.oauth.clientSecret,
        refreshToken: config.mail.oauth.refreshToken,
      }
    : { user: config.mail.utilisateur, pass: config.mail.motDePasse };

  transporteur ??= nodemailer.createTransport({
    host: config.mail.hote,
    port: config.mail.port,
    secure: config.mail.securise,
    auth,
  });
  return transporteur;
}

/** Destination d'un e-mail — la règle expliquée en tête de fichier. */
export function destinationPour(adresse) {
  if (estProduction) return 'smtp';
  if (/\.local$/i.test(adresse)) return 'boite';
  return smtpConfigure() ? 'smtp' : 'boite';
}

async function deposer(message) {
  await mkdir(BOITE, { recursive: true });
  const nom = `${Date.now()}-${message.to.replace(/[^a-z0-9@._-]/gi, '_')}.json`;
  await writeFile(join(BOITE, nom), JSON.stringify({ ...message, deposeLe: new Date() }, null, 2));
}

/**
 * Envoie un e-mail, ou le dépose.
 *
 * @param {{ a: string, sujet: string, texte: string, html: string }} message
 * @returns {Promise<'smtp'|'boite'>} la destination effective
 */
export async function envoyerMail({ a, sujet, texte, html }) {
  const message = { from: config.mail.expediteur, to: a, subject: sujet, text: texte, html };
  const destination = destinationPour(a);

  if (destination === 'boite') {
    if (!smtpConfigure() && !/\.local$/i.test(a)) {
      console.warn(
        `[MAIL] SMTP non configuré : l'e-mail « ${sujet} » est déposé dans server/.boite-mails/ au lieu d'être envoyé.`
      );
    }
    await deposer(message);
    return 'boite';
  }

  await transporteurSmtp().sendMail(message);
  return 'smtp';
}

/**
 * Vérifie la connexion SMTP, sans rien envoyer. Utile au démarrage d'un
 * diagnostic : identifiants refusés, port bloqué, certificat intercepté.
 */
export async function verifierSmtp() {
  const mode = modeEnvoi();
  if (mode === 'aucun') {
    return { ok: false, mode, raison: 'aucune authentification configurée (ni OAuth2, ni mot de passe)' };
  }
  try {
    await transporteurSmtp().verify();
    return { ok: true, mode };
  } catch (erreur) {
    return { ok: false, mode, raison: erreur.message };
  }
}
