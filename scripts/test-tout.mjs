/**
 * ===========================================================================
 *  LANCEUR DE TOUTES LES SUITES
 * ===========================================================================
 *
 *   npm test
 *
 * POURQUOI CE SCRIPT EXISTE.
 *
 * Le projet compte trente-cinq suites réparties sur deux paquets, avec des
 * prérequis différents. Un correcteur qui ouvre le dépôt et tape `npm test`
 * doit obtenir une réponse — pas une erreur « missing script », et pas une
 * liste de trente-cinq commandes à recopier.
 *
 * TROIS CHOSES QUE CE LANCEUR FAIT, ET QU'UN SIMPLE ENCHAÎNEMENT NE FERAIT PAS :
 *
 *   1. IL VÉRIFIE LES PRÉREQUIS AVANT DE LANCER QUOI QUE CE SOIT.
 *      Sans relais Stripe, `test:paiement` échoue à mi-parcours sur treize
 *      vérifications d'affilée, toutes en aval de la vraie cause. Sans compte
 *      admin, deux autres échouent. Le diagnostic doit précéder l'échec :
 *      une ligne qui dit quoi lancer vaut mieux que trente lignes rouges qui
 *      accusent le code.
 *
 *   2. IL LANCE LES SUITES UNE PAR UNE.
 *      Enchaînées dans une même commande, plusieurs suites navigateur saturent
 *      la machine et l'une d'elles expire au premier chargement de page. Le
 *      symptôme accuse l'application ; la cause est le banc d'essai qui se met
 *      lui-même en difficulté. Constaté deux fois pendant le développement.
 *
 *   3. IL SE VÉRIFIE LUI-MÊME AVANT DE VÉRIFIER LE CODE.
 *      Une suite déclarée mais absente de la liste ci-dessous ne tourne
 *      jamais ; une suite qui ne compile pas n'exécute aucune vérification et
 *      n'imprime aucun « ECHEC ». Les deux RASSURENT à tort. Les deux
 *      contrôles sont en tête des prérequis, et ils bloquent.
 * ===========================================================================
 */

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { freemem, totalmem } from 'node:os';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVEUR = join(RACINE, 'server');
const CLIENT = join(RACINE, 'client');

const API = 'http://localhost:5000/api';
const CLIENT_URL = 'http://localhost:5173';

/* ================================================================== *
 *  SUITES
 * ================================================================== */

/**
 * L'ORDRE N'EST PAS ARBITRAIRE : les suites d'API d'abord, plus rapides et
 * sans navigateur. Une régression de fond se signale ainsi en quelques
 * secondes, sans attendre huit minutes de Playwright.
 */
const SUITES = [
  { paquet: 'server', script: 'test:api', libelle: 'API — régression générale' },
  { paquet: 'server', script: 'test:stripe', libelle: 'API — Stripe Connect' },
  { paquet: 'server', script: 'test:relations', libelle: 'API — abonnés et abonnements' },
  { paquet: 'server', script: 'test:evenements', libelle: 'API — événements' },
  { paquet: 'server', script: 'test:geocodage', libelle: 'API — géocodage des événements' },
  { paquet: 'server', script: 'test:recherche', libelle: 'API — recherche' },
  { paquet: 'server', script: 'test:messagerie', libelle: 'API — messagerie' },
  { paquet: 'server', script: 'test:notifications', libelle: 'API — notifications' },
  { paquet: 'server', script: 'test:moderation', libelle: 'API — modération (blocage, restriction, signalement)' },
  { paquet: 'server', script: 'test:support', libelle: 'API — support automatisé' },
  { paquet: 'server', script: 'test:mot-de-passe', libelle: 'API — mot de passe oublié' },
  { paquet: 'server', script: 'test:releve', libelle: 'Workflow — relève des escalades' },
  { paquet: 'server', script: 'test:canaux', libelle: 'Workflows — Telegram et courriel' },
  { paquet: 'server', script: 'test:telegram', libelle: 'API — rattachement Telegram' },
  { paquet: 'server', script: 'test:reponse', libelle: 'API — réponse à une demande' },
  { paquet: 'server', script: 'test:courriel', libelle: 'API — support par courriel' },
  { paquet: 'server', script: 'test:escalade', libelle: 'API — escalade forcée du support' },
  { paquet: 'server', script: 'test:messagerie-agent', libelle: 'Workflows — assistant de messagerie' },
  { paquet: 'server', script: 'test:perf', libelle: 'API — performance' },

  { paquet: 'client', script: 'test:ui', libelle: 'Navigateur — parcours général' },
  { paquet: 'client', script: 'test:story-camera', libelle: 'Navigateur — story par la caméra' },
  { paquet: 'client', script: 'test:publication-toggle', libelle: 'Navigateur — bascule du compositeur' },
  { paquet: 'client', script: 'test:carrousel', libelle: 'Navigateur — carrousel des publications' },
  { paquet: 'client', script: 'test:relations', libelle: 'Navigateur — abonnés et abonnements' },
  { paquet: 'client', script: 'test:premium', libelle: 'Navigateur — écrans premium' },
  { paquet: 'client', script: 'test:paiement', libelle: 'Navigateur — paiement réel' },
  { paquet: 'client', script: 'test:carte', libelle: 'Navigateur — carte' },
  { paquet: 'client', script: 'test:evenements', libelle: 'Navigateur — événements' },
  { paquet: 'client', script: 'test:recherche', libelle: 'Navigateur — recherche' },
  { paquet: 'client', script: 'test:messagerie', libelle: 'Navigateur — messagerie' },
  { paquet: 'client', script: 'test:parcours-10-11', libelle: 'Navigateur — parcours 10 et 11' },
  { paquet: 'client', script: 'test:notifications', libelle: 'Navigateur — notifications' },
  { paquet: 'client', script: 'test:moderation', libelle: 'Navigateur — modération (menu « ⋯ »)' },
  { paquet: 'client', script: 'test:support', libelle: 'Navigateur — back-office du support' },
  { paquet: 'client', script: 'test:telegram', libelle: 'Navigateur — rattachement Telegram' },

  /*
   * CONTROLE STATIQUE, SANS NAVIGATEUR. Il lit le paquet de production, donc
   * il ne depend d aucun serveur et ne cree aucun compte. Place ici, avant la
   * performance, parce qu il reconstruit le paquet s il est perime : la suite
   * de performance mesure ce meme paquet, et autant qu elle mesure le bon.
   */
  { paquet: 'client', script: 'test:cadratins', libelle: 'Texte livré — aucun cadratin séparateur' },

  /*
   * LA PERFORMANCE EN DERNIER, et pour une raison precise : elle mesure le
   * BUILD de production, servi par `vite preview`. La placer avant obligerait
   * les suites suivantes a partager la machine avec un second serveur, et
   * fausserait leurs propres delais.
   */
  { paquet: 'client', script: 'test:perf', libelle: 'Navigateur — performance' },
];

/* ================================================================== *
 *  VÉRIFICATION DES PRÉREQUIS
 * ================================================================== */

const requireServeur = createRequire(join(SERVEUR, 'package.json'));

function lireEnv(cle) {
  const chemin = join(SERVEUR, '.env');
  if (!existsSync(chemin)) return null;

  const ligne = readFileSync(chemin, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${cle}=`));

  return ligne ? ligne.slice(cle.length + 1).trim().replace(/^["']|["']$/g, '') : null;
}

async function joignable(url) {
  try {
    const reponse = await fetch(url, { signal: AbortSignal.timeout(6000) });
    return reponse.ok;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 *  DEUX CONTRÔLES SUR LE BANC D'ESSAI LUI-MÊME
 * ------------------------------------------------------------------ */

/**
 * TOUTE SUITE DÉCLARÉE DOIT ÊTRE ENREGISTRÉE ICI.
 *
 * POURQUOI CE CONTRÔLE EXISTE : `test:courriel` est restée absente de la liste
 * ci-dessus du 25 au 26 octobre. La suite passait — 56 vérifications au vert —
 * mais `npm test` ne la lançait jamais. Une couverture qui existe et ne
 * s'exécute pas est pire qu'une couverture absente : elle rassure.
 *
 * Rien dans le langage n'impose cette correspondance, et la mémoire ne suffit
 * pas : la liste vit dans ce fichier, les suites dans deux `package.json`. On
 * compare donc les deux à chaque campagne, et l'absence BLOQUE au lieu de
 * passer inaperçue.
 */
function verifierRegistre() {
  const enregistrees = new Set(SUITES.map((s) => `${s.paquet}:${s.script}`));
  const oubliees = [];

  for (const [paquet, dossier] of [['server', SERVEUR], ['client', CLIENT]]) {
    const scripts = JSON.parse(readFileSync(join(dossier, 'package.json'), 'utf8')).scripts ?? {};
    for (const nom of Object.keys(scripts)) {
      if (!nom.startsWith('test:')) continue;
      if (!enregistrees.has(`${paquet}:${nom}`)) oubliees.push(`${paquet} / ${nom}`);
    }
  }

  return oubliees;
}

/**
 * CHAQUE FICHIER DE SUITE DOIT SE COMPILER, ET C'EST VÉRIFIÉ EN PREMIER.
 *
 * POURQUOI CE CONTRÔLE EXISTE : trois fois les 25 et 26 octobre, une
 * déclaration ajoutée au milieu d'une suite portait un nom DÉJÀ pris plus haut
 * dans le même fichier — `sansCle`, `dossier`, `second`. Les fichiers de ce
 * projet sont longs et à plat : tout nom court y est probablement déjà employé.
 *
 * Une collision de ce genre est une `SyntaxError`, donc une erreur de
 * COMPILATION : le fichier entier est refusé, AUCUNE vérification ne s'exécute,
 * et la sortie ne contient aucun « ECHEC » — seulement une pile d'erreur. Qui
 * compte les échecs lit zéro et croit la suite au vert.
 *
 * `node --check` tranche la question en une seconde, avant d'engager les
 * minutes d'une campagne. Il ne remplace pas la lecture du code de sortie plus
 * bas — il dit seulement, tout de suite, ce qui ne peut pas tourner du tout.
 */
function verifierSyntaxe() {
  const casses = [];

  for (const [paquet, dossier] of [['server', SERVEUR], ['client', CLIENT]]) {
    const scripts = JSON.parse(readFileSync(join(dossier, 'package.json'), 'utf8')).scripts ?? {};

    for (const [nom, commande] of Object.entries(scripts)) {
      if (!nom.startsWith('test:')) continue;

      // « node tests/support.mjs » — on ne retient que ce qui désigne un fichier.
      const fichier = (/^node\s+([^\s]+\.mjs)/.exec(commande) ?? [])[1];
      if (!fichier) continue;

      const chemin = join(dossier, fichier);
      if (!existsSync(chemin)) {
        casses.push({ suite: `${paquet} / ${nom}`, raison: `fichier absent : ${fichier}` });
        continue;
      }

      const controle = spawnSync(process.execPath, ['--check', chemin], { encoding: 'utf8' });
      if (controle.status !== 0) {
        const premiere = String(controle.stderr ?? '')
          .split('\n')
          .find((l) => /SyntaxError|Error:/.test(l)) ?? 'ne compile pas';
        casses.push({ suite: `${paquet} / ${nom}`, raison: premiere.trim() });
      }
    }
  }

  return casses;
}

/**
 * Chaque prérequis rend `{ ok, remede }` : le remède est une commande à
 * copier, pas une description. « Lancez le serveur » oblige à chercher
 * comment ; `cd server && npm run dev` se colle dans un terminal.
 */
async function verifierPrerequis() {
  const manques = [];

  /* ---- Le banc d'essai avant le code qu'il mesure ---- */
  for (const oubliee of verifierRegistre()) {
    manques.push({
      quoi: `Suite déclarée mais non enregistrée dans la campagne : ${oubliee}`,
      remede: 'Ajouter une entrée dans SUITES, dans scripts/test-tout.mjs',
    });
  }

  for (const cassee of verifierSyntaxe()) {
    manques.push({
      quoi: `La suite ${cassee.suite} ne compile pas : ${cassee.raison}`,
      remede: 'Corriger le fichier — aucune de ses vérifications ne peut s’exécuter',
    });
  }

  /* ---- Le fichier de configuration ---- */
  if (!existsSync(join(SERVEUR, '.env'))) {
    manques.push({
      quoi: 'server/.env absent',
      remede: 'cd server && cp .env.example .env   puis remplir les valeurs',
    });
    // Sans configuration, tout le reste échouera : inutile d'aller plus loin.
    return manques;
  }

  /* ---- L'API ---- */
  const apiVivante = await joignable(`${API}/health`);
  if (!apiVivante) {
    manques.push({
      quoi: 'API injoignable sur le port 5000',
      remede: 'cd server && npm run dev',
    });
  }

  /* ---- MongoDB, vu à travers l'API ---- */
  if (apiVivante) {
    try {
      const sante = await (await fetch(`${API}/health`)).json();
      if (sante.base !== 'connecte') {
        manques.push({
          quoi: `MongoDB non connecté (état : ${sante.base})`,
          remede: 'docker start sportsocial-mongo',
        });
      }
    } catch {
      /* déjà signalé plus haut */
    }
  }

  /* ---- Le client ---- */
  if (!(await joignable(CLIENT_URL))) {
    manques.push({
      quoi: 'Client injoignable sur le port 5173',
      remede: 'cd client && npm run dev',
    });
  } else if (!(await joignable(`${CLIENT_URL}/api/health`))) {
    /*
     * LE CAS LE PLUS TRAÎTRE, et il s'est produit deux fois.
     * Vite répond, mais son proxy `/api` ne relaie plus rien — typiquement un
     * processus orphelin dont le parent a été tué. Les pages s'affichent, et
     * toutes les suites navigateur expirent à la connexion.
     */
    manques.push({
      quoi: 'Vite répond mais son proxy /api ne relaie pas (processus orphelin ?)',
      remede:
        'Arrêter tout Vite puis le relancer :\n' +
        '      Get-NetTCPConnection -LocalPort 5173 -State Listen | Select OwningProcess\n' +
        '      Stop-Process -Id <pid> -Force ; cd client && npm run dev',
    });
  }

  /* ---- Le relais Stripe ---- */
  if (lireEnv('STRIPE_SECRET_KEY')) {
    /*
     * ON NE TESTE PAS LE RELAIS DIRECTEMENT — il n'expose aucun port. On
     * vérifie que la route de webhook répond, et l'on RAPPELLE le relais :
     * son absence ne se voit qu'au milieu de `test:paiement`, treize
     * vérifications trop tard.
     */
    manques.push({
      quoi: null, // simple rappel, pas un blocage
      rappel:
        'Le relais Stripe doit tourner, sans quoi `test:paiement` échouera\n' +
        '      à mi-parcours sur des messages sans rapport avec la cause :\n' +
        '      stripe listen --forward-to localhost:5000/api/webhooks/stripe',
    });
  }

  /* ---- La mémoire libre du poste ---- */
  /*
   * UN PRÉREQUIS AU MÊME TITRE QUE LE RELAIS STRIPE, et pour la même raison :
   * son absence ne se voit qu'à travers des échecs qui accusent le code.
   *
   * Les suites navigateur chronomètrent des pages. Sous deux gigaoctets de
   * mémoire libre, elles chronomètrent la machine. Le 27 octobre 2026,
   * `/messages` a été mesuré à 10 370 ms en fin de campagne et à 1 463 ms
   * relancé seul — sept fois plus rapide, sur un code identique. Trois
   * campagnes du même jour ont rendu trois totaux différents.
   *
   * ON AVERTIT, ON NE BLOQUE PAS : une campagne sur un poste chargé reste
   * utile pour tout ce qui ne mesure pas une durée, et c'est au porteur du
   * projet de décider s'il ferme ses fenêtres.
   */
  const SEUIL_MEMOIRE_GO = 2;
  const libreGo = freemem() / 1e9;
  if (libreGo < SEUIL_MEMOIRE_GO) {
    manques.push({
      quoi: null, // un rappel, pas un blocage
      rappel:
        `Mémoire libre : ${libreGo.toFixed(2)} Go sur ${(totalmem() / 1e9).toFixed(1)}.\n` +
        `      Sous ${SEUIL_MEMOIRE_GO} Go, les suites navigateur mesurent la machine plutôt\n` +
        '      que l’application, et les échecs ne nomment jamais la mémoire.\n' +
        '      Fermer les fenêtres du navigateur fait partie des prérequis,\n' +
        '      au même titre que `stripe listen`.',
    });
  }

  /* ---- Le piège du redémarrage : une adresse de tunnel morte ---- */

  /*
   * POURQUOI CE CONTRÔLE EXISTE, ET POURQUOI IL EST AUTOMATIQUE.
   *
   * Le conteneur de tunnel ne revient pas tout seul après un redémarrage du
   * poste — c'est voulu, `restart: "no"`. Mais n8n, lui, revient, et il garde
   * l'adresse publique morte dans son environnement. Si le workflow Telegram
   * est resté actif, n8n la déclare à Telegram au démarrage : **le bot devient
   * injoignable en silence**, sans une seule erreur nulle part.
   *
   * L'avertissement était consigné depuis le 19 octobre 2026, et il n'a pas
   * suffi : le piège s'est produit le 29 ET le 30 octobre, deux redémarrages de
   * suite. La seule façon de le voir était de le chercher à la main.
   *
   *   LA LEÇON : un piège qui mord deux fois malgré sa consigne écrite doit
   *   devenir une MESURE, pas un rappel. Une consigne demande qu'on s'en
   *   souvienne ; un contrôle le fait à notre place.
   *
   * Ce n'est qu'un RAPPEL, pas un blocage : l'état fautif n'empêche aucune
   * suite de passer, il rend seulement le canal Telegram muet. Bloquer la
   * campagne pour cela serait disproportionné.
   */
  try {
    const { execFileSync } = await import('node:child_process');
    const lire = (...args) =>
      execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

    const adresse = lire('exec', 'coachconnect-n8n', 'sh', '-c', 'echo "$WEBHOOK_URL"');
    const publique = /^https?:\/\/(?!localhost)/i.test(adresse);
    const tunnelDebout = lire('ps', '--filter', 'name=coachconnect-tunnel', '--filter', 'status=running', '-q') !== '';

    if (publique && !tunnelDebout) {
      manques.push({
        quoi: null,
        rappel:
          'ADRESSE DE TUNNEL MORTE dans n8n, et aucun tunnel debout.\n' +
          '      n8n a déclaré cette adresse à Telegram au démarrage : si le\n' +
          '      workflow Telegram est actif, le bot est injoignable EN SILENCE.\n' +
          '      C’est le piège des redémarrages du 29 et du 30 octobre 2026.\n' +
          '      Remède :  node docker/n8n/ouvrir-tunnel.mjs --fermer\n' +
          '      puis, pour une démonstration :  node docker/n8n/ouvrir-tunnel.mjs',
      });
    }
  } catch {
    /*
     * Docker absent ou conteneur éteint : d'autres contrôles le signalent déjà,
     * et un prérequis qui crie deux fois la même panne apprend à être ignoré.
     */
  }

  /* ---- Le compte administrateur ---- */
  const uri = lireEnv('MONGO_URI');
  if (uri) {
    try {
      const { MongoClient } = requireServeur('mongodb');
      const client = new MongoClient(uri, { serverSelectionTimeoutMS: 6000 });
      await client.connect();
      const admin = await client.db().collection('users').findOne({ type: 'admin' });
      await client.close();

      if (!admin) {
        manques.push({
          quoi: 'Aucun compte administrateur en base',
          remede:
            'cd server && npm run creer-admin -- --email=admin@exemple.fr ' +
            '--pseudo=admin --password=MotDePasseAdmin123 --nom=Nom --prenom=Prenom',
        });
      }
    } catch (erreur) {
      manques.push({
        quoi: `MongoDB injoignable directement : ${erreur.message}`,
        remede: 'docker start sportsocial-mongo',
      });
    }
  }

  return manques;
}

/* ================================================================== *
 *  EXÉCUTION
 * ================================================================== */

function lancer(paquet, script) {
  return new Promise((resoudre) => {
    const dossier = paquet === 'server' ? SERVEUR : CLIENT;

    /*
     * COMMANDE EN UNE SEULE CHAÎNE, sans tableau d'arguments.
     *
     * `spawn(cmd, [args], { shell: true })` déclenche DEP0190 : Node avertit
     * que les arguments sont concaténés sans échappement. L'avertissement
     * s'imprime au milieu du premier résultat et donne à croire à un problème.
     * Ici le nom du script vient d'une constante de ce fichier, jamais d'une
     * saisie : la chaîne unique est équivalente et silencieuse.
     */
    const processus = spawn(`npm run ${script}`, {
      cwd: dossier,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let sortie = '';
    processus.stdout.on('data', (bloc) => { sortie += bloc; });
    processus.stderr.on('data', (bloc) => { sortie += bloc; });

    processus.on('close', (code) => resoudre({ code, sortie }));
  });
}

/** Extrait « 47/47 » du flot de sortie d'une suite. */
function lireScore(sortie) {
  const correspondance = /(\d+)\/(\d+) vérifications réussies/.exec(sortie);
  return correspondance
    ? { reussies: Number(correspondance[1]), total: Number(correspondance[2]) }
    : null;
}

async function principal() {
  console.log('\n===========================================================');
  console.log('  VÉRIFICATION DES PRÉREQUIS');
  console.log('===========================================================\n');

  const manques = await verifierPrerequis();
  const bloquants = manques.filter((m) => m.quoi);
  const rappels = manques.filter((m) => m.rappel);

  for (const rappel of rappels) {
    console.log(`  ⓘ  ${rappel.rappel}\n`);
  }

  if (bloquants.length > 0) {
    console.log('  Impossible de lancer les suites — il manque :\n');
    for (const manque of bloquants) {
      console.log(`  ✗  ${manque.quoi}`);
      console.log(`     → ${manque.remede}\n`);
    }
    console.log('  Rien n’a été lancé : corriger ce qui précède évite des');
    console.log('  dizaines d’échecs qui accuseraient le code à tort.\n');
    process.exit(1);
  }

  console.log('  ✓  Tous les prérequis sont réunis.\n');

  /*
   * `--prerequis` — VÉRIFIER L'ÉTAT DU POSTE SANS LANCER LES 37 SUITES.
   *
   * Deux usages, et le second est le plus utile :
   *
   *   1. savoir en deux secondes si une campagne a une chance d'aboutir, au
   *      lieu de l'apprendre à la trentième suite ;
   *   2. ÉPROUVER LES CONTRÔLES EUX-MÊMES. Un prérequis qui ne sonne jamais ne
   *      vaut rien, et on ne peut pas le vérifier s'il faut vingt minutes de
   *      campagne pour l'entendre. Le contrôle de l'adresse de tunnel morte a
   *      été éprouvé ainsi : on arrête le conteneur de tunnel en laissant
   *      l'adresse dans n8n, et l'avertissement doit apparaître.
   */
  if (process.argv.includes('--prerequis')) {
    console.log('  (--prerequis : les suites ne sont pas lancées)\n');
    process.exit(0);
  }

  console.log('===========================================================');
  console.log(`  ${SUITES.length} SUITES, UNE PAR UNE`);
  console.log('===========================================================\n');

  const bilan = [];
  let totalReussies = 0;
  let totalVerifications = 0;

  for (const [index, suite] of SUITES.entries()) {
    const numero = `${index + 1}/${SUITES.length}`;
    process.stdout.write(`  [${numero}] ${suite.libelle.padEnd(36)} … `);

    const debut = Date.now();
    let { code, sortie } = await lancer(suite.paquet, suite.script);

    /*
     * UN SEUL RÉESSAI, ET SEULEMENT SUR UNE PANNE DE TRANSPORT.
     *
     * Constaté pendant le développement : une coupure réseau de quelques
     * secondes a fait échouer HUIT suites d'affilée sur « fetch failed /
     * ECONNRESET », alors que rien dans le code n'avait bougé. Les serveurs
     * étaient revenus avant même qu'on regarde.
     *
     * On distingue donc deux natures d'échec. Une VÉRIFICATION qui échoue est
     * un résultat : la réessayer masquerait précisément ce que la suite est
     * chargée de mesurer. Une panne de TRANSPORT n'est pas un résultat — la
     * suite n'a rien pu mesurer du tout. Seul le second cas est rejoué, une
     * fois, après avoir vérifié que l'API répond de nouveau.
     */
    const panneTransport =
      code !== 0 &&
      !lireScore(sortie) &&
      /fetch failed|ECONNRESET|ECONNREFUSED|socket hang up/i.test(sortie);

    if (panneTransport) {
      process.stdout.write('panne réseau, réessai… ');
      await new Promise((r) => setTimeout(r, 5000));

      if (await joignable(`${API}/health`)) {
        ({ code, sortie } = await lancer(suite.paquet, suite.script));
      }
    }

    const secondes = Math.round((Date.now() - debut) / 1000);

    const score = lireScore(sortie);

    /*
     * PAUSE ENTRE DEUX SUITES, et elle n'est pas décorative.
     *
     * Chaque suite navigateur ferme Chromium, mais le système met un instant
     * à rendre la mémoire et les sockets. Enchaînées sans répit, la
     * quatorzième expire au premier `page.goto` — constaté ici même, alors
     * que la même suite passe à 35/35 lancée seule. Le symptôme accuse
     * l'application ; la cause est la machine.
     */
    if (index < SUITES.length - 1) {
      await new Promise((r) => setTimeout(r, suite.paquet === 'client' ? 4000 : 1000));
    }

    if (code === 0 && score) {
      console.log(`${score.reussies}/${score.total}  (${secondes} s)`);
      totalReussies += score.reussies;
      totalVerifications += score.total;
      bilan.push({ ...suite, ok: true, score });
    } else {
      console.log(`ÉCHEC  (${secondes} s)`);
      if (score) {
        totalReussies += score.reussies;
        totalVerifications += score.total;
      }
      bilan.push({ ...suite, ok: false, score, sortie });
    }
  }

  /* --------------------------- Récapitulatif --------------------------- */

  const echecs = bilan.filter((b) => !b.ok);

  console.log('\n===========================================================');
  console.log('  RÉCAPITULATIF');
  console.log('===========================================================\n');

  for (const ligne of bilan) {
    const marque = ligne.ok ? '✓' : '✗';
    const score = ligne.score ? `${ligne.score.reussies}/${ligne.score.total}` : '—';
    console.log(`  ${marque}  ${ligne.libelle.padEnd(36)} ${score}`);
  }

  console.log(`\n  Total : ${totalReussies}/${totalVerifications} vérifications`);

  /*
   * LE DÉTAIL DE CHAQUE SUITE EN ÉCHEC, PAS SEULEMENT DE LA PREMIÈRE.
   *
   * Une première version ne montrait que la première : quand trois suites
   * échouaient ensemble puis passaient seules, il était impossible de savoir
   * ce qui avait cédé dans les deux autres — et donc de distinguer un aléa
   * d'une régression. La sortie COMPLÈTE de chaque suite en échec est en
   * outre conservée dans `captures/` (ignoré par git) : la preuve survit à
   * la fermeture du terminal.
   */
  if (echecs.length > 0) {
    const dossier = join(RACINE, 'captures');
    mkdirSync(dossier, { recursive: true });

    console.log(`\n  ${echecs.length} suite(s) en échec :\n`);
    for (const echec of echecs) {
      const journal = join(dossier, `campagne-${echec.paquet}-${echec.script.replace(/[:/]/g, '-')}.log`);
      writeFileSync(journal, echec.sortie);

      console.log(`  ✗ ${echec.libelle}`);
      console.log(
        echec.sortie
          .split('\n')
          .filter((l) => /ECHEC|INTERROMPU|Error/.test(l))
          .slice(0, 15)
          .map((l) => `      ${l}`)
          .join('\n')
      );
      console.log(`      relancer seule :  cd ${echec.paquet} && npm run ${echec.script}`);
      console.log(`      sortie complète : ${journal}\n`);
    }
    process.exit(1);
  }

  console.log('\n  Tout est au vert.\n');
}

principal();
