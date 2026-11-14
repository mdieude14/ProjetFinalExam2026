#!/usr/bin/env node
/**
 * ===========================================================================
 *  PROPAGER LE JETON GMAIL VERS LA PRODUCTION
 * ===========================================================================
 *
 *   npm run propager:gmail                    ESSAI : vérifie, n'écrit rien
 *   npm run propager:gmail -- --appliquer     écrit sur le VPS et redémarre
 *
 * POURQUOI CE SCRIPT EXISTE.
 *
 * `autoriser-gmail.mjs` réémet le jeton et l'écrit dans `server/.env`, puis
 * s'arrête. C'était suffisant quand le projet ne tournait qu'en local. Depuis
 * qu'une API tourne sur le VPS avec son propre `api.env`, réémettre le jeton
 * ne répare QUE le poste : la production continue de rendre
 * « invalid_grant » sans que rien ne le signale, et on croit avoir corrigé.
 *
 * CE QUI EST VÉRIFIÉ AVANT D'ÉCRIRE, ET DANS CET ORDRE :
 *
 *   1. le jeton local existe et a une longueur plausible ;
 *   2. GOOGLE L'ACCEPTE — un appel réel au point d'échange. On ne pousse
 *      jamais un jeton mort : ce serait remplacer une panne par la même ;
 *   3. le VPS répond en SSH ;
 *   4. l'empreinte du jeton distant DIFFÈRE de la locale, sinon il n'y a
 *      rien à faire.
 *
 * LE JETON N'EST JAMAIS AFFICHÉ, ni dans une commande visible dans
 * l'historique du shell distant : il est transmis par l'ENTRÉE STANDARD de
 * ssh, et comparé par empreinte SHA-256.
 *
 * ────────────────────────────────────────────────
 *  POURQUOI AUCUN `process.exit()` APRÈS L'APPEL À GOOGLE
 * ────────────────────────────────────────────────
 *
 * Sur Windows, `process.exit()` appelé alors qu'une connexion `fetch` est
 * encore maintenue ouverte fait planter libuv :
 *
 *   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c
 *
 * Et le code de sortie devient 127 au lieu de 1, ce qui rend le script
 * inutilisable dans un enchaînement. D'où un unique point de sortie : le
 * corps rend un code, et seule la dernière ligne pose `process.exitCode`.
 *
 * ET LA CAUSE DE FOND N'EST PAS ICI. Ce script répare ; il n'empêche pas la
 * panne de revenir. L'écran de consentement Google en mode « Test » fait
 * expirer tout jeton de rafraîchissement au bout de SEPT JOURS. Le publier
 * « In production » est le seul correctif durable.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const HOTE = 'root@2.24.62.117';
const CLE_SSH = join(process.env.HOME || process.env.USERPROFILE, '.ssh', 'coachconnect_vps');
const DIST = '/opt/coachconnect/docker/n8n/hostinger';
const CLE = 'GOOGLE_OAUTH_REFRESH_TOKEN';

const APPLIQUER = process.argv.includes('--appliquer');

const dire = (s) => process.stdout.write((s === undefined ? '' : s) + '\n');
const ok = (s) => dire('  \u001b[32mOK\u001b[0m    ' + s);
const note = (s) => dire('  \u001b[33mNOTE\u001b[0m  ' + s);
const stop = (s) => dire('  \u001b[31mSTOP\u001b[0m  ' + s);
const titre = (s) => dire('\n\u001b[1;34m' + s + '\u001b[0m');

const emp = (v) => createHash('sha256').update(String(v).trim()).digest('hex').slice(0, 16);

const ssh = (cmd, entree) => execFileSync('ssh', [
  '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'ConnectTimeout=15', '-i', CLE_SSH, HOTE, cmd,
], { encoding: 'utf8', timeout: 120000, input: entree });

const lireEnv = (chemin, cle) => {
  const m = readFileSync(chemin, 'utf8').match(new RegExp('^' + cle + '=(.*)$', 'm'));
  return m ? m[1].trim() : null;
};

async function principal() {
  titre('=== 1. LE JETON LOCAL ===');
  let local;
  try {
    local = lireEnv(join(process.cwd(), '.env'), CLE);
  } catch (e) {
    stop('server/.env illisible : ' + e.message);
    note('lancer ce script depuis le dossier « server »');
    return 1;
  }
  if (!local) {
    stop(CLE + ' absent de server/.env');
    note('le réémettre d abord : npm run autoriser:gmail');
    return 1;
  }
  if (local.length < 60 || !local.startsWith('1//')) {
    stop('jeton de forme inattendue : ' + local.length + ' caractères');
    note('un jeton de rafraîchissement Google commence par « 1// » et fait ~103 signes');
    return 1;
  }
  ok(local.length + ' caractères, empreinte ' + emp(local));

  titre('=== 2. GOOGLE L ACCEPTE-T-IL ? (on ne pousse jamais un jeton mort) ===');
  const cid = lireEnv(join(process.cwd(), '.env'), 'GOOGLE_OAUTH_CLIENT_ID');
  const cse = lireEnv(join(process.cwd(), '.env'), 'GOOGLE_OAUTH_CLIENT_SECRET');
  if (!cid || !cse) {
    stop('identifiant ou secret client absents de server/.env');
    return 1;
  }
  let reponse;
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: cid, client_secret: cse, refresh_token: local, grant_type: 'refresh_token',
      }),
    });
    reponse = await r.json();
  } catch (e) {
    stop('appel à Google impossible : ' + e.message);
    return 1;
  }
  if (!reponse.access_token) {
    stop('Google REFUSE ce jeton : ' + (reponse.error || '?') + ' — ' + (reponse.error_description || ''));
    if (reponse.error === 'invalid_grant') {
      note('cause la plus fréquente : écran de consentement en mode « Test » = SEPT JOURS');
      note('réémettre : npm run autoriser:gmail');
      note('puis, pour que cela cesse : publier l application « In production »');
    }
    return 1;
  }
  ok('Google rend un jeton d accès, portée ' + (reponse.scope || '?'));
  ok('validité du jeton d accès : ' + (reponse.expires_in || '?') + ' s');

  titre('=== 3. LE VPS, ET CE QU IL PORTE AUJOURD HUI ===');
  let distant;
  try {
    distant = ssh('grep "^' + CLE + '=" ' + DIST + '/api.env | cut -d= -f2-').trim();
  } catch (e) {
    stop('SSH injoignable : ' + String(e.message).split('\n')[0]);
    return 1;
  }
  if (!distant) {
    note(CLE + ' absent de api.env : il sera ajouté');
  } else {
    ok('distant : ' + distant.length + ' caractères, empreinte ' + emp(distant));
    if (emp(distant) === emp(local)) {
      titre('=== RIEN A FAIRE ===');
      dire('  Les deux jetons sont IDENTIQUES et Google les accepte.');
      dire('  Si la production échoue encore, la cause est ailleurs.');
      return 0;
    }
    note('les deux empreintes DIFFÈRENT : la production est en retard');
  }

  if (!APPLIQUER) {
    titre('=== MODE ESSAI : rien n a été écrit ===');
    dire('  relancer avec --appliquer pour mettre la production à jour.');
    return 0;
  }

  titre('=== 4. ECRITURE SUR LE VPS ===');
  // Le jeton passe par l ENTREE STANDARD : il n apparait dans aucune commande,
  // donc dans aucun historique de shell distant.
  const script = [
    'set -eu',
    'cd ' + DIST,
    'JETON=$(cat)',
    'cp api.env api.env.avant',
    'if grep -q "^' + CLE + '=" api.env; then',
    '  grep -v "^' + CLE + '=" api.env > api.env.tmp',
    '  printf "%s=%s\\n" "' + CLE + '" "$JETON" >> api.env.tmp',
    '  mv api.env.tmp api.env',
    'else',
    '  printf "%s=%s\\n" "' + CLE + '" "$JETON" >> api.env',
    'fi',
    'chmod 600 api.env',
    'DIFF=$(diff <(grep -v "^' + CLE + '=" api.env.avant) <(grep -v "^' + CLE + '=" api.env) | wc -l)',
    'echo "    autres lignes modifiees : $DIFF (0 attendu)"',
    'echo "    nouvelle empreinte : $(grep "^' + CLE + '=" api.env | cut -d= -f2- | tr -d "\\n" | sha256sum | cut -c1-16)"',
    'rm -f api.env.avant',
  ].join('\n');

  try {
    dire(ssh('bash -s', script + '\n' + local + '\n').trimEnd());
  } catch (e) {
    stop('écriture impossible : ' + String(e.message).split('\n')[0]);
    return 1;
  }
  ok('ligne remplacée, fichier en 600');

  titre('=== 5. REDEMARRAGE DE L API, ET CONTROLE ===');
  let journal = '';
  try {
    ssh('cd ' + DIST + ' && CADDYFILE=Caddyfile.nom-unique docker compose up -d --force-recreate api >/dev/null 2>&1; sleep 25; '
      + 'echo "    etat  : $(docker inspect coachconnect-api --format \'{{.State.Status}}\')"; '
      + 'echo "    sante : $(docker inspect coachconnect-api --format \'{{.State.Health.Status}}\')"')
      .split('\n').filter(Boolean).forEach(dire);
    journal = ssh('cd ' + DIST + ' && docker compose logs api --tail=60 2>&1 | grep -i "COURRIEL" | tail -4');
  } catch (e) {
    stop('redémarrage ou contrôle impossible : ' + String(e.message).split('\n')[0]);
    return 1;
  }
  dire('');
  dire('  --- ce que l API dit de son envoi ---');
  journal.split('\n').filter(Boolean).forEach((l) => dire('    ' + l.slice(0, 150)));

  let code = 0;
  if (/Envoi pret/i.test(journal)) {
    ok('L ENVOI EST REPARE EN PRODUCTION');
  } else if (/HORS SERVICE|invalid_grant/i.test(journal)) {
    stop('l API annonce encore un envoi hors service');
    code = 1;
  } else {
    note('aucune ligne COURRIEL dans les 60 dernières : relancer le contrôle dans un instant');
  }

  titre('=== IL RESTE UN GESTE QUE CE SCRIPT NE PEUT PAS FAIRE ===');
  dire('  L identifiant Gmail de n8n a son PROPRE jeton, également expiré.');
  dire('  Il se réautorise depuis l éditeur n8n, dans le navigateur :');
  dire('    https://srv2141095.hstgr.cloud  ->  Credentials');
  dire('    ->  « Gmail (assistant de messagerie) »  ->  Reconnect');
  dire('');
  dire('  Prérequis chez Google, sans quoi « redirect_uri_mismatch » :');
  dire('    https://srv2141095.hstgr.cloud/rest/oauth2-credential/callback');
  return code;
}

// Unique point de sortie : on POSE le code, on ne tue pas le processus. Node
// termine de lui-même quand les connexions de `fetch` se sont refermees.
process.exitCode = await principal();
