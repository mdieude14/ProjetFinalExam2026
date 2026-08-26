/**
 * ===========================================================================
 *  ÉCRANS DE MONÉTISATION — MODULE 7
 * ===========================================================================
 *
 *   npm run test:premium
 *
 * Prérequis : l'API (port 5000) et Vite (port 5173) doivent tourner, et le
 * coach de démonstration `coachdemo` être entièrement configuré chez Stripe
 * (`npm run coach-demo` côté serveur).
 *
 * CE QUE CETTE SUITE VÉRIFIE, ET QUE LES AUTRES NE COUVRENT PAS.
 * `test:paiement` valide la chaîne de paiement de bout en bout, mais par
 * l'API : elle ne dit rien du rendu. `test:ui` couvre les parcours des
 * modules 3 à 6, antérieurs à la monétisation. Restent les trois écrans
 * introduits ici, et surtout leurs GARDES DE RÔLE :
 *
 *   /abonnements      tout utilisateur connecté
 *   /coach/premium    coachs seulement — un sportif doit être refoulé
 *   /paiement/succes  retour de Stripe, session requise
 *
 * Le refus de /coach/premium à un sportif est la vérification la plus
 * importante du lot. Ce n'est qu'un confort d'affichage — le serveur refuse
 * de toute façon —, mais un écran de configuration de paiement ouvert à
 * n'importe qui serait déroutant et donnerait une fausse impression de faille.
 *
 * Les comptes créés ici sont supprimés à la fin.
 * ===========================================================================
 */

import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:5173';
const API = 'http://localhost:5000/api';
const MDP = 'MotDePasse123';

const resultats = [];
const ok = (libelle, condition, detail = '') =>
  resultats.push({ libelle, ok: Boolean(condition), detail });

const erreursJs = [];

async function acteur(navigateur, largeur = 1280) {
  const ctx = await navigateur.newContext({ viewport: { width: largeur, height: 950 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => erreursJs.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') erreursJs.push(m.text());
  });
  return page;
}

const visible = (loc, t = 10000) =>
  loc.first().waitFor({ state: 'visible', timeout: t }).then(() => true).catch(() => false);

async function connexion(page, identifiant) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email ou pseudo').fill(identifiant);
  await page.getByLabel('Mot de passe').fill(MDP);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL('**/home', { timeout: 25000 });
}

/* --------- un sportif jetable, cree par l'API --------- */
const S = Date.now();
const pseudoSportif = `ecran${S}`;
await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    type: 'utilisateur', nom: 'Test', prenom: 'Ecran', pseudo: pseudoSportif,
    email: `${pseudoSportif}@ecrans.local`, password: MDP, ville: 'Lyon',
  }),
});

const navigateur = await chromium.launch();

/* ================= 1. /abonnements, cote sportif ================= */

const sportif = await acteur(navigateur);
await connexion(sportif, pseudoSportif);

await sportif.goto(BASE + '/abonnements', { waitUntil: 'domcontentloaded' });
ok('/abonnements accessible à un sportif', !sportif.url().includes('/home'), sportif.url());
ok('titre « Mes abonnements » affiché',
  await visible(sportif.getByRole('heading', { name: 'Mes abonnements' })));
ok('état vide explicite',
  await visible(sportif.getByText(/abonné à aucun coach/i)));

/* L'entree de menu doit exister pour tout le monde. */
await sportif.goto(BASE + '/home', { waitUntil: 'domcontentloaded' });
await sportif.locator('header button, nav button').last().click().catch(() => {});
await sportif.waitForTimeout(600);
ok('entrée de menu « Mes abonnements »',
  await visible(sportif.getByRole('menuitem', { name: 'Mes abonnements' }), 5000));

/* ================= 2. /coach/premium interdit au sportif ================= */

await sportif.goto(BASE + '/coach/premium', { waitUntil: 'domcontentloaded' });
await sportif.waitForTimeout(1200);
ok('**/coach/premium refusé à un sportif**',
  !sportif.url().endsWith('/coach/premium'), sportif.url());

/* ================= 3. /paiement/succes sans paiement ================= */

await sportif.goto(BASE + '/paiement/succes', { waitUntil: 'domcontentloaded' });
ok('/paiement/succes ne renvoie plus 404',
  !(await visible(sportif.getByText(/page introuvable/i), 2500)));
ok('page de retour affichée',
  await visible(sportif.getByText(/Confirmation du paiement|Paiement enregistré/i), 20000));

/* ================= 4. /coach/premium, cote coach ================= */

const coach = await acteur(navigateur);
await connexion(coach, 'coachdemo');

await coach.goto(BASE + '/coach/premium', { waitUntil: 'domcontentloaded' });
ok('/coach/premium accessible au coach', coach.url().endsWith('/coach/premium'), coach.url());
ok('titre « Contenu premium » affiché',
  await visible(coach.getByRole('heading', { name: 'Contenu premium', exact: true }), 20000));
ok('état du compte Stripe affiché',
  await visible(coach.getByText('Compte actif'), 15000));
ok('section tarif présente',
  await visible(coach.getByRole('heading', { name: 'Tarif mensuel' })));
ok('tarif courant affiché en euros',
  await visible(coach.getByText(/19,90/), 10000));
ok('section revenus présente',
  await visible(coach.getByRole('heading', { name: 'Revenus mensuels' })));
ok('commission annoncée',
  await visible(coach.getByText(/Commission \(15/), 10000));

/* Le menu coach doit exposer l'entree. */
await coach.goto(BASE + '/home', { waitUntil: 'domcontentloaded' });
await coach.locator('header button, nav button').last().click().catch(() => {});
await coach.waitForTimeout(600);
ok('entrée de menu « Contenu premium »',
  await visible(coach.getByRole('menuitem', { name: 'Contenu premium' }), 5000));

/* ================= 5. Responsive ================= */

const mobile = await acteur(navigateur, 375);
await connexion(mobile, 'coachdemo');
for (const route of ['/abonnements', '/coach/premium']) {
  await mobile.goto(BASE + route, { waitUntil: 'domcontentloaded' });
  await mobile.waitForTimeout(1500);
  const deborde = await mobile.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  ok(`${route} sans débordement en mobile 375 px`, !deborde);
}

await navigateur.close();

/* ================= Console ================= */

const inattendues = erreursJs.filter(
  (m) => !/401|403|404|Failed to load resource|favicon/i.test(m)
);
ok('aucune erreur JavaScript inattendue',
  inattendues.length === 0,
  inattendues[0] || 'console propre');

/* ---------- Nettoyage des comptes de test ---------- */

// On emprunte le pilote et l'URI au serveur plutôt que de les redéclarer :
// une seule source de vérité pour l'adresse de la base.
const requireServeur = createRequire(new URL('../../server/package.json', import.meta.url));
const { MongoClient } = requireServeur('mongodb');

const uriMongo = readFileSync(new URL('../../server/.env', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .find((ligne) => ligne.startsWith('MONGO_URI='))
  .slice('MONGO_URI='.length)
  .trim()
  .replace(/^["']|["']$/g, '');

const client = new MongoClient(uriMongo, { serverSelectionTimeoutMS: 8000 });
await client.connect();
await client.db().collection('users').deleteMany({ email: /@ecrans[.]local$/ });
await client.close();

console.log('\n========== ÉCRANS DE MONÉTISATION ==========');
for (const r of resultats) {
  console.log(`${r.ok ? 'OK   ' : 'ECHEC'} ${r.libelle}${r.detail ? '  -> ' + r.detail : ''}`);
}
const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications réussies`);
process.exit(echecs ? 1 : 0);
