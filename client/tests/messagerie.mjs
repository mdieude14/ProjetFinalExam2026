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

/* ================================================================== *
 *  DÉMARRER UNE CONVERSATION DEPUIS /messages
 * ================================================================== */

section('Nouvelle conversation depuis la page Messages');

/*
 * CE QUE CETTE SECTION DÉFEND.
 * Jusqu'au 6 novembre 2026, écrire à quelqu'un supposait de passer par sa
 * page de profil. Ce chemin reste ouvert ; celui-ci part de la messagerie,
 * comme on le fait partout ailleurs : on ouvre ses messages, PUIS on choisit.
 *
 * Frank n'a AUCUNE conversation avec Alice, et c'est le seul dans ce cas :
 * Bob et Carol en ont déjà une. Grace, elle, n'a aucune relation — elle sert
 * d'ancre négative, et sans elle la liste pourrait proposer n'importe qui
 * sans qu'aucune assertion ne tombe.
 */
const frank = await inscrire('frontfrank', 'Frank');
const grace = await inscrire('frontgrace', 'Grace');
await appel(`/follows/${alice.id}`, { methode: 'POST', token: frank.token });

ok('Frank suit Alice, Grace n’a aucun lien', Boolean(frank.token && grace.token));

await pageAlice.setViewportSize({ width: 1280, height: 950 });
await pageAlice.goto(BASE + '/messages', { waitUntil: 'domcontentloaded' });

const boutonNouveau = pageAlice.locator('[data-test="ouvrir-nouvelle-conversation"]');
ok('**un bouton « Nouveau message » est proposé sur /messages**',
  await rendu(boutonNouveau));

await boutonNouveau.click();

const fenetre = pageAlice.locator('[data-test="nouvelle-conversation"]');
ok('la fenêtre de choix s’ouvre', await rendu(fenetre));

const champRecherche = pageAlice.locator('[data-test="recherche-destinataire"]');
ok('une barre de recherche est présente', await rendu(champRecherche));

/* --- sans saisie : mes relations sont déjà proposées --- */

const listeInitiale = pageAlice.locator('[data-test="liste-destinataires"]');
ok('**la liste ne s’ouvre pas sur un vide** — mes relations sont proposées d’emblée',
  await rendu(listeInitiale));

/* --- la saisie filtre, et l’absence est ancrée sur une présence --- */

await champRecherche.fill('frontfrank');

const ligneFrank = pageAlice.locator(`[data-test="destinataire"][data-pseudo="${frank.pseudo}"]`);
const frankVisible = await rendu(ligneFrank);
ok('le préfixe « frontfrank » ramène Frank', frankVisible);

/*
 * L'ABSENCE D'EVE NE CONCLUT QUE SI DAVE EST LÀ. Une fenêtre qui n'aurait
 * rien rendu validerait cette assertion sans avoir rien vérifié — c'est le
 * faux vert consigné dans `tests/evenements.mjs`.
 */
const texteListe = frankVisible ? await pageAlice.locator('[data-test="liste-destinataires"]').innerText() : '';
ok('**Grace, sans aucun lien, n’est PAS proposée**',
  frankVisible && !texteListe.includes(grace.pseudo),
  frankVisible ? '' : 'NON CONCLUANT : la liste n’a rien rendu');

/* --- on se ravise : AUCUNE conversation vide ne doit rester --- */

await ligneFrank.click();
ok('le champ de message apparaît après le choix',
  await rendu(pageAlice.locator('[data-test="message-nouvelle-conversation"]')));

await pageAlice.keyboard.press('Escape');
await pageAlice.waitForTimeout(600);

const convsApresAbandon = await bdd.collection('conversations').countDocuments({
  participants: { $all: [new ObjectId(alice.id), new ObjectId(frank.id)] },
});
ok('**se raviser ne laisse AUCUNE conversation vide** — elle n’est créée qu’à l’envoi',
  convsApresAbandon === 0,
  `${convsApresAbandon} conversation(s) Alice–Frank en base`);

/* --- et maintenant, l’envoi réel --- */

/*
 * RECHARGEMENT AVANT LE SECOND PASSAGE, ET CE N'EST PAS UN RAFISTOLAGE.
 * Rouvrir la fenêtre dans la foulée d'un Échap laisse l'ancienne modale en
 * cours de démontage : deux champs portent alors le même sélecteur, et celui
 * qu'on remplit n'est pas celui qu'on voit. Le rechargement supprime cette
 * ambiguïté et reproduit mieux le geste réel — on y revient plus tard.
 */
await pageAlice.goto(BASE + '/messages', { waitUntil: 'domcontentloaded' });
await rendu(boutonNouveau);
await boutonNouveau.click();
await rendu(fenetre);
await champRecherche.fill('frontfrank');
await rendu(ligneFrank);
await ligneFrank.click();

const MESSAGE_NEUF = 'Premier message, depuis la page Messages.';
await pageAlice.locator('[data-test="message-nouvelle-conversation"]').fill(MESSAGE_NEUF);
await pageAlice.locator('[data-test="envoyer-nouvelle-conversation"]').click();

/*
 * ON ATTEND LE MESSAGE DANS LE FIL, pas une durée. C'est la seule preuve
 * qui couvre toute la chaîne : ouverture, envoi, rechargement de la liste,
 * puis bascule de l'URL sur le fil neuf.
 */
/*
 * ON VISE LE FIL (`fil-messages`), PAS LA PAGE ENTIERE.
 * `getByText` apparie aussi la VALEUR d'un `textarea` : le brouillon resté
 * dans la fenêtre suffisait à valider « le message est envoyé » alors que
 * rien n'était parti. Même famille de faux vert qu'une assertion d'absence
 * sur une page vide — et il a trompé la première version de cette section.
 */
const dansLeFil = pageAlice.locator('[data-testid="fil-messages"]').getByText(MESSAGE_NEUF);
const messageAffiche = await rendu(dansLeFil, 20000);
ok('**le message est envoyé ET le fil s’ouvre dessus**', messageAffiche);
ok('**la fenêtre s’est refermée d’elle-même**',
  (await pageAlice.locator('[data-test="nouvelle-conversation"]').count()) === 0);

ok('l’URL porte la conversation neuve', /\?c=[a-f0-9]{24}/.test(pageAlice.url()),
  pageAlice.url().replace(BASE, ''));

const convFrank = await bdd.collection('conversations').findOne({
  participants: { $all: [new ObjectId(alice.id), new ObjectId(frank.id)] },
});
ok('la conversation existe désormais en base', Boolean(convFrank));

const msgFrank = convFrank
  ? await bdd.collection('messages').findOne({ conversation: convFrank._id })
  : null;
ok('et elle porte bien le message envoyé', msgFrank?.contenu === MESSAGE_NEUF,
  msgFrank?.contenu ?? 'aucun message');

/*
 * LE SAS D'ENTRÉE RESTE APPLIQUÉ. Frank suit Alice, donc la conversation
 * s'ouvre « accepte ». Ce chemin neuf ne doit pas contourner la règle qui
 * protège du harcèlement — il appelle `ouvrirConversation`, pas une
 * création directe.
 */
ok('**le sas d’entrée est respecté** — Frank suit Alice, donc « accepte »',
  convFrank?.statut === 'accepte', convFrank?.statut);

/* --- reprendre un fil existant ne le dédouble pas --- */

await pageAlice.goto(BASE + '/messages', { waitUntil: 'domcontentloaded' });
await rendu(boutonNouveau);
await boutonNouveau.click();
await rendu(fenetre);
await champRecherche.fill('frontbob');
const ligneBob = pageAlice.locator(`[data-test="destinataire"][data-pseudo="${bob.pseudo}"]`);
const bobVisible = await rendu(ligneBob);
ok('Bob, avec qui un fil existe déjà, reste proposé', bobVisible);

if (bobVisible) {
  await ligneBob.click();
  await pageAlice.locator('[data-test="message-nouvelle-conversation"]').fill('Reprise du fil.');
  await pageAlice.locator('[data-test="envoyer-nouvelle-conversation"]').click();

  /*
   * L'ANCRE EST LA LIVRAISON, PAS LE COMPTE. « une seule conversation
   * Alice–Bob » était déjà vrai avant ce test : sans exiger d'abord que le
   * message soit arrivé DANS LE FIL, l'assertion restait verte même si rien
   * ne partait — elle ne concluait rien du tout.
   */
  const repriseLivree = await rendu(
    pageAlice.locator('[data-testid="fil-messages"]').getByText('Reprise du fil.'),
    20000
  );
  ok('la reprise est bien livrée', repriseLivree);

  const convsBob = await bdd.collection('conversations').countDocuments({
    participants: { $all: [new ObjectId(alice.id), new ObjectId(bob.id)] },
  });
  ok('**écrire à quelqu’un déjà contacté ne crée PAS un second fil**',
    repriseLivree && convsBob === 1,
    repriseLivree ? `${convsBob} conversation(s) Alice–Bob` : 'NON CONCLUANT : rien n’a été livré');
}

/* ================================================================== *
 *  MODIFIER, SUPPRIMER UN MESSAGE — ET SUPPRIMER LA CONVERSATION
 * ================================================================== */

section('Actions sur un message et sur la conversation');

/*
 * CE QUE CETTE SECTION DÉFEND, ET QUE LA SUITE SERVEUR NE DIT PAS.
 * La suite serveur prouve que les règles tiennent. Elle ne dit rien de ce
 * qu'un utilisateur VOIT : que le menu n'apparaît que sur ses propres
 * bulles, que « modifié » s'affiche, que la bulle supprimée reste en place
 * vidée, et que la confirmation annonce la conséquence AVANT le clic.
 */

/*
 * UN COUPLE NEUF, ET C'EST NÉCESSAIRE. Alice et Bob traînent déjà un fil
 * chargé par les sections précédentes : « un seul menu dans le fil » y serait
 * faux, et `.first()` désignerait le plus ancien message plutôt que le mien.
 * Une section qui dépend de l'état laissé par les précédentes ne teste plus
 * ce qu'elle croit — elle teste l'ordre d'exécution.
 */
const gina = await inscrire('frontgina', 'Gina');
const hugo = await inscrire('fronthugo', 'Hugo');
await appel(`/follows/${gina.id}`, { methode: 'POST', token: hugo.token });

const ctxGina = await navigateur.newContext({
  viewport: { width: 1280, height: 950 },
  locale: 'fr-FR',
});
const pageGina = await ctxGina.newPage();
pageGina.on('pageerror', (e) => erreursJs.push(e.message));
await seConnecter(pageGina, gina.pseudo);

const convActions = await appel('/messages/conversations', {
  methode: 'POST', token: gina.token, corps: { destinataire: hugo.id },
});
const idConvActions = convActions.json?.conversation?._id;
await appel(`/messages/conversations/${idConvActions}/messages`, {
  methode: 'POST', token: gina.token, corps: { contenu: 'Texte a corriger ici.' },
});
await appel(`/messages/conversations/${idConvActions}/messages`, {
  methode: 'POST', token: hugo.token, corps: { contenu: 'Message de Hugo, intouchable.' },
});

await pageGina.goto(BASE + `/messages?c=${idConvActions}`, { waitUntil: 'domcontentloaded' });
ok('le fil est ouvert', await rendu(pageGina.getByText('Texte a corriger ici.')));

const menusBulles = pageGina.locator('[data-testid="fil-messages"] [data-test="menu-options"]');
const menuPresent = await rendu(menusBulles);
ok('**un menu « ⋯ » est proposé sur ma bulle**', menuPresent);

/*
 * L'ANCRE AVANT L'ABSENCE : s'il n'y avait aucun menu, « un seul menu »
 * passerait pour la mauvaise raison. On exige d'abord qu'il y en ait un.
 */
const nbMenus = await menusBulles.count();
ok('**et sur la MIENNE seulement** — pas sur le message de Hugo',
  menuPresent && nbMenus === 1, `${nbMenus} menu(s) dans le fil`);

/* ------------------------------ Modifier ------------------------------ */

await menusBulles.first().click();
ok('« Modifier » est proposé', await rendu(pageGina.getByRole('menuitem', { name: /Modifier/ })));
await pageGina.getByRole('menuitem', { name: /Modifier/ }).click();

ok('la fenêtre de modification s’ouvre',
  await rendu(pageGina.locator('[data-test="modifier-message"]')));

const champModif = pageGina.locator('[data-test="champ-modification"]');
ok('**le champ est prérempli** — on corrige, on ne réécrit pas de zéro',
  (await champModif.inputValue()) === 'Texte a corriger ici.', await champModif.inputValue());

ok('la conséquence est annoncée AVANT le clic',
  (await pageGina.locator('[data-test="modifier-message"]').innerText()).includes('modifié'));

await champModif.fill('Texte corrige depuis l’interface.');
await pageGina.locator('[data-test="valider-modification"]').click();

ok('**le nouveau texte apparaît dans le fil**',
  await rendu(pageGina.locator('[data-testid="fil-messages"]').getByText('Texte corrige depuis l’interface.'), 20000));
ok('**la mention « modifié » est affichée**',
  await rendu(pageGina.locator('[data-test="marque-modifie"]')));
ok('la fenêtre s’est refermée d’elle-même',
  (await pageGina.locator('[data-test="modifier-message"]').count()) === 0);

const relecture = await appel(`/messages/conversations/${idConvActions}/messages`, { token: hugo.token });
const vuDeBob = (relecture.json?.messages ?? []).find((m) => m.contenu === 'Texte corrige depuis l’interface.');
ok('**et Bob voit le texte corrigé ET la mention** — une retouche invisible serait un mensonge',
  Boolean(vuDeBob?.modifieLe), String(vuDeBob?.modifieLe));

/* ------------------------------ Supprimer ------------------------------ */

await menusBulles.first().click();
/*
 * PAS D ANCRAGE STRICT SUR LE NOM. `MenuOptions` compose le nom accessible
 * du libelle ET de sa description : /^Supprimer$/ ne correspond donc a rien.
 * Dans le menu d une bulle, « Supprimer » est sans ambiguite.
 */
await pageGina.getByRole('menuitem', { name: /Supprimer/ }).click();
ok('la confirmation de suppression s’ouvre',
  await rendu(pageGina.locator('[data-test="confirmer-suppression-message"]')));
ok('elle dit ce qui restera dans le fil',
  (await pageGina.locator('[data-test="confirmer-suppression-message"]').innerText()).includes('vidée'));

await pageGina.locator('[data-test="valider-suppression-message"]').click();
ok('**la bulle reste, vidée de son contenu**',
  await rendu(pageGina.locator('[data-testid="fil-messages"]').getByText('Message supprimé'), 20000));
ok('**et son menu disparaît** — on ne modifie pas ce qui n’existe plus',
  (await menusBulles.count()) === 0, `${await menusBulles.count()} menu(s)`);

/* ---------------------- Supprimer la conversation ---------------------- */

const menuEntete = pageGina.locator('[data-test="menu-options"]').last();
await menuEntete.click();
const entreeSuppr = pageGina.getByRole('menuitem', { name: /Supprimer la conversation/ });
ok('**« Supprimer la conversation » est dans le menu « ⋯ »**, avec les actions de modération',
  await rendu(entreeSuppr));

await entreeSuppr.click();
const dialogue = pageGina.locator('[data-test="confirmer-suppression-conversation"]');
ok('la confirmation s’ouvre', await rendu(dialogue));

const texteDialogue = await dialogue.innerText();
ok('**elle dit que l’autre garde la sienne** — croire qu’on efface chez lui serait grave',
  /gardera la sienne/i.test(texteDialogue));
ok('et qu’un nouveau message la fera revenir', /reviendra/i.test(texteDialogue));

await pageGina.locator('[data-test="valider-suppression-conversation"]').click();
await pageGina.waitForTimeout(2000);

const listeAlice = await appel('/messages/conversations', { token: gina.token });
ok('**elle a disparu de la liste de Gina**',
  !(listeAlice.json?.elements ?? []).some((c) => c._id === idConvActions));

const listeBob = await appel('/messages/conversations', { token: hugo.token });
ok('**et Hugo la garde, avec son historique**',
  (listeBob.json?.elements ?? []).some((c) => c._id === idConvActions));

ok('l’URL ne pointe plus sur un fil absent de la liste',
  !pageGina.url().includes(idConvActions), pageGina.url().replace(BASE, ''));

/* ------------- Le style de la fenêtre de nouveau message ------------- */

/*
 * LA HAUTEUR DE LA FENÊTRE NE DOIT PAS CHANGER ENTRE LES ÉTATS.
 * Sans cadre de hauteur fixe, elle grandit et rétrécit à chaque frappe, et
 * les boutons se déplacent sous le curseur — on clique sur ce qui vient de
 * bouger. C'est une assertion de MISE EN PAGE, et elle se mesure.
 */
await pageGina.goto(BASE + '/messages', { waitUntil: 'domcontentloaded' });
await rendu(pageGina.locator('[data-test="ouvrir-nouvelle-conversation"]'));
await pageGina.locator('[data-test="ouvrir-nouvelle-conversation"]').click();
await rendu(pageGina.locator('[data-test="nouvelle-conversation"]'));

const hauteurFenetre = async () => {
  const boite = await pageGina.locator('[data-test="nouvelle-conversation"]').boundingBox();
  return boite ? Math.round(boite.height) : 0;
};

const hDepart = await hauteurFenetre();
await pageGina.locator('[data-test="recherche-destinataire"]').fill('fronthugo');
await rendu(pageGina.locator('[data-test="destinataire"]'));
const hResultat = await hauteurFenetre();
await pageGina.locator('[data-test="recherche-destinataire"]').fill('zzzintrouvable');
await rendu(pageGina.locator('[data-test="aucun-destinataire"]'));
const hVide = await hauteurFenetre();

ok('**la fenêtre garde la même hauteur entre ses trois états**',
  hDepart > 0 && Math.abs(hDepart - hResultat) <= 2 && Math.abs(hResultat - hVide) <= 2,
  `${hDepart} / ${hResultat} / ${hVide} px`);

await pageGina.locator('[data-test="recherche-destinataire"]').fill('fronthugo');
await rendu(pageGina.locator('[data-test="destinataire"]'));
await pageGina.locator('[data-test="recherche-destinataire"]').press('Enter');
ok('**Entrée choisit le premier résultat** — on ne lâche pas le clavier pour la souris',
  await rendu(pageGina.locator('[data-test="message-nouvelle-conversation"]')));

await pageGina.screenshot({ path: DOSSIER_CAPTURES + '/messagerie-nouvelle-conversation.png' });
await pageGina.keyboard.press('Escape');


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
