/**
 * ===========================================================================
 *  NOTIFICATIONS — MODULE 12, PARCOURS NAVIGATEUR
 * ===========================================================================
 *
 *   npm run test:notifications
 *
 * Prérequis : l'API (port 5000) et Vite (port 5173) doivent tourner.
 *
 * CE QUE CETTE SUITE AJOUTE À `server/tests/notifications.mjs`.
 * La suite serveur prouve que les huit sources produisent la bonne
 * notification, chez la bonne personne, sans doublon. Elle ne dit rien de ce
 * que l'utilisateur voit.
 *
 * Or tout l'intérêt du module est là : une notification qu'on ne remarque pas
 * n'existe pas. Trois choses ne se vérifient qu'à l'écran :
 *
 *   - LA PASTILLE MONTE EN DIRECT, depuis n'importe quelle page ;
 *   - LA PHRASE EST LISIBLE — le serveur envoie `inscription_event`, pas une
 *     phrase française ;
 *   - LE LIEN MÈNE QUELQUE PART. Une notification qui ne conduit nulle part
 *     oblige à retrouver soi-même ce dont elle parle, et l'on renonce.
 *
 * Deux navigateurs sont ouverts en même temps : c'est la seule façon de
 * distinguer « arrivée en direct » de « rechargée à l'ouverture ».
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
const DOM = '@notiffront.local';
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

async function appel(chemin, { methode = 'GET', corps, form, token } = {}) {
  const entetes = {};
  if (token) entetes.Authorization = `Bearer ${token}`;
  if (corps) entetes['Content-Type'] = 'application/json';
  const r = await fetch(API + chemin, {
    method: methode,
    headers: entetes,
    body: form || (corps ? JSON.stringify(corps) : undefined),
  });
  const texte = await r.text();
  return {
    statut: r.status,
    texte,
    json: (() => { try { return JSON.parse(texte); } catch { return null; } })(),
  };
}

const png = () =>
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );

function formMedia(champs = {}) {
  const fd = new FormData();
  fd.append('medias', new Blob([png()], { type: 'image/png' }), 'p.png');
  for (const [cle, valeur] of Object.entries(champs)) fd.append(cle, String(valeur));
  return fd;
}

async function inscrire(prefixe, prenom) {
  const pseudo = `${prefixe}${S}`;
  const r = await appel('/auth/register', {
    methode: 'POST',
    corps: {
      type: 'utilisateur', nom: 'NotifF', prenom, pseudo,
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
  await page.waitForSelector('nav[aria-label="Navigation principale"] a', { timeout: 10000 });
}

/**
 * Nombre affiché sur la pastille du lien demandé, ou '' si absente.
 *
 * ON LIT LE LIBELLÉ ACCESSIBLE, PAS LES CHIFFRES DU LIEN.
 * Le lien contient DEUX fois le nombre : une fois dans la pastille visible,
 * une fois dans le texte réservé aux lecteurs d'écran (« — 1 non lu »).
 * Retirer les non-chiffres de tout le lien concaténait les deux et rendait
 * « 11 » pour une seule notification — un échec qui accusait le compteur
 * alors que seul le banc d'essai comptait mal.
 *
 * Le libellé accessible est de surcroît la meilleure cible : c'est lui qui
 * porte le sens, la pastille n'en étant que la traduction visuelle.
 */
async function pastilleDe(page, chemin) {
  const lien = page.locator(
    `nav[aria-label="Navigation principale"] a[href="${chemin}"]`
  ).first();

  const texte = (await lien.textContent().catch(() => '')) || '';
  const correspondance = /(\d+)\s*non\s*lu/.exec(texte);

  return correspondance ? correspondance[1] : '';
}

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

const motifTest = /@notiffront[.]local$/;

async function purger() {
  const comptes = await bdd.collection('users')
    .find({ email: motifTest }, { projection: { _id: 1 } })
    .toArray();
  const ids = comptes.map((u) => u._id);
  if (ids.length === 0) return 0;

  const convs = await bdd.collection('conversations')
    .find({ participants: { $in: ids } }, { projection: { _id: 1 } })
    .toArray();

  await bdd.collection('notifications').deleteMany({
    $or: [{ destinataire: { $in: ids } }, { emetteur: { $in: ids } }],
  });
  await bdd.collection('messages').deleteMany({ conversation: { $in: convs.map((c) => c._id) } });
  await bdd.collection('conversations').deleteMany({ participants: { $in: ids } });
  await bdd.collection('comments').deleteMany({ auteur: { $in: ids } });
  await bdd.collection('posts').deleteMany({ auteur: { $in: ids } });
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

const alice = await inscrire('nfalice', 'Alice');
const bob = await inscrire('nfbob', 'Bob');

ok('deux comptes inscrits', Boolean(alice.token && bob.token));

const post = await appel('/posts', {
  methode: 'POST', token: alice.token,
  form: formMedia({ titre: `Seance ${S}`, description: 'Entrainement du jour' }),
});
ok('publication créée', post.statut === 201, post.json?.message);
const idPost = post.json?.post?._id;

/* ================================================================== *
 *  DEUX NAVIGATEURS
 * ================================================================== */

const navigateur = await chromium.launch();
const erreursJs = [];

const ctxAlice = await navigateur.newContext({ viewport: { width: 1280, height: 950 }, locale: 'fr-FR' });
const ctxBob = await navigateur.newContext({ viewport: { width: 1280, height: 950 }, locale: 'fr-FR' });

const pageAlice = await ctxAlice.newPage();
const pageBob = await ctxBob.newPage();

for (const page of [pageAlice, pageBob]) {
  page.on('pageerror', (e) => erreursJs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') erreursJs.push(m.text()); });
}

await seConnecter(pageAlice, alice.pseudo);
await seConnecter(pageBob, bob.pseudo);

/* ------------------------- Navigation ------------------------- */

section('Accès aux notifications');

const lienNotifs = pageAlice.locator(
  'nav[aria-label="Navigation principale"] a[href="/notifications"]'
);
ok('**entrée « Notifications » présente dans la navigation**',
  (await lienNotifs.count()) === 1);

ok('aucune pastille au départ', (await pastilleDe(pageAlice, '/notifications')) === '');

await lienNotifs.click();
await pageAlice.waitForURL('**/notifications', { timeout: 15000 });
await pageAlice.waitForTimeout(1800);

ok('la page s’ouvre', pageAlice.url().includes('/notifications'));
ok('**une liste vide explique à quoi sert l’écran**',
  (await pageAlice.getByText(/Aucune notification pour le moment/).count()) === 1);
ok('les deux onglets sont proposés',
  (await pageAlice.getByRole('button', { name: 'Toutes', exact: true }).count()) === 1 &&
    (await pageAlice.getByRole('button', { name: 'Non lues', exact: true }).count()) === 1);

/* ================================================================== *
 *  ARRIVÉE EN DIRECT
 * ================================================================== */

section('Réception en direct');

// Alice reste sur une AUTRE page : la pastille doit monter là aussi.
await pageAlice.goto(BASE + '/home', { waitUntil: 'domcontentloaded' });
await pageAlice.waitForTimeout(1500);

// Bob aime la publication d'Alice, depuis l'API — le geste importe peu, c'est
// l'arrivée côté Alice qu'on observe.
await appel(`/posts/${idPost}/like`, { methode: 'POST', token: bob.token });

let pastilleVue = '';
for (let essai = 0; essai < 14; essai++) {
  await pageAlice.waitForTimeout(600);
  pastilleVue = await pastilleDe(pageAlice, '/notifications');
  if (pastilleVue) break;
}

ok('**la pastille monte en direct, depuis une autre page**',
  pastilleVue === '1', `pastille « ${pastilleVue} »`);

// Un commentaire : la pastille doit passer à 2.
await appel(`/posts/${idPost}/comments`, {
  methode: 'POST', token: bob.token, corps: { texte: 'Belle seance !' },
});

let pastilleDeux = '';
for (let essai = 0; essai < 14; essai++) {
  await pageAlice.waitForTimeout(600);
  pastilleDeux = await pastilleDe(pageAlice, '/notifications');
  if (pastilleDeux === '2') break;
}
ok('**et s’incrémente à chaque nouvelle notification**', pastilleDeux === '2',
  `pastille « ${pastilleDeux} »`);

await pageAlice.screenshot({ path: DOSSIER_CAPTURES + '/notifications-pastille.png' });

/* ================================================================== *
 *  LISIBILITÉ
 * ================================================================== */

section('Lisibilité des notifications');

await pageAlice.goto(BASE + '/notifications', { waitUntil: 'domcontentloaded' });
await pageAlice.waitForTimeout(2000);

const liste = pageAlice.getByTestId('liste-notifications');
await liste.waitFor({ state: 'visible', timeout: 10000 });

const contenu = await pageAlice.content();

ok('**le type est traduit en phrase française**',
  contenu.includes('a aimé votre publication'),
  'et non « like »');
ok('le commentaire aussi', contenu.includes('a commenté votre publication'));
ok('**le nom de l’émetteur est affiché**', contenu.includes('Bob NotifF'));
ok('une ancienneté est indiquée', /à l’instant|\d+ min/.test(contenu));

const nonLuesVisibles = await liste.locator('li.bg-marque-50\\/60').count();
ok('**les non lues se distinguent visuellement**', nonLuesVisibles === 2,
  `${nonLuesVisibles} ligne(s) mise(s) en avant`);

await pageAlice.screenshot({ path: DOSSIER_CAPTURES + '/notifications-liste.png' });

/* ================================================================== *
 *  LECTURE
 * ================================================================== */

section('Marquer comme lu');

const boutonsLire = pageAlice.getByRole('button', { name: 'Marquer comme lue' });
ok('chaque non lue propose « marquer comme lue »',
  (await boutonsLire.count()) === 2, `${await boutonsLire.count()}`);

await boutonsLire.first().click();
await pageAlice.waitForTimeout(2000);

ok('**la pastille redescend à 1**',
  (await pastilleDe(pageAlice, '/notifications')) === '1',
  await pastilleDe(pageAlice, '/notifications'));

/* ------------------------ Onglet « non lues » ------------------------ */

await pageAlice.getByRole('button', { name: 'Non lues', exact: true }).click();
await pageAlice.waitForTimeout(2000);

const restantes = await pageAlice.getByTestId('liste-notifications').locator('li').count();
ok('**l’onglet « non lues » ne montre que ce qui reste**', restantes === 1,
  `${restantes} ligne(s)`);

await pageAlice.getByRole('button', { name: 'Toutes', exact: true }).click();
await pageAlice.waitForTimeout(1800);

/* ------------------------ Tout marquer comme lu ------------------------ */

const toutLire = pageAlice.getByRole('button', { name: 'Tout marquer comme lu' });
ok('le bouton « tout marquer comme lu » est proposé', (await toutLire.count()) === 1);

/*
 * ARRIVER SUR LA PAGE NE VAUT PAS LECTURE, et c'est un choix.
 * Une liste de vingt notifications ne se lit pas d'un regard : tout marquer
 * a l'arrivee ferait disparaitre le repere de ce qui restait a voir. Le
 * bouton est explicite, et c'est l'utilisateur qui decide.
 */
ok('**arriver sur la page n’a pas tout marqué lu tout seul**',
  (await pastilleDe(pageAlice, '/notifications')) === '1');

await toutLire.click();
await pageAlice.waitForTimeout(2500);

ok('**la pastille disparaît**', (await pastilleDe(pageAlice, '/notifications')) === '',
  await pastilleDe(pageAlice, '/notifications'));

ok('le bouton disparaît lui aussi, n’ayant plus d’objet',
  (await pageAlice.getByRole('button', { name: 'Tout marquer comme lu' }).count()) === 0);

/* ================================================================== *
 *  LE LIEN MÈNE QUELQUE PART
 * ================================================================== */

section('Destination des notifications');

// Bob envoie une demande de conversation : elle doit mener à la messagerie.
const conv = await appel('/messages/conversations', {
  methode: 'POST', token: bob.token, corps: { destinataire: alice.id },
});
await appel(`/messages/conversations/${conv.json.conversation._id}/messages`, {
  methode: 'POST', token: bob.token, corps: { contenu: 'Bonjour Alice' },
});

await pageAlice.goto(BASE + '/notifications', { waitUntil: 'domcontentloaded' });
await pageAlice.waitForTimeout(2500);

ok('**la demande de conversation est annoncée comme telle**',
  (await pageAlice.getByText('souhaite vous écrire').count()) === 1,
  'et non « vous a envoyé un message »');

const lienMessagerie = pageAlice.locator('a[href^="/messages?c="]').first();
ok('elle porte un lien vers la conversation', (await lienMessagerie.count()) === 1);

await lienMessagerie.click();
await pageAlice.waitForURL('**/messages**', { timeout: 15000 });
await pageAlice.waitForTimeout(2000);

ok('**le clic mène directement à la bonne conversation**',
  pageAlice.url().includes('/messages?c='), pageAlice.url().split('?')[1]);

ok('et la notification a été marquée lue au passage',
  (await pastilleDe(pageAlice, '/notifications')) === '');

/* ================================================================== *
 *  SUPPRESSION
 * ================================================================== */

section('Suppression');

await pageAlice.goto(BASE + '/notifications', { waitUntil: 'domcontentloaded' });
await pageAlice.waitForTimeout(2000);

const avant = await pageAlice.getByTestId('liste-notifications').locator('li').count();
await pageAlice.getByRole('button', { name: 'Supprimer cette notification' }).first().click();
await pageAlice.waitForTimeout(2000);

const apres = await pageAlice.getByTestId('liste-notifications').locator('li').count();
ok('**supprimer retire la ligne**', apres === avant - 1, `${avant} → ${apres}`);

await pageAlice.reload({ waitUntil: 'domcontentloaded' });
await pageAlice.waitForTimeout(2000);
const apresRechargement = await pageAlice
  .getByTestId('liste-notifications')
  .locator('li')
  .count();
ok('**et elle ne revient pas au rechargement**', apresRechargement === apres,
  `${apresRechargement}`);

/* ================================================================== *
 *  CLOISONNEMENT
 * ================================================================== */

section('Cloisonnement');

await pageBob.goto(BASE + '/notifications', { waitUntil: 'domcontentloaded' });
await pageBob.waitForTimeout(2000);

const contenuBob = await pageBob.content();
ok('**Bob ne voit pas les notifications d’Alice**',
  !contenuBob.includes('a aimé votre publication'));
ok('sa liste à lui est vide',
  (await pageBob.getByText(/Aucune notification pour le moment/).count()) === 1);

/* ================================================================== *
 *  RESPONSIVE ET CONSOLE
 * ================================================================== */

section('Responsive et console');

for (const largeur of [375, 768]) {
  await pageAlice.setViewportSize({ width: largeur, height: 900 });
  await pageAlice.waitForTimeout(1200);
  const deborde = await pageAlice.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  ok(`/notifications sans débordement en ${largeur} px`, !deborde);
}

await pageAlice.setViewportSize({ width: 375, height: 900 });
await pageAlice.waitForTimeout(800);
await pageAlice.screenshot({ path: DOSSIER_CAPTURES + '/notifications-mobile.png' });

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

console.log('\n========= NOTIFICATIONS — MODULE 12 (front) =========');
const echecs = afficher();
console.log(`\n  (${supprimes} compte(s) de test supprimés, notifications comprises)`);
process.exit(echecs > 0 ? 1 : 0);
