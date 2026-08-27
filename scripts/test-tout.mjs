/**
 * ===========================================================================
 *  LANCEUR DE TOUTES LES SUITES
 * ===========================================================================
 *
 *   npm test
 *
 * POURQUOI CE SCRIPT EXISTE.
 *
 * Le projet compte quinze suites réparties sur deux paquets, avec des
 * prérequis différents. Un correcteur qui ouvre le dépôt et tape `npm test`
 * doit obtenir une réponse — pas une erreur « missing script », et pas une
 * liste de quinze commandes à recopier.
 *
 * DEUX CHOSES QUE CE LANCEUR FAIT, ET QU'UN SIMPLE ENCHAÎNEMENT NE FERAIT PAS :
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
 * ===========================================================================
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';

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
  { paquet: 'server', script: 'test:recherche', libelle: 'API — recherche' },
  { paquet: 'server', script: 'test:messagerie', libelle: 'API — messagerie' },
  { paquet: 'server', script: 'test:notifications', libelle: 'API — notifications' },
  { paquet: 'server', script: 'test:perf', libelle: 'API — performance' },

  { paquet: 'client', script: 'test:ui', libelle: 'Navigateur — parcours général' },
  { paquet: 'client', script: 'test:relations', libelle: 'Navigateur — abonnés et abonnements' },
  { paquet: 'client', script: 'test:premium', libelle: 'Navigateur — écrans premium' },
  { paquet: 'client', script: 'test:paiement', libelle: 'Navigateur — paiement réel' },
  { paquet: 'client', script: 'test:carte', libelle: 'Navigateur — carte' },
  { paquet: 'client', script: 'test:evenements', libelle: 'Navigateur — événements' },
  { paquet: 'client', script: 'test:recherche', libelle: 'Navigateur — recherche' },
  { paquet: 'client', script: 'test:messagerie', libelle: 'Navigateur — messagerie' },
  { paquet: 'client', script: 'test:parcours-10-11', libelle: 'Navigateur — parcours 10 et 11' },
  { paquet: 'client', script: 'test:notifications', libelle: 'Navigateur — notifications' },

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

/**
 * Chaque prérequis rend `{ ok, remede }` : le remède est une commande à
 * copier, pas une description. « Lancez le serveur » oblige à chercher
 * comment ; `cd server && npm run dev` se colle dans un terminal.
 */
async function verifierPrerequis() {
  const manques = [];

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

  if (echecs.length > 0) {
    console.log(`\n  ${echecs.length} suite(s) en échec — détail de la première :\n`);
    console.log(
      echecs[0].sortie
        .split('\n')
        .filter((l) => /ECHEC|INTERROMPU|Error/.test(l))
        .slice(0, 15)
        .map((l) => `      ${l}`)
        .join('\n')
    );
    console.log(
      `\n  Relancer seule :  cd ${echecs[0].paquet} && npm run ${echecs[0].script}\n`
    );
    process.exit(1);
  }

  console.log('\n  Tout est au vert.\n');
}

principal();
