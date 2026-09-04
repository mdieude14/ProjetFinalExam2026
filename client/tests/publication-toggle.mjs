/**
 * ===========================================================================
 *  BASCULE DU COMPOSITEUR — MODULE 5.9, PARCOURS NAVIGATEUR
 * ===========================================================================
 *
 *   npm run test:publication-toggle
 *
 * Prérequis : l'API (port 5000) et Vite (port 5173) doivent tourner.
 *
 * CE QUE CETTE SUITE PROTÈGE.
 *
 * La demande d'origine était « cliquer sur le formulaire ouvert le referme ».
 * Appliquée telle quelle, elle rend le formulaire inutilisable : cliquer dans
 * la zone de texte pour écrire le fermerait aussi. La bascule est donc portée
 * par le bouton, et **la vérification centrale de cette suite est qu'écrire
 * dans le formulaire ne le referme pas**. Sans elle, une « simplification »
 * ultérieure — rendre toute la surface cliquable — casserait la publication
 * sans qu'aucun autre test ne bronche.
 *
 * Deux autres garanties, invisibles dans une réponse HTTP :
 *
 *   - LE FORMULAIRE REPLIÉ EST `inert`. Il reste dans le DOM pour pouvoir
 *     s'animer ; sans `inert`, on tabulerait au clavier dans un formulaire
 *     invisible. Seul un test qui tente réellement le focus le montre.
 *
 *   - LE DÉPLIEMENT EST ANIMÉ. Mesuré à mi-course : une hauteur intermédiaire
 *     prouve la transition. Une capture d'écran ne distinguerait pas un
 *     dépliement animé d'un affichage instantané.
 *
 * Le compte créé ici est supprimé à la fin — et au démarrage.
 * ===========================================================================
 */

import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const BASE = process.env.CLIENT_URL || 'http://localhost:5173';
const API = 'http://localhost:5000/api';
const DOM = '@toggle.local';
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

process.on('uncaughtException', (e) => { afficher(e.message); process.exit(1); });
process.on('unhandledRejection', (e) => { afficher(e?.message || e); process.exit(1); });

/* ------------------------- Accès direct à la base ------------------------ */

const requireServeur = createRequire(new URL('../../server/package.json', import.meta.url));
const { MongoClient } = requireServeur('mongodb');

const uriMongo = readFileSync(new URL('../../server/.env', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .find((ligne) => ligne.startsWith('MONGO_URI='))
  .slice('MONGO_URI='.length)
  .trim()
  .replace(/^["']|["']$/g, '');

const clientMongo = new MongoClient(uriMongo, { serverSelectionTimeoutMS: 8000 });
await clientMongo.connect();
const bdd = clientMongo.db();

async function purger() {
  const comptes = await bdd.collection('users')
    .find({ email: /@toggle[.]local$/ }, { projection: { _id: 1 } })
    .toArray();
  const ids = comptes.map((u) => u._id);
  if (ids.length === 0) return 0;
  await bdd.collection('posts').deleteMany({ auteur: { $in: ids } });
  await bdd.collection('users').deleteMany({ _id: { $in: ids } });
  return ids.length;
}

const restes = await purger();
if (restes > 0) {
  console.log(`  (purge d'entrée : ${restes} compte(s) laissés par une exécution précédente)`);
}

/* ================================================================== *
 *  MISE EN PLACE
 * ================================================================== */

section('Mise en place');

const pseudo = `toggle${S}`;
const inscription = await fetch(API + '/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    type: 'utilisateur', nom: 'Tog', prenom: 'Gle', pseudo,
    email: `${pseudo}${DOM}`, password: MDP, ville: 'Lyon',
  }),
});
if (inscription.status !== 201) throw new Error(`création du compte : ${inscription.status}`);
ok('compte de test créé', true);

/* ================================================================== *
 *  NAVIGATEUR
 * ================================================================== */

const navigateur = await chromium.launch();
const erreursJs = [];
const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 950 }, locale: 'fr-FR' });
const page = await contexte.newPage();

page.on('pageerror', (e) => erreursJs.push(e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  // Le 401 sur /auth/refresh au démarrage est la réponse attendue : pas de
  // cookie encore. Écarté nommément, pas par un filtre général sur les 401.
  if ((m.location()?.url || '').includes('/auth/refresh')) return;
  erreursJs.push(m.text());
});

await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
await page.getByLabel('Email ou pseudo').fill(pseudo);
await page.getByLabel('Mot de passe').fill(MDP);
await page.getByRole('button', { name: 'Se connecter' }).click();
await page.waitForURL('**/home', { timeout: 25000 });

/*
 * IDENTIFIANT STABLE, PAS LE LIBELLÉ.
 * Le texte du bouton change justement avec l'état : s'y accrocher ferait
 * échouer la moitié des vérifications pour la mauvaise raison.
 */
const bascule = page.locator('[data-test="bascule-publication"]');
await bascule.waitFor({ state: 'visible', timeout: 15000 });

const zone = page.locator('#formulaire-publication');
const hauteur = () => zone.evaluate((n) => Math.round(n.getBoundingClientRect().height));

/* ------------------------------------------------------------------ */

section('État 0 — formulaire replié');

ok('hauteur nulle au chargement', (await hauteur()) === 0, `${await hauteur()} px`);
ok('aria-expanded = false', (await bascule.getAttribute('aria-expanded')) === 'false');
ok('le bloc est `inert`', await zone.evaluate((n) => n.hasAttribute('inert')));
ok('le champ replié refuse le focus clavier',
  await zone.evaluate((n) => {
    const t = n.querySelector('textarea');
    if (!t) return false;
    t.focus();
    return document.activeElement !== t;
  }));

/* ------------------------------------------------------------------ */

section('Ouverture');

await bascule.click();
await page.waitForTimeout(80);
const miCourse = await hauteur();
await page.waitForTimeout(500);
const ouvert = await hauteur();

ok('le formulaire est déplié', ouvert > 200, `${ouvert} px`);
ok('le dépliement est animé, pas instantané', miCourse > 0 && miCourse < ouvert,
  `${miCourse} px à mi-course, ${ouvert} px à l'arrivée`);
ok('aria-expanded = true', (await bascule.getAttribute('aria-expanded')) === 'true');
ok('le bloc n’est plus `inert`', !(await zone.evaluate((n) => n.hasAttribute('inert'))));
ok('PostForm est affiché',
  await page.getByRole('heading', { name: 'Nouvelle publication' }).isVisible());
ok('le bouton annonce la fermeture',
  /fermer/i.test((await bascule.textContent()) || ''), (await bascule.textContent())?.trim());

/* ------------------------------------------------------------------ */

section('Le piège — la saisie ne doit pas refermer');

const texte = page.locator('#formulaire-publication textarea').first();
await texte.click();
await texte.type('Séance de fractionné 10x400m');
await page.waitForTimeout(300);

ok('**cliquer et écrire dans le formulaire ne le referme pas**',
  (await hauteur()) > 200, `${await hauteur()} px`);
ok('le texte saisi est conservé', (await texte.inputValue()).includes('fractionné'));

/* Un clic sur le titre du formulaire ne doit pas davantage le refermer. */
await page.getByRole('heading', { name: 'Nouvelle publication' }).click();
await page.waitForTimeout(300);
ok('cliquer sur le titre du formulaire ne le referme pas', (await hauteur()) > 200);

/* ------------------------------------------------------------------ */

section('Fermeture');

await bascule.click();
await page.waitForTimeout(500);

ok('le second clic replie le formulaire', (await hauteur()) === 0, `${await hauteur()} px`);
ok('le bouton retrouve son libellé d’invitation',
  /partagez votre séance/i.test((await bascule.textContent()) || ''),
  (await bascule.textContent())?.trim());
ok('le bloc redevient `inert`', await zone.evaluate((n) => n.hasAttribute('inert')));

await bascule.click();
await page.waitForTimeout(500);
ok('le brouillon survit à une fermeture accidentelle',
  (await texte.inputValue()).includes('fractionné'));

/* ------------------------------------------------------------------ */

section('Console');
ok('aucune erreur JavaScript', erreursJs.length === 0, erreursJs.slice(0, 2).join(' | '));

/* ================================================================== *
 *  NETTOYAGE
 * ================================================================== */

await contexte.close();
await navigateur.close();

const supprimes = await purger();
console.log(`\n  (nettoyage : ${supprimes} compte(s) de test supprimé(s))`);
await clientMongo.close();

process.exit(afficher() > 0 ? 1 : 0);
