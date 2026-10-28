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
 * une fois dans le texte réservé aux lecteurs d'écran (« , 1 non lu », depuis le retrait des cadratins le 28 octobre 2026).
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

/**
 * ATTENDRE LA BARRE DE NAVIGATION, AVANT TOUTE LECTURE DE PASTILLE.
 *
 * `pastilleDe()` rend la chaîne vide dans DEUX cas qui n'ont rien à voir :
 * aucune notification non lue, ou barre de navigation pas encore rendue. Cette
 * ambiguïté coûtait deux fois.
 *
 * D'abord un FAUX VERT : « aucune pastille au départ » était satisfaite par
 * une page qui n'avait rien affiché du tout.
 *
 * Ensuite de FAUX ÉCHECS : les boucles de sondage dépensaient leur budget de
 * huit secondes à attendre le chargement de la page, et non l'arrivée de la
 * notification. Sous charge, la campagne rendait « pastille «  » » pour un
 * code qui fonctionnait — vérifié en rejouant la suite seule.
 *
 * Le sondage reste nécessaire ensuite : la pastille monte sur un événement
 * réseau, et aucune condition DOM ne peut être attendue avant qu'il arrive.
 */
const navRendue = async (page, delai = 15000) => {
  try {
    await page
      .locator('nav[aria-label="Navigation principale"]')
      .first()
      .waitFor({ state: 'visible', timeout: delai });
    return true;
  } catch {
    return false;
  }
};

/** Attendre une condition et non une durée. Explication : `tests/evenements.mjs`. */
const rendu = async (localisateur, delai = 15000) => {
  try {
    await localisateur.first().waitFor({ state: 'visible', timeout: delai });
    return true;
  } catch {
    return false;
  }
};

/**
 * SONDER LA PASTILLE JUSQU'À LA VALEUR ATTENDUE, puis rendre ce qu'on a lu.
 *
 * La pastille change au retour d'un appel au serveur : la lire après un délai
 * fixe revient à parier sur la latence du moment, et le pari se perd dès que
 * la machine travaille. On sonde donc jusqu'à la valeur espérée, et on rend la
 * DERNIÈRE valeur lue — ainsi un vrai défaut échoue en affichant le chiffre
 * réellement présent, ce qui reste diagnosticable, au lieu d'une chaîne vide.
 */
const pastilleAttendue = async (page, chemin, attendue, delai = 20000) => {
  /*
   * LA BARRE D'ABORD, LE COMPTEUR ENSUITE.
   *
   * Sans ce contrôle, un échec rend « pastille «  » » — une valeur vide qui
   * peut vouloir dire deux choses sans rapport : le compteur est à zéro, ou la
   * barre n'est pas rendue. On a déjà levé cette ambiguïté pour l'état de
   * départ ; elle revenait ici par la porte du sondage. Un libellé explicite
   * vaut mieux qu'un vide à interpréter.
   */
  if (!(await navRendue(page, delai))) return 'NAVIGATION NON RENDUE';

  const limite = Date.now() + delai;
  let vue = await pastilleDe(page, chemin);
  while (vue !== attendue && Date.now() < limite) {
    await page.waitForTimeout(300);
    vue = await pastilleDe(page, chemin);
  }
  return vue;
};

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

const navDepart = await navRendue(pageAlice);
ok('aucune pastille au départ',
  navDepart && (await pastilleDe(pageAlice, '/notifications')) === '',
  navDepart ? '' : 'NAVIGATION NON RENDUE : une pastille vide ne prouve rien');

await lienNotifs.click();
await pageAlice.waitForURL('**/notifications', { timeout: 15000 });

ok('la page s’ouvre', pageAlice.url().includes('/notifications'));
ok('**une liste vide explique à quoi sert l’écran**',
  await rendu(pageAlice.getByText(/Aucune notification pour le moment/)));
ok('les deux onglets sont proposés',
  (await pageAlice.getByRole('button', { name: 'Toutes', exact: true }).count()) === 1 &&
    (await pageAlice.getByRole('button', { name: 'Non lues', exact: true }).count()) === 1);

/* ================================================================== *
 *  ARRIVÉE EN DIRECT
 * ================================================================== */

section('Réception en direct');

/*
 * ON ATTEND QUE LE SOCKET SOIT ÉTABLI AVANT DE PROVOQUER L'ÉVÉNEMENT.
 *
 * La pastille ne monte pas sur une relecture périodique : elle monte sur un
 * événement `notification:nouvelle` reçu par socket, et le compteur
 * s'incrémente localement. Un événement émis AVANT que le socket d'Alice soit
 * connecté est donc perdu POUR DE BON — la pastille ne monte pas « plus
 * tard », elle ne monte jamais. Sonder plus longtemps n'y changeait rien, ce
 * qui explique l'alternance entre « pastille «  » » et le vert d'une série à
 * l'autre, pour un code identique.
 *
 * Ce n'est pas un défaut du produit : `NotificationContext` assume cette
 * dérive, et la navigation suivante remet le compteur d'aplomb. C'est une
 * synchronisation qui manquait au TEST.
 *
 * L'écoute est posée AVANT la navigation : `waitForEvent` ne voit que les
 * sockets ouverts après son appel, et c'est le chargement de la page qui en
 * crée un. On attend ensuite une trame REÇUE, qui prouve que la poignée de
 * main a abouti dans les deux sens — l'ouverture seule ne le prouve pas.
 */
const socketOuvert = pageAlice.waitForEvent('websocket', { timeout: 20000 }).catch(() => null);

// Alice reste sur une AUTRE page : la pastille doit monter là aussi.
await pageAlice.goto(BASE + '/home', { waitUntil: 'domcontentloaded' });

// La barre doit être là AVANT qu'on commence à sonder, sans quoi le budget de
// sondage sert à attendre la page et non la notification.
ok('la barre de navigation est rendue sur l’autre page', await navRendue(pageAlice));

const socket = await socketOuvert;
if (socket) await socket.waitForEvent('framereceived', { timeout: 15000 }).catch(() => null);
ok('**le socket temps réel est établi avant qu’on provoque l’événement**', Boolean(socket));

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

const apresUneLecture = await pastilleAttendue(pageAlice, '/notifications', '1');
ok('**la pastille redescend à 1**', apresUneLecture === '1',
  `pastille « ${apresUneLecture} »`);

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
const avantToutLire = await pastilleAttendue(pageAlice, '/notifications', '1');
ok('**arriver sur la page n’a pas tout marqué lu tout seul**',
  avantToutLire === '1', `pastille « ${avantToutLire} »`);

await toutLire.click();

/*
 * LA PASTILLE VIDE SERT D'ANCRAGE À L'ABSENCE DU BOUTON.
 *
 * Lues après 2,5 s, les deux vérifications pouvaient passer ensemble pour la
 * mauvaise raison : barre non rendue, donc aucune pastille ET aucun bouton.
 * `pastilleAttendue` exige la barre d'abord, puis attend la valeur espérée ;
 * l'absence du bouton n'est examinée qu'ensuite.
 */
const pastilleVidee = await pastilleAttendue(pageAlice, '/notifications', '');
ok('**la pastille disparaît**', pastilleVidee === '', `pastille « ${pastilleVidee} »`);

ok('le bouton disparaît lui aussi, n’ayant plus d’objet',
  pastilleVidee === '' &&
    (await pageAlice.getByRole('button', { name: 'Tout marquer comme lu' }).count()) === 0,
  pastilleVidee === '' ? '' : 'PASTILLE NON VIDÉE : une absence ne conclut rien');

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

/*
 * LA NOTIFICATION ARRIVE PAR LA LISTE, DONC ON L'ATTEND.
 *
 * Un `count()` après 2,5 s rendait 0 sous charge, et l'échec accusait le
 * LIBELLÉ — « et non vous a envoyé un message » — alors que rien n'était
 * encore affiché. Le détail du message d'échec pointait donc vers une
 * mauvaise piste, ce qui est le pire des cas.
 */
const demandeAnnoncee = await rendu(pageAlice.getByText('souhaite vous écrire'));
ok('**la demande de conversation est annoncée comme telle**',
  demandeAnnoncee,
  demandeAnnoncee ? 'et non « vous a envoyé un message »' : 'LISTE NON RENDUE');

const lienMessagerie = pageAlice.locator('a[href^="/messages?c="]').first();
ok('elle porte un lien vers la conversation',
  demandeAnnoncee && (await lienMessagerie.count()) === 1,
  demandeAnnoncee ? '' : 'LISTE NON RENDUE : rien de concluant');

await lienMessagerie.click();
await pageAlice.waitForURL('**/messages**', { timeout: 15000 });
await pageAlice.waitForTimeout(2000);

ok('**le clic mène directement à la bonne conversation**',
  pageAlice.url().includes('/messages?c='), pageAlice.url().split('?')[1]);

/*
 * `pastilleAttendue` ET NON `pastilleDe`, pour la même raison qu'ailleurs : une
 * pastille vide lue trop tôt ne distingue pas « marquée lue » de « barre pas
 * encore rendue ». Attendre la valeur espérée lève l'ambiguïté, et un libellé
 * explicite remplace le vide en cas d'échec.
 */
const pastilleApresClic = await pastilleAttendue(pageAlice, '/notifications', '');
ok('et la notification a été marquée lue au passage',
  pastilleApresClic === '', `pastille « ${pastilleApresClic} »`);

/* ================================================================== *
 *  SUPPRESSION
 * ================================================================== */

section('Suppression');

await pageAlice.goto(BASE + '/notifications', { waitUntil: 'domcontentloaded' });

/*
 * ON ATTEND QUE LA LISTE EXISTE, ON NE COMPTE PAS À L'AVEUGLE.
 *
 * Il y avait ici `waitForTimeout(2000)` puis un comptage. Deux secondes
 * suffisent quand la suite tourne seule ; elles ne suffisent pas en
 * trente-et-unième position d'une campagne, la machine chargée. Le 27 octobre,
 * le comptage a lu **zéro** parce que la liste n'était pas encore rendue — puis
 * le clic, qui attend le bouton lui-même, a bien supprimé une ligne et en a
 * laissé deux. La vérification a donc comparé 2 à -1 et échoué, sur un
 * comportement parfaitement correct.
 *
 * UNE ATTENTE FIXE MESURE LA VITESSE DE LA MACHINE, pas le code. On attend
 * donc la CONDITION : qu'au moins une ligne soit là.
 */
const lignes = pageAlice.getByTestId('liste-notifications').locator('li');
await lignes.first().waitFor({ state: 'visible', timeout: 20000 });

const avant = await lignes.count();
await pageAlice.getByRole('button', { name: 'Supprimer cette notification' }).first().click();

/*
 * ET L'ON ATTEND QUE LE COMPTE AIT BAISSÉ, plutôt qu'un délai arbitraire. Si la
 * suppression ne marche pas, la boucle expire et la vérification échoue — ce
 * qui est le résultat voulu, pour la bonne raison cette fois.
 */
/*
 * VINGT SECONDES, comme le `waitFor` ci-dessus, et non dix. Allonger le budget
 * d'une attente CONDITIONNELLE ne coûte rien quand la condition arrive tôt :
 * la boucle sort au premier essai sur une machine au repos. C'est toute la
 * différence avec un délai fixe, qui se paie à chaque passage. À 0,73 Go de
 * mémoire libre, dix secondes ne suffisaient pas à l'aller-retour serveur plus
 * le rendu — mesuré le 28 octobre 2026.
 */
let apres = avant;
for (let essai = 0; essai < 40 && apres >= avant; essai += 1) {
  await pageAlice.waitForTimeout(500);
  apres = await lignes.count();
}

ok('**supprimer retire la ligne**', apres === avant - 1, `${avant} → ${apres}`);

await pageAlice.reload({ waitUntil: 'domcontentloaded' });

/*
 * ON ATTEND QUE LA LISTE SOIT REVENUE, PAS DEUX SECONDES.
 *
 * Un `count()` lu après un délai fixe rend **0** sur une page qui n'a pas fini
 * de charger. Et 0 est le pire des résultats ici : il ressemble à « la ligne
 * supprimée a disparu, et toutes les autres avec elle », donc à une régression
 * grave du code mesuré. La campagne du 28 octobre 2026 a rendu exactement cela,
 * `-> 0` au lieu de 2, sur un code qui fonctionnait.
 *
 * On attend donc le compte espéré. S'il n'arrive jamais, l'attente expire et
 * l'on compte quand même : l'assertion échoue alors sur le nombre RÉEL, et le
 * diagnostic reste possible.
 */
const listeApres = pageAlice.getByTestId('liste-notifications');
await pageAlice
  .waitForFunction(
    (attendu) =>
      document.querySelectorAll('[data-testid="liste-notifications"] li').length === attendu,
    apres,
    { timeout: 15000 }
  )
  .catch(() => {});

const apresRechargement = await listeApres.locator('li').count();
ok('**et elle ne revient pas au rechargement**', apresRechargement === apres,
  `${apresRechargement}`);

/* ================================================================== *
 *  CLOISONNEMENT
 * ================================================================== */

section('Cloisonnement');

await pageBob.goto(BASE + '/notifications', { waitUntil: 'domcontentloaded' });

/*
 * L'ÉTAT VIDE SERT D'ANCRAGE AU CLOISONNEMENT.
 *
 * « Bob ne voit pas les notifications d'Alice » se lisait dans un HTML capturé
 * après deux secondes : sur une page encore blanche, l'affirmation était vraie
 * sans rien prouver. C'est le pire endroit où laisser un faux vert — ce
 * contrôle est là pour garantir qu'un compte ne lit pas les notifications d'un
 * autre.
 *
 * On attend donc d'abord le message d'état vide, qui prouve DEUX choses à la
 * fois : la page a rendu, et la liste de Bob est effectivement vide.
 */
const videChezBob = await rendu(pageBob.getByText(/Aucune notification pour le moment/));
ok('sa liste à lui est vide', videChezBob);

const contenuBob = await pageBob.content();
ok('**Bob ne voit pas les notifications d’Alice**',
  videChezBob && !contenuBob.includes('a aimé votre publication'),
  videChezBob ? '' : 'PAGE NON RENDUE : une absence ne conclut rien sur un écran vide');

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
