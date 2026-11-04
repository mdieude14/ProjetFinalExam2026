/**
 * ===========================================================================
 *  ÉTAT DU CANAL TELEGRAM — pourquoi il marche, ou pourquoi il ne marche pas
 * ===========================================================================
 *
 *   node docker/n8n/etat-telegram.mjs
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE SCRIPT EXISTE
 * ---------------------------------------------------------------------------
 *
 * Le 30 octobre 2026, le canal Telegram a cessé de fonctionner. Le porteur du
 * projet a tenté de réactiver le workflow depuis l'éditeur n8n, et a reçu ceci :
 *
 *     Workflow could not be activated:
 *     Bad Request: bad webhook: An HTTPS URL must be provided for webhook.
 *
 * Ce message est exact, et il est inutilisable. Il dit ce que Telegram refuse,
 * jamais POURQUOI n8n lui a proposé une adresse non conforme, et encore moins
 * quoi faire.
 *
 *   LA LEÇON : quand un service tiers rend une erreur exacte mais opaque, ce
 *   n'est pas son message qu'il faut corriger, c'est le chemin qui mène de ce
 *   message à la cause.
 *
 * ---------------------------------------------------------------------------
 * CE QUI A CHANGÉ LE 4 NOVEMBRE 2026, ET POURQUOI CE SCRIPT A ÉTÉ REFAIT
 * ---------------------------------------------------------------------------
 *
 * Cette erreur ne peut plus se produire : le canal entrant ne passe plus par
 * un webhook de Telegram. Le back-end va chercher les messages lui-même
 * (`getUpdates`, un appel SORTANT), et les remet à n8n en local. Plus
 * d'adresse publique, donc plus de tunnel, donc plus d'éditeur n8n joignable
 * de l'extérieur.
 *
 *   ET UN DIAGNOSTIC QUI DÉCRIT UNE ARCHITECTURE DISPARUE EST PIRE QUE PAS DE
 *   DIAGNOSTIC. L'ancienne version prescrivait d'ouvrir un tunnel : elle
 *   aurait fait rouvrir une porte dont tout le travail consistait à se passer.
 *
 * CE QUE CE SCRIPT VÉRIFIE MAINTENANT, ET IL ÉPROUVE AU LIEU DE CONSTATER.
 * Le chemin du webhook local est SONDÉ, sans clé : la réponse distingue d'un
 * seul appel les trois états qui compte — enregistré et protégé (403),
 * inexistant donc workflow inactif (404), ou enregistré SANS protection
 * (200), qui serait une porte ouverte sur le réseau local.
 *
 * Ce script ne modifie RIEN. Il lit, il sonde, il conclut.
 *
 * SORTIE : code 0 si le canal peut fonctionner, 1 sinon.
 * ===========================================================================
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CONTENEUR = 'coachconnect-n8n';
const WORKFLOW = 'ccAgentTelegr01';
const RELEVE = 'ccReleveTelegr01';
const CHEMIN_WEBHOOK = 'http://localhost:5678/webhook/telegram-support';
const SANTE_API = 'http://localhost:5000/api/health';

const ICI = fileURLToPath(new URL('.', import.meta.url));

const lire = (...args) => {
  try {
    return execFileSync('docker', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
};

const sonder = async (url, options = {}) => {
  try {
    const reponse = await fetch(url, { signal: AbortSignal.timeout(8000), ...options });
    return reponse.status;
  } catch {
    return null;
  }
};

console.log('\n=== ÉTAT DU CANAL TELEGRAM ===\n');

/* ------------------------------------------------------------------ *
 *  1. Le conteneur n8n répond-il ?
 * ------------------------------------------------------------------ */
const debout = lire('ps', '--filter', `name=${CONTENEUR}`, '--filter', 'status=running', '-q');
if (!debout) {
  console.log('  n8n            : ÉTEINT');
  console.log('\nLe canal ne peut pas fonctionner : n8n ne tourne pas.');
  console.log('  Remède : démarrer Docker Desktop, puis');
  console.log(`           docker start ${CONTENEUR}\n`);
  process.exit(1);
}
console.log('  n8n            : debout');

/* ------------------------------------------------------------------ *
 *  2. Le jeton du bot est-il déposé ?
 * ------------------------------------------------------------------ */

/*
 * ON VÉRIFIE SA PRÉSENCE, JAMAIS SA VALEUR. Le jeton vaut le bot entier :
 * qui le lit peut écrire à la place du support. Un journal de terminal se
 * recopie plus souvent qu'on ne le croit.
 */
let jetonPose = false;
try {
  const env = readFileSync(`${ICI}../../server/.env`, 'utf8');
  jetonPose = /^TELEGRAM_BOT_TOKEN=.+/m.test(env);
} catch {
  jetonPose = false;
}
console.log(`  jeton du bot   : ${jetonPose ? 'déposé dans server/.env' : 'ABSENT'}`);

/* ------------------------------------------------------------------ *
 *  3. Le back-end tourne-t-il ? C'est lui qui scrute.
 * ------------------------------------------------------------------ */
const api = await sonder(SANTE_API);
console.log(`  back-end       : ${api === 200 ? 'debout' : 'INJOIGNABLE'}`);

/* ------------------------------------------------------------------ *
 *  4. Les deux workflows du canal
 * ------------------------------------------------------------------ */
const etats = lire(
  'exec',
  CONTENEUR,
  'sh',
  '-c',
  `cd $(npm root -g)/n8n && node -e '
const s = require("sqlite3");
const db = new s.Database("/home/node/.n8n/database.sqlite", s.OPEN_READONLY);
db.all("SELECT id, active FROM workflow_entity", (e, r) => {
  if (e) { console.log(""); process.exit(0); }
  console.log(r.map((x) => x.id + "=" + (x.active ? 1 : 0)).join(","));
  db.close();
});'`
);

const actif = (id) => new RegExp(`${id}=1`).test(etats ?? '');
console.log(`  ${WORKFLOW} : ${actif(WORKFLOW) ? 'ACTIF' : 'inactif'}   (reçoit tes réponses)`);
console.log(`  ${RELEVE} : ${actif(RELEVE) ? 'ACTIF' : 'inactif'}   (envoie les alertes)`);

/* ------------------------------------------------------------------ *
 *  5. LE CHEMIN LOCAL EST-IL ENREGISTRÉ, ET PROTÉGÉ ?
 * ------------------------------------------------------------------ */

/*
 * UN SEUL APPEL, TROIS ÉTATS DISTINGUÉS — et c'est la leçon de la version
 * précédente, qui vérifiait la PRÉSENCE d'un maillon au lieu de son
 * FONCTIONNEMENT, et annonçait « ENTRANT : OUI » sur une adresse morte.
 *
 *   403  enregistré ET protégé par la clé de service. C'est l'état voulu.
 *   404  pas enregistré : n8n n'inscrit le chemin que pour un workflow ACTIF,
 *        et `n8n import:workflow` remet toujours `active: false`.
 *   200  enregistré mais SANS protection. Le port 5678 est joignable depuis
 *        le réseau local : n'importe qui pourrait injecter une fausse
 *        réponse. C'est une alarme, pas une bonne nouvelle.
 *
 * La sonde part SANS clé, exprès : c'est ce qui permet de distinguer les
 * trois cas, et elle ne peut donc rien déclencher.
 */
const codeWebhook = await sonder(CHEMIN_WEBHOOK, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
});

const etatWebhook =
  codeWebhook === 403
    ? 'enregistré et protégé'
    : codeWebhook === 404
      ? 'NON ENREGISTRÉ (workflow inactif)'
      : codeWebhook === null
        ? 'INJOIGNABLE'
        : `OUVERT SANS CLÉ (${codeWebhook})`;
console.log(`  webhook local  : ${etatWebhook}`);

/* ------------------------------------------------------------------ *
 *  6. Un tunnel traîne-t-il encore ?
 * ------------------------------------------------------------------ */

/*
 * CE N'EST PLUS UN PRÉREQUIS, C'EST UNE ALERTE. Le canal n'a plus besoin
 * d'adresse publique ; un tunnel debout n'apporte donc rien et expose
 * l'éditeur n8n pour rien.
 */
const tunnel = lire('ps', '--filter', 'name=coachconnect-tunnel', '--filter', 'status=running', '-q');
const adresse = lire('exec', CONTENEUR, 'sh', '-c', 'echo "$WEBHOOK_URL"') ?? '';
const enHttps = /^https:\/\//i.test(adresse);
if (tunnel || enHttps) {
  console.log(`  tunnel         : ${tunnel ? 'DEBOUT — inutile désormais' : 'fermé'}`);
  console.log(`  adresse n8n    : ${enHttps ? 'PUBLIQUE — inutile désormais' : 'localhost'}`);
}

/* ------------------------------------------------------------------ *
 *  7. Le verdict, et il distingue DEUX sens de circulation
 * ------------------------------------------------------------------ */

/*
 * LE CANAL A DEUX SENS, ET ILS N'ONT JAMAIS EU LES MÊMES BESOINS. C'est la
 * distinction que l'erreur de Telegram ne disait pas, et qui expliquait qu'on
 * puisse recevoir des alertes sans pouvoir y répondre :
 *
 *   SORTANT  (relève -> Telegram)   un appel sortant ; il a toujours marché.
 *   ENTRANT  (Telegram -> n8n)      il exigeait que Telegram JOIGNE la
 *                                   machine. Il part désormais chercher,
 *                                   donc il est devenu sortant lui aussi.
 *
 * Les deux sens sont maintenant de même nature, et c'est tout le gain : plus
 * rien à ouvrir, plus rien à refermer, plus rien à surveiller.
 */
console.log('\n--- verdict ---\n');

const sortantOk = actif(RELEVE);
const entrantOk = jetonPose && api === 200 && actif(WORKFLOW) && codeWebhook === 403;

console.log(`  SORTANT (tu reçois les alertes)   : ${sortantOk ? 'OUI' : 'NON'}`);
console.log(`  ENTRANT (tu peux y répondre)      : ${entrantOk ? 'OUI' : 'NON'}`);

if (sortantOk && entrantOk) {
  console.log('\nLe canal fonctionne dans les deux sens, sans aucune porte ouverte.');
  if (tunnel) {
    console.log('  ⚠️  Un tunnel tourne pour rien. Referme-le :');
    console.log('      node docker/n8n/ouvrir-tunnel.mjs --fermer\n');
  } else {
    console.log('');
  }
  process.exit(0);
}

if (!sortantOk) {
  console.log(`\n  ✗ ${RELEVE} est inactif : aucune alerte ne partira.`);
  console.log(`    Remède : docker exec ${CONTENEUR} n8n update:workflow --id=${RELEVE} --active=true`);
  console.log('             puis recréer le conteneur (un état posé en base ne vaut');
  console.log('             rien tant que n8n ne l’a pas relu au démarrage).');
}

if (!entrantOk) {
  /*
   * L'ORDRE DES BRANCHES N'EST PAS INDIFFÉRENT : du cas le plus GÉNÉRAL au
   * plus particulier. Une version antérieure testait le cas particulier
   * d'abord, et expliquait donc de travers un état qu'elle diagnostiquait
   * pourtant bien — « un tunnel tourne » imprimé juste après « tunnel :
   * fermé ». Le remède était bon, l'explication se contredisait.
   */
  if (!jetonPose) {
    console.log('\n  ✗ LE JETON DU BOT N’EST PAS DÉPOSÉ.');
    console.log('    Sans lui, personne ne va chercher les messages : tu reçois les');
    console.log('    alertes, mais y répondre ne produit rien — et le bot ne peut même');
    console.log('    pas dire qu’il n’a rien reçu.');
    console.log('');
    console.log('    Remède, une seule ligne à ajouter dans server/.env :');
    console.log('        TELEGRAM_BOT_TOKEN=<le jeton donné par @BotFather>');
    console.log('    puis redémarrer le back-end. C’est la MÊME valeur que celle du');
    console.log('    justificatif « Bot Telegram — CoachConnect » dans n8n.');
  } else if (api !== 200) {
    console.log('\n  ✗ LE BACK-END NE RÉPOND PAS, et c’est lui qui scrute.');
    console.log('    Le jeton est déposé, mais personne ne s’en sert.');
    console.log('    Remède : cd server && npm run dev');
  } else if (codeWebhook === 404) {
    console.log(`\n  ✗ LE CHEMIN DU WEBHOOK N’EST PAS ENREGISTRÉ — ${WORKFLOW} est inactif.`);
    console.log('    n8n n’inscrit le chemin que pour un workflow ACTIF, et');
    console.log('    `n8n import:workflow` le remet TOUJOURS à l’arrêt. Après un import,');
    console.log('    les trois étapes sont donc obligatoires, dans cet ordre :');
    console.log('');
    console.log(`        docker exec ${CONTENEUR} n8n import:workflow --input=/workflows/agent-telegram.json`);
    console.log(`        docker exec ${CONTENEUR} n8n update:workflow --id=${WORKFLOW} --active=true`);
    console.log('        node docker/n8n/recreer-n8n.mjs');
    console.log('');
    console.log('    La recréation n’est pas une précaution : un état posé en base ne');
    console.log('    vaut rien tant que n8n ne l’a pas relu au démarrage. Et elle passe');
    console.log('    par ce script, pas par `docker compose` à la main : la commande');
    console.log('    évidente supprime la surcharge qui porte le certificat d’Avast, et');
    console.log('    n8n se retrouve debout mais incapable d’appeler quoi que ce soit.');
  } else if (codeWebhook !== 403 && codeWebhook !== null) {
    console.log(`\n  ✗ LE WEBHOOK LOCAL RÉPOND ${codeWebhook} SANS CLÉ DE SERVICE.`);
    console.log('    Le port 5678 est joignable depuis le réseau local : n’importe qui');
    console.log('    pourrait injecter une fausse réponse d’exploitant. Le nœud');
    console.log('    « Message reçu » doit porter `authentication: headerAuth` et le');
    console.log('    justificatif « Clé de service — CoachConnect ».');
    console.log('    Remède : node docker/n8n/workflows/construire-agent-telegram.mjs');
    console.log('             puis les trois étapes d’import ci-dessus.');
  } else {
    console.log('\n  ✗ n8n ne répond pas sur son chemin local.');
    console.log('    Remède : node docker/n8n/recreer-n8n.mjs');
  }
}

console.log('');
process.exit(1);
