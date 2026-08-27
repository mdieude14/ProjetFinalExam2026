/**
 * ===========================================================================
 *  PERFORMANCE — CÔTÉ NAVIGATEUR
 * ===========================================================================
 *
 *   npm run test:perf
 *
 * Prérequis : l'API (port 5000) et Vite (port 5173) doivent tourner.
 *
 * CE QUE CETTE SUITE MESURE — ET POURQUOI PAS EN MODE DÉVELOPPEMENT.
 *
 * Les temps de chargement sont mesurés sur le **build de production**, servi
 * par `vite preview`. En développement, Vite transpile chaque module à la
 * demande et en sert des centaines séparément : les chiffres décrivent alors
 * l'outil de développement, pas l'application. Un écran qui met deux secondes
 * en `npm run dev` peut en mettre trois cents millisecondes une fois construit.
 *
 * Trois choses sont vérifiées, et chacune répond à un risque distinct :
 *
 *   1. LE POIDS DU PAQUET. C'est ce que l'utilisateur télécharge avant de
 *      voir quoi que ce soit. Un budget explicite empêche la dérive lente —
 *      une bibliothèque ajoutée par mois, et le premier écran double en un an.
 *
 *   2. LE CLOISONNEMENT DES FRAGMENTS. Leaflet ne doit pas revenir dans le
 *      paquet principal par une porte dérobée : il suffit d'un import anodin
 *      depuis un composant partagé, et les 150 ko reviennent sans que rien ne
 *      le signale. C'est arrivé une fois, via `formaterDistance`.
 *
 *   3. LE TEMPS JUSQU'AU CONTENU. Un écran peut être « chargé » et rester
 *      vide : ce qui compte est le moment où l'utilisateur voit sa liste.
 * ===========================================================================
 */

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(RACINE, 'dist');
const APERCU = 'http://localhost:4173';
const API = 'http://localhost:5000/api';
const DOM = '@perffront.local';
const MDP = 'MotDePasse123';
const S = Date.now();

const resultats = [];
let sectionCourante = '';
const section = (nom) => { sectionCourante = nom; };
const ok = (libelle, condition, detail = '') =>
  resultats.push({ section: sectionCourante, libelle, ok: Boolean(condition), detail });

function afficher(interrompu) {
  let derniere = null;
  for (const r of resultats) {
    if (r.section !== derniere) { console.log(`\n--- ${r.section} ---`); derniere = r.section; }
    console.log(`${r.ok ? 'OK   ' : 'ECHEC'} ${r.libelle}${r.detail ? '  -> ' + r.detail : ''}`);
  }
  const echecs = resultats.filter((r) => !r.ok).length;
  console.log(
    `\n${resultats.length - echecs}/${resultats.length} vérifications réussies` +
      (interrompu ? `\nINTERROMPU : ${interrompu}` : '')
  );
  return echecs;
}

let apercu = null;
const arreter = () => { try { apercu?.kill(); } catch { /* déjà mort */ } };

process.on('uncaughtException', (e) => { arreter(); afficher(e.message); process.exit(1); });
process.on('unhandledRejection', (e) => { arreter(); afficher(e?.message || e); process.exit(1); });

async function appel(chemin, { methode = 'GET', corps, token } = {}) {
  const entetes = {};
  if (token) entetes.Authorization = `Bearer ${token}`;
  if (corps) entetes['Content-Type'] = 'application/json';
  const r = await fetch(API + chemin, {
    method: methode,
    headers: entetes,
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const texte = await r.text();
  return {
    statut: r.status,
    json: (() => { try { return JSON.parse(texte); } catch { return null; } })(),
  };
}

/* ================================================================== *
 *  POIDS DU PAQUET
 * ================================================================== */

section('Poids du paquet construit');

let fichiers;
try {
  fichiers = readdirSync(join(DIST, 'assets'));
} catch {
  console.error(
    '\n  dist/ absent — lancer `npm run build` avant cette suite.\n'
  );
  process.exit(1);
}

/** Poids brut et compressé d'un fragment. */
function peser(nom) {
  const chemin = join(DIST, 'assets', nom);
  const contenu = readFileSync(chemin);
  return {
    brut: statSync(chemin).size,
    gzip: gzipSync(contenu).length,
    contenu: contenu.toString('utf8'),
  };
}

const principal = fichiers.find((f) => f.startsWith('index-') && f.endsWith('.js'));
ok('un paquet principal est produit', Boolean(principal), principal || 'introuvable');

const poidsPrincipal = peser(principal);
const KO = (o) => `${Math.round(o / 1024)} ko`;

/*
 * BUDGET : 150 ko compressés pour le paquet principal.
 *
 * Le chiffre n'est pas une norme : c'est la valeur actuelle (environ 103 ko)
 * plus une marge de croissance raisonnable. Il attrape l'ajout d'une grosse
 * bibliothèque sans gêner l'évolution normale du code.
 */
ok('**le paquet principal reste sous 150 ko compressés**',
  poidsPrincipal.gzip < 150 * 1024,
  `${KO(poidsPrincipal.brut)} brut · ${KO(poidsPrincipal.gzip)} gzip`);

/*
 * LE CLOISONNEMENT, ET POURQUOI IL SE VÉRIFIE PAR UNE RECHERCHE DE TEXTE.
 *
 * Aucun outil ne signale qu'une bibliothèque est revenue dans le paquet
 * principal : la compilation réussit, la page fonctionne, seul le poids
 * change. Chercher le nom de la bibliothèque dans le fragment produit est
 * grossier, mais c'est la vérification qui a effectivement attrapé le défaut
 * — un import de `formaterDistance` depuis un composant `react-leaflet`
 * ramenait 150 ko de cartographie dans tous les écrans.
 */
ok('**Leaflet est absent du paquet principal**',
  !/leaflet/i.test(poidsPrincipal.contenu),
  'chargé à la demande, sur les trois écrans qui l’utilisent');

const fragmentCarte = fichiers.find(
  (f) => f.endsWith('.js') && /leaflet/i.test(readFileSync(join(DIST, 'assets', f), 'utf8'))
);
ok('mais bien présent dans un fragment séparé', Boolean(fragmentCarte),
  fragmentCarte || 'introuvable');

/*
 * SOCKET.IO, LUI, A SA PLACE DANS LE PRINCIPAL — et le vérifier évite qu'on
 * « corrige » un jour ce qui n'est pas un défaut. Il se connecte sur toutes
 * les pages, pour les pastilles de messages et de notifications : le sortir
 * ajouterait un aller-retour avant que le compteur puisse s'afficher.
 */
ok('Socket.io est dans le principal, et c’est voulu',
  /socket\.io|engine\.io/i.test(poidsPrincipal.contenu),
  'il sert les pastilles sur tous les écrans');

const totalJs = fichiers
  .filter((f) => f.endsWith('.js'))
  .reduce((somme, f) => somme + peser(f).gzip, 0);

ok('l’ensemble des fragments tient sous 300 ko compressés',
  totalJs < 300 * 1024, KO(totalJs));

/* ================================================================== *
 *  APERÇU DE PRODUCTION
 * ================================================================== */

section('Temps de chargement — build de production');

/*
 * ON SERT LE BUILD, PAS LE SERVEUR DE DÉVELOPPEMENT.
 * `vite preview` sert exactement ce qui partirait en production, avec le même
 * découpage en fragments. Mesurer `npm run dev` décrirait la transpilation à
 * la demande, qui n'existe pas chez l'utilisateur.
 */
apercu = spawn('npm run preview -- --port 4173', {
  cwd: RACINE,
  shell: true,
  stdio: 'ignore',
});

// L'aperçu met un instant à ouvrir son port.
let pret = false;
for (let essai = 0; essai < 30; essai++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const r = await fetch(APERCU, { signal: AbortSignal.timeout(2000) });
    if (r.ok) { pret = true; break; }
  } catch { /* pas encore */ }
}

ok('l’aperçu de production démarre', pret, APERCU);

if (!pret) {
  arreter();
  console.log('\n============ PERFORMANCE — NAVIGATEUR ============');
  const echecs = afficher('aperçu de production injoignable');
  process.exit(echecs > 0 ? 1 : 0);
}

/* ---------------------------- Un compte ---------------------------- */

const pseudo = `perff${S}`;
const compte = await appel('/auth/register', {
  methode: 'POST',
  corps: {
    type: 'utilisateur', nom: 'PerfF', prenom: 'Alice', pseudo,
    email: `${pseudo}${DOM}`, password: MDP, ville: 'Lyon',
  },
});
ok('compte de mesure créé', compte.statut === 201);

/* ---------------------------- Mesures ---------------------------- */

const navigateur = await chromium.launch();
const contexte = await navigateur.newContext({
  viewport: { width: 1280, height: 950 },
  locale: 'fr-FR',
});
const page = await contexte.newPage();

/*
 * L'APERÇU NE PROXIFIE PAS `/api` — c'est un serveur de fichiers statiques.
 * On redirige donc les appels d'API vers le port 5000, exactement ce que
 * ferait `VITE_API_URL` en production.
 */
await page.route('**/api/**', (route) => {
  const url = new URL(route.request().url());
  route.continue({ url: `http://localhost:5000${url.pathname}${url.search}` });
});

/** Mesure le temps jusqu'à ce qu'un repère visible apparaisse. */
async function mesurerEcran(chemin, repere) {
  const debut = performance.now();
  await page.goto(APERCU + chemin, { waitUntil: 'domcontentloaded' });
  await repere(page);
  return Math.round(performance.now() - debut);
}

const tempsLogin = await mesurerEcran('/login', (p) =>
  p.getByRole('button', { name: 'Se connecter' }).waitFor({ state: 'visible', timeout: 20000 })
);

/*
 * BUDGET LARGE, POUR LA MÊME RAISON QUE CÔTÉ API : il attrape une régression
 * d'un ordre de grandeur, pas les variations d'une machine chargée par les
 * suites précédentes.
 */
ok('**le premier écran s’affiche sous 4 s**', tempsLogin < 4000, `${tempsLogin} ms`);

const metriques = await page.evaluate(() => {
  const n = performance.getEntriesByType('navigation')[0];
  const peinture = performance.getEntriesByName('first-contentful-paint')[0];
  return {
    domInteractif: n ? Math.round(n.domInteractive) : null,
    premierePeinture: peinture ? Math.round(peinture.startTime) : null,
    transfere: n ? n.transferSize : null,
  };
});

ok('la première peinture intervient sous 2,5 s',
  metriques.premierePeinture === null || metriques.premierePeinture < 2500,
  `${metriques.premierePeinture} ms`);

/* ------------------------- Écran connecté ------------------------- */

await page.getByLabel('Email ou pseudo').fill(pseudo);
await page.getByLabel('Mot de passe').fill(MDP);

const debutConnexion = performance.now();
await page.getByRole('button', { name: 'Se connecter' }).click();
await page.waitForURL('**/home', { timeout: 25000 });
await page.waitForSelector('nav[aria-label="Navigation principale"] a', { timeout: 15000 });
const tempsConnexion = Math.round(performance.now() - debutConnexion);

ok('**la connexion aboutit sous 5 s**', tempsConnexion < 5000, `${tempsConnexion} ms`);

/*
 * NAVIGATION INTERNE : elle ne recharge rien, elle doit donc être bien plus
 * rapide qu'un premier chargement. Un écran lent ici trahit une requête
 * bloquante au montage, pas un problème de réseau.
 */
const ecrans = [
  { chemin: '/recherche', repere: (p) => p.getByRole('combobox', { name: 'Rechercher' }).waitFor({ timeout: 15000 }) },
  { chemin: '/notifications', repere: (p) => p.getByRole('heading', { name: 'Notifications' }).waitFor({ timeout: 15000 }) },
  { chemin: '/messages', repere: (p) => p.getByRole('heading', { name: 'Messages' }).waitFor({ timeout: 15000 }) },
];

for (const ecran of ecrans) {
  const debut = performance.now();
  await page.goto(APERCU + ecran.chemin, { waitUntil: 'domcontentloaded' });
  await ecran.repere(page);
  const temps = Math.round(performance.now() - debut);

  ok(`${ecran.chemin} affiché sous 4 s`, temps < 4000, `${temps} ms`);
}

/*
 * L'ÉCRAN CARTOGRAPHIQUE PAIE SON FRAGMENT SÉPARÉ : il télécharge Leaflet au
 * moment où l'on y navigue. C'est le prix assumé du cloisonnement, et on le
 * mesure pour savoir ce qu'il coûte réellement.
 */
const debutCarte = performance.now();
await page.goto(APERCU + '/carte', { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: /Coachs près de chez vous/ }).waitFor({ timeout: 20000 });
const tempsCarte = Math.round(performance.now() - debutCarte);

ok('la carte, qui charge Leaflet à la demande, s’affiche sous 6 s',
  tempsCarte < 6000, `${tempsCarte} ms`);

await navigateur.close();
arreter();

/* ------------------------------ Nettoyage ------------------------------ */

const { createRequire } = await import('node:module');
const requireServeur = createRequire(new URL('../../server/package.json', import.meta.url));
const { MongoClient } = requireServeur('mongodb');

const uriMongo = readFileSync(new URL('../../server/.env', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .find((l) => l.startsWith('MONGO_URI='))
  .slice('MONGO_URI='.length)
  .trim()
  .replace(/^["']|["']$/g, '');

const clientMongo = new MongoClient(uriMongo, { serverSelectionTimeoutMS: 8000 });
await clientMongo.connect();
const supprimes = await clientMongo
  .db()
  .collection('users')
  .deleteMany({ email: /@perffront[.]local$/ });
await clientMongo.close();

console.log('\n============ PERFORMANCE — NAVIGATEUR ============');
const echecs = afficher();
console.log(`\n  (${supprimes.deletedCount} compte(s) de test supprimés)`);
process.exit(echecs > 0 ? 1 : 0);
