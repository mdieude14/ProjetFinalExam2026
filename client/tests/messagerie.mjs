/**
 * ===========================================================================
 *  MESSAGERIE — MODULE 11, PARCOURS NAVIGATEUR
 * ===========================================================================
 *
 *   npm run test:messagerie
 *
 * Prérequis : l'API (port 5000) et Vite (port 5173) doivent tourner.
 *
 * CE QUE CETTE SUITE AJOUTE À `server/tests/messagerie.mjs`.
 * La suite serveur prouve que les règles tiennent et que le socket diffuse.
 * Elle ne dit rien de ce que deux personnes voient réellement.
 *
 * ICI, ON OUVRE DEUX NAVIGATEURS EN MÊME TEMPS. C'est la seule façon de
 * vérifier ce qui fait tout l'intérêt du module : Alice écrit, et le message
 * apparaît chez Bob **sans qu'il touche à rien**. Un test à une session ne
 * peut pas distinguer « diffusé en direct » de « rechargé à l'ouverture ».
 *
 * Trois défauts ne se manifestent QUE dans cette configuration :
 *   - le message qui arrive dans le MAUVAIS fil (le socket diffuse par
 *     utilisateur, pas par conversation) ;
 *   - le message affiché EN DOUBLE (ajouté localement, puis reçu du socket) ;
 *   - la pastille qui ne bouge jamais, ou qui ne retombe jamais.
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
const DOM = '@msgfront.local';
const MDP = 'MotDePasse123';
const S = Date.now();

const DOSSIER_CAPTURES = fileURLToPath(new URL('../captures/', import.meta.url));
mkdirSync(DOSSIER_CAPTURES, { recursive: true });

const resultats = [];
let sectionCourante = '';
const section = (nom) => { sectionCourante = nom; };
const ok = (libelle, condition, detail = '') =>
  resultats.push({ section: sectionCourante, libelle, ok: Boolean(condition), detail });

/**
 * ATTENDRE UNE CONDITION, PAS UNE DURÉE — et dire si la page a rendu.
 *
 * `count()` est un INSTANTANÉ : il ne réessaie jamais. Lu après un
 * `waitForTimeout`, il mesure le DOM à un moment arbitraire, ce qui rend la
 * suite verte au repos et rouge sous charge pour un code identique. Et une
 * assertion d'ABSENCE passe alors pour la mauvaise raison, puisqu'une page
 * vide ne contient rien — d'où le booléen rendu ici, qui sert de condition
 * préalable à ces assertions.
 *
 * L'explication complète, et la mesure qui l'a établie, sont dans
 * `tests/evenements.mjs`.
 */
const rendu = async (localisateur, delai = 15000) => {
  try {
    await localisateur.first().waitFor({ state: 'visible', timeout: delai });
    return true;
  } catch {
    return false;
  }
};

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

const motifTest = /@msgfront[.]local$/;

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

const alice = await inscrire('frontalice', 'Alice');
const bob = await inscrire('frontbob', 'Bob');
const carol = await inscrire('frontcarol', 'Carol');

ok('trois comptes inscrits', Boolean(alice.token && bob.token && carol.token));

// Bob suit Alice : une conversation ouverte par Alice sera acceptée d'emblée.
await appel(`/follows/${alice.id}`, { methode: 'POST', token: bob.token });

// Une seconde conversation, avec Carol, sert à vérifier le CLOISONNEMENT :
// un message pour Bob ne doit pas apparaître dans le fil de Carol.
await appel(`/follows/${alice.id}`, { methode: 'POST', token: carol.token });

const convBob = await appel('/messages/conversations', {
  methode: 'POST', token: alice.token, corps: { destinataire: bob.id },
});
const convCarol = await appel('/messages/conversations', {
  methode: 'POST', token: alice.token, corps: { destinataire: carol.id },
});

const idBob = convBob.json?.conversation?._id;
const idCarol = convCarol.json?.conversation?._id;
ok('deux conversations préparées', Boolean(idBob && idCarol));

await appel(`/messages/conversations/${idCarol}/messages`, {
  methode: 'POST', token: alice.token, corps: { contenu: 'fil de Carol' },
});

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

section('Accès à la messagerie');

const lienMessages = pageAlice.locator(
  'nav[aria-label="Navigation principale"] a[href="/messages"]'
);
ok('**entrée « Messages » active dans la navigation**', (await lienMessages.count()) === 1);

await lienMessages.click();
await pageAlice.waitForURL('**/messages', { timeout: 15000 });

ok('la page des messages s’affiche', pageAlice.url().includes('/messages'));

ok('la conversation avec Bob figure dans la liste',
  await rendu(pageAlice.getByRole('button').filter({ hasText: 'Bob' })));

/* ================================================================== *
 *  TEMPS RÉEL À DEUX
 * ================================================================== */

section('Temps réel — Alice écrit, Bob reçoit');

/**
 * Attend que le socket de la page soit REELLEMENT connecte.
 *
 * SANS CETTE PRECONDITION, LA VERIFICATION MESURE AUTRE CHOSE.
 * Une page peut etre entierement chargee alors que son socket s'authentifie
 * encore — la poignee de main fait un aller-retour en base. Un message envoye
 * dans cette fenetre n'est pas diffuse a ce client : il n'est pas encore dans
 * sa salle. Le test concluait alors a une panne de diffusion, ce qui etait
 * faux : le destinataire n'ecoutait pas encore.
 *
 * Constate trois fois en campagne complete, jamais en execution isolee — la
 * machine chargee allongeait simplement la poignee de main au-dela du delai
 * d'attente fixe a l'aveugle.
 */
async function attendreSocket(page, libelle) {
  await page.locator('[data-socket="connecte"]').waitFor({ state: 'attached', timeout: 20000 });
  return libelle;
}

// Bob ouvre la conversation avec Alice et n'y touche plus.
await pageBob.goto(BASE + `/messages?c=${idBob}`, { waitUntil: 'domcontentloaded' });
await attendreSocket(pageBob, 'Bob');

// Alice ouvre la même conversation.
await pageAlice.goto(BASE + `/messages?c=${idBob}`, { waitUntil: 'domcontentloaded' });
await attendreSocket(pageAlice, 'Alice');

ok('**les deux sockets sont connectés avant toute mesure**', true,
  'précondition explicite, plus supposée');

// Laisser le fil se peupler et les abonnements se poser.
await pageBob.waitForTimeout(800);
await pageAlice.waitForTimeout(800);

const champ = pageAlice.getByLabel('Votre message');
ok('le champ de saisie est accessible',
  (await rendu(champ)) && (await champ.count()) === 1);

const TEXTE = `bonjour en direct ${S}`;
await champ.fill(TEXTE);
await pageAlice.getByRole('button', { name: 'Envoyer' }).click();

/*
 * ON CADRE LE SELECTEUR SUR LE FIL, ET C'EST INDISPENSABLE.
 *
 * `getByText` sans cadrage trouve DEUX elements : la bulle du fil, et
 * l'extrait du dernier message affiche dans la liste des conversations.
 * Playwright refuse alors d'agir — « strict mode violation » —, le `catch`
 * ci-dessous transforme l'exception en « pas recu », et la suite accuse la
 * diffusion temps reel alors que le message est bien arrive.
 *
 * L'echec dependait de l'ordre d'arrivee de `message:nouveau` et de
 * `conversation:maj` : tant que l'extrait n'etait pas encore peint, un seul
 * element repondait et le test passait. D'ou une suite qui passait une fois
 * sur deux, pour une raison etrangere a ce qu'elle mesure.
 */
// Aucun rechargement côté Bob : on attend simplement que le texte paraisse.
const bulleChezBob = pageBob
  .getByTestId('fil-messages')
  .getByText(TEXTE, { exact: false });
let recuEnDirect = true;
try {
  // Marge large a dessein : la machine peut etre chargee par les suites
  // precedentes. Elargir le delai n affaiblit pas la verification — elle
  // prouve toujours que rien n a ete recharge — mais evite un echec qui
  // accuserait la diffusion temps reel a la place du banc d essai.
  await bulleChezBob.waitFor({ state: 'visible', timeout: 25000 });
} catch {
  recuEnDirect = false;
}

ok('**le message apparaît chez Bob sans aucun rechargement**', recuEnDirect, TEXTE);

await pageAlice.waitForTimeout(1200);
/*
 * ON COMPTE DANS LE FIL, PAS DANS LA PAGE.
 * Le meme texte figure legitimement deux fois a l ecran : dans la bulle, et
 * dans l extrait de la liste des conversations a gauche. Compter sur la page
 * entiere signalait donc un doublon la ou il n y en avait pas — le banc
 * d essai accusait le produit d un defaut qui etait le sien.
 */
const occurrencesAlice = await pageAlice
  .getByTestId('fil-messages')
  .getByText(TEXTE, { exact: false })
  .count();
ok('**et une seule fois chez Alice** (ajout local + socket ne doivent pas doubler)',
  occurrencesAlice === 1, `${occurrencesAlice} occurrence(s)`);

/* ---------------------- Cloisonnement des fils ---------------------- */

/*
 * UNE ABSENCE NE CONCLUT RIEN SUR UN ÉCRAN VIDE.
 * Celle-ci garde le CLOISONNEMENT DES CONVERSATIONS : si la page de Bob
 * n'est pas rendue, « fil de Carol » n'y figure pas, et l'assertion passe au
 * vert en ayant mesuré le néant. C'est la pire place possible pour un faux
 * vert — on y perdrait la preuve qu'un tiers ne voit pas les fils d'autrui.
 *
 * Elle avait survécu au balayage du 28 octobre parce que le recenseur
 * cherchait une comparaison à zéro DANS la ligne de lecture, et non une
 * comparaison portant sur une VARIABLE, une ligne plus bas.
 * L'outil a été corrigé en même temps que l'assertion.
 */
const filBobRendu = await rendu(pageBob.getByTestId('fil-messages'));
const filCarolChezBob = await pageBob.getByText('fil de Carol').count();
ok('**le fil de Carol n’apparaît pas chez Bob**',
  filBobRendu && filCarolChezBob === 0,
  filBobRendu ? '' : 'FIL NON RENDU : une absence ne conclut rien sur un écran vide');

/* --------------------------- Double coche --------------------------- */

/*
 * Bob a la conversation ouverte : sa lecture doit remonter à Alice.
 * ELLE REMONTE PAR UN SOCKET, donc à une date qu'aucun délai ne connaît.
 * On attend la coche elle-même ; la lecture du HTML qui suit ne sert plus
 * qu'à nommer ce qu'on a trouvé.
 */
const cocheVue = await rendu(pageAlice.getByText('✓✓').first(), 20000);
const contenuAlice = await pageAlice.content();
ok('**la double coche remonte à Alice en direct**',
  cocheVue && contenuAlice.includes('✓✓'),
  cocheVue ? 'lecture signalée' : 'COCHE JAMAIS VUE en 20 s');

await pageAlice.screenshot({ path: DOSSIER_CAPTURES + '/messagerie-alice.png' });
await pageBob.screenshot({ path: DOSSIER_CAPTURES + '/messagerie-bob.png' });

/* -------------------------- Indicateur de saisie -------------------------- */

section('Indicateur de saisie');

/*
 * ATTENDRE QUE LA SÉRIE DE FRAPPE PRÉCÉDENTE SOIT CLOSE, et ce délai fixe
 * est ASSUMÉ — il porte une précondition du produit, pas une espérance.
 *
 * `signalerSaisie()` n'émet `saisie:debut` qu'au DÉBUT d'une série : tant que
 * son minuteur de deux secondes court, chaque frappe ne fait que le repousser.
 * Alice vient d'écrire le message précédent ; si l'on enchaîne sans laisser ce
 * minuteur expirer, AUCUN `saisie:debut` ne part, et Bob ne voit jamais
 * « Alice écrit… » — alors que le produit fonctionne parfaitement.
 *
 * ET IL N'Y A RIEN À ATTENDRE DANS LE DOM : la fermeture de la série est un
 * minuteur côté client, invisible de dehors. Une attente conditionnelle ne
 * peut pas remplacer ce délai ; seul le temps le referme.
 *
 * MESURÉ LE 28 OCTOBRE 2026 : ce délai existait, sans explication, dans la
 * section précédente. Pris pour une attente de socket, il a été remplacé par
 * une attente conditionnelle — et l'assertion est tombée de façon
 * REPRODUCTIBLE, deux campagnes de suite à 25/26.
 *
 *   LEÇON : un délai fixe qui porte une précondition doit la DIRE. Sinon le
 *   prochain passage le prend pour de la négligence et le retire.
 */
await pageAlice.waitForTimeout(2500);

await champ.fill('');
await champ.pressSequentially('je reponds', { delay: 60 });

const ecritChezBob = pageBob.getByText(/écrit…/);
let saisieVue = true;
try {
  await ecritChezBob.waitFor({ state: 'visible', timeout: 6000 });
} catch {
  saisieVue = false;
}
ok('**Bob voit « Alice écrit… » pendant la frappe**', saisieVue);

const saisieChezAlice = await pageAlice.getByText(/écrit…/).count();
ok('**Alice ne se voit pas écrire elle-même**', saisieChezAlice === 0);

await champ.fill('');

/* ================================================================== *
 *  PASTILLE DE NON-LUS
 * ================================================================== */

section('Pastille de non-lus');

// Bob quitte la conversation : ses prochains messages non lus doivent compter.
await pageBob.goto(BASE + '/home', { waitUntil: 'domcontentloaded' });
await pageBob.waitForTimeout(1500);

await pageAlice.goto(BASE + `/messages?c=${idBob}`, { waitUntil: 'domcontentloaded' });
await pageAlice.waitForTimeout(1500);
await pageAlice.getByLabel('Votre message').fill('pastille stp');
await pageAlice.getByRole('button', { name: 'Envoyer' }).click();

const pastille = pageBob.locator(
  'nav[aria-label="Navigation principale"] a[href="/messages"] span[aria-hidden="true"]'
).last();

let pastilleVue = false;
for (let essai = 0; essai < 12; essai++) {
  await pageBob.waitForTimeout(700);
  const texte = (await pastille.textContent().catch(() => '')) || '';
  if (/^\d/.test(texte.trim())) { pastilleVue = true; break; }
}
ok('**la pastille apparaît chez Bob depuis une autre page**', pastilleVue);

// Bob ouvre la conversation : la pastille doit retomber.
await pageBob.goto(BASE + `/messages?c=${idBob}`, { waitUntil: 'domcontentloaded' });

/*
 * ON ATTEND QUE LA PASTILLE RETOMBE, au lieu de parier sur 3 secondes.
 *
 * Deux raisons de ne pas lire après un délai fixe. La première : la remise à
 * zéro passe par un appel au serveur, et sous charge trois secondes ne
 * suffisaient pas — l'échec accusait le code pendant que la pastille
 * retombait une seconde plus tard. La seconde, plus sournoise : lue trop
 * tôt, la barre de navigation peut n'être pas encore rendue, et « aucun
 * chiffre » serait alors vrai sur du vide. On exige donc d'abord que la
 * conversation soit ouverte.
 */
const conversationOuverte = await rendu(pageBob.getByLabel('Votre message'));
const pastilleBob = pageBob.locator('nav[aria-label="Navigation principale"] a[href="/messages"]');
await pageBob
  .waitForFunction(
    () => {
      const lien = document.querySelector('nav[aria-label="Navigation principale"] a[href="/messages"]');
      return lien && !/\d/.test(lien.textContent || '');
    },
    null,
    { timeout: 10000 }
  )
  .catch(() => {});

const restePastille = await pastilleBob.textContent().catch(() => '');
ok('**et retombe une fois la conversation ouverte**',
  conversationOuverte && !/\d/.test((restePastille || '').replace(/[^\d]/g, '')),
  conversationOuverte ? restePastille?.trim() : 'CONVERSATION NON OUVERTE : rien de concluant');

/* ================================================================== *
 *  DEMANDE DE CHAT
 * ================================================================== */

section('Demande de chat');

const dave = await inscrire('frontdave', 'Dave');
const convDave = await appel('/messages/conversations', {
  methode: 'POST', token: alice.token, corps: { destinataire: dave.id },
});
const idDave = convDave.json?.conversation?._id;

await appel(`/messages/conversations/${idDave}/messages`, {
  methode: 'POST', token: alice.token, corps: { contenu: 'Bonjour Dave' },
});

const ctxDave = await navigateur.newContext({ viewport: { width: 1280, height: 950 }, locale: 'fr-FR' });
const pageDave = await ctxDave.newPage();
pageDave.on('pageerror', (e) => erreursJs.push(e.message));

await seConnecter(pageDave, dave.pseudo);
await pageDave.goto(BASE + `/messages?c=${idDave}`, { waitUntil: 'domcontentloaded' });
await pageDave.waitForTimeout(2000);

const bandeauRendu = await rendu(pageDave.getByText('souhaite vous écrire'));
ok('**le bandeau de demande s’affiche chez la cible**',
  bandeauRendu && (await pageDave.getByText('souhaite vous écrire').count()) === 1,
  bandeauRendu ? '' : 'BANDEAU NON RENDU en 15 s');
ok('la conséquence du refus est annoncée avant le clic',
  (await pageDave.getByText(/empêchera définitivement/).count()) === 1);
ok('les deux boutons sont proposés',
  (await pageDave.getByRole('button', { name: 'Accepter' }).count()) === 1 &&
    (await pageDave.getByRole('button', { name: 'Refuser' }).count()) === 1);

// Côté Alice, la demande est en attente : elle ne peut plus écrire.
await pageAlice.goto(BASE + `/messages?c=${idDave}`, { waitUntil: 'domcontentloaded' });

/*
 * L'EXPLICATION SERT D'ANCRAGE À L'INTERDICTION. On attend qu'elle paraisse,
 * puis seulement on constate que la zone de saisie n'est pas là : sur un
 * écran encore vide, son absence ne prouverait rien du tout.
 */
const attenteExpliquee = await rendu(
  pageAlice.getByText(/lorsque votre demande aura été acceptée/)
);
ok('et l’interface le dit', attenteExpliquee);
ok('**le demandeur ne peut plus écrire tant que la demande attend**',
  attenteExpliquee && (await pageAlice.getByLabel('Votre message').count()) === 0,
  attenteExpliquee ? '' : 'ÉCRAN NON RENDU : une absence ne conclut rien');

await pageDave.getByRole('button', { name: 'Accepter' }).click();
await pageDave.waitForTimeout(2500);

ok('après acceptation, Dave peut écrire',
  (await rendu(pageDave.getByLabel('Votre message'))) &&
    (await pageDave.getByLabel('Votre message').count()) === 1);

await pageAlice.waitForTimeout(2500);
ok('**et Alice retrouve son champ de saisie, en direct**',
  (await rendu(pageAlice.getByLabel('Votre message'), 20000)) &&
    (await pageAlice.getByLabel('Votre message').count()) === 1);

await pageDave.screenshot({ path: DOSSIER_CAPTURES + '/messagerie-demande.png' });

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
  ok(`/messages sans débordement en ${largeur} px`, !deborde);
}

await pageAlice.setViewportSize({ width: 375, height: 900 });
await pageAlice.goto(BASE + `/messages?c=${idBob}`, { waitUntil: 'domcontentloaded' });

/*
 * ON ATTEND LE BOUTON, PAS 1,8 SECONDE. Dernière occurrence du motif dans
 * cette suite, et elle a tenu jusqu'à la campagne du 28 octobre 2026 : un
 * `count()` lu trop tôt rendait 0, et l'échec laissait croire que le retour
 * mobile avait disparu de l'interface.
 */
ok('**en mobile, un retour vers la liste est proposé**',
  await rendu(pageAlice.getByLabel('Retour aux conversations')));

await pageAlice.screenshot({ path: DOSSIER_CAPTURES + '/messagerie-mobile.png' });

await navigateur.close();

const inattendues = erreursJs.filter(
  (m) => !/401|403|404|409|Failed to load resource|favicon|geolocation|websocket|socket/i.test(m)
);
ok('aucune erreur JavaScript inattendue', inattendues.length === 0,
  inattendues[0] || 'console propre');

/* ================================================================== *
 *  NETTOYAGE
 * ================================================================== */

const supprimes = await purger();
await clientMongo.close();

console.log('\n=========== MESSAGERIE — MODULE 11 (front) ===========');
const echecs = afficher();
console.log(`\n  (${supprimes} compte(s) de test supprimés, conversations comprises)`);
process.exit(echecs > 0 ? 1 : 0);
