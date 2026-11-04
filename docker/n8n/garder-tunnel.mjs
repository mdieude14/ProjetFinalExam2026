/**
 * ===========================================================================
 *  GARDER LE TUNNEL OUVERT LE TEMPS DE RÉPONDRE — puis le refermer tout seul
 * ===========================================================================
 *
 *   node docker/n8n/garder-tunnel.mjs
 *   node docker/n8n/garder-tunnel.mjs --minutes=45
 *
 * ---------------------------------------------------------------------------
 * CE QUI ÉTAIT DEMANDÉ, ET POURQUOI CE N'EST PAS CE QUE FAIT CE SCRIPT
 * ---------------------------------------------------------------------------
 *
 * La demande était : « que le tunnel s'ouvre automatiquement quand je réponds
 * à un message d'escalade, et se referme quand le workflow a fini ».
 *
 * LA PREMIÈRE MOITIÉ EST IMPOSSIBLE, et pour une raison de principe : pour
 * savoir que quelqu'un a répondu sur Telegram, il faut que Telegram ait pu
 * livrer le message. Or Telegram ne peut livrer que si l'adresse est déjà
 * joignable. **Rien ne peut apprendre la réponse tant que le tunnel est
 * fermé** — c'est l'œuf et la poule, pas un manque d'effort.
 *
 * TROIS CONTOURNEMENTS ONT ÉTÉ CHERCHÉS, ET MESURÉS :
 *
 *   1. que n8n SCRUTE Telegram (`getUpdates`) au lieu d'attendre. Un appel
 *      sortant n'a besoin d'aucun tunnel. Mais `TelegramApi.credentials.js`
 *      n'a AUCUN bloc `authenticate` : un nœud `httpRequest` qui emprunterait
 *      ce justificatif partirait sans jeton. Vérifié dans l'image.
 *   2. que le déclencheur scrute de lui-même. `TelegramTrigger.node.js` ne
 *      porte aucun `polling` — il est webhook, et rien d'autre.
 *   3. que notre back-end scrute. Le jeton n'est dans AUCUN `.env` du projet :
 *      il vit uniquement dans les justificatifs chiffrés de n8n, et l'en
 *      extraire est hors de question.
 *
 * LA SECONDE MOITIÉ, ELLE, EST FAISABLE — et c'est tout l'objet de ce script.
 * Il ouvre le tunnel une fois, puis le REFERME DE LUI-MÊME dès que l'activité
 * s'arrête. On ne pense donc au tunnel qu'une seule fois, au début.
 *
 * ---------------------------------------------------------------------------
 * CE QU'IL FAIT, ET CE QU'IL SURVEILLE
 * ---------------------------------------------------------------------------
 *
 *   1. il ouvre le tunnel par `ouvrir-tunnel.mjs`, sans dupliquer sa logique :
 *      l'ordre des trois étapes y est écrit, et le dupliquer serait s'exposer
 *      à ce que les deux divergent ;
 *   2. il scrute les exécutions de `ccAgentTelegr01` dans la base de n8n ;
 *   3. dès que rien n'arrive pendant le délai d'inactivité, il referme.
 *
 * ET IL REFERME AUSSI SUR INTERRUPTION. Un Ctrl-C qui laisserait le tunnel
 * ouvert serait le pire des deux mondes : on croit avoir arrêté, l'adresse
 * reste joignable. Le `finally` et les signaux sont là pour ça.
 *
 * ⚠️ L'adresse publique mène à n8n, ÉDITEUR COMPRIS. Ce script réduit la
 * fenêtre d'exposition ; il ne la supprime pas. La seule façon de la supprimer
 * serait de se passer du webhook — voir le contournement 1 ci-dessus, qui
 * demande que le porteur du projet dépose lui-même le jeton dans un
 * justificatif que `httpRequest` sait lire. Son secret, son geste.
 * ===========================================================================
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ICI = fileURLToPath(new URL('.', import.meta.url));
const CONTENEUR = 'coachconnect-n8n';
const WORKFLOW = 'ccAgentTelegr01';

/** Délai d'inactivité avant fermeture, en minutes. */
const argMinutes = process.argv.find((a) => a.startsWith('--minutes='));
const MINUTES = Math.max(2, Number.parseInt(argMinutes?.split('=')[1] ?? '20', 10) || 20);

/** Pas de scrutation. Trente secondes : assez fin pour ne pas traîner. */
const PAS_MS = 30000;

const docker = (...args) => {
  try {
    return execFileSync('docker', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
};

const horodate = () => new Date().toTimeString().slice(0, 8);
const dire = (t) => console.log(`[${horodate()}] ${t}`);

/**
 * Combien d'exécutions de l'agent Telegram, et quand la dernière ?
 *
 * ON LIT LA BASE, PAS LE JOURNAL. Le journal de n8n ne trace pas une exécution
 * réussie, et `docker logs --since` s'est déjà révélé trompeur après une
 * recréation de conteneur : la fenêtre de temps ne correspondait pas. La base
 * fait foi.
 */
function derniereExecution() {
  const sortie = docker(
    'exec',
    CONTENEUR,
    'sh',
    '-c',
    `cd $(npm root -g)/n8n && node -e '
const s = require("sqlite3");
const db = new s.Database("/home/node/.n8n/database.sqlite", s.OPEN_READONLY);
db.get("SELECT COUNT(*) n, MAX(startedAt) d FROM execution_entity WHERE workflowId = ?", ["${WORKFLOW}"], (e, r) => {
  if (e || !r) { console.log("0|"); process.exit(0); }
  console.log((r.n || 0) + "|" + (r.d || ""));
  db.close();
});'`
  );
  if (!sortie) return null;
  const [nombre, date] = sortie.split('|');
  return { nombre: Number.parseInt(nombre, 10) || 0, date: date || null };
}

/*
 * LES HORODATAGES DE n8n SONT EN UTC, et son conteneur l'est aussi. Les lire
 * comme de l'heure locale décalerait la comparaison d'une ou deux heures —
 * assez pour fermer le tunnel en pleine conversation, ou pour le laisser
 * ouvert une heure de trop. Les deux erreurs comptent.
 */
const enMs = (date) => (date ? Date.parse(`${date.replace(' ', 'T')}Z`) : null);

const fermer = () => {
  dire('fermeture du tunnel…');
  spawnSync(process.execPath, [`${ICI}ouvrir-tunnel.mjs`, '--fermer'], { stdio: 'inherit' });
};

/* ------------------------------------------------------------------ */

console.log(`
=== SURVEILLANT DU TUNNEL TELEGRAM ===

  Il ouvre le tunnel, te laisse répondre, et REFERME TOUT SEUL après
  ${MINUTES} minutes sans la moindre exécution de l'agent.

  ⚠️  Pendant ce temps, l'adresse publique mène à n8n, éditeur compris.
  Ctrl-C referme aussi.
`);

if (!docker('ps', '--filter', `name=${CONTENEUR}`, '--filter', 'status=running', '-q')) {
  console.error('n8n ne tourne pas. Démarrer Docker Desktop, puis réessayer.');
  process.exit(1);
}

/*
 * ON COMPTE LES EXÉCUTIONS AVANT D'OUVRIR. Sans ce point de départ, une
 * exécution ancienne — celle de la veille, par exemple — passerait pour de
 * l'activité, et le tunnel resterait ouvert sans que personne ne réponde.
 */
const depart = derniereExecution();
if (!depart) {
  console.error('Impossible de lire les exécutions de n8n. Rien n’a été ouvert.');
  process.exit(1);
}
dire(`exécutions de l'agent au départ : ${depart.nombre}`);

let ouvert = false;
let interrompu = false;

const surInterruption = () => {
  if (interrompu) return;
  interrompu = true;
  dire('interruption demandée.');
  if (ouvert) fermer();
  process.exit(130);
};
process.on('SIGINT', surInterruption);
process.on('SIGTERM', surInterruption);

try {
  dire('ouverture du tunnel…');
  const ouverture = spawnSync(process.execPath, [`${ICI}ouvrir-tunnel.mjs`], { stdio: 'inherit' });
  if (ouverture.status !== 0) {
    console.error('\nL’ouverture a échoué. Rien à refermer.');
    process.exit(1);
  }
  ouvert = true;

  /*
   * LE DÉLAI COURT À PARTIR DE MAINTENANT, pas de la dernière exécution. Au
   * premier tour il n'y a par définition aucune activité nouvelle : partir de
   * la dernière exécution fermerait aussitôt.
   */
  let derniereActivite = Date.now();
  let vues = depart.nombre;

  dire(`en veille. Réponds sur Telegram ; je referme après ${MINUTES} min sans activité.`);

  for (;;) {
    await new Promise((r) => setTimeout(r, PAS_MS));
    if (interrompu) break;

    const etat = derniereExecution();
    if (!etat) {
      dire('n8n ne répond plus. Je referme par précaution.');
      break;
    }

    if (etat.nombre > vues) {
      const nouvelles = etat.nombre - vues;
      vues = etat.nombre;
      derniereActivite = enMs(etat.date) ?? Date.now();
      dire(`${nouvelles} exécution(s) de l'agent — le compteur d'inactivité repart.`);
      continue;
    }

    const inactifMin = (Date.now() - derniereActivite) / 60000;
    if (inactifMin >= MINUTES) {
      dire(`${MINUTES} min sans activité.`);
      break;
    }
  }
} finally {
  if (ouvert && !interrompu) {
    fermer();
    console.log('\nTunnel refermé. Le canal sortant (les alertes) continue de fonctionner.\n');
  }
}
