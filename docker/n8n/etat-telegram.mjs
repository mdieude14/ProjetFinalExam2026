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
 * quoi faire. Entre cette phrase et sa cause — « le tunnel est fermé, donc
 * WEBHOOK_URL vaut http://localhost:5678/ » — il n'y avait aucun chemin.
 *
 *   LA LEÇON : quand un service tiers rend une erreur exacte mais opaque, ce
 *   n'est pas son message qu'il faut corriger, c'est le chemin qui mène de ce
 *   message à la cause. Un diagnostic d'une commande vaut mieux qu'un
 *   paragraphe de documentation que personne ne relira au moment utile.
 *
 * Ce script ne modifie RIEN. Il lit, il compare, il conclut.
 *
 * SORTIE : code 0 si le canal peut fonctionner, 1 sinon — pour qu'il serve
 * aussi dans un enchaînement.
 * ===========================================================================
 */

import { execFileSync } from 'node:child_process';

const CONTENEUR = 'coachconnect-n8n';
const WORKFLOW = 'ccAgentTelegr01';
const RELEVE = 'ccReleveTelegr01';

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
 *  2. Quelle adresse n8n déclarerait-il à Telegram ?
 * ------------------------------------------------------------------ */
const adresse = lire('exec', CONTENEUR, 'sh', '-c', 'echo "$WEBHOOK_URL"') ?? '';
const enHttps = /^https:\/\//i.test(adresse);
const surLocalhost = /localhost|127\.0\.0\.1/i.test(adresse);

/*
 * ON N'IMPRIME PAS L'ADRESSE EN CLAIR. Elle mène à n8n, éditeur compris :
 * elle vaut mot de passe tant qu'elle est ouverte, et un journal de terminal
 * se recopie plus souvent qu'on ne le croit. Son existence suffit à conclure.
 */
console.log(`  adresse        : ${enHttps ? 'HTTPS (publique)' : surLocalhost ? 'localhost' : adresse ? 'non HTTPS' : 'aucune'}`);

/* ------------------------------------------------------------------ *
 *  3. Le tunnel tourne-t-il ?
 * ------------------------------------------------------------------ */
const tunnel = lire('ps', '--filter', 'name=coachconnect-tunnel', '--filter', 'status=running', '-q');
console.log(`  tunnel         : ${tunnel ? 'debout' : 'fermé'}`);

/* ------------------------------------------------------------------ *
 *  3 bis. L'ADRESSE DÉTENUE MÈNE-T-ELLE ENCORE À n8n ?
 * ------------------------------------------------------------------ */

/*
 * « UN TUNNEL TOURNE » ET « L'ADRESSE DÉTENUE FONCTIONNE » SONT DEUX FAITS
 * DIFFÉRENTS, et c'est la première version de ce script qui l'a appris.
 *
 * `cloudflared` tire une adresse AU HASARD à chaque démarrage. Relancer son
 * conteneur par `docker start` lui en donne donc une NOUVELLE, pendant que n8n
 * continue de déclarer l'ancienne à Telegram. Le tunnel est debout, le workflow
 * est actif, tout a l'air juste — et rien n'arrive.
 *
 * Mesuré le 30 octobre 2026 : après un `docker start coachconnect-tunnel`,
 * l'adresse détenue par n8n rendait **530** (Cloudflare n'a plus d'origine
 * derrière elle), alors que ce script annonçait « ENTRANT : OUI ».
 *
 *   LA LEÇON : un diagnostic qui vérifie la PRÉSENCE d'un maillon au lieu de
 *   son FONCTIONNEMENT ment avec aplomb. Ici la différence tient en un appel
 *   HTTP, et sans lui le script aurait rassuré à tort — exactement le défaut
 *   qu'il est censé éviter.
 *
 * C'est aussi pourquoi on ne relance JAMAIS le conteneur de tunnel seul :
 * `ouvrir-tunnel.mjs` existe pour enchaîner l'adresse, l'inscription et la
 * recréation de n8n dans le bon ordre.
 */
let adresseVivante = null;
if (enHttps) {
  try {
    const reponse = await fetch(`${adresse.replace(/\/$/, '')}/healthz`, {
      signal: AbortSignal.timeout(20000),
    });
    adresseVivante = reponse.ok;
  } catch {
    adresseVivante = false;
  }
  console.log(
    `  cette adresse  : ${adresseVivante ? 'mène bien à n8n' : 'NE MÈNE PLUS À RIEN (morte)'}`
  );
}

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
 *  5. Le verdict, et il distingue DEUX sens de circulation
 * ------------------------------------------------------------------ */

/*
 * LE CANAL A DEUX SENS, ET ILS N'ONT PAS LES MÊMES BESOINS. C'est la
 * distinction que l'erreur de Telegram ne dit pas, et qui explique qu'on puisse
 * recevoir des alertes sans pouvoir y répondre :
 *
 *   SORTANT  (relève -> Telegram)  un appel sortant, il passe derrière
 *                                  n'importe quelle box, SANS tunnel.
 *   ENTRANT  (Telegram -> n8n)     Telegram doit JOINDRE la machine, et il
 *                                  exige une adresse HTTPS publique.
 *
 * D'où le symptôme déroutant : les alertes arrivent, mais répondre ne produit
 * rien — et le bot ne peut même pas dire qu'il n'a rien reçu.
 */
console.log('\n--- verdict ---\n');

const sortantOk = actif(RELEVE);
const entrantOk = enHttps && Boolean(tunnel) && adresseVivante === true && actif(WORKFLOW);

console.log(`  SORTANT (tu reçois les alertes)   : ${sortantOk ? 'OUI' : 'NON'}`);
console.log(`  ENTRANT (tu peux y répondre)      : ${entrantOk ? 'OUI' : 'NON'}`);

if (sortantOk && entrantOk) {
  console.log('\nLe canal fonctionne dans les deux sens.');
  console.log('  ⚠️  L’adresse publique mène à n8n, éditeur compris. Referme après usage :');
  console.log('      node docker/n8n/ouvrir-tunnel.mjs --fermer\n');
  process.exit(0);
}

if (!sortantOk) {
  console.log(`\n  ✗ ${RELEVE} est inactif : aucune alerte ne partira.`);
  console.log(`    Remède : docker exec ${CONTENEUR} n8n update:workflow --id=${RELEVE} --active=true`);
  console.log('             puis recréer le conteneur (un état posé en base ne vaut');
  console.log('             rien tant que n8n ne l’a pas relu au démarrage).');
}

if (!entrantOk) {
  if (!enHttps) {
    console.log('\n  ✗ AUCUNE ADRESSE HTTPS PUBLIQUE.');
    console.log('    C’est la cause de ce message, si tu l’as vu dans l’éditeur n8n :');
    console.log('');
    console.log('        Workflow could not be activated:');
    console.log('        Bad Request: bad webhook: An HTTPS URL must be provided for webhook.');
    console.log('');
    console.log('    Telegram exige une adresse HTTPS pour y livrer les messages. Sans');
    console.log('    tunnel, n8n n’a que `http://localhost:5678/` à lui proposer, et');
    console.log('    Telegram refuse. Activer le workflow à la main ne peut pas marcher :');
    console.log('    il faut d’abord une adresse.');
    console.log('');
    console.log('    Remède, et il fait tout dans le bon ordre :');
    console.log('        node docker/n8n/ouvrir-tunnel.mjs');
    /*
     * L'ORDRE DES DEUX BRANCHES SUIVANTES N'EST PAS INDIFFÉRENT.
     *
     * Une première version plaçait l'adresse morte AVANT l'absence de tunnel.
     * Sur l'état réel du 2 novembre 2026 — tunnel fermé, adresse publique
     * restée dans n8n — elle affichait donc « un tunnel tourne, mais pas celui
     * dont n8n détient l'adresse » juste après avoir imprimé « tunnel : fermé ».
     * Le remède était bon, l'explication se contredisait, et le lecteur
     * cherchait un tunnel qui n'existait pas.
     *
     *   LA LEÇON : « aucun tunnel » est un cas PLUS GÉNÉRAL que « le mauvais
     *   tunnel ». Le cas général se teste d'abord, sinon le cas particulier le
     *   capture et explique de travers.
     *
     * Et ce défaut ne s'est vu que sur un état FAUTIF RÉEL. Les deux états
     * simulés la veille passaient tous les deux par la branche correcte : le
     * hasard du simulacre avait masqué l'inversion.
     */
  } else if (!tunnel) {
    console.log('\n  ✗ AUCUN TUNNEL DEBOUT, ALORS QUE n8n DÉTIENT UNE ADRESSE PUBLIQUE.');
    console.log('    C’est l’état d’après-redémarrage : le conteneur de tunnel ne revient');
    console.log('    pas seul (`restart: "no"`, c’est voulu), mais n8n revient et garde');
    console.log('    l’adresse morte. Il l’a déclarée à Telegram au démarrage, donc le bot');
    console.log('    est injoignable EN SILENCE — aucune erreur ne le signale.');
    console.log('    Remède : node docker/n8n/ouvrir-tunnel.mjs --fermer');
    console.log('             puis, pour une démonstration : node docker/n8n/ouvrir-tunnel.mjs');
  } else if (adresseVivante === false) {
    console.log('\n  ✗ UN TUNNEL TOURNE, MAIS PAS CELUI DONT n8n DÉTIENT L’ADRESSE.');
    console.log('    cloudflared tire une adresse AU HASARD à chaque démarrage : relancer');
    console.log('    son conteneur seul lui en donne une nouvelle, pendant que n8n continue');
    console.log('    de déclarer l’ancienne à Telegram. Tout a l’air juste, et rien n’arrive.');
    console.log('    C’est pourquoi on ne relance JAMAIS le conteneur de tunnel seul.');
    console.log('    Remède, et il remet les trois étapes dans le bon ordre :');
    console.log('        node docker/n8n/ouvrir-tunnel.mjs --fermer');
    console.log('        node docker/n8n/ouvrir-tunnel.mjs');
  } else {
    console.log(`\n  ✗ ${WORKFLOW} est inactif alors que l’adresse et le tunnel sont bons.`);
    console.log('    Remède : node docker/n8n/ouvrir-tunnel.mjs  (il réactive au bon moment)');
  }
}

console.log('');
process.exit(1);
