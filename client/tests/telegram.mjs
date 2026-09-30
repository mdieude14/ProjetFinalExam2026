/**
 * ===========================================================================
 *  PARAMÈTRES — RATTACHER SA CONVERSATION TELEGRAM (module 15)
 * ===========================================================================
 *
 *   npm run test:telegram
 *
 * Le parcours complet, tel que la personne le vit : elle génère un code dans
 * les Paramètres, l'envoie au bot — ici simulé par l'appel exact que fait
 * n8n — et voit la page confirmer d'elle-même, sans recharger.
 *
 * CE QUI EST VÉRIFIÉ AU-DELÀ DU PARCOURS :
 *   - l'identifiant de la conversation n'apparaît jamais à l'écran ;
 *   - le sondage S'ARRÊTE quand on quitte la page — sinon chaque visite des
 *     Paramètres laisserait des appels tourner en arrière-plan ;
 *   - le lien vers le bot s'ouvre dans un nouvel onglet, sans `opener` ;
 *   - rien ne déborde sur un écran de téléphone.
 * ===========================================================================
 */

import { chromium, selectors } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

selectors.setTestIdAttribute('data-test');

const BASE = process.env.CLIENT_URL || 'http://localhost:5173';
const API = 'http://localhost:5000/api';
const DOM = '@telegramfront.local';
const MDP = 'MotDePasse123';
const S = Date.now();
const CONVERSATION = '7711000001';

const DOSSIER_CAPTURES = fileURLToPath(new URL('../captures/', import.meta.url));
mkdirSync(DOSSIER_CAPTURES, { recursive: true });

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

async function appel(chemin, { methode = 'GET', corps, token, cleService } = {}) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (cleService) h['x-service-key'] = cleService;
  if (corps) h['Content-Type'] = 'application/json';
  const r = await fetch(API + chemin, { method: methode, headers: h, body: corps ? JSON.stringify(corps) : undefined });
  const t = await r.text();
  return { statut: r.status, json: (() => { try { return JSON.parse(t); } catch { return null; } })() };
}

async function seConnecter(page, pseudo) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email ou pseudo').fill(pseudo);
  await page.getByLabel('Mot de passe').fill(MDP);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL('**/home', { timeout: 25000 });
  await page.waitForSelector('nav[aria-label="Navigation principale"] a', { timeout: 15000 });
}

/* ------------------------------ Base ------------------------------ */

const requireServeur = createRequire(new URL('../../server/package.json', import.meta.url));
const { MongoClient } = requireServeur('mongodb');
const bcrypt = requireServeur('bcryptjs');

const env = readFileSync(new URL('../../server/.env', import.meta.url), 'utf8');
const lireEnv = (cle) => {
  const ligne = env.split(/\r?\n/).find((l) => l.startsWith(`${cle}=`));
  return ligne ? ligne.slice(cle.length + 1).trim().replace(/^["']|["']$/g, '') : null;
};
const CLE_SERVICE = lireEnv('SUPPORT_SERVICE_KEY');

const clientMongo = new MongoClient(lireEnv('MONGO_URI'), { serverSelectionTimeoutMS: 8000 });
await clientMongo.connect();
const bdd = clientMongo.db();

async function purger() {
  const r = await bdd.collection('users').deleteMany({ email: /@telegramfront[.]local$/ });
  return r.deletedCount;
}
await purger();

/*
 * UN COMPTE ADMINISTRATEUR, car l'encart des Paramètres ne s'affiche que pour
 * eux : le bot Telegram est la console de l'exploitant. Le type étant immuable,
 * il s'insère en base, comme dans la suite du support.
 */
const pseudo = `tgfront${S}`;
await bdd.collection('users').insertOne({
  type: 'admin', prenom: 'Front', nom: 'Telegram', pseudo, email: `${pseudo}${DOM}`,
  password: bcrypt.hashSync(MDP, 12), isActive: true, createdAt: new Date(), updatedAt: new Date(),
});

const navigateur = await chromium.launch();

try {
  const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await contexte.newPage();
  await seConnecter(page, pseudo);

  /* ================================================================ */
  section('L’encart dans les Paramètres');

  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  const titre = page.getByRole('heading', { name: 'Assistant sur Telegram' });
  await titre.waitFor({ state: 'visible', timeout: 15000 });
  ok('la section « Assistant sur Telegram » est présente', await titre.isVisible());

  const encart = page.getByTestId('rattachement-telegram');
  await encart.getByRole('button', { name: 'Générer un code' }).waitFor({ state: 'visible', timeout: 10000 });
  ok('un compte neuf se voit proposer de générer un code',
    await encart.getByRole('button', { name: 'Générer un code' }).isVisible());

  const lienBot = encart.getByRole('link', { name: '@coachconnect_support_bot' });
  ok('le nom du bot vient de la configuration, et mène à Telegram',
    (await lienBot.getAttribute('href')) === 'https://t.me/coachconnect_support_bot');
  ok('**il s’ouvre dans un nouvel onglet, sans `opener`**',
    (await lienBot.getAttribute('target')) === '_blank' &&
    (await lienBot.getAttribute('rel'))?.includes('noopener'));

  /* ================================================================ */
  section('Générer un code');

  await encart.getByRole('button', { name: 'Générer un code' }).click();
  const commande = encart.getByTestId('commande-lier');
  await commande.waitFor({ state: 'visible', timeout: 10000 });
  const texteCommande = (await commande.textContent()).trim();
  const code = texteCommande.replace(/^\/lier\s+/, '');

  ok('la commande exacte à envoyer s’affiche', /^\/lier [A-Z2-9]{8}$/.test(texteCommande), texteCommande);
  ok('avec un compte à rebours de dix minutes',
    /Valable encore (9|10) min/.test(await encart.textContent()));
  ok('un bouton permet de la copier', await encart.getByRole('button', { name: 'Copier' }).isVisible());

  /* ================================================================ */
  section('Le bot reçoit le code — la page se met à jour seule');

  // L'appel exact que fait le workflow n8n quand la personne envoie /lier.
  const lien = await appel('/support/service/telegram/lier', {
    methode: 'POST', cleService: CLE_SERVICE, corps: { code, conversation: CONVERSATION },
  });
  ok('le code lu à l’écran est accepté par l’API', lien.statut === 200, `statut ${lien.statut}`);

  const confirmation = encart.getByText('C’est fait : votre conversation Telegram est rattachée.');
  const t0 = Date.now();
  await confirmation.waitFor({ state: 'visible', timeout: 15000 });
  ok('**la page confirme d’elle-même, sans rechargement**', await confirmation.isVisible(),
    `${Math.round((Date.now() - t0) / 100) / 10} s`);
  ok('et propose de délier', await encart.getByRole('button', { name: 'Délier la conversation' }).isVisible());
  ok('en disant ce que le bot peut lire — et ce qu’il ne lit jamais',
    (await encart.textContent()).includes('jamais sur un montant'));
  ok('**l’identifiant de la conversation n’apparaît nulle part**',
    !(await page.content()).includes(CONVERSATION));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await encart.getByRole('button', { name: 'Délier la conversation' }).waitFor({ state: 'visible', timeout: 15000 });
  ok('après rechargement, l’état vient bien de l’API', true);

  /* ================================================================ */
  section('Délier');

  await encart.getByRole('button', { name: 'Délier la conversation' }).click();
  await encart.getByText('n’est plus rattachée').waitFor({ state: 'visible', timeout: 10000 });
  ok('la page confirme', true);
  ok('et repropose un code', await encart.getByRole('button', { name: 'Générer un code' }).isVisible());
  ok('**le bot ne lit plus rien**',
    (await appel(`/support/service/telegram/compte?conversation=${CONVERSATION}`, { cleService: CLE_SERVICE })).statut === 404);

  /* ================================================================ */
  section('Le sondage s’arrête quand on quitte la page');

  await encart.getByRole('button', { name: 'Générer un code' }).click();
  await encart.getByTestId('commande-lier').waitFor({ state: 'visible', timeout: 10000 });

  let appelsAvant = 0;
  let appelsApres = 0;
  let parti = false;
  page.on('request', (req) => {
    if (!/\/api\/support\/telegram$/.test(new URL(req.url()).pathname)) return;
    if (parti) appelsApres += 1; else appelsAvant += 1;
  });

  await page.waitForTimeout(9000);
  ok('tant que le code est affiché, la page interroge l’API', appelsAvant >= 1, `${appelsAvant} appel(s) en 9 s`);

  await page.getByRole('link', { name: 'Accueil' }).first().click();
  await page.waitForURL('**/home', { timeout: 15000 });
  parti = true;
  await page.waitForTimeout(9000);
  ok('**une fois la page quittée, plus aucun appel**', appelsApres === 0, `${appelsApres} appel(s) en 9 s`);

  await contexte.close();

  /* ================================================================ */
  section('Téléphone');

  /*
   * CONNEXION EN GRAND ÉCRAN, PUIS PASSAGE AU TÉLÉPHONE. Sur mobile, la
   * navigation principale est rendue autrement, et l'attente de `seConnecter`
   * ne la trouve pas — même méthode que la suite du back-office.
   */
  const mobile = await navigateur.newContext({ viewport: { width: 1280, height: 900 } });
  const ecran = await mobile.newPage();
  await seConnecter(ecran, pseudo);
  await ecran.setViewportSize({ width: 375, height: 800 });
  await ecran.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  const encartMobile = ecran.getByTestId('rattachement-telegram');
  await encartMobile.getByRole('button', { name: 'Générer un code' }).click();
  await encartMobile.getByTestId('commande-lier').waitFor({ state: 'visible', timeout: 10000 });
  await encartMobile.scrollIntoViewIfNeeded();

  const deborde = await ecran.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok('/settings, code affiché, sans débordement en 375 px', !deborde);
  await encartMobile.screenshot({ path: `${DOSSIER_CAPTURES}telegram-rattachement-mobile.png` });
  await mobile.close();
} catch (erreur) {
  ok('le parcours s’exécute sans erreur', false, erreur.message.split('\n')[0]);
} finally {
  await navigateur.close();
  const purges = await purger();
  await clientMongo.close();
  const echecs = afficher();
  console.log(`\n  (${purges} compte(s) de test supprimé(s))`);
  process.exit(echecs > 0 ? 1 : 0);
}
