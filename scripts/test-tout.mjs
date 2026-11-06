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
import { readFileSync, existsSync, mkdirSync, writeFileSync, statfsSync } from 'node:fs';
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
/*
 * LE SEUIL DE MÉMOIRE EST AU NIVEAU DU MODULE, et c'est délibéré : il sert aux
 * prérequis AVANT la campagne et au bilan APRÈS. Deux constantes jumelles
 * finiraient par divergir, et le bilan annoncerait un seuil que les prérequis
 * n'appliquent plus.
 */
const SEUIL_MEMOIRE_GO = 2;

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
  { paquet: 'server', script: 'test:scrutage', libelle: 'Canal — scrutage Telegram' },
  { paquet: 'server', script: 'test:controles', libelle: 'Exploitation — contrôles d’envoi et de flux' },
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

  /* ---- Le jeton Gmail, qui meurt tous les sept jours ---- */

  /*
   * POURQUOI CE CONTRÔLE EXISTE, ET POURQUOI IL ÉTAIT LE PLUS MANQUANT.
   *
   * Le jeton OAuth de Gmail expire au bout de SEPT JOURS — règle du mode Test
   * de l'application Google, pas incident. Le 2 novembre 2026 il est mort à
   * 13 h 44, et la campagne du 4 novembre a rendu **2106/2106** pendant que
   * l'envoi était hors service.
   *
   * AUCUNE DES 2106 VÉRIFICATIONS NE REGARDAIT LÀ, et c'est logique :
   *   - les dossiers de test visent des domaines réservés (`.local`, `.test`),
   *     donc aucun envoi réel n'a lieu pendant une campagne — c'est voulu ;
   *   - la section « portée de l'identifiant d'envoi » de `test:mot-de-passe`
   *     LIT LES SOURCES sans rien exécuter — c'est son objet, et elle ne peut
   *     donc pas voir un jeton mort.
   *
   *   LA LEÇON : un chiffre vert ne vaut que pour ce qu'il mesure. La seule
   *   façon de savoir ce qu'il ne mesure pas est de le chercher.
   *
   * `verifierSmtp()` authentifie SANS RIEN ENVOYER : on peut donc l'appeler à
   * chaque campagne sans risque d'écrire à qui que ce soit.
   */
  if (lireEnv('GOOGLE_OAUTH_REFRESH_TOKEN') || lireEnv('SMTP_PASS')) {
    /*
     * UN PROCESSUS SÉPARÉ, AVEC `server/` POUR RÉPERTOIRE COURANT, ET CE N'EST
     * PAS UN DÉTAIL DE STYLE. `config/env.js` appelle `dotenv.config()`, qui lit
     * le `.env` du répertoire courant, puis `process.exit(1)` s'il manque une
     * variable requise. Importer le service ICI — la campagne tourne depuis la
     * racine, où il n'y a pas de `.env` — TUERAIT la campagne au lieu de la
     * renseigner.
     */
    const sonde = spawnSync(process.execPath, [join('scripts', 'verifier-envoi.mjs')], {
      cwd: join(RACINE, 'server'),
      encoding: 'utf8',
    });
    const verdict = (sonde.stdout ?? '').trim();

    if (sonde.status !== 0 && verdict) {
      manques.push({
        quoi: null,
        rappel:
          `ENVOI DE COURRIELS HORS SERVICE.\n      ${verdict.split('\n').join('\n      ')}\n` +
          '      La campagne passera quand même au vert : aucune de ses\n' +
          '      vérifications n’envoie de courriel réel. Mais le back-office,\n' +
          '      le mot de passe oublié et les réponses du support, eux, échouent.',
      });
    } else if (sonde.status !== 0) {
      manques.push({
        quoi: null,
        rappel:
          'Le contrôle du jeton d’envoi n’a pas pu s’exécuter :\n      ' +
          ((sonde.stderr ?? '').trim().split('\n')[0] || 'cause inconnue'),
      });
    }
  }

  /* ---- Les flux n8n qui échouent en silence ---- */

  /*
   * VINGT-SEPT ÉCHECS D'AFFILÉE N'ONT ALERTÉ PERSONNE PENDANT TROIS JOURS.
   *
   * Le flux courriel tourne toutes les dix minutes. Quand son garde-fou refuse
   * de lire une boîte qu'il ne pourrait pas marquer — ce qui est le bon
   * comportement — il échoue PROPREMENT, et donc silencieusement. Rien, dans
   * l'application comme dans la campagne, ne relevait ces erreurs.
   *
   * On lit la base de n8n, pas son journal : `docker logs` s'est déjà révélé
   * trompeur après une recréation de conteneur.
   *
   * ------------------------------------------------------------------------
   * CORRIGÉ LE 5 NOVEMBRE 2026 : COMPTER LES `error` NE SUFFIT PAS.
   * ------------------------------------------------------------------------
   *
   * La première version de ce contrôle a attrapé sa première vraie panne —
   * `ccAgentCourri01=26` — et c'est en vérifiant son verdict qu'on a découvert
   * ce qu'elle ne pouvait PAS voir. Mesuré sur 24 h, même justificatif Gmail
   * mort pour les trois flux :
   *
   *     ccAgentCourri01    error     29 exécutions, 27 avec échec d'authentification
   *     ccMessagerieCor1   success   19 exécutions, 17 avec échec d'authentification
   *     ccMessagerieTri1   success   19 exécutions, 17 avec échec d'authentification
   *
   * TRENTE-QUATRE EXÉCUTIONS SE SONT DÉCLARÉES RÉUSSIES EN ÉCHOUANT À
   * S'AUTHENTIFIER. Leurs données contiennent `invalid_grant`, et leur statut
   * dit `success` : le flux rattrape l'erreur du nœud Gmail et continue.
   *
   *   LA LEÇON, et c'est celle du projet appliquée à mon propre instrument :
   *   un contrôle qui fait confiance au statut déclaré hérite des faux verts
   *   de ce qu'il surveille. La campagne a rendu 2106/2106 pendant que l'envoi
   *   était mort ; ce contrôle rendait « 26 échecs » pendant qu'il y en avait
   *   60. *Le même piège, un cran plus loin.*
   *
   * ON LIT DONC LES DONNÉES, PAS SEULEMENT LE STATUT. Deux chiffres distincts
   * sont rendus par flux, parce qu'ils ne veulent pas dire la même chose : un
   * échec déclaré se voit dans l'éditeur, un échec avalé ne se voit nulle part.
   */
  {
    const requete =
      'cd $(npm root -g)/n8n && node -e \'' +
      'const s=require("sqlite3");' +
      'const db=new s.Database("/home/node/.n8n/database.sqlite", s.OPEN_READONLY);' +
      'const d=new Date(Date.now()-86400000).toISOString().slice(0,19).replace("T"," ");' +
      'const re=/invalid_grant|expired or revoked|"code":401|"httpCode":"401"/i;' +
      'db.all("SELECT e.workflowId w, e.status st, e.startedAt sa, d.data da FROM execution_entity e JOIN execution_data d ON d.executionId = e.id WHERE e.startedAt > ? ORDER BY e.startedAt ASC", [d], (e,r)=>{' +
      'if(e||!r){console.log("");process.exit(0);}' +
      'console.log("N|"+r.length);' +
      'const a={};' +
      'r.forEach(x=>{const k=x.w;a[k]=a[k]||{err:0,faux:0,dernierMauvais:"",dernierEtat:"sain"};' +
      'const mauvaisAuth=re.test(String(x.da||""));' +
      'const mauvais=(x.st=="error")||(x.st=="success"&&mauvaisAuth);' +
      'if(x.st=="error"){a[k].err++;}' +
      'else if(x.st=="success"&&mauvaisAuth){a[k].faux++;}' +
      'if(mauvais){a[k].dernierMauvais=x.sa;}' +
      'a[k].dernierEtat=mauvais?"mauvais":"sain";});' +
      'Object.keys(a).sort().forEach(k=>{' +
      'const v=a[k];const etat=v.dernierEtat=="mauvais"?"ENCOURS":"RESOLU";' +
      'if(v.err){console.log("E|"+k+"|"+v.err+"|"+v.dernierMauvais+"|"+etat);}' +
      'if(v.faux){console.log("F|"+k+"|"+v.faux+"|"+v.dernierMauvais+"|"+etat);}});' +
      'db.close();});\'';

    const lu = spawnSync('docker', ['exec', 'coachconnect-n8n', 'sh', '-c', requete], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    /*
     * UNE LIGNE PAR CONSTAT : `E|<flux>|<n>|<dernier mauvais>|<ENCOURS|RESOLU>`
     * pour les échecs déclarés, `F|…` pour les exécutions qui se disent
     * réussies alors que leurs données portent un refus d'authentification.
     *
     * ------------------------------------------------------------------------
     * POURQUOI L'ÉTAT COMPTE AUTANT QUE LE NOMBRE, et c'est la correction du
     * 6 novembre 2026.
     * ------------------------------------------------------------------------
     *
     * La fenêtre est de 24 h. Juste après la réparation du justificatif Gmail,
     * à 23 h 45, ce contrôle annonçait encore `ccAgentCourri01=31` et
     * `ccMessagerieTri1=19` — chiffres exacts, et complètement trompeurs : les
     * trois flux tournaient de nouveau sans erreur depuis vingt minutes.
     *
     *   LA LEÇON : un avertissement qui continue de crier après la réparation
     *   apprend à l'ignorer. Et un avertissement qu'on a appris à ignorer ne
     *   protège plus de rien — c'est exactement l'état d'esprit qui a laissé
     *   27 échecs passer trois jours.
     *
     * On distingue donc une panne EN COURS d'une panne RÉSOLUE, sur un critère
     * mesuré et non sur une heure de garde : l'état de la DERNIÈRE exécution du
     * flux dans la fenêtre.
     */
    const declares = [];
    const avales = [];
    let examinees = null;
    for (const ligne of (lu.stdout ?? '').trim().split('\n')) {
      const compte = ligne.trim().match(/^N\|(\d+)$/);
      if (compte) {
        examinees = Number(compte[1]);
        continue;
      }
      const m = ligne.trim().match(/^([EF])\|([^|]+)\|(\d+)\|([^|]*)\|(ENCOURS|RESOLU)$/);
      if (!m) continue;
      const [, genre, flux, nombre, dernier, etat] = m;
      (genre === 'E' ? declares : avales).push({ flux, nombre, dernier, resolu: etat === 'RESOLU' });
    }

    /*
     * ANCRER L'ABSENCE SUR UNE PRÉSENCE — la règle du projet, appliquée ici à
     * un trou qu'on a trouvé en se la posant.
     *
     * Ce contrôle conclut « rien à signaler » quand il ne trouve aucun échec.
     * Mais il concluait EXACTEMENT LA MÊME CHOSE s'il ne trouvait aucune
     * exécution du tout — base vide après une recréation de conteneur, flux
     * tous désactivés, purge d'historique. Un silence pour cause de santé et un
     * silence pour cause de cécité se ressemblaient trait pour trait.
     *
     *   LA LEÇON, déjà écrite pour les pages vides des suites navigateur : une
     *   assertion d'absence ne vaut que si l'on a prouvé qu'on regardait au bon
     *   endroit. « Zéro erreur sur zéro exécution » n'est pas une bonne
     *   nouvelle, c'est l'absence de nouvelle.
     */
    if (lu.status === 0 && examinees === 0) {
      manques.push({
        quoi: null,
        rappel:
          'AUCUNE EXÉCUTION n8n SUR LES DERNIÈRES 24 H — et ce n’est pas un bon signe.\n' +
          '      Les flux tournent à l’horloge : le relevé Telegram seul en produit\n' +
          '      plus de deux cents par jour. Zéro signifie qu’ils ne tournent plus,\n' +
          '      pas qu’ils vont bien.\n' +
          '      Causes déjà vues : flux désactivés après `n8n import:workflow`,\n' +
          '      qui remet toujours `active: false` ; conteneur recréé ; historique\n' +
          '      purgé.\n' +
          '      À vérifier :  node docker/n8n/etat-telegram.mjs',
      });
    }

    /*
     * Une panne en cours se dit d'abord. Une panne résolue reste mentionnée —
     * elle explique des données manquantes de la journée — mais elle ne doit
     * pas se faire passer pour une urgence.
     */
    const decrire = (liste) =>
      liste
        .map(
          (x) =>
            `${x.flux}=${x.nombre}` +
            (x.resolu
              ? ` (RÉSOLU, dernier le ${x.dernier.slice(0, 19)})`
              : ` (EN COURS, dernier le ${x.dernier.slice(0, 19)})`)
        )
        .join('\n      ');

    if (lu.status === 0 && declares.length) {
      const enCours = declares.some((x) => !x.resolu);
      manques.push({
        quoi: null,
        rappel:
          `FLUX n8n EN ÉCHEC SUR LES DERNIÈRES 24 H :\n      ${decrire(declares)}\n` +
          (enCours
            ? '      Ces échecs ne remontent nulle part ailleurs : un flux qui refuse\n' +
              '      proprement de travailler échoue en silence.\n' +
              '      Pour en lire la cause :  node docker/n8n/etat-telegram.mjs\n' +
              '      ou, dans l’éditeur n8n, l’onglet « Executions » du flux nommé.'
            : '      Plus aucun échec depuis : la cause a été traitée. Ces lignes\n' +
              '      restent affichées parce que la fenêtre couvre 24 h, et parce\n' +
              '      qu’elles expliquent les données manquantes de la journée.'),
      });
    }

    if (lu.status === 0 && avales.length) {
      const enCours = avales.some((x) => !x.resolu);
      manques.push({
        quoi: null,
        rappel:
          `FLUX n8n QUI SE DISENT RÉUSSIS EN ÉCHOUANT À S’AUTHENTIFIER :\n      ${decrire(avales)}\n` +
          (enCours
            ? '      PIRE QUE LES ÉCHECS DÉCLARÉS : ceux-là n’apparaissent nulle part.\n' +
              '      Leur statut dit « success », leurs données portent `invalid_grant`.\n' +
              '      L’onglet « Executions » les affiche en vert : il faut ouvrir une\n' +
              '      exécution et lire le nœud concerné pour voir le refus.\n' +
              '      Cause la plus fréquente : un justificatif OAuth expiré que le\n' +
              '      flux rattrape au lieu de propager.'
            : '      Plus aucun refus depuis : le justificatif a été reconnecté.\n' +
              '      Ces lignes restent affichées parce que la fenêtre couvre 24 h.'),
      });
    }
    /*
     * Pas de `try` : `spawnSync` ne lève pas quand la commande échoue, il rend
     * un statut. n8n éteint donne donc un statut non nul, et les contrôles
     * précédents l'ont déjà dit — inutile de le répéter ici.
     */
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

  /* ---- L'ESPACE DISQUE, et le 5 novembre 2026 l'a démontré ---- */

  /*
   * POURQUOI CE CONTRÔLE EXISTE, ET CE QU'IL A COÛTÉ DE NE PAS L'AVOIR.
   *
   * Le 5 novembre 2026, `C:` est descendu à **0,01 Go libre sur 221**. Neuf
   * mégaoctets. Tout s'est arrêté d'un coup, et AUCUN des symptômes ne nommait
   * le disque :
   *
   *   - `docker ps` sans réponse en 120 s, `docker version` en 180 s ;
   *   - `vmmemWSL` tombé à 38 Mo — la machine virtuelle ne pouvait plus
   *     étendre son image ;
   *   - `[DB] Connexion impossible`, donc un back-end qui paraît cassé ;
   *   - `wsl --shutdown` qui ne rend jamais la main.
   *
   * ET LE DIAGNOSTIC A COMMENCÉ PAR SE TROMPER DE RESSOURCE. La mémoire libre
   * était basse elle aussi — 0,77 Go, navigateurs à 1 133 Mo — donc elle a été
   * accusée, mesurée, et commentée, pendant que la vraie contrainte était à
   * côté.
   *
   *   LA LEÇON : un chiffre inquiétant n'est pas une cause. Il faut encore
   *   montrer qu'il produit le symptôme observé. Mémoire et disque sont deux
   *   ressources distinctes, et leurs pannes se ressemblent assez pour que
   *   l'une serve d'explication commode à l'autre.
   *
   * ET LIBÉRER LE DISQUE APRÈS COUP N'A PAS SUFFI : WSL était resté figé au
   * niveau du service, et seul un redémarrage du poste l'a remis d'aplomb.
   * D'où le seuil ci-dessous, qui avertit AVANT d'y arriver.
   *
   * ON AVERTIT, ON NE BLOQUE PAS — même règle que pour la mémoire. Mais on le
   * dit tôt, parce qu'une campagne écrit : Mongo journalise, n8n journalise,
   * Vite met en cache, et les suites navigateur déposent des captures.
   */
  const SEUIL_DISQUE_GO = 5;
  try {
    const fs = statfsSync(RACINE);
    const disqueLibreGo = (fs.bavail * fs.bsize) / 1e9;
    if (disqueLibreGo < SEUIL_DISQUE_GO) {
      manques.push({
        quoi: null, // un rappel, pas un blocage
        rappel:
          `Espace disque libre : ${disqueLibreGo.toFixed(2)} Go sur ` +
          `${((fs.blocks * fs.bsize) / 1e9).toFixed(0)}.\n` +
          `      Sous ${SEUIL_DISQUE_GO} Go, une campagne qui écrit peut figer Docker et WSL,\n` +
          '      et les symptômes accusent alors la base ou le code : `docker ps`\n' +
          '      sans réponse, `[DB] Connexion impossible`, `wsl --shutdown` bloqué.\n' +
          '      Libérer le disque APRÈS COUP ne suffit pas — il faut redémarrer\n' +
          '      le poste. Mieux vaut donc faire de la place maintenant.',
      });
    }
  } catch {
    /*
     * `statfsSync` existe depuis Node 18.15. Si elle manque ou refuse le
     * chemin, on se taît : un prérequis qui ne peut pas mesurer n'a rien à
     * dire, et surtout rien à empêcher.
     */
  }

  /* ---- Le canal Telegram muet, nouvelle cause ---- */

  /*
   * POURQUOI CE CONTRÔLE EXISTE, ET POURQUOI IL EST AUTOMATIQUE.
   *
   * Sa première version guettait une adresse de tunnel morte : le conteneur de
   * tunnel ne revenait pas après un redémarrage du poste, n8n gardait
   * l'adresse publique périmée et la déclarait à Telegram au démarrage — le
   * bot devenait injoignable EN SILENCE. L'avertissement était consigné
   * depuis le 19 octobre 2026 et n'avait pas suffi : le piège a mordu le 29 ET
   * le 30 octobre.
   *
   *   LA LEÇON, ET ELLE SURVIT AU PIÈGE QUI L'A FAIT NAÎTRE : un piège qui
   *   mord deux fois malgré sa consigne écrite doit devenir une MESURE, pas un
   *   rappel. Une consigne demande qu'on s'en souvienne ; un contrôle le fait
   *   à notre place.
   *
   * CE PIÈGE-LÀ N'EXISTE PLUS depuis le 4 novembre 2026 : le canal entrant
   * passe par le scrutage, il n'y a plus ni tunnel ni `setWebhook`. Mais il en
   * reste un, de la même famille — muet, et de même remède oublié :
   *
   *   `n8n import:workflow` REMET TOUJOURS LE WORKFLOW À L'ARRÊT. Le chemin du
   *   webhook local n'est alors plus enregistré, le scrutateur reçoit 404, et
   *   répondre sur Telegram ne produit toujours rien.
   *
   * On sonde donc le chemin SANS clé de service : 403 prouve qu'il est
   * enregistré et protégé, 404 qu'il ne l'est pas. Un diagnostic qui
   * constaterait la présence du conteneur au lieu d'éprouver le chemin
   * mentirait avec aplomb — c'est déjà arrivé.
   *
   * Ce n'est qu'un RAPPEL, pas un blocage : l'état fautif n'empêche aucune
   * suite de passer, il rend seulement le canal Telegram muet.
   */
  try {
    const { execFileSync } = await import('node:child_process');
    const lire = (...args) =>
      execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

    const code = await fetch('http://localhost:5678/webhook/telegram-support', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(8000),
    })
      .then((r) => r.status)
      .catch(() => null);

    if (code === 404) {
      manques.push({
        quoi: null,
        rappel:
          'CANAL TELEGRAM MUET : le chemin du webhook local n’est pas enregistré.\n' +
          '      `ccAgentTelegr01` est inactif — et `n8n import:workflow` le remet\n' +
          '      TOUJOURS à l’arrêt. Aucune erreur ne le signale ailleurs.\n' +
          '      Remède :  node docker/n8n/etat-telegram.mjs  (il donne les trois étapes)',
      });
    } else if (code !== null && code !== 403) {
      manques.push({
        quoi: null,
        rappel:
          `WEBHOOK TELEGRAM OUVERT SANS CLÉ (${code}).\n` +
          '      Le port 5678 est joignable depuis le réseau local : n’importe qui\n' +
          '      pourrait injecter une fausse réponse d’exploitant.\n' +
          '      Remède :  node docker/n8n/etat-telegram.mjs',
      });
    }

    /*
     * ET UN TUNNEL QUI TRAÎNE N'EST PLUS UN PRÉREQUIS MAIS UNE ALERTE : il
     * n'apporte plus rien et expose l'éditeur n8n pour rien.
     */
    const tunnelDebout = lire('ps', '--filter', 'name=coachconnect-tunnel', '--filter', 'status=running', '-q') !== '';
    if (tunnelDebout) {
      manques.push({
        quoi: null,
        rappel:
          'UN TUNNEL TOURNE POUR RIEN. Le canal n’en a plus besoin depuis le\n' +
          '      scrutage ; il expose l’éditeur n8n sans aucune contrepartie.\n' +
          '      Remède :  node docker/n8n/ouvrir-tunnel.mjs --fermer',
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

  /* ------------------- CE QUE CE TOTAL NE COUVRE PAS ------------------- */

  /*
   * ============================================================================
   * POURQUOI CE BLOC EXISTE, ET C'EST LA RÉPONSE DE FOND AU 2106/2106
   * ============================================================================
   *
   * Le 4 novembre 2026 cette campagne a affiché **2106/2106** pendant que
   * l'envoi de courriels était hors service depuis deux jours, que le flux
   * courriel de n8n échouait toutes les dix minutes, et que le back-office
   * montrait `invalid_grant` à l'exploitant.
   *
   * AUCUNE DES 2106 VÉRIFICATIONS N'ÉTAIT FAUSSE. Le total était exact. Ce
   * qu'il ne disait pas, c'est ce qu'il ne regardait pas — et personne ne peut
   * deviner l'étendue d'une mesure à partir de son résultat.
   *
   *   LA LEÇON : un nombre vert invite à la confiance À PROPORTION DE SA
   *   TAILLE, jamais de sa couverture. « 2106/2106 » rassure mille fois plus
   *   que « 21/21 », pour une couverture qui n'a rien à voir. *Le remède n'est
   *   pas de tester plus, c'est d'afficher les limites AU MÊME ENDROIT que le
   *   total.*
   *
   * ET LA MÊME ERREUR A ÉTÉ REFAITE DEUX FOIS DEPUIS, un cran plus loin
   * chaque fois : le contrôle des flux n8n annonçait « 26 échecs » quand il y
   * en avait 60, parce qu'il croyait le statut déclaré ; puis il criait encore
   * « 31 échecs » vingt minutes après la réparation, parce qu'il ne distinguait
   * pas la panne de son souvenir. *Trois fois le même piège, à trois étages.*
   *
   * ON ÉNONCE DONC DEUX SORTES DE LIMITES, et le mélange des deux serait une
   * faute :
   *
   *   - les limites STRUCTURELLES, qui tiennent au dessin de la campagne et ne
   *     changent pas d'un lancement à l'autre ;
   *   - les limites MESURÉES À CE LANCEMENT-CI, qui dépendent de l'état du
   *     poste et de ce qui a réellement tourné.
   *
   * Les secondes sont calculées, jamais écrites à la main : une liste figée
   * finirait par mentir, et un avertissement qui ment est pire que pas
   * d'avertissement.
   */

  const limites = [];

  /* ---- Ce qui tient au dessin de la campagne ---- */

  limites.push(
    'aucun courriel RÉEL n’est envoyé : les dossiers de test visent des domaines\n' +
      '      réservés (`.local`, `.test`), et c’est voulu — une campagne ne doit pas\n' +
      '      écrire à des inconnus. Un jeton d’envoi mort reste donc invisible ici.'
  );

  limites.push(
    'les flux n8n ne sont PAS exercés : ils tournent à l’horloge, dans un\n' +
      '      conteneur, déclenchés par Gmail et Telegram. Rien ici ne les démarre ni ne\n' +
      '      les observe. Leur état se lit dans les prérequis (`--prerequis`).'
  );

  limites.push(
    'certaines sections LISENT LES SOURCES au lieu de les exécuter — ainsi la\n' +
      '      « portée de l’identifiant d’envoi » de `test:mot-de-passe`. C’est leur objet,\n' +
      '      et cela ne peut par construction rien dire d’un justificatif expiré.'
  );

  /* ---- Ce qui dépend de CE lancement, et qui est donc mesuré ---- */

  /*
   * LES SUITES QUI N'ONT PAS RENDU DE SCORE. Une suite peut finir en code 0
   * sans compteur lisible : ses vérifications n'entrent alors dans aucun
   * total, et son absence passerait inaperçue au milieu d'un grand nombre.
   */
  /*
   * UN COMPTEUR À ZÉRO EST AUSSI AVEUGLE QU'UN COMPTEUR ABSENT, et ce défaut-ci
   * a été trouvé en relisant la sortie de ce bloc même.
   *
   * La campagne du 6 novembre 2026 a affiché `Total : 2130/2130` avec une suite
   * interrompue à `0/0` — le relais Stripe ne tournait pas. Le total restait
   * parfaitement vrai ET parfaitement muet sur une suite entière de couverture
   * manquante, parce que `0/0` se fond dans une addition.
   *
   *   LA LEÇON : `n/n` n'est pas rassurant par construction. `0/0` satisfait
   *   « tout est au vert » sans avoir rien vérifié. *Une addition ne distingue
   *   pas ce qui est réussi de ce qui n'a pas été tenté.*
   */
  const sansScore = bilan.filter((b) => !b.score || b.score.total === 0);
  if (sansScore.length > 0) {
    limites.push(
      `${sansScore.length} suite(s) n’ont rendu AUCUNE vérification, donc ne pèsent rien dans\n` +
        `      le total : ${sansScore.map((b) => b.script).join(', ')}.\n` +
        '      Un compteur à zéro se fond dans l’addition : la couverture manque sans\n' +
        '      que le total ne baisse d’une unité.'
    );
  }

  /*
   * LA MÉMOIRE AU MOMENT DU BILAN. Sous le seuil, toute assertion de DURÉE a
   * mesuré la machine ; le reste de la campagne garde sa valeur. La distinction
   * compte : jeter un total entier pour cette raison serait aussi faux que de
   * le croire sans réserve.
   */
  const memoireFinGo = freemem() / 1e9;
  if (memoireFinGo < SEUIL_MEMOIRE_GO) {
    limites.push(
      `les assertions de DURÉE ne valent rien pour ce lancement : ${memoireFinGo.toFixed(2)} Go de\n` +
        `      mémoire libre en fin de campagne, sous le seuil de ${SEUIL_MEMOIRE_GO} Go. Les suites\n` +
        '      navigateur ont chronométré la machine. Le reste des vérifications tient.'
    );
  }

  /*
   * LES SUITES ABSENTES DE CE LANCEMENT, par filtre d'arguments ou autrement.
   * Un total partiel présenté comme un total est exactement le piège qu'on
   * cherche à fermer.
   */
  if (bilan.length < SUITES.length) {
    const lancees = new Set(bilan.map((b) => b.script));
    const absentes = SUITES.filter((s) => !lancees.has(s.script)).map((s) => s.script);
    limites.push(
      `${absentes.length} suite(s) sur ${SUITES.length} N’ONT PAS ÉTÉ LANCÉES : ${absentes.join(', ')}.\n` +
        '      Ce total est donc partiel.'
    );
  }

  console.log('\n  CE QUE CE TOTAL NE COUVRE PAS :');
  for (const limite of limites) console.log(`    • ${limite}`);

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
