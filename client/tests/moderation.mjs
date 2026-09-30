/**
 * ===========================================================================
 *  MODÉRATION — PARCOURS NAVIGATEUR (menu « ⋯ »)
 * ===========================================================================
 *
 *   npm run test:moderation
 *
 * Prérequis : l'API (port 5000) et Vite (port 5173) doivent tourner.
 *
 * CE QUE CETTE SUITE AJOUTE À `server/tests/moderation.mjs`.
 * La suite serveur prouve que les règles tiennent. Elle ne dit rien de ce
 * qu'un utilisateur peut réellement DÉCLENCHER : un blocage parfaitement
 * implémenté derrière un bouton qui n'ouvre pas son menu reste inutilisable.
 *
 * ON PASSE DONC PAR LES VRAIS CLICS — le bouton « ⋯ », l'entrée du menu, la
 * fenêtre de confirmation. Aucun appel HTTP n'est fait à la place de
 * l'interface ; la base n'est lue qu'APRÈS, pour vérifier que le clic a
 * produit l'écriture attendue.
 *
 * TROIS CHOSES NE SE VÉRIFIENT QUE D'ICI :
 *   - le libellé du menu BASCULE (« Bloquer » devient « Débloquer ») ;
 *   - le menu est présent SUR LES DEUX SURFACES — profil et conversation ;
 *   - le signalement part avec son motif ET ses précisions, et l'admin les
 *     retrouve dans son back-office.
 *
 * Les comptes créés ici sont supprimés à la fin — et au démarrage.
 * ===========================================================================
 */

import { chromium, selectors } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * PLAYWRIGHT CHERCHE `data-testid` PAR DEFAUT ; LE PROJET ECRIT `data-test`.
 *
 * C'est la convention majoritaire du code (vingt-cinq occurrences contre
 * quatre), et la faire respecter ici coute une ligne. Sans elle,
 * `getByTestId('menu-options')` ne trouve rien alors que l'attribut est bien
 * dans le DOM — un echec qui accuse le composant a la place du test.
 */
selectors.setTestIdAttribute('data-test');

const BASE = process.env.CLIENT_URL || 'http://localhost:5173';
const API = 'http://localhost:5000/api';
const DOM = '@modfront.local';
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
      type: 'utilisateur', nom: 'Front', prenom, pseudo,
      email: `${pseudo}${DOM}`, password: MDP, ville: 'Lyon',
    },
  });
  if (r.statut !== 201) throw new Error(`création de ${pseudo} : ${r.statut} ${r.json?.message}`);
  return { token: r.json.accessToken, id: r.json.utilisateur._id, pseudo };
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
 * Ouvre le menu « ⋯ » et clique une entrée par son libellé.
 *
 * FACTORISÉ PARCE QUE LA SÉQUENCE EST RÉPÉTÉE HUIT FOIS. Recopiée, elle
 * finirait par diverger d'un appel à l'autre — et c'est justement la
 * séquence qu'on veut voir se comporter pareil partout.
 */
async function viaMenu(page, libelleEntree) {
  const bouton = page.getByTestId('menu-options');
  await bouton.waitFor({ state: 'visible', timeout: 15000 });
  await bouton.click();

  const menu = page.getByRole('menu');
  await menu.waitFor({ state: 'visible', timeout: 5000 });

  await page.getByRole('menuitem', { name: new RegExp(libelleEntree, 'i') }).click();
}

/** Libellés actuellement proposés par le menu, menu refermé ensuite. */
async function libellesDuMenu(page) {
  const bouton = page.getByTestId('menu-options');
  await bouton.waitFor({ state: 'visible', timeout: 15000 });
  await bouton.click();
  await page.getByRole('menu').waitFor({ state: 'visible', timeout: 5000 });

  const libelles = await page.getByRole('menuitem').allInnerTexts();
  await page.keyboard.press('Escape');

  return libelles.join(' | ');
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

const motifTest = /@modfront[.]local$/;

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
  await bdd.collection('relations').deleteMany({
    $or: [{ source: { $in: ids } }, { cible: { $in: ids } }],
  });
  await bdd.collection('signalements').deleteMany({
    $or: [{ signaleur: { $in: ids } }, { cible: { $in: ids } }],
  });
  await bdd.collection('notifications').deleteMany({
    $or: [{ destinataire: { $in: ids } }, { emetteur: { $in: ids } }],
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

const alice = await inscrire('alicemodui', 'Alice');
const bruno = await inscrire('brunomodui', 'Bruno');

// Un suivi accepté, pour que le blocage ait quelque chose à rompre.
await appel(`/follows/${bruno.pseudo}`, { methode: 'POST', token: alice.token });
await appel(`/follows/${alice.pseudo}`, { methode: 'POST', token: bruno.token });

// Une conversation ouverte, pour tester le menu de son en-tête.
const ouverture = await appel('/messages/conversations', {
  methode: 'POST',
  corps: { destinataire: bruno.id },
  token: alice.token,
});
const idConversation = ouverture.json?.conversation?._id;

// Un message, pour que le fil ne soit pas vide à l'affichage.
await appel(`/messages/conversations/${idConversation}/messages`, {
  methode: 'POST',
  corps: { contenu: `Bonjour ${S}` },
  token: alice.token,
});

const navigateur = await chromium.launch();
let codeSortie = 0;

try {
  const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await contexte.newPage();

  await seConnecter(page, alice.pseudo);

  /* =================================================================== *
   *  LE MENU LUI-MÊME
   * =================================================================== */
  section('Le bouton « ⋯ » sur le profil');

  await page.goto(`${BASE}/profile/${bruno.pseudo}`, { waitUntil: 'domcontentloaded' });

  const bouton = page.getByTestId('menu-options');
  await bouton.waitFor({ state: 'visible', timeout: 20000 });
  ok('le bouton « ⋯ » est présent dans l’en-tête du profil', await bouton.isVisible());

  ok(
    'il s’annonce comme ouvrant un menu',
    (await bouton.getAttribute('aria-haspopup')) === 'menu',
    `aria-haspopup="${await bouton.getAttribute('aria-haspopup')}"`
  );
  ok('et se déclare fermé au départ', (await bouton.getAttribute('aria-expanded')) === 'false');

  /*
   * LE MENU EST TOUT À DROITE. On compare son bord droit à celui de la carte
   * de profil : une mesure, pas une classe CSS — c'est le rendu qui compte,
   * et une classe juste peut être annulée par une autre.
   */
  const cadreBouton = await bouton.boundingBox();
  const cadreCarte = await page.locator('section').first().boundingBox();
  const ecartDroite = (cadreCarte.x + cadreCarte.width) - (cadreBouton.x + cadreBouton.width);
  ok(
    'il est aligné à droite de l’en-tête',
    ecartDroite >= 0 && ecartDroite <= 40,
    `${Math.round(ecartDroite)} px du bord droit`
  );

  await bouton.click();
  const menu = page.getByRole('menu');
  await menu.waitFor({ state: 'visible', timeout: 5000 });
  ok('le clic ouvre le menu', await menu.isVisible());
  ok('et le bouton se déclare ouvert', (await bouton.getAttribute('aria-expanded')) === 'true');

  const entrees = await page.getByRole('menuitem').allInnerTexts();
  ok('il propose les trois actions', entrees.length === 3, `${entrees.length} entrée(s)`);

  await page.screenshot({
    path: `${DOSSIER_CAPTURES}moderation-menu-profil.png`,
    fullPage: false,
  });

  section('Fermeture du menu');

  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden', timeout: 5000 });
  ok('Échap referme le menu', (await page.getByRole('menu').count()) === 0);

  /*
   * ÉCHAP DOIT RENDRE LE FOCUS AU BOUTON. Sans ce retour, la tabulation
   * repart du début du document : l'utilisateur clavier est renvoyé en haut
   * de la page pour avoir simplement fermé un menu.
   */
  const focusRendu = await page.evaluate(
    () => document.activeElement?.getAttribute('data-test') === 'menu-options'
  );
  ok('et rend le focus au bouton', focusRendu);

  await bouton.click();
  await page.getByRole('menu').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('h1').first().click();
  await page.getByRole('menu').waitFor({ state: 'hidden', timeout: 5000 });
  ok('un clic à l’extérieur le referme aussi', (await page.getByRole('menu').count()) === 0);

  /* =================================================================== *
   *  RESTREINDRE / LEVER
   * =================================================================== */
  section('Restreindre depuis le menu');

  ok(
    'le menu propose « Restreindre »',
    (await libellesDuMenu(page)).includes('Restreindre'),
    'avant toute action'
  );

  await viaMenu(page, 'Restreindre');
  await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 5000 });
  ok('une confirmation s’affiche', await page.getByRole('dialog').isVisible());

  ok(
    'elle annonce le silence de la restriction',
    (await page.getByRole('dialog').innerText()).toLowerCase().includes('jamais informée')
  );

  await page.getByRole('button', { name: /^Restreindre$/ }).click();
  await page.getByText('a été restreint').waitFor({ state: 'visible', timeout: 20000 });
  ok('l’action est confirmée à l’écran', true);
  await page.getByRole('button', { name: 'Fermer' }).click();

  const relationRestreinte = await bdd.collection('relations').findOne({
    type: 'restriction',
    source: (await bdd.collection('users').findOne({ pseudo: alice.pseudo }))._id,
  });
  ok('LA RESTRICTION EST ÉCRITE EN BASE', Boolean(relationRestreinte));

  const libellesApres = await libellesDuMenu(page);
  ok(
    'le menu BASCULE sur « Lever la restriction »',
    libellesApres.includes('Lever la restriction'),
    libellesApres.slice(0, 80)
  );

  section('Lever la restriction depuis le menu');

  await viaMenu(page, 'Lever la restriction');
  await page.getByText('Restriction levée').waitFor({ state: 'visible', timeout: 20000 });
  await page.getByRole('button', { name: 'Fermer' }).click();

  const restrictionRestante = await bdd.collection('relations').countDocuments({
    type: 'restriction',
  });
  ok('LA RESTRICTION EST RETIRÉE DE LA BASE', restrictionRestante === 0,
    `${restrictionRestante} restante(s)`);

  ok(
    'le menu revient à « Restreindre »',
    (await libellesDuMenu(page)).includes('Restreindre'),
    'aller-retour complet'
  );

  /* =================================================================== *
   *  SIGNALER
   * =================================================================== */
  section('Signaler depuis le menu');

  await viaMenu(page, 'Signaler ce compte');
  await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 5000 });

  const boutonSignaler = page.getByRole('button', { name: /^Signaler$/ });
  ok('le bouton reste inerte tant qu’aucun motif n’est choisi', await boutonSignaler.isDisabled());

  await page.getByLabel('Harcèlement ou intimidation').check();
  ok('le bouton s’active une fois le motif choisi', await boutonSignaler.isEnabled());

  const precisions = `Précisions saisies depuis l'interface ${S}`;
  await page.locator('textarea').fill(precisions);

  await page.screenshot({
    path: `${DOSSIER_CAPTURES}moderation-signalement.png`,
    fullPage: false,
  });

  await boutonSignaler.click();
  await page.getByText('Signalement transmis').waitFor({ state: 'visible', timeout: 20000 });
  await page.getByRole('button', { name: 'Fermer' }).click();

  ok(
    'le menu indique désormais « Signalement en cours »',
    (await libellesDuMenu(page)).includes('Signalement en cours')
  );

  /* =================================================================== *
   *  RÉCEPTION PAR L'ADMINISTRATION
   * =================================================================== */
  section('Le signalement arrive chez l’administration');

  const enBase = await bdd.collection('signalements').findOne({ motif: 'harcelement' });
  ok('LE SIGNALEMENT EST ÉCRIT EN BASE', Boolean(enBase));
  ok('avec le motif choisi dans l’interface', enBase?.motif === 'harcelement',
    `motif « ${enBase?.motif} »`);
  ok('AVEC LES PRÉCISIONS SAISIES', enBase?.commentaire === precisions,
    `« ${String(enBase?.commentaire).slice(0, 50)}… »`);
  ok('et le statut « ouvert »', enBase?.statut === 'ouvert');

  /*
   * ON SE CONNECTE VRAIMENT COMME ADMINISTRATEUR, dans un second contexte.
   * Lire la base prouverait seulement que la donnée existe ; le point à
   * vérifier est qu'elle ARRIVE JUSQU'À L'ÉCRAN de modération.
   */
  const idAdmin = `adminmodui${S}`;

  const creation = await appel('/auth/register', {
    methode: 'POST',
    corps: {
      type: 'utilisateur', nom: 'Front', prenom: 'Admin', pseudo: idAdmin,
      email: `${idAdmin}${DOM}`, password: MDP, ville: 'Lyon',
    },
  });
  ok('compte de service créé', creation.statut === 201);

  /*
   * PROMOTION EN BASE, ET NON PAR L'API. Créer un admin par l'API est
   * refusé — c'est une protection du module 3, vérifiée par la suite de
   * régression. La contourner ici serait tester le contournement.
   */
  await bdd.collection('users').updateOne({ pseudo: idAdmin }, { $set: { type: 'admin' } });

  const contexteAdmin = await navigateur.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const ecranAdmin = await contexteAdmin.newPage();
  await seConnecter(ecranAdmin, idAdmin);

  await ecranAdmin.goto(`${BASE}/admin/moderation`, { waitUntil: 'domcontentloaded' });

  const ongletSignalements = ecranAdmin.getByTestId('famille-signalements');
  await ongletSignalements.waitFor({ state: 'visible', timeout: 20000 });
  ok('le back-office propose un onglet « Signalements »', await ongletSignalements.isVisible());

  await ongletSignalements.click();
  await ecranAdmin.getByTestId('liste-signalements').waitFor({ state: 'visible', timeout: 15000 });

  const contenu = await ecranAdmin.getByTestId('liste-signalements').innerText();

  ok('LE MOTIF EST AFFICHÉ À L’ADMINISTRATEUR',
    contenu.includes('Harcèlement ou intimidation'), 'libellé lisible, pas la valeur brute');
  ok('LES PRÉCISIONS SONT AFFICHÉES', contenu.includes(precisions));
  ok('le compte signalé est identifié', contenu.includes(bruno.pseudo));
  ok('le signaleur est identifié — dans le back-office seulement',
    contenu.includes(alice.pseudo));

  await ecranAdmin.screenshot({
    path: `${DOSSIER_CAPTURES}moderation-back-office.png`,
    fullPage: false,
  });

  section('Instruction depuis le back-office');

  await ecranAdmin.getByRole('button', { name: /Traiter/ }).first().click();
  await ecranAdmin.getByText(/Signalement traité/).waitFor({ state: 'visible', timeout: 15000 });

  const instruit = await bdd.collection('signalements').findOne({ motif: 'harcelement' });
  ok('LE DOSSIER EST CLASSÉ EN BASE', instruit?.statut === 'traite', `statut « ${instruit?.statut} »`);
  ok('l’instructeur est tracé', Boolean(instruit?.traitePar));
  ok('le dossier est CONSERVÉ, pas supprimé', Boolean(instruit));

  await contexteAdmin.close();

  /* =================================================================== *
   *  BLOQUER / DÉBLOQUER
   * =================================================================== */
  section('Bloquer depuis le menu du profil');

  await page.goto(`${BASE}/profile/${bruno.pseudo}`, { waitUntil: 'domcontentloaded' });

  await viaMenu(page, 'Bloquer');
  await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 5000 });

  const texteConfirmation = await page.getByRole('dialog').innerText();
  ok(
    'la confirmation annonce la rupture des abonnements',
    texteConfirmation.toLowerCase().includes('rompus')
  );
  ok(
    'et qu’ils ne seront PAS rétablis au déblocage',
    texteConfirmation.toLowerCase().includes('pas rétablis')
  );

  await page.getByRole('button', { name: /^Bloquer$/ }).click();
  await page.getByText('a été bloqué').waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('button', { name: 'Fermer' }).click();

  const blocage = await bdd.collection('relations').findOne({ type: 'blocage' });
  ok('LE BLOCAGE EST ÉCRIT EN BASE', Boolean(blocage));

  /*
   * ON COMPTE LES LIENS ENTRE CES DEUX COMPTES, PAS TOUTE LA COLLECTION.
   * La base de développement porte les suivis d'autres comptes : un
   * countDocuments({}) mesurait onze liens sans rapport avec le test, et
   * accusait le produit d'un défaut qui n'existait pas.
   */
  const idAlice = (await bdd.collection('users').findOne({ pseudo: alice.pseudo }))._id;
  const idBruno = (await bdd.collection('users').findOne({ pseudo: bruno.pseudo }))._id;
  const entreEux = {
    $or: [
      { follower: idAlice, following: idBruno },
      { follower: idBruno, following: idAlice },
    ],
  };

  const suivisRestants = await bdd.collection('follows').countDocuments(entreEux);
  ok('les suivis croisés ont été rompus', suivisRestants === 0,
    `${suivisRestants} lien(s) restant(s)`);

  await page.waitForTimeout(1200);
  ok(
    'le menu BASCULE sur « Débloquer »',
    (await libellesDuMenu(page)).includes('Débloquer')
  );

  await page.screenshot({
    path: `${DOSSIER_CAPTURES}moderation-profil-bloque.png`,
    fullPage: false,
  });

  section('Débloquer depuis le menu');

  await viaMenu(page, 'Débloquer');
  await page.getByText('a été débloqué').waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('button', { name: 'Fermer' }).click();

  const blocageRestant = await bdd.collection('relations').countDocuments({ type: 'blocage' });
  ok('LE BLOCAGE EST RETIRÉ DE LA BASE', blocageRestant === 0, `${blocageRestant} restant(s)`);

  const suivisApres = await bdd.collection('follows').countDocuments(entreEux);
  ok(
    'les suivis ne sont PAS rétablis — comme annoncé',
    suivisApres === 0,
    `${suivisApres} lien(s)`
  );

  ok(
    'le menu revient à « Bloquer »',
    (await libellesDuMenu(page)).includes('Bloquer'),
    'aller-retour complet'
  );

  /* =================================================================== *
   *  LA SECONDE SURFACE : LA CONVERSATION
   * =================================================================== */
  section('Le même menu dans la conversation');

  /*
   * ON OUVRE LE FIL PAR SON IDENTIFIANT, comme le fait `test:messagerie`.
   * Cliquer dans la liste supposait d'y retrouver le PSEUDO — or la liste
   * affiche le prénom et le nom. Le localisateur cherchait donc un texte que
   * l'écran ne contient pas.
   */
  await page.goto(`${BASE}/messages?c=${idConversation}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(2500);

  const boutonChat = page.getByTestId('menu-options');
  await boutonChat.waitFor({ state: 'visible', timeout: 15000 });
  ok('le bouton « ⋯ » est présent dans l’en-tête de la conversation',
    await boutonChat.isVisible());

  const cadreChat = await boutonChat.boundingBox();
  const cadreEntete = await page.locator('header').last().boundingBox();
  const ecartChat = (cadreEntete.x + cadreEntete.width) - (cadreChat.x + cadreChat.width);
  ok(
    'il est aligné à droite de l’en-tête',
    ecartChat >= 0 && ecartChat <= 40,
    `${Math.round(ecartChat)} px du bord droit`
  );

  const libellesChat = await libellesDuMenu(page);
  ok('il propose les mêmes actions que sur le profil',
    libellesChat.includes('Bloquer') && libellesChat.includes('Restreindre'),
    libellesChat.slice(0, 90));

  await page.screenshot({
    path: `${DOSSIER_CAPTURES}moderation-menu-conversation.png`,
    fullPage: false,
  });

  section('Bloquer depuis la conversation');

  await viaMenu(page, 'Bloquer');
  await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 5000 });
  await page.getByRole('button', { name: /^Bloquer$/ }).click();
  await page.getByText('a été bloqué').waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('button', { name: 'Fermer' }).click();

  const blocageChat = await bdd.collection('relations').countDocuments({
    type: 'blocage',
    source: idAlice,
    cible: idBruno,
  });
  ok('LE BLOCAGE DEPUIS LA CONVERSATION EST ÉCRIT EN BASE', blocageChat === 1,
    `${blocageChat} relation(s)`);

  /*
   * LE FIL EST DÉSORMAIS FERMÉ CÔTÉ SERVEUR. On le vérifie par l'API et non
   * par l'écran : c'est la garantie qui compte, l'affichage n'en est que la
   * conséquence.
   */
  const conversations = await appel('/messages/conversations', { token: bruno.token });
  const idConv = conversations.json?.elements?.[0]?._id;
  const ecriture = await appel(`/messages/conversations/${idConv}/messages`, {
    methode: 'POST',
    corps: { contenu: 'Message après blocage' },
    token: bruno.token,
  });
  ok(
    'le fil est fermé à la personne bloquée',
    ecriture.statut === 403 || ecriture.statut === 404,
    `statut ${ecriture.statut}`
  );

  section('On ne se modère pas soi-même');

  await page.goto(`${BASE}/profile/${alice.pseudo}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  ok(
    'aucun menu « ⋯ » sur son propre profil',
    (await page.getByTestId('menu-options').count()) === 0
  );
} finally {
  await navigateur.close();
  await purger();
  await clientMongo.close();
  codeSortie = afficher(null) > 0 ? 1 : 0;
}

process.exit(codeSortie);
