/**
 * ===========================================================================
 *  OBTENIR LE JETON DE RAFRAÎCHISSEMENT GMAIL (module 15, phase B)
 * ===========================================================================
 *
 *   node server/scripts/autoriser-gmail.mjs
 *
 * PRÉREQUIS : GOOGLE_OAUTH_CLIENT_ID et GOOGLE_OAUTH_CLIENT_SECRET renseignés
 * dans `server/.env`, obtenus dans Google Cloud (voir docs/SUIVI.md, phase B).
 *
 * CE QUE FAIT CE SCRIPT
 *
 *   1. ouvre une adresse locale qui attend la réponse de Google ;
 *   2. ouvre le navigateur sur l'écran d'autorisation ;
 *   3. recueille le code que Google y renvoie ;
 *   4. l'échange contre un jeton de RAFRAÎCHISSEMENT ;
 *   5. écrit ce jeton dans `server/.env`, et s'arrête.
 *
 * ───────────────────────────────────────────────────────────────────────────
 *  LE JETON N'EST JAMAIS AFFICHÉ, ET C'EST VOLONTAIRE.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Il vaut un accès permanent à la boîte : l'imprimer le laisserait dans
 * l'historique du terminal, dans les journaux de l'outillage, et sous les yeux
 * de qui regarde l'écran. Le script l'écrit donc lui-même dans le fichier, et
 * ne confirme que sa longueur.
 *
 * POURQUOI UNE ADRESSE LOCALE PLUTÔT QU'UN COPIER-COLLER. Google a retiré en
 * 2022 le mode « copiez ce code à la main » (`urn:ietf:wg:oauth:2.0:oob`). Un
 * client de type « application de bureau » reçoit la réponse sur
 * `http://localhost`, sans avoir à déclarer le port à l'avance.
 *
 * LA PORTÉE DEMANDÉE EST `https://mail.google.com/`, et c'est une contrainte
 * de SMTP, non un choix de confort : l'authentification XOAUTH2 n'en accepte
 * pas de plus étroite. Le porteur du projet l'a arbitré le 8 octobre, à
 * condition que rien ne puisse envoyer ni supprimer sans son accord — ce que
 * la section « La portée de l'identifiant d'envoi » de
 * `server/tests/mot-de-passe.mjs` vérifie désormais à chaque campagne.
 * ===========================================================================
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { config as chargerEnv } from 'dotenv';

const FICHIER_ENV = fileURLToPath(new URL('../.env', import.meta.url));

/*
 * LE FICHIER EST DÉSIGNÉ PAR SON CHEMIN, JAMAIS PAR LE RÉPERTOIRE COURANT.
 *
 * `import 'dotenv/config'` lit le `.env` du répertoire depuis lequel on lance la
 * commande. Or l'en-tête de ce script indique de le lancer depuis la RACINE du
 * dépôt, où aucun `.env` n'existe : le script s'arrêtait alors sur
 * « CLIENT_ID et CLIENT_SECRET sont requis » alors qu'ils étaient bien
 * renseignés dans `server/.env`. Il ne fonctionnait qu'en ignorant sa propre
 * documentation — défaut constaté le 8 octobre, corrigé le 10.
 *
 * `import.meta.url` désigne CE fichier : le chemin est donc le même d'où que
 * l'on appelle, et c'est exactement celui où le jeton sera écrit plus bas.
 */
chargerEnv({ path: FICHIER_ENV });

const PORT = 53682;
const REDIRECTION = `http://localhost:${PORT}`;
const PORTEE = 'https://mail.google.com/';
const ATTENTE_MAX_MS = 15 * 60 * 1000;

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();

if (!clientId || !clientSecret) {
  console.error('\n[AUTORISATION] GOOGLE_OAUTH_CLIENT_ID et GOOGLE_OAUTH_CLIENT_SECRET sont requis.');
  console.error('  Renseignez-les dans server/.env — ils viennent de Google Cloud,');
  console.error('  « API et services » puis « Identifiants », sur votre ID client OAuth.\n');
  process.exit(1);
}

/** Remplace une ligne de `.env`, ou l'ajoute si elle manque. Rien d'autre ne bouge. */
function ecrireDansEnv(cle, valeur) {
  const contenu = readFileSync(FICHIER_ENV, 'utf8');
  const motif = new RegExp(`^${cle}=.*$`, 'm');
  const existait = motif.test(contenu);

  const nouveau = existait
    ? contenu.replace(motif, `${cle}=${valeur}`)
    : `${contenu.replace(/\s*$/, '')}\n${cle}=${valeur}\n`;

  writeFileSync(FICHIER_ENV, nouveau);
  return existait ? 'remplacée' : 'ajoutée';
}

const urlConsentement = new URL('https://accounts.google.com/o/oauth2/v2/auth');
urlConsentement.searchParams.set('client_id', clientId);
urlConsentement.searchParams.set('redirect_uri', REDIRECTION);
urlConsentement.searchParams.set('response_type', 'code');
urlConsentement.searchParams.set('scope', PORTEE);
/*
 * `offline` ET `consent` ENSEMBLE, et les deux sont nécessaires. Sans
 * `offline`, Google ne délivre aucun jeton de rafraîchissement ; sans
 * `consent`, il n'en délivre un que la PREMIÈRE fois — une seconde exécution
 * du script repartirait alors sans jeton, pour une raison invisible.
 */
urlConsentement.searchParams.set('access_type', 'offline');
urlConsentement.searchParams.set('prompt', 'consent');

/** Échange le code d'autorisation contre les jetons. */
async function echanger(code) {
  const reponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECTION,
      grant_type: 'authorization_code',
    }),
  });

  const corps = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    const raison = corps.error_description ?? corps.error ?? 'raison inconnue';
    throw new Error(`Google a refusé l'échange (${reponse.status}) : ${raison}`);
  }
  return corps;
}

const page = (titre, message) =>
  '<!doctype html><html lang="fr"><meta charset="utf-8">' +
  `<title>${titre}</title>` +
  '<body style="font-family:system-ui,sans-serif;max-width:34rem;margin:4rem auto;line-height:1.6">' +
  `<h1 style="font-size:1.3rem">${titre}</h1><p>${message}</p>` +
  '<p style="color:#666">Vous pouvez fermer cet onglet et revenir au terminal.</p></body></html>';

const repondre = (reponse, titre, message) => {
  reponse.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  reponse.end(page(titre, message));
};

/*
 * UNE SEULE SORTIE, ET ELLE NE FORCE RIEN.
 *
 * Chaque issue appelait `serveur.close()` puis `process.exit()`. Or le minuteur
 * d'attente était encore en cours de fermeture, et libuv s'en plaignait :
 *
 *   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c:94
 *
 * Le processus mourait alors sur le CODE 127 — APRÈS avoir écrit le jeton. Un
 * succès annoncé comme un échec, ce qui est pire qu'un échec franc : celui qui
 * relance ce script chaque semaine ne saurait pas s'il a fonctionné. Défaut
 * constaté le 8 octobre, corrigé le 10.
 *
 * On annule donc le minuteur, on ferme le serveur, et on laisse la boucle
 * d'événements se vider d'elle-même. `process.exitCode` dit quoi rendre sans
 * interrompre quoi que ce soit.
 */
let minuteur;

function terminer(code) {
  clearTimeout(minuteur);
  process.exitCode = code;
  serveur.close();

  /*
   * LES NAVIGATEURS GARDENT LA CONNEXION OUVERTE. Sans cette ligne, `close()`
   * attendrait l'expiration du maintien en vie — cinq secondes par défaut — et
   * le script paraîtrait figé alors que tout a réussi.
   */
  serveur.closeAllConnections();
}

const serveur = createServer(async (requete, reponse) => {
  const recue = new URL(requete.url, REDIRECTION);
  if (recue.pathname !== '/') {
    reponse.writeHead(404);
    reponse.end();
    return;
  }

  const refus = recue.searchParams.get('error');
  if (refus) {
    repondre(reponse, 'Autorisation refusée', `Google a répondu : <code>${refus}</code>`);
    console.error(`\n[AUTORISATION] refusée par Google : ${refus}\n`);
    terminer(1);
    return;
  }

  const code = recue.searchParams.get('code');
  if (!code) {
    reponse.writeHead(400);
    reponse.end('code absent');
    return;
  }

  try {
    const jetons = await echanger(code);

    if (!jetons.refresh_token) {
      repondre(
        reponse,
        'Aucun jeton de rafraîchissement',
        'Google n’en a pas délivré. Révoquez l’accès puis relancez le script.'
      );
      console.error('\n[AUTORISATION] Google n’a pas délivré de jeton de rafraîchissement.');
      console.error('  Cela arrive quand le compte a déjà autorisé cette application.');
      console.error('  Révoquez l’accès sur myaccount.google.com/permissions, puis relancez.\n');
      terminer(1);
      return;
    }

    const etat = ecrireDansEnv('GOOGLE_OAUTH_REFRESH_TOKEN', jetons.refresh_token);

    repondre(reponse, 'Autorisation enregistrée', 'Le jeton a été écrit dans <code>server/.env</code>.');

    console.log('\n[AUTORISATION] REUSSIE.');
    console.log(`  jeton de rafraîchissement : ${jetons.refresh_token.length} signes, ligne ${etat} dans server/.env`);
    console.log(`  portée accordée           : ${jetons.scope ?? PORTEE}`);
    console.log('  (la valeur n’est volontairement pas affichée)');
    console.log('\n  Redémarrez l’API pour qu’elle la lise, puis vérifiez l’envoi.\n');

    terminer(0);
  } catch (erreur) {
    repondre(reponse, 'Échec de l’échange', String(erreur.message));
    console.error(`\n[AUTORISATION] ${erreur.message}\n`);
    terminer(1);
  }
});

serveur.listen(PORT, '127.0.0.1', () => {
  console.log('\n=== Autorisation Gmail pour CoachConnect ===\n');
  console.log(`  compte attendu  : ${process.env.SMTP_USER ?? '(SMTP_USER non renseigné)'}`);
  console.log(`  portée demandée : ${PORTEE}`);
  console.log(`  en écoute sur   : ${REDIRECTION}\n`);
  console.log('  Le navigateur va s’ouvrir. Si rien ne se passe, ouvrez cette adresse :\n');
  console.log(`  ${urlConsentement.toString()}\n`);
  console.log('  ATTENTION : choisissez le compte de la boîte dédiée, pas le compte personnel.\n');

  /*
   * `start` PASSE PAR LE SHELL DE WINDOWS, et son premier argument est le
   * TITRE de la fenêtre : l'omettre ferait prendre l'URL pour un titre, et
   * rien ne s'ouvrirait. D'où la chaîne vide.
   */
  spawn('cmd', ['/c', 'start', '', urlConsentement.toString()], {
    detached: true,
    stdio: 'ignore',
  }).unref();
});

/*
 * Sans réponse, on ne laisse pas un serveur ouvert indéfiniment. Le minuteur est
 * retenu dans `minuteur` : c'est `terminer()` qui l'annulera, et c'est ce qui
 * évite l'assertion de libuv expliquée plus haut.
 */
minuteur = setTimeout(() => {
  console.error('\n[AUTORISATION] abandon : aucune réponse en quinze minutes.\n');
  terminer(1);
}, ATTENTE_MAX_MS);
