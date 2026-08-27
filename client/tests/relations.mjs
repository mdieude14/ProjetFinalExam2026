/**
 * ===========================================================================
 *  ABONNÉS ET ABONNEMENTS — MODULE 6, PARCOURS NAVIGATEUR
 * ===========================================================================
 *
 *   npm run test:relations
 *
 * Prérequis : l'API (port 5000) et Vite (port 5173) doivent tourner.
 *
 * CE QUE CETTE SUITE VÉRIFIE, ET POURQUOI IL FALLAIT UN NAVIGATEUR.
 *
 * Le défaut signalé était double, et la moitié ne se voyait qu'à l'écran :
 *
 *   « la liste n'affiche pas toutes les personnes »  -> côté serveur, le tri
 *     des comptes inaccessibles s'appliquait après la pagination. Vérifié par
 *     `server/tests/relations.mjs`.
 *
 *   « la liste ne s'actualise pas »  -> côté client. Deux causes distinctes,
 *     invisibles dans une réponse HTTP :
 *
 *       1. CHANGER D'ONGLET laissait la liste précédente affichée pendant
 *          tout le chargement — l'indicateur d'attente ne se montre que sur
 *          une liste vide. On voyait donc les abonnés sous « Abonnements ».
 *
 *       2. LE COMPTEUR DU PROFIL ne bougeait jamais. Retirer un abonné faisait
 *          disparaître sa ligne, et le nombre au-dessus continuait d'annoncer
 *          l'ancien total jusqu'au rechargement de la page.
 *
 * Les comptes créés ici sont supprimés à la fin — et au démarrage.
 * ===========================================================================
 */

import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.CLIENT_URL || 'http://localhost:5173';
const API = 'http://localhost:5000/api';
const DOM = '@relfront.local';
const MDP = 'MotDePasse123';
const S = Date.now();

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

process.on('uncaughtException', (e) => { afficher(e.message); process.exit(1); });
process.on('unhandledRejection', (e) => { afficher(e?.message || e); process.exit(1); });

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
    texte,
    json: (() => { try { return JSON.parse(texte); } catch { return null; } })(),
  };
}

async function inscrire(prefixe, prenom) {
  const pseudo = `${prefixe}${S}`;
  const r = await appel('/auth/register', {
    methode: 'POST',
    corps: {
      type: 'utilisateur', nom: 'RelF', prenom, pseudo,
      email: `${pseudo}${DOM}`, password: MDP, ville: 'Lyon',
    },
  });
  if (r.statut !== 201) throw new Error(`création de ${pseudo} : ${r.statut} ${r.json?.message}`);
  return { token: r.json.accessToken, id: r.json.utilisateur._id, pseudo, prenom };
}

async function seConnecter(page, pseudo) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email ou pseudo').fill(pseudo);
  await page.getByLabel('Mot de passe').fill(MDP);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL('**/home', { timeout: 25000 });
  await page.waitForSelector('nav[aria-label="Navigation principale"] a', { timeout: 15000 });
}

/* ------------------------- Accès direct à la base ------------------------ */

const requireServeur = createRequire(new URL('../../server/package.json', import.meta.url));
const { MongoClient, ObjectId } = requireServeur('mongodb');

const uriMongo = readFileSync(new URL('../../server/.env', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .find((ligne) => ligne.startsWith('MONGO_URI='))
  .slice('MONGO_URI='.length)
  .trim()
  .replace(/^["']|["']$/g, '');

const clientMongo = new MongoClient(uriMongo, { serverSelectionTimeoutMS: 8000 });
await clientMongo.connect();
const bdd = clientMongo.db();

const motifTest = /@relfront[.]local$/;

async function purger() {
  const comptes = await bdd.collection('users')
    .find({ email: motifTest }, { projection: { _id: 1 } })
    .toArray();
  const ids = comptes.map((u) => u._id);
  if (ids.length === 0) return 0;

  await bdd.collection('notifications').deleteMany({
    $or: [{ destinataire: { $in: ids } }, { emetteur: { $in: ids } }],
  });
  await bdd.collection('follows').deleteMany({
    $or: [{ follower: { $in: ids } }, { following: { $in: ids } }],
  });
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

const vedette = await inscrire('rfvedette', 'Vedette');

/*
 * VINGT-CINQ ABONNÉS : au-delà de la page par défaut, pour que la pagination
 * entre réellement en jeu. Trois seront désactivés — c'est le scénario qui
 * produisait « le compteur dit 25, la liste en montre 22 ».
 */
const abonnes = [];
for (let i = 0; i < 25; i++) {
  const compte = await inscrire(`rfab${i}`, `Ab${i}`);
  await appel(`/follows/${vedette.id}`, { methode: 'POST', token: compte.token });
  abonnes.push(compte);
}

// La vedette suit trois personnes, pour distinguer les deux onglets.
for (let i = 0; i < 3; i++) {
  await appel(`/follows/${abonnes[i].id}`, { methode: 'POST', token: vedette.token });
}

ok('25 abonnés et 3 abonnements en place', abonnes.length === 25);

/* Trois abonnés sont désactivés : le compteur devient faux. */
for (let i = 10; i < 13; i++) {
  await bdd.collection('users').updateOne(
    { _id: new ObjectId(abonnes[i].id) },
    { $set: { isActive: false } }
  );
}

/*
 * ET LE COMPTEUR EST FORCÉ À SA VALEUR PÉRIMÉE.
 * Le serveur le recale dès qu'on lit la liste ; sans cette écriture, l'écart
 * serait déjà réparé avant que le navigateur l'affiche, et la vérification
 * passerait pour la mauvaise raison.
 */
await bdd.collection('users').updateOne(
  { _id: new ObjectId(vedette.id) },
  { $set: { 'stats.followersCount': 25 } }
);

/* ================================================================== *
 *  NAVIGATEUR
 * ================================================================== */

const navigateur = await chromium.launch();
const erreursJs = [];

const contexte = await navigateur.newContext({
  viewport: { width: 1280, height: 950 },
  locale: 'fr-FR',
});
const page = await contexte.newPage();
page.on('pageerror', (e) => erreursJs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') erreursJs.push(m.text()); });

/*
 * COMPTEUR DES APPELS À LA LISTE.
 * Il sert à détecter une boucle de rechargement : le rappel qui remonte le
 * total au profil pourrait, mal écrit, relancer le chargement indéfiniment.
 * Aucune réponse HTTP ne le montrerait — seul le NOMBRE d'appels le trahit.
 */
let appelsListe = 0;
page.on('request', (r) => {
  if (/\/api\/follows\/[^/]+\/(abonnes|abonnements)/.test(r.url())) appelsListe += 1;
});

await seConnecter(page, vedette.pseudo);

/* ================================================================== *
 *  LE COMPTEUR ET LA LISTE
 * ================================================================== */

section('Le compteur et la liste concordent');

await page.goto(BASE + `/profile/${vedette.pseudo}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);

const statAbonnes = page.getByRole('button').filter({ hasText: 'Abonnés' }).first();
ok('le profil affiche une statistique « Abonnés »', (await statAbonnes.count()) === 1);

const compteurAvant = ((await statAbonnes.textContent()) || '').replace(/[^\d]/g, '');
ok('il annonce encore 25 (valeur périmée)', compteurAvant === '25', compteurAvant);

appelsListe = 0;
await statAbonnes.click();
await page.waitForTimeout(2500);

const modale = page.getByRole('dialog');
ok('la fenêtre des relations s’ouvre', (await modale.count()) === 1);

const lignes = modale.locator('ul > li');
const nbLignes = await lignes.count();
ok('**la liste ne montre que les 20 premiers actifs**', nbLignes === 20, `${nbLignes} lignes`);

await page.screenshot({ path: DOSSIER_CAPTURES + '/relations-liste.png' });

/*
 * LA VÉRIFICATION QUI PORTE LE DÉFAUT SIGNALÉ.
 * Le compteur du profil doit s'être recalé sur ce que la liste rend vraiment.
 */
const compteurApres = ((await statAbonnes.textContent()) || '').replace(/[^\d]/g, '');
ok('**le compteur du profil se recale sur la liste** (25 → 22)',
  compteurApres === '22', `${compteurAvant} → ${compteurApres}`);

ok('l’onglet actif affiche le total réel',
  (await modale.getByRole('button', { name: /Abonnés/ }).textContent())?.includes('22'),
  await modale.getByRole('button', { name: /Abonnés/ }).textContent());

/* ------------------------- Pas de boucle ------------------------- */

const appelsApresOuverture = appelsListe;
await page.waitForTimeout(3000);

ok('**aucune boucle de rechargement** (le rappel ne relance pas la requête)',
  appelsListe === appelsApresOuverture && appelsListe <= 2,
  `${appelsListe} appel(s) à la liste`);

/* ================================================================== *
 *  CHANGEMENT D'ONGLET
 * ================================================================== */

section('Changement d’onglet');

const pseudoPremierAbonne = (await lignes.first().textContent()) || '';

await modale.getByRole('button', { name: 'Abonnements' }).click();

/*
 * ON REGARDE IMMÉDIATEMENT, PENDANT LE CHARGEMENT.
 * C'est le seul instant où le défaut était visible : la liste précédente
 * restait affichée, l'indicateur d'attente ne se montrant que sur une liste
 * vide. Attendre la fin du chargement le masquerait complètement.
 */
await page.waitForTimeout(120);
const pendantChargement = (await modale.textContent()) || '';

ok('**la liste précédente disparaît pendant le chargement**',
  !pendantChargement.includes(pseudoPremierAbonne.trim().slice(0, 12)) ||
    pendantChargement.includes('Aucun'),
  'plus de données de l’onglet précédent');

await page.waitForTimeout(2500);

const lignesAbonnements = await modale.locator('ul > li').count();
ok('l’onglet « Abonnements » montre les 3 abonnements', lignesAbonnements === 3,
  `${lignesAbonnements} lignes`);

const compteurAbonnements = ((
  await page.getByRole('button').filter({ hasText: 'Abonnements' }).first().textContent()
) || '').replace(/[^\d]/g, '');
ok('le compteur « Abonnements » du profil est juste', compteurAbonnements === '3',
  compteurAbonnements);

await page.screenshot({ path: DOSSIER_CAPTURES + '/relations-abonnements.png' });

/* ================================================================== *
 *  PAGINATION
 * ================================================================== */

section('Voir plus');

await modale.getByRole('button', { name: 'Abonnés' }).click();
await page.waitForTimeout(2500);

const voirPlus = modale.getByRole('button', { name: 'Voir plus' });
ok('un bouton « Voir plus » est proposé', (await voirPlus.count()) === 1);

await voirPlus.click();
await page.waitForTimeout(2500);

const apresVoirPlus = await modale.locator('ul > li').count();
ok('**« Voir plus » complète la liste sans l’effacer**', apresVoirPlus === 22,
  `${apresVoirPlus} lignes`);
ok('le bouton disparaît une fois tout chargé',
  (await modale.getByRole('button', { name: 'Voir plus' }).count()) === 0);

/* ================================================================== *
 *  RETRAIT D'UN ABONNÉ
 * ================================================================== */

section('Retirer un abonné');

const boutonsRetirer = modale.getByRole('button', { name: 'Retirer' });
ok('sur son propre profil, chaque abonné peut être retiré',
  (await boutonsRetirer.count()) > 0, `${await boutonsRetirer.count()} boutons`);

await boutonsRetirer.first().click();
await page.waitForTimeout(2500);

const apresRetrait = await modale.locator('ul > li').count();
ok('la ligne disparaît', apresRetrait === 21, `${apresRetrait} lignes`);

const compteurApresRetrait = ((await statAbonnes.textContent()) || '').replace(/[^\d]/g, '');
ok('**et le compteur du profil suit immédiatement** (22 → 21)',
  compteurApresRetrait === '21', `${compteurApres} → ${compteurApresRetrait}`);

/* ------------------- La correction tient au rechargement ------------------- */

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const compteurRecharge = ((
  await page.getByRole('button').filter({ hasText: 'Abonnés' }).first().textContent()
) || '').replace(/[^\d]/g, '');
ok('**la correction survit au rechargement** (elle vient du serveur)',
  compteurRecharge === '21', compteurRecharge);

/* ================================================================== *
 *  RESPONSIVE ET CONSOLE
 * ================================================================== */

section('Responsive et console');

await page.getByRole('button').filter({ hasText: 'Abonnés' }).first().click();
await page.waitForTimeout(2000);

for (const largeur of [375, 768]) {
  await page.setViewportSize({ width: largeur, height: 900 });
  await page.waitForTimeout(1200);
  const deborde = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  ok(`la fenêtre des relations sans débordement en ${largeur} px`, !deborde);
}

await page.setViewportSize({ width: 375, height: 900 });
await page.waitForTimeout(600);
await page.screenshot({ path: DOSSIER_CAPTURES + '/relations-mobile.png' });

await navigateur.close();

const inattendues = erreursJs.filter(
  (m) => !/401|403|404|409|Failed to load resource|favicon|geolocation|websocket|socket|canceled|abort/i.test(m)
);
ok('aucune erreur JavaScript inattendue', inattendues.length === 0,
  inattendues[0] || 'console propre');

/* ================================================================== *
 *  NETTOYAGE
 * ================================================================== */

const supprimes = await purger();
await clientMongo.close();

console.log('\n======= RELATIONS — MODULE 6 (parcours navigateur) =======');
const echecs = afficher();
console.log(`\n  (${supprimes} compte(s) de test supprimés)`);
process.exit(echecs > 0 ? 1 : 0);
