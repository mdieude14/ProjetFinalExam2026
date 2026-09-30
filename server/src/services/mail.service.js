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

const smtpConfigure = () => Boolean(config.mail.utilisateur && config.mail.motDePasse);

let transporteur = null;
function transporteurSmtp() {
  transporteur ??= nodemailer.createTransport({
    host: config.mail.hote,
    port: config.mail.port,
    secure: config.mail.securise,
    auth: { user: config.mail.utilisateur, pass: config.mail.motDePasse },
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
  if (!smtpConfigure()) return { ok: false, raison: 'identifiants SMTP non renseignés' };
  try {
    await transporteurSmtp().verify();
    return { ok: true };
  } catch (erreur) {
    return { ok: false, raison: erreur.message };
  }
}
