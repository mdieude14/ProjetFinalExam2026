/**
 * ===========================================================================
 *  PARCOURS DEMANDÉ — MODULES 10 ET 11, DU POINT DE VUE DE L'UTILISATEUR
 * ===========================================================================
 *
 *   npm run test:parcours-10-11
 *
 * Prérequis : l'API (port 5000) et Vite (port 5173) doivent tourner.
 *
 * POURQUOI CETTE SUITE EN PLUS DES DEUX AUTRES.
 * `test:recherche` et `test:messagerie` vérifient les règles, les verrous,
 * la concurrence et la diffusion. Elles ne suivent pas un utilisateur du
 * début à la fin d'une intention.
 *
 * Celle-ci ne fait que cela, et rien d'autre :
 *
 *   MODULE 10   je cherche une personne, et je vois un résultat
 *   MODULE 11   depuis son profil, j'ouvre une conversation ;
 *               je la retrouve dans ma liste ;
 *               je l'ouvre, j'écris, j'envoie ;
 *               le message est là, et il est bien parti.
 *
 * C'est ce parcours-là qui a révélé qu'AUCUN bouton ne permettait d'ouvrir
 * une conversation : tout le module 11 fonctionnait, et restait pourtant
 * inatteignable depuis l'interface. Une suite qui teste les règles ne peut
 * pas voir ce genre de trou — il faut suivre l'intention, pas l'API.
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
const DOM = '@parcours1011.local';
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

async function inscrire(prefixe, prenom, nom) {
  const pseudo = `${prefixe}${S}`;
  const r = await appel('/auth/register', {
    methode: 'POST',
    corps: {
      type: 'utilisateur', nom, prenom, pseudo,
      email: `${pseudo}${DOM}`, password: MDP, ville: 'Lyon',
    },
  });
  if (r.statut !== 201) throw new Error(`création de ${pseudo} : ${r.statut} ${r.json?.message}`);
  return { token: r.json.accessToken, id: r.json.utilisateur._id, pseudo, prenom, nom };
}

async function seConnecter(page, pseudo) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email ou pseudo').fill(pseudo);
  await page.getByLabel('Mot de passe').fill(MDP);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL('**/home', { timeout: 25000 });
  await page.waitForSelector('nav[aria-label="Navigation principale"] a', { timeout: 10000 });
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

const motifTest = /@parcours1011[.]local$/;

async function purger() {
  const comptes = await bdd.collection('users')
    .find({ email: motifTest }, { projection: { _id: 1 } })
    .toArray();
  const ids = comptes.map((u) => u._id);
  if (ids.length === 0) return 0;

  const convs = await bdd.collection('conversations')
    .find({ participants: { $in: ids } }, { projection: { _id: 1 } })
    .toArray();

  await bdd.collection('messages').deleteMany({ conversation: { $in: convs.map((c) => c._id) } });
  await bdd.collection('conversations').deleteMany({ participants: { $in: ids } });
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

/*
 * UN NOM DE FAMILLE INVENTÉ, pour que le résultat de recherche soit
 * indiscutable. Chercher « Martin » ramènerait les comptes laissés par
 * d'autres suites, et « je vois un résultat » ne prouverait plus que la
 * recherche a trouvé LA bonne personne.
 */
const NOM = `Zerbulot${S}`.slice(0, 40);

const moi = await inscrire('pxmoi', 'Alice', 'Dupont');
const cible = await inscrire('pxcible', 'Bruno', NOM);
const inconnu = await inscrire('pxinconnu', 'Chloe', 'Etrangere');

ok('trois comptes inscrits', Boolean(moi.token && cible.token && inconnu.token));

/*
 * LA CIBLE ME SUIT — et sans cela, le parcours principal ne serait pas celui
 * qu'on croit tester.
 *
 * La règle du module 11 : si la cible suit déjà l'initiateur, la conversation
 * s'ouvre directement ; sinon elle démarre « en attente » et le demandeur n'a
 * droit qu'à UN message. Ouvrir avec quelqu'un qui ne me suit pas ferait donc
 * disparaître le champ de saisie après le premier envoi — comportement
 * parfaitement correct, mais qui ne décrit pas l'échange courant entre deux
 * personnes qui se connaissent.
 *
 * Les deux cas sont vérifiés : celui-ci pour l'échange normal, `inconnu` plus
 * bas pour le sas d'entrée.
 */
const suivi = await appel(`/follows/${moi.id}`, { methode: 'POST', token: cible.token });
ok('la personne cherchée me suit (conversation ouverte d’emblée)',
  suivi.statut === 201 || suivi.statut === 200, suivi.json?.message);

const navigateur = await chromium.launch();
const erreursJs = [];

const contexte = await navigateur.newContext({
  viewport: { width: 1280, height: 950 },
  locale: 'fr-FR',
});
const page = await contexte.newPage();
page.on('pageerror', (e) => erreursJs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') erreursJs.push(m.text()); });

await seConnecter(page, moi.pseudo);

/* ================================================================== *
 *  MODULE 10 — JE CHERCHE UNE PERSONNE
 * ================================================================== */

section('Module 10 — recherche de personnes');

await page.getByRole('link', { name: /Recherche/ }).first().click();
await page.waitForURL('**/recherche', { timeout: 15000 });

const champ = page.getByRole('combobox', { name: 'Rechercher' });
await champ.waitFor({ state: 'visible', timeout: 10000 });
ok('la page de recherche s’ouvre depuis la navigation', page.url().includes('/recherche'));

/* ---------------------- Suggestions pendant la frappe ---------------------- */

await champ.click();
await champ.pressSequentially(NOM.slice(0, 5), { delay: 60 });
await page.waitForTimeout(1200);

const liste = page.getByRole('listbox', { name: 'Suggestions' });
let suggestionVue = true;
try {
  await liste.waitFor({ state: 'visible', timeout: 8000 });
} catch {
  suggestionVue = false;
}

ok('**les suggestions apparaissent pendant la frappe**', suggestionVue);
ok('**la personne cherchée y figure**',
  (await liste.getByRole('option').filter({ hasText: cible.pseudo }).count()) === 1,
  `@${cible.pseudo}`);

await page.screenshot({ path: DOSSIER_CAPTURES + '/parcours-suggestions.png' });

/* ------------------------- Recherche validée ------------------------- */

await champ.press('Escape');
await page.goto(BASE + `/recherche?q=${encodeURIComponent(NOM)}`, {
  waitUntil: 'domcontentloaded',
});
await page.waitForTimeout(2000);

const contenu = await page.content();
ok('**la recherche validée affiche un résultat**', contenu.includes(cible.pseudo), NOM);
ok('le nom complet est lisible',
  contenu.includes(NOM) && contenu.includes('Bruno'));

/* ------------------- L'onglet « Personnes » précisément ------------------- */

await page.getByRole('button', { name: 'Personnes', exact: true }).click();
await page.waitForTimeout(1800);

const lienProfil = page.locator(`a[href="/profile/${cible.pseudo}"]`).first();
ok('**l’onglet Personnes liste bien la personne**',
  (await lienProfil.count()) >= 1);

ok('aucun message « aucun résultat » ne s’affiche',
  (await page.getByText(/Aucune personne pour/).count()) === 0);

await page.screenshot({ path: DOSSIER_CAPTURES + '/parcours-resultats-personnes.png' });

/* ------------------ Le résultat mène bien au profil ------------------ */

await lienProfil.click();
await page.waitForURL(`**/profile/${cible.pseudo}`, { timeout: 15000 });
await page.waitForTimeout(1800);

ok('**cliquer sur le résultat ouvre le profil**',
  page.url().includes(`/profile/${cible.pseudo}`));

/* ================================================================== *
 *  MODULE 11 — J'OUVRE UNE CONVERSATION
 * ================================================================== */

section('Module 11 — ouvrir une conversation');

const boutonMessage = page.getByRole('button', { name: 'Envoyer un message' });
ok('**le profil propose « Envoyer un message »**', (await boutonMessage.count()) === 1);

await boutonMessage.click();
await page.waitForURL('**/messages**', { timeout: 20000 });
await page.waitForTimeout(2500);

ok('**le clic mène à la messagerie, sur la bonne conversation**',
  page.url().includes('/messages?c='), page.url().split('?')[1]);

const enBase = await bdd.collection('conversations').countDocuments({
  participants: { $size: 2 },
  cle: [String(moi.id), String(cible.id)].sort((a, b) => a.localeCompare(b)).join('_'),
});
ok('**la conversation existe réellement en base**', enBase === 1, `${enBase} document(s)`);

/* --------------------- Elle figure dans ma liste --------------------- */

section('Module 11 — ma liste de conversations');

await page.goto(BASE + '/messages', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

/*
 * ON CIBLE LE NOM AFFICHÉ, PAS LE PSEUDO.
 * La liste des conversations montre le nom complet, l'extrait du dernier
 * message et l'heure — pas l'identifiant. C'est la convention de toutes les
 * messageries, et c'est ce sur quoi un utilisateur clique. Chercher le pseudo
 * ici faisait échouer le test sur une chaîne que l'écran n'affiche pas : le
 * banc d'essai visait une information que l'interface n'a jamais promise.
 */
const ligne = page.getByRole('button').filter({ hasText: `Bruno ${NOM}` });
ok('**la conversation apparaît dans la liste**', (await ligne.count()) >= 1,
  `Bruno ${NOM}`);
ok('la liste montre le nom de l’interlocuteur',
  (await page.getByText(`Bruno ${NOM}`).count()) >= 1);

await page.screenshot({ path: DOSSIER_CAPTURES + '/parcours-liste-conversations.png' });

/* ------------------------ J'entre dans le fil ------------------------ */

section('Module 11 — écrire et envoyer');

await ligne.first().click();
await page.waitForTimeout(2500);

ok('**la conversation s’ouvre au clic**', page.url().includes('/messages?c='));

const zoneSaisie = page.getByLabel('Votre message');
ok('**le champ de saisie est présent**', (await zoneSaisie.count()) === 1);

const boutonEnvoyer = page.getByRole('button', { name: 'Envoyer' });
ok('le bouton « Envoyer » est présent', (await boutonEnvoyer.count()) === 1);

const TEXTE = `Bonjour, message de verification ${S}`;
await zoneSaisie.fill(TEXTE);
await boutonEnvoyer.click();

const fil = page.getByTestId('fil-messages');
let bulleVue = true;
try {
  await fil.getByText(TEXTE, { exact: false }).waitFor({ state: 'visible', timeout: 10000 });
} catch {
  bulleVue = false;
}

ok('**le message envoyé apparaît dans le fil**', bulleVue, TEXTE);

ok('le champ de saisie est vidé après l’envoi',
  (await zoneSaisie.inputValue()) === '');

/*
 * ET IL EST RÉELLEMENT PARTI.
 * Un message affiché n'est pas un message envoyé : une interface optimiste
 * peut très bien montrer une bulle qu'aucun serveur n'a reçue. On relit donc
 * la base — la seule preuve qui ne dépende pas de l'écran.
 */
const enregistre = await bdd.collection('messages').findOne({ contenu: TEXTE });
ok('**et il est enregistré en base** (pas seulement affiché)',
  Boolean(enregistre), enregistre ? String(enregistre._id) : 'introuvable');

ok('avec le bon expéditeur',
  String(enregistre?.expediteur) === String(moi.id));

/* ------------------- La cible le reçoit vraiment ------------------- */

const cotecible = await appel('/messages/conversations', { token: cible.token });
const convCible = (cotecible.json?.elements || [])[0];

ok('**la conversation apparaît aussi chez le destinataire**', Boolean(convCible));
ok('avec l’extrait du message', convCible?.dernierMessage?.texte === TEXTE,
  convCible?.dernierMessage?.texte);
ok('**et un message non lu**', convCible?.nonLus === 1, `${convCible?.nonLus}`);

await page.screenshot({ path: DOSSIER_CAPTURES + '/parcours-message-envoye.png' });

/* --------------------- Un second message --------------------- */

const TEXTE2 = `Second message ${S}`;
await zoneSaisie.fill(TEXTE2);
await zoneSaisie.press('Enter');
await page.waitForTimeout(2500);

ok('**Entrée envoie aussi le message**',
  (await fil.getByText(TEXTE2, { exact: false }).count()) === 1);

const total = await bdd.collection('messages').countDocuments({
  conversation: enregistre.conversation,
});
ok('deux messages dans la conversation', total === 2, `${total}`);

/* ================================================================== *
 *  LE SAS D'ENTRÉE, VU DE L'INTERFACE
 * ================================================================== */

section('Module 11 — écrire à quelqu’un qui ne me suit pas');

/*
 * L'AUTRE CHEMIN, ET IL SURPREND SI ON NE L'A PAS EN TÊTE.
 * Chloé ne me suit pas : la conversation démarre « en attente », un message
 * passe pour me présenter, puis le champ de saisie DISPARAÎT jusqu'à ce
 * qu'elle accepte. Ce n'est pas une panne — c'est la protection contre le
 * harcèlement par messagerie — mais l'interface doit le dire, sinon le
 * champ qui s'évanouit ressemble exactement à un bogue.
 */
await page.goto(BASE + `/profile/${inconnu.pseudo}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1800);

await page.getByRole('button', { name: 'Envoyer un message' }).click();
// Ouvrir une conversation demande un aller-retour serveur : on laisse plus
// de marge qu'a un simple changement d'ecran, la machine pouvant etre
// chargee par les suites precedentes.
await page.waitForURL('**/messages**', { timeout: 40000 });
await page.waitForTimeout(2500);

const saisieInconnu = page.getByLabel('Votre message');
ok('le champ de saisie est proposé pour le premier message',
  (await saisieInconnu.count()) === 1);

const PREMIER = `Bonjour, je me presente ${S}`;
await saisieInconnu.fill(PREMIER);
await page.getByRole('button', { name: 'Envoyer' }).click();
await page.waitForTimeout(3000);

ok('**le premier message part bien**',
  (await page.getByTestId('fil-messages').getByText(PREMIER, { exact: false }).count()) === 1);

ok('**puis le champ disparaît** — un seul message tant que la demande attend',
  (await page.getByLabel('Votre message').count()) === 0);

ok('**et l’interface explique pourquoi**, au lieu de laisser croire à une panne',
  (await page.getByText(/lorsque votre demande aura été acceptée/).count()) === 1);

await page.screenshot({ path: DOSSIER_CAPTURES + '/parcours-sas-entree.png' });

/* ------------------------- Responsive ------------------------- */

section('Responsive et console');

for (const largeur of [375, 768]) {
  await page.setViewportSize({ width: largeur, height: 900 });
  await page.waitForTimeout(1200);
  const deborde = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  ok(`le fil sans débordement en ${largeur} px`, !deborde);
}

await page.setViewportSize({ width: 375, height: 900 });
await page.goto(BASE + `/recherche?q=${encodeURIComponent(NOM)}`, {
  waitUntil: 'domcontentloaded',
});
await page.waitForTimeout(1500);
const debordeRecherche = await page.evaluate(
  () => document.documentElement.scrollWidth > window.innerWidth + 1
);
ok('la recherche sans débordement en 375 px', !debordeRecherche);

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

console.log('\n====== PARCOURS UTILISATEUR — MODULES 10 ET 11 ======');
const echecs = afficher();
console.log(`\n  (${supprimes} compte(s) de test supprimés, conversations comprises)`);
process.exit(echecs > 0 ? 1 : 0);
