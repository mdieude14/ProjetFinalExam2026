#!/usr/bin/env node
/**
 * Transfère le n8n local vers le n8n du VPS : les identifiants et les flux.
 *
 *   npm run transferer:n8n -- --hote=root@2.24.62.117              ESSAI
 *   npm run transferer:n8n -- --hote=root@2.24.62.117 --appliquer
 *
 * CE QUI REND LE TRANSFERT POSSIBLE SANS RETAPER AUCUN SECRET : les données
 * des identifiants sont chiffrées en AES par n8n. Elles voyagent chiffrées et
 * ne se déchiffrent qu'avec la MÊME « N8N_ENCRYPTION_KEY ».
 *
 * D'OÙ LE CONTRÔLE QUI PASSE AVANT TOUT : les deux clés sont comparées par
 * leur empreinte SHA-256, jamais par leur valeur. Si elles différaient,
 * l'import produirait des identifiants présents mais INDÉCHIFFRABLES, et n8n
 * ne le signalerait qu'au premier appel, en pleine soutenance.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CONTENEUR_LOCAL = 'coachconnect-n8n';
const CONTENEUR_VPS = 'n8n';

const args = process.argv.slice(2);
const lire = (n) => {
  const a = args.find((x) => x.startsWith('--' + n + '='));
  return a ? a.slice(n.length + 3) : null;
};
const HOTE = lire('hote');
const CLE_SSH = lire('cle') || join(process.env.HOME || process.env.USERPROFILE, '.ssh', 'coachconnect_vps');
const APPLIQUER = args.includes('--appliquer');

const crier = (s) => process.stdout.write((s === undefined ? '' : s) + '\n');
const ok = (s) => crier('  \u001b[32mOK\u001b[0m    ' + s);
const note = (s) => crier('  \u001b[33mNOTE\u001b[0m  ' + s);
const stop = (s) => crier('  \u001b[31mSTOP\u001b[0m  ' + s);
const titre = (s) => crier('\n\u001b[1;34m' + s + '\u001b[0m');

if (!HOTE) {
  crier('Usage : npm run transferer:n8n -- --hote=root@<IP> [--cle=<chemin>] [--appliquer]');
  process.exit(2);
}

const TRAVAIL = join(tmpdir(), 'transfert-n8n-' + process.pid);
mkdirSync(TRAVAIL, { recursive: true });

const ssh = (cmd) => execFileSync('ssh', [
  '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'ConnectTimeout=12', '-i', CLE_SSH, HOTE, cmd,
], { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });

const docker = (...a) => execFileSync('docker', a, {
  encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024,
});

// n8n préfixe sa sortie de lignes de journal : on ne garde que le JSON.
const extraireJson = (brut) => {
  const i = brut.indexOf('[');
  if (i < 0) throw new Error('aucun tableau JSON dans la sortie');
  return JSON.parse(brut.slice(i));
};

const empreinte = (v) => createHash('sha256').update(v.trim()).digest('hex').slice(0, 16);
const CHIFFRE = 'U2FsdGVkX1';

/**
 * Sortie qui efface AVANT de quitter.
 *
 * « sortir() » n a PAS cette politesse : il termine sur le champ, sans
 * dérouler la pile, donc sans exécuter le « finally ». Les deux fichiers
 * portent des secrets chiffrés : les laisser dans le dossier temporaire du
 * poste serait un résidu, et un résidu finit toujours par être oublié.
 */
const sortir = (code) => {
  try { rmSync(TRAVAIL, { recursive: true, force: true }); } catch { /* rien */ }
  process.exit(code); // seul appel direct legitime
};

let anomalies = 0;

try {
  titre('=== 1. LE n8n LOCAL RÉPOND-IL ? ===');
  const etat = docker('ps', '--filter', 'name=' + CONTENEUR_LOCAL, '--format', '{{.Status}}').trim();
  if (!etat) {
    stop('le conteneur ' + CONTENEUR_LOCAL + ' ne tourne pas');
    sortir(1);
  }
  ok(CONTENEUR_LOCAL + ' : ' + etat);

  titre('=== 2. LES DEUX CLÉS DE CHIFFREMENT SONT-ELLES IDENTIQUES ? ===');
  crier('  (comparées par empreinte SHA-256 ; aucune valeur affichée)');

  const cleLocale = docker('exec', CONTENEUR_LOCAL, 'printenv', 'N8N_ENCRYPTION_KEY').trim();
  if (!cleLocale) {
    stop('le n8n local a une clé générée au hasard, pas une clé fixée');
    stop('sans clé fixée, les identifiants ne sont pas transférables');
    sortir(1);
  }
  const empLocale = empreinte(cleLocale);
  ok('locale : empreinte ' + empLocale + ', ' + cleLocale.length + ' caractères');

  let cleVps = '';
  try {
    cleVps = ssh('docker exec ' + CONTENEUR_VPS + ' printenv N8N_ENCRYPTION_KEY 2>/dev/null || true').trim();
  } catch (e) {
    stop('SSH injoignable : ' + String(e.message).split('\n')[0]);
    note('la clé publique est-elle installée sur le VPS ?');
    sortir(1);
  }

  if (!cleVps) {
    note('le n8n du VPS ne tourne pas encore, ou sans clé : rien à comparer');
    note('REPORTER la même clé dans le .env du VPS AVANT le premier démarrage');
    anomalies += 1;
  } else if (empreinte(cleVps) === empLocale) {
    ok('les deux clés sont IDENTIQUES : les identifiants se déchiffreront');
  } else {
    stop('les clés DIFFÈRENT (VPS : ' + empreinte(cleVps) + ')');
    stop('un import produirait des identifiants présents mais INDÉCHIFFRABLES');
    note('corriger N8N_ENCRYPTION_KEY dans le .env du VPS, puis');
    note('  docker compose up -d --force-recreate n8n');
    sortir(1);
  }

  titre('=== 3. EXPORT DEPUIS LE LOCAL ===');
  const idents = extraireJson(docker('exec', CONTENEUR_LOCAL, 'n8n', 'export:credentials', '--all', '--pretty'));
  const flux = extraireJson(docker('exec', CONTENEUR_LOCAL, 'n8n', 'export:workflow', '--all'));

  const enClair = idents.filter((c) => typeof c.data !== 'string' || !c.data.startsWith(CHIFFRE));
  if (enClair.length) {
    stop(enClair.length + ' identifiant(s) NON chiffrés : ils ne doivent pas voyager ainsi');
    enClair.forEach((c) => stop('    ' + c.name));
    sortir(1);
  }
  ok(idents.length + ' identifiants, tous chiffrés AES');
  idents.forEach((c) => crier('          ' + String(c.name || '?').padEnd(44) + '[' + c.type + ']'));
  ok(flux.length + ' flux, dont ' + flux.filter((w) => w.active).length + ' actifs');

  const fIdents = join(TRAVAIL, 'identifiants.json');
  const fFlux = join(TRAVAIL, 'flux.json');
  writeFileSync(fIdents, JSON.stringify(idents), { mode: 0o600 });
  writeFileSync(fFlux, JSON.stringify(flux), { mode: 0o600 });
  ok('écrits hors du dépôt, en 600');

  if (!APPLIQUER) {
    titre('=== MODE ESSAI : aucun envoi, aucun import ===');
    crier('  anomalies : ' + anomalies);
    crier('  relancer avec --appliquer pour transférer pour de bon.');
    sortir(0);
  }

  titre('=== 4. ENVOI VERS LE VPS ===');
  const distant = '/root/transfert-n8n';
  ssh('mkdir -p ' + distant + ' && chmod 700 ' + distant);
  for (const f of [fIdents, fFlux]) {
    execFileSync('scp', ['-q', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new',
      '-i', CLE_SSH, f, HOTE + ':' + distant + '/'], { timeout: 180000 });
  }
  ok('deux fichiers déposés, dans un dossier en 700');

  titre('=== 5. IMPORT DANS LE n8n DU VPS ===');
  ssh('docker cp ' + distant + '/identifiants.json ' + CONTENEUR_VPS + ':/tmp/identifiants.json');
  ssh('docker cp ' + distant + '/flux.json ' + CONTENEUR_VPS + ':/tmp/flux.json');
  const rImp = ssh(
    'docker exec ' + CONTENEUR_VPS + ' n8n import:credentials --input=/tmp/identifiants.json 2>&1 | tail -3; ' +
    'docker exec ' + CONTENEUR_VPS + ' n8n import:workflow --input=/tmp/flux.json 2>&1 | tail -3');
  rImp.split('\n').filter(Boolean).forEach((l) => crier('          ' + l));

  titre('=== 6. CONTRÔLE APRÈS IMPORT, ET NETTOYAGE ===');
  const vus = ssh('docker exec ' + CONTENEUR_VPS + ' n8n export:credentials --all 2>/dev/null | tail -c 400000');
  let nb = 0;
  try { nb = extraireJson(vus).length; } catch { nb = -1; }
  if (nb === idents.length) {
    ok(nb + ' identifiants présents sur le VPS, comme en local');
  } else {
    stop(nb + ' identifiants sur le VPS contre ' + idents.length + ' en local');
    anomalies += 1;
  }

  // Les fichiers portent des secrets chiffrés : ils ne restent nulle part.
  ssh('rm -rf ' + distant + '; docker exec ' + CONTENEUR_VPS +
      ' rm -f /tmp/identifiants.json /tmp/flux.json');
  ok('fichiers de transfert supprimés du VPS et du conteneur');

  titre(anomalies ? '=== TERMINÉ AVEC ' + anomalies + ' ANOMALIE(S) ===' : '=== TRANSFERT TERMINÉ ===');
  crier('  Reste à faire à la main, une seule fois :');
  crier('    - Gmail est en OAuth2 : déclarer la nouvelle adresse');
  crier('      de retour https://n8n.<domaine>/rest/oauth2-credential/callback');
  crier('      dans Google Cloud Console');
  crier('    - activer les flux depuis le n8n du VPS');
  sortir(anomalies ? 1 : 0);
} finally {
  try { rmSync(TRAVAIL, { recursive: true, force: true }); } catch { /* rien */ }
}
