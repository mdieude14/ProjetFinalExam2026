/**
 * ===========================================================================
 *  OUVRIR LE TUNNEL — n8n joignable depuis Telegram, le temps d'une démo
 * ===========================================================================
 *
 *   node docker/n8n/ouvrir-tunnel.mjs          ouvre le tunnel
 *   node docker/n8n/ouvrir-tunnel.mjs --fermer  le referme
 *
 * CE QUE FAIT CE SCRIPT, ET POURQUOI IL EN FAUT UN.
 *
 * Un tunnel rapide de Cloudflare tire une adresse au hasard à chaque
 * démarrage. Or n8n a besoin de la connaître AVANT d'activer un workflow :
 * c'est cette adresse qu'il déclare à Telegram comme destination des
 * messages. Trois gestes s'enchaînent donc, et se tromper d'ordre donne un
 * bot silencieux sans aucun message d'erreur :
 *
 *   1  démarrer le tunnel, et lire l'adresse qu'il annonce dans son journal
 *   2  l'inscrire dans `docker/n8n/.env`, puis recréer n8n pour qu'il la lise
 *   3  réactiver les workflows à webhook, pour qu'ils la déclarent à Telegram
 *
 * L'adresse change à chaque ouverture : c'est le prix du tunnel gratuit, sans
 * compte ni domaine. Une adresse stable demanderait un compte Cloudflare et
 * un nom de domaine — le jour où le projet sera hébergé, la question ne se
 * posera plus.
 * ===========================================================================
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ICI = fileURLToPath(new URL('.', import.meta.url));
const ENV = fileURLToPath(new URL('./.env', import.meta.url));

const COMPOSE = [
  'compose',
  '-f', `${ICI}docker-compose.yml`,
  '-f', `${ICI}docker-compose.tunnel.yml`,
];

/* Une surcharge locale peut exister (certificat d'un antivirus qui intercepte
   le HTTPS). Elle doit rester dans la liste, sans quoi la recréation de n8n
   la perdrait — et les appels sortants échoueraient à nouveau. */
const SURCHARGE = `${ICI}docker-compose.override.yml`;
/*
 * INSÉRÉE ENTRE LE FICHIER DE BASE ET CELUI DU TUNNEL, à l'indice 3 : chaque
 * fichier veut son propre `-f`. Une première version insérait à l’indice 4 et
 * produisait « -f -f surcharge tunnel », que Docker refuse en disant seulement
 * « unknown docker command » — un message qui ne désigne pas la cause.
 */
if (existsSync(SURCHARGE)) COMPOSE.splice(3, 0, '-f', SURCHARGE);

const docker = (...args) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/*
 * LE JOURNAL DE cloudflared SORT SUR L'ERREUR STANDARD, pas sur la sortie
 * standard — et `docker logs` conserve cette séparation. Ne lire que la
 * sortie standard renvoie une chaîne vide : le script cherchait l'adresse
 * dans le néant, et renonçait alors que le tunnel était établi. On réunit
 * donc les deux flux.
 */
const journalDu = (conteneur) => {
  const r = spawnSync('docker', ['logs', conteneur], { encoding: 'utf8' });
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
};

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ Fermeture ------------------------------ */

if (process.argv.includes('--fermer')) {
  try {
    docker('rm', '-f', 'coachconnect-tunnel');
    console.log('Tunnel fermé.');
  } catch {
    console.log('Aucun tunnel à fermer.');
  }
  console.log(
    "\nn8n reste configuré sur la dernière adresse connue. Elle ne répond plus :\n" +
    "c'est sans conséquence tant qu'aucun workflow à webhook n'est actif."
  );
  process.exit(0);
}

/* ------------------------- 1. Démarrer le tunnel ------------------------ */

console.log('1/3  Démarrage du tunnel…');
docker(...COMPOSE, 'up', '-d', 'cloudflared');

/*
 * L'ADRESSE EST ANNONCÉE DANS LE JOURNAL, pas ailleurs. cloudflared l'écrit
 * une seule fois, dans un encadré, quelques secondes après le démarrage. On
 * la guette plutôt que d'attendre une durée fixe : selon la latence, cela
 * prend deux secondes ou quinze.
 */
/*
 * DEUX MINUTES D'ATTENTE, ET PAS QUARANTE SECONDES. cloudflared négocie sa
 * connexion en QUIC ; quand le premier essai expire — « no recent network
 * activity » —, il en refait un, et l'adresse n'apparaît qu'ensuite. Constaté
 * à la première ouverture réelle : le tunnel s'établissait, mais après que le
 * script avait renoncé.
 */
let adresse = null;
for (let i = 0; i < 120 && !adresse; i += 1) {
  await attendre(1000);
  const journal = journalDu('coachconnect-tunnel');
  /*
   * PAS LA PREMIÈRE ADRESSE VENUE. cloudflared obtient son tunnel en appelant
   * `https://api.trycloudflare.com` — adresse qui peut figurer dans le journal,
   * notamment après un premier essai raté. La prendre pour l'adresse publique
   * enverrait Telegram vers l'API de Cloudflare, et le bot resterait muet.
   */
  adresse = [...journal.matchAll(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g)]
    .map((m) => m[0])
    .find((url) => url !== 'https://api.trycloudflare.com') ?? null;
}

if (!adresse) {
  console.error(
    "\nÉCHEC : aucune adresse trouvée dans le journal du tunnel après 2 min.\n" +
    '   docker logs coachconnect-tunnel      pour voir ce qu il raconte'
  );
  process.exit(1);
}

console.log(`     adresse publique : ${adresse}`);

/* --------------------- 2. L'inscrire et recréer n8n --------------------- */

console.log('2/3  Inscription de l’adresse et recréation de n8n…');

const lignes = existsSync(ENV) ? readFileSync(ENV, 'utf8').split(/\r?\n/) : [];
const sansWebhook = lignes.filter((l) => !/^WEBHOOK_URL=/.test(l));

/*
 * LA BARRE FINALE EST OBLIGATOIRE. n8n concatène cette valeur avec le chemin
 * du webhook : sans elle, l'adresse déclarée à Telegram est malformée, et le
 * bot reste muet sans que rien ne signale l'erreur.
 */
sansWebhook.push(`WEBHOOK_URL=${adresse}/`);
writeFileSync(ENV, `${sansWebhook.filter((l, i, t) => l !== '' || i < t.length - 1).join('\n')}\n`);

docker(...COMPOSE, 'up', '-d', 'n8n');

/* n8n met quelques secondes à répondre après une recréation. */
for (let i = 0; i < 30; i += 1) {
  await attendre(1000);
  try {
    const r = await fetch('http://localhost:5678/healthz');
    if (r.ok) break;
  } catch { /* pas encore levé */ }
}

console.log('3/3  Prêt.');

console.log(`
──────────────────────────────────────────────────────────────────────
  Adresse publique de n8n :

      ${adresse}

  IL RESTE UN GESTE, ET IL EST INDISPENSABLE :

    Ouvre http://localhost:5678 → Workflows → le bot conversationnel,
    bascule-le sur Inactive, puis à nouveau sur Active.

    C'est cette bascule qui déclare la nouvelle adresse à Telegram.
    Sans elle, le bot reste muet : Telegram continue d'envoyer les
    messages à l'adresse d'hier, qui ne répond plus.

  APRÈS LA DÉMONSTRATION :

      node docker/n8n/ouvrir-tunnel.mjs --fermer

    L'adresse mène à ton n8n, éditeur compris. On ne la laisse pas
    ouverte, et on ne la publie nulle part.
──────────────────────────────────────────────────────────────────────`);
