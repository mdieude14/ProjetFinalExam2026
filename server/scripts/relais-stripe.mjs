#!/usr/bin/env node
/**
 * ===========================================================================
 *  RELAIS STRIPE — une commande, et le secret de signature est à jour
 * ===========================================================================
 *
 *   npm run relais:stripe          depuis server/
 *
 * POURQUOI CE SCRIPT EXISTE, ET CE QU'IL A DÉJÀ COÛTÉ DE NE PAS L'AVOIR.
 *
 * Le webhook Stripe ne peut pas joindre `localhost` : en développement, on
 * passe par `stripe listen`, qui relaie les événements vers l'API locale et
 * annonce un secret de signature. Ce secret doit figurer dans `server/.env`,
 * sans quoi l'API refuse chaque événement et `test:paiement` échoue sans
 * expliquer pourquoi.
 *
 * Fait à la main, ce geste a produit DEUX pannes en deux jours :
 *
 *   1. Le 5 novembre, le secret a été lu sur la sortie STANDARD du relais
 *      alors qu'il s'écrit sur la sortie d'ERREUR. Le motif rendait une
 *      chaîne vide, et cette chaîne vide a été écrite dans le `.env` —
 *      effaçant un secret valable.
 *
 *   2. Le 6 novembre, le relais a été lancé vers `/api/webhooks`, une adresse
 *      INVENTÉE. Chaque événement est reparti en 404, treize assertions de
 *      paiement sont tombées, et il a fallu lire le journal du relais pour
 *      comprendre que le code n'était pas en cause.
 *
 * Ce script fige les deux : l'adresse est écrite une fois pour toutes, et
 * rien n'est écrit dans le `.env` avant d'avoir été VALIDÉ.
 *
 * ---------------------------------------------------------------------------
 *  CE QU'IL REFUSE DE FAIRE
 * ---------------------------------------------------------------------------
 *
 * Il s'arrête net si la clé n'est pas une clé de TEST. Relayer avec une clé
 * de production ferait tomber de vrais paiements dans une base de
 * développement — et la commande serait exactement la même.
 * ===========================================================================
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENV = fileURLToPath(new URL('../.env', import.meta.url));
const SAUVEGARDE = `${ENV}.avant-relais`;

/*
 * L'ADRESSE EXACTE, ÉCRITE UNE FOIS. `webhook.routes.js` déclare
 * `router.post('/stripe')`, et `app.js` monte ce routeur sur `/api/webhooks`
 * derrière `express.raw`. Toute autre adresse rend 404 en silence.
 */
const CIBLE = 'http://localhost:5000/api/webhooks/stripe';

const dire = (texte) => console.log(`[RELAIS] ${texte}`);
const crier = (texte) => console.error(`[RELAIS] ${texte}`);

/* ------------------------------------------------------------------ *
 *  1 — LA CLÉ, ET LE REFUS QUI PROTÈGE
 * ------------------------------------------------------------------ */

if (!existsSync(ENV)) {
  crier(`Fichier introuvable : ${ENV}`);
  process.exit(1);
}

const lireEnv = () => readFileSync(ENV, 'utf8');
const valeurDe = (contenu, cle) =>
  (contenu.match(new RegExp(`^${cle}\\s*=\\s*(.*)$`, 'm'))?.[1] ?? '').trim();

const cle = valeurDe(lireEnv(), 'STRIPE_SECRET_KEY');

if (!cle) {
  crier('STRIPE_SECRET_KEY est absente de server/.env.');
  process.exit(1);
}

if (!cle.startsWith('sk_test')) {
  crier('REFUS : la clé ne commence pas par « sk_test ».');
  crier('Relayer avec une clé de production ferait tomber de vrais paiements');
  crier('dans la base de développement. Rien n’a été lancé.');
  process.exit(1);
}

dire(`Clé de TEST confirmée (${cle.length} caractères).`);
dire(`Cible : ${CIBLE}`);

/* ------------------------------------------------------------------ *
 *  2 — LE RELAIS
 * ------------------------------------------------------------------ */

/*
 * LA CLÉ PASSE PAR L'ENVIRONNEMENT, JAMAIS EN ARGUMENT.
 * Un argument de commande est visible de toute la machine dans la liste des
 * processus — y compris d'un autre utilisateur.
 */
const relais = spawn('stripe', ['listen', '--forward-to', CIBLE], {
  env: { ...process.env, STRIPE_API_KEY: cle },
  shell: true,
});

let secretVu = null;
let secretTraite = false;

/*
 * ON ÉCOUTE LES DEUX SORTIES. Le secret s'écrit sur la sortie d'ERREUR —
 * c'est précisément ce que la version manuelle avait manqué, et ce qui a
 * conduit à écrire une chaîne vide dans le `.env`.
 */
const examiner = (donnees, flux) => {
  const texte = donnees.toString();

  // Le jeton est masqué dans tout ce qu'on réaffiche.
  process[flux === 'err' ? 'stderr' : 'stdout'].write(
    texte.replace(/whsec_[A-Za-z0-9]+/g, 'whsec_•••')
  );

  const trouve = texte.match(/whsec_[A-Za-z0-9]+/);
  if (trouve && !secretTraite) {
    secretVu = trouve[0];
    secretTraite = true;
    synchroniser(secretVu);
  }
};

relais.stdout.on('data', (d) => examiner(d, 'out'));
relais.stderr.on('data', (d) => examiner(d, 'err'));

relais.on('error', (erreur) => {
  crier(`Le relais n’a pas pu démarrer : ${erreur.message}`);
  crier('La CLI Stripe est-elle installée et dans le PATH ?');
  process.exit(1);
});

relais.on('exit', (code) => {
  if (!secretTraite) {
    crier(`Le relais s’est arrêté (code ${code}) sans annoncer de secret.`);
    crier('Le fichier .env est resté INTACT.');
    process.exit(code ?? 1);
  }
  dire(`Relais arrêté (code ${code}).`);
  process.exit(code ?? 0);
});

/* ------------------------------------------------------------------ *
 *  3 — LA SYNCHRONISATION, VALIDÉE AVANT D'ÉCRIRE
 * ------------------------------------------------------------------ */

function synchroniser(secret) {
  /*
   * ON VALIDE AVANT D'ÉCRIRE, ET NON L'INVERSE.
   * Vérifier coûte trois lignes ; restaurer coûte une sauvegarde qu'on n'a
   * pas toujours. Le 5 novembre, l'ordre inverse a effacé un secret valable.
   */
  if (!secret || secret.length < 32) {
    crier(`Secret inexploitable (${secret?.length ?? 0} caractères). .env INTACT.`);
    return;
  }

  const contenu = lireEnv();
  const ancien = valeurDe(contenu, 'STRIPE_WEBHOOK_SECRET');

  if (ancien === secret) {
    dire('Secret inchangé — rien à écrire, le back-end est déjà à jour.');
    dire('Le relais tourne. Ctrl+C pour l’arrêter.');
    return;
  }

  if (!/^STRIPE_WEBHOOK_SECRET\s*=/m.test(contenu)) {
    crier('Aucune ligne STRIPE_WEBHOOK_SECRET dans .env — ajoutez-la d’abord.');
    crier('Rien n’a été écrit.');
    return;
  }

  copyFileSync(ENV, SAUVEGARDE);
  const sortie = contenu.replace(
    /^STRIPE_WEBHOOK_SECRET\s*=.*$/m,
    `STRIPE_WEBHOOK_SECRET=${secret}`
  );

  if (!sortie.includes(`STRIPE_WEBHOOK_SECRET=${secret}`)) {
    crier('La substitution n’a pas pris. .env INTACT.');
    return;
  }

  writeFileSync(ENV, sortie, 'utf8');

  // ON RELIT : écrire sans relire, c'est espérer.
  const relu = valeurDe(lireEnv(), 'STRIPE_WEBHOOK_SECRET');
  if (relu !== secret) {
    crier('ALERTE : la relecture ne correspond pas. Sauvegarde conservée :');
    crier(`  ${SAUVEGARDE}`);
    return;
  }

  /*
   * LA SAUVEGARDE PORTE UN SECRET, ELLE NE RESTE PAS.
   * Le 5 novembre, `server/.env.avant-stripe-listen` n'était pas ignorée par
   * git : un `git add .` l'aurait publiée. La règle `.env.*` couvre
   * désormais la famille, mais le plus sûr reste de ne pas laisser traîner
   * le fichier.
   */
  try {
    unlinkSync(SAUVEGARDE);
  } catch {
    /* la sauvegarde a déjà disparu : rien à faire */
  }

  dire(`Secret mis à jour (${secret.length} caractères) et relu conforme.`);
  dire('');
  dire('⚠️  REDÉMARREZ LE BACK-END : il a lu l’ancien secret au démarrage.');
  dire('');
  dire('Le relais tourne. Ctrl+C pour l’arrêter.');
}

/* ------------------------------------------------------------------ *
 *  4 — L'ARRÊT PROPRE
 * ------------------------------------------------------------------ */

/*
 * SANS CELA, Ctrl+C TUE CE SCRIPT ET LAISSE LE RELAIS VIVANT.
 * Un relais orphelin continue de transmettre les événements, et le suivant
 * échouera en 409 « port déjà utilisé » sans qu'on comprenne d'où il sort.
 */
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    dire('Arrêt demandé — on ferme le relais.');
    relais.kill();
  });
}
