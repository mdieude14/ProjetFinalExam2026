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
 * LE SEUL WORKFLOW QUI DÉPENDE DE L'ADRESSE PUBLIQUE. `ccAgentTelegr01` porte
 * le déclencheur `telegramTrigger` : c'est lui, et lui seul, qui déclare une
 * adresse à Telegram. `ccSupportAgent01` porte bien un nœud `webhook`, mais le
 * navigateur l'appelle par `localhost:5678` — le toucher couperait le widget
 * sans rien gagner. Les quatre autres sont des déclencheurs horaires, qui
 * n'attendent aucun appel entrant. Vérifié le 19 octobre en relisant les types
 * de nœuds des six workflows, plutôt qu'en se fiant à leurs noms.
 */
const WORKFLOW_TELEGRAM = 'ccAgentTelegr01';

/*
 * `n8n update:workflow` ÉCRIT DANS LA BASE, IL NE DÉCLARE RIEN. C'est le
 * démarrage de n8n qui parcourt les workflows actifs et appelle `setWebhook`.
 * D'où l'ordre tenu partout plus bas, et il n'est pas interchangeable : on pose
 * l'état voulu, PUIS on recrée le conteneur. L'inverse laisse la base et
 * Telegram en désaccord, sans aucun message d'erreur.
 */
const etatWorkflowTelegram = (actif) =>
  docker(
    'exec', 'coachconnect-n8n',
    'n8n', 'update:workflow', `--id=${WORKFLOW_TELEGRAM}`, `--active=${actif}`
  );

/* Retire la ligne `WEBHOOK_URL` du fichier d'environnement, s'il existe. */
const retirerAdresse = () => {
  if (!existsSync(ENV)) return [];
  return readFileSync(ENV, 'utf8')
    .split(/\r?\n/)
    .filter((l) => !l.startsWith('WEBHOOK_URL='));
};

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
  /*
   * FERMER, C'ÉTAIT RETIRER LE CONTENEUR — ET RIEN D'AUTRE. Le message affiché
   * ici affirmait que l'adresse morte était « sans conséquence tant qu'aucun
   * workflow à webhook n'est actif ». Or `ccAgentTelegr01` EST actif : la
   * condition n'était pas remplie, et l'affirmation rassurait à tort.
   *
   * CE QUE CELA LAISSAIT OUVERT. L'adresse d'un tunnel rapide est RENDUE à
   * Cloudflare quand le tunnel tombe — constaté le 19 octobre, le nom d'hôte ne
   * résolvait plus du tout (« Non-existent domain ») alors que n8n l'annonçait
   * encore. Si Cloudflare la réattribue un jour à quelqu'un d'autre, Telegram
   * pousse les conversations de support chez cet inconnu. La probabilité est
   * faible — quatre mots tirés au hasard — mais la conséquence est une fuite de
   * messages d'utilisateurs, et elle ne coûte rien à écarter.
   */
  try {
    etatWorkflowTelegram(false);
    console.log(`1/3  Workflow ${WORKFLOW_TELEGRAM} désactivé.`);
  } catch {
    console.log(`1/3  ${WORKFLOW_TELEGRAM} non désactivé — n8n ne répond pas.`);
  }

  try {
    docker('rm', '-f', 'coachconnect-tunnel');
    console.log('2/3  Tunnel fermé.');
  } catch {
    console.log('2/3  Aucun tunnel à fermer.');
  }

  /*
   * ON RETIRE AUSSI L'ADRESSE DU FICHIER. La composition la déclare en
   * `${WEBHOOK_URL:-http://localhost:5678/}` : sans la ligne, n8n retombe donc
   * sur `localhost`, qui n'est joignable de nulle part. Et à la relecture, un
   * fichier sans adresse dit la vérité — que le tunnel est fermé.
   */
  const restant = retirerAdresse();
  if (restant.length > 0) {
    writeFileSync(ENV, `${restant.join('\n').replace(/\n+$/, '')}\n`);
  }

  /*
   * `--force-recreate`, ET NON UN SIMPLE `restart`. L'environnement d'un
   * conteneur est figé à sa création : un redémarrage relirait l'ancienne
   * adresse. La recréation est sans risque, les données de n8n vivant dans le
   * volume nommé `coachconnect-n8n-data`.
   */
  try {
    docker(...COMPOSE, 'up', '-d', '--force-recreate', 'n8n');
    console.log('3/3  n8n recréé sans adresse publique.');
  } catch {
    console.log('3/3  n8n n’a pas pu être recréé — à relancer à la main.');
  }

  console.log(`
CE QUE CELA NE GARANTIT PAS, et il faut le savoir : Telegram conserve la
dernière adresse qu'on lui a déclarée jusqu'à ce qu'on lui en donne une
autre. La prochaine ouverture du tunnel l'écrase. Ce qui précède garantit
que n8n, lui, n'annonce plus rien de public et n'écoute plus ce canal.`);
  process.exit(0);
}

/* ------------------------- 1. Démarrer le tunnel ------------------------ */

console.log('1/3  Démarrage du tunnel…');
/*
 * TOUJOURS UN TUNNEL NEUF, JAMAIS CELUI QUI TRAÎNE. Un `up -d` ordinaire laisse
 * en place un conteneur déjà démarré dont la configuration n'a pas changé —
 * même si son tunnel est MORT. Le cas s'est produit le 19 octobre : cloudflared
 * tournait depuis trois heures, affichait « Up », et bouclait en réalité sur
 * `control stream encountered a failure` parce que Cloudflare avait révoqué son
 * nom d'hôte, qui ne résolvait plus. Le script aurait alors relu cette adresse
 * morte dans le journal et l'aurait redéclarée à Telegram.
 *
 * La recréation garantit deux choses : un nom d'hôte vivant, et un journal qui
 * n'en contient qu'un — ce qui rend la sélection ci-dessous robuste au lieu de
 * la rendre critique.
 */
docker(...COMPOSE, 'up', '-d', '--force-recreate', 'cloudflared');

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
  /*
   * ET LA DERNIÈRE, PAS LA PREMIÈRE. `find` renvoyait la plus ancienne adresse
   * du journal. Tant que le conteneur était créé de neuf il n'y en avait qu'une,
   * et le défaut restait invisible ; mais un conteneur REDÉMARRÉ conserve ses
   * anciens encadrés, et le script réinscrivait alors l'adresse de la veille —
   * morte. Constaté au redémarrage du 19 octobre : `aircraft-…` ne répondait
   * plus (000) quand `without-housing-…` servait n8n (200). Le dernier encadré
   * est celui du tunnel en cours : c'est lui qu'on veut, toujours.
   */
  adresse = [...journal.matchAll(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g)]
    .map((m) => m[0])
    .filter((url) => url !== 'https://api.trycloudflare.com')
    .at(-1) ?? null;
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

console.log('2/3  Inscription de l’adresse et activation du workflow…');

const sansWebhook = retirerAdresse();

/*
 * LA BARRE FINALE EST OBLIGATOIRE. n8n concatène cette valeur avec le chemin
 * du webhook : sans elle, l'adresse déclarée à Telegram est malformée, et le
 * bot reste muet sans que rien ne signale l'erreur.
 */
sansWebhook.push(`WEBHOOK_URL=${adresse}/`);
writeFileSync(ENV, `${sansWebhook.join('\n').replace(/\n+$/, '')}\n`);

/*
 * ON MARQUE LE WORKFLOW ACTIF MAINTENANT, AVANT LA RECRÉATION. C'est le
 * troisième geste que l'en-tête de ce fichier annonce depuis le début et que
 * le script ne faisait pas : il se contentait de demander une bascule
 * « Inactive → Active » à la main, dans l'interface. La bascule était bien
 * nécessaire — mais pour une raison qui rendait le geste manuel inutile : n8n
 * ne déclare l'adresse à Telegram qu'au moment où il ACTIVE le workflow, et il
 * active au démarrage. Il suffit donc que l'état soit posé en base avant que le
 * conteneur ne reparte.
 */
try {
  etatWorkflowTelegram(true);
} catch {
  console.log(`     ATTENTION : ${WORKFLOW_TELEGRAM} n’a pas pu être activé.`);
}

/*
 * `--force-recreate` : l'environnement est figé à la création du conteneur, et
 * surtout la recréation est ce qui REJOUE le cycle d'activation. Sans elle,
 * Docker ne voit parfois aucun changement — l'adresse peut être identique à
 * celle du fichier — et rien n'est redéclaré à Telegram.
 */
console.log('3/3  Recréation de n8n, qui déclare l’adresse à Telegram…');
docker(...COMPOSE, 'up', '-d', '--force-recreate', 'n8n');

/* n8n met quelques secondes à répondre après une recréation. */
let leve = false;
for (let i = 0; i < 40 && !leve; i += 1) {
  await attendre(1000);
  try {
    const r = await fetch('http://localhost:5678/healthz');
    leve = r.ok;
  } catch { /* pas encore levé */ }
}
if (!leve) console.log('     ATTENTION : n8n ne répond pas encore sur /healthz.');

console.log(`
──────────────────────────────────────────────────────────────────────
  Adresse publique de n8n :

      ${adresse}

  PLUS AUCUN GESTE À FAIRE : le workflow ${WORKFLOW_TELEGRAM} a été
  activé avant la recréation, et n8n a donc déclaré cette adresse à
  Telegram en démarrant. Écris au bot pour le vérifier.

    Si le bot reste muet, c'est la déclaration qui a échoué :
      docker logs coachconnect-n8n 2>&1 | grep -i telegram

  APRÈS LA DÉMONSTRATION :

      node docker/n8n/ouvrir-tunnel.mjs --fermer

    L'adresse mène à ton n8n, éditeur compris. On ne la laisse pas
    ouverte, et on ne la publie nulle part.
──────────────────────────────────────────────────────────────────────`);
