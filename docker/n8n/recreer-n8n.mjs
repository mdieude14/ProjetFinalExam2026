/**
 * ===========================================================================
 *  RECRÉER LE CONTENEUR n8n — la seule façon de le faire sans rien casser
 * ===========================================================================
 *
 *   node docker/n8n/recreer-n8n.mjs
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE SCRIPT EXISTE : LA COMMANDE À LA MAIN EST UN PIÈGE
 * ---------------------------------------------------------------------------
 *
 * Recréer n8n est obligatoire après tout changement d'état en base — un
 * workflow activé ne vaut rien tant que n8n ne l'a pas relu au démarrage. La
 * commande évidente est pourtant fausse :
 *
 *     docker compose -f docker/n8n/docker-compose.yml up -d --force-recreate n8n
 *
 * ELLE SUPPRIME LE CHARGEMENT AUTOMATIQUE DE `docker-compose.override.yml`.
 * Dès qu'on passe `-f`, Docker n'ajoute plus l'override tout seul : il faut
 * l'énumérer. Or c'est lui qui monte le certificat d'Avast et pose
 * `NODE_EXTRA_CA_CERTS`. Sans lui, le conteneur démarre, répond `healthz 200`,
 * sert son éditeur — et CHAQUE APPEL SORTANT ÉCHOUE :
 *
 *     unable to verify the first certificate
 *
 * Mesuré le 4 novembre 2026 : une réponse d'escalade a traversé tout le
 * workflow, l'API a répondu 200, et la rédaction a échoué sur ce seul point.
 * Le dossier est resté sans brouillon, et rien dans l'état du conteneur ne le
 * laissait voir.
 *
 * ET LA COMMANDE « ÉVIDENTE SUIVANTE » EST FAUSSE AUSSI. Ni
 * `cd docker/n8n && docker compose up -d`, ni les deux fichiers base +
 * override ne fonctionnent : l'override déclare aussi `cloudflared`, qui n'a
 * son image que dans `docker-compose.tunnel.yml`. Sans ce troisième fichier,
 * Docker refuse le projet entier :
 *
 *     service "cloudflared" has neither an image nor a build context specified
 *
 * Mesuré, les deux. La seule liste valable est donc : base, override (s'il
 * existe), tunnel.
 *
 *   LA LEÇON : un piège qui mord deux fois malgré sa consigne écrite doit
 *   devenir une MESURE. Ce script est cette mesure — et il va plus loin que
 *   la commande : il VÉRIFIE la sortie TLS après coup, parce que c'est
 *   précisément ce que la panne ne montre pas.
 *
 * Nommer `n8n` en fin de commande garantit que le tunnel n'est pas démarré au
 * passage, bien que son fichier soit chargé.
 * ===========================================================================
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ICI = fileURLToPath(new URL('.', import.meta.url));
const CONTENEUR = 'coachconnect-n8n';

const SURCHARGE = `${ICI}docker-compose.override.yml`;
const fichiers = [
  '-f', `${ICI}docker-compose.yml`,
  ...(existsSync(SURCHARGE) ? ['-f', SURCHARGE] : []),
  '-f', `${ICI}docker-compose.tunnel.yml`,
];

console.log('\n=== RECRÉATION DE n8n ===\n');
console.log(
  existsSync(SURCHARGE)
    ? '  surcharge locale : présente (certificat d’Avast)'
    : '  surcharge locale : absente — machine sans antivirus intercepteur'
);

const recreation = spawnSync(
  'docker',
  ['compose', ...fichiers, 'up', '-d', '--force-recreate', CONTENEUR.replace('coachconnect-', '')],
  { stdio: 'inherit' }
);

if (recreation.status !== 0) {
  console.error('\nLa recréation a échoué. Rien d’autre n’a été tenté.\n');
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 *  Attendre que n8n réponde
 * ------------------------------------------------------------------ */
const attendre = async () => {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch('http://localhost:5678/healthz', { signal: AbortSignal.timeout(3000) });
      if (r.ok) return i + 1;
    } catch {
      /* pas encore debout */
    }
    await new Promise((resoudre) => setTimeout(resoudre, 2000));
  }
  return null;
};

const tours = await attendre();
if (!tours) {
  console.error('\nn8n n’a pas répondu en deux minutes.\n');
  process.exit(1);
}
console.log(`\n  healthz        : 200 (après ${tours} tentative(s))`);

/* ------------------------------------------------------------------ *
 *  LA VÉRIFICATION QUI COMPTE : LA SORTIE TLS
 * ------------------------------------------------------------------ */

/*
 * ON SONDE AVEC NODE, PAS AVEC `wget`. Le `wget` de busybox ne lit pas
 * `NODE_EXTRA_CA_CERTS` : il échoue même quand le certificat est bien monté,
 * et conclurait donc à une panne inexistante. C'est Node qui exécute les
 * nœuds de n8n, c'est donc Node qui doit répondre.
 *
 * Un 401 est le bon résultat : il prouve que la poignée de main TLS a abouti
 * et que seule la clé manque — ce qui est normal, on n'en envoie pas.
 */
const sonde = spawnSync(
  'docker',
  ['exec', CONTENEUR, 'node', '-e', `
fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  .then((r) => console.log('CODE ' + r.status))
  .catch((e) => console.log('ECHEC ' + (e.cause && e.cause.code ? e.cause.code : e.message)));
`],
  { encoding: 'utf8' }
);

const resultat = (sonde.stdout ?? '').trim();
const tlsBon = /^CODE /.test(resultat);

console.log(`  sortie TLS     : ${tlsBon ? 'vérifiée' : 'ROMPUE'}   (${resultat})`);

let certificat = null;
try {
  certificat = execFileSync('docker', ['exec', CONTENEUR, 'sh', '-c', 'echo "$NODE_EXTRA_CA_CERTS"'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  certificat = '';
}
console.log(`  certificat     : ${certificat || 'AUCUN'}`);

if (!tlsBon) {
  console.error('\n  ✗ LE CONTENEUR EST DEBOUT MAIS NE PEUT RIEN APPELER.');
  console.error('    Tout appel sortant de n8n échouera — Claude, l’API, Telegram —');
  console.error('    et rien dans son état ne le montrera : il répond healthz 200.');
  console.error('    Remède : node docker/n8n/certificat-avast.mjs');
  console.error('             puis relancer ce script.\n');
  process.exit(1);
}

console.log('\nn8n est debout, et il peut appeler l’extérieur.\n');
process.exit(0);
