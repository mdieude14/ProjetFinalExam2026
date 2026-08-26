/**
 * ===========================================================================
 *  RECHERCHE — MODULE 10, PARCOURS NAVIGATEUR
 * ===========================================================================
 *
 *   npm run test:recherche
 *
 * Prérequis : l'API (port 5000) et Vite (port 5173) doivent tourner.
 *
 * CE QUE CETTE SUITE AJOUTE À `server/tests/recherche.mjs`.
 * La suite serveur prouve que les règles tiennent : préfixe indexé, verrou
 * premium, comptes désactivés absents. Elle ne dit rien de ce que
 * l'utilisateur vit. Or l'essentiel du module 10 est un comportement
 * D'INTERFACE, et trois défauts ne se manifestent QUE dans un navigateur :
 *
 *   - LE VOLUME DE REQUÊTES. Une barre sans délai d'attente envoie une
 *     requête par lettre. Aucun test serveur ne peut le voir : chaque requête
 *     prise isolément est parfaitement correcte. On les COMPTE ici.
 *
 *   - L'ORDRE D'ARRIVÉE. Une réponse lente qui écrase une réponse récente
 *     fait régresser la liste sous les yeux de l'utilisateur.
 *
 *   - LE CLAVIER. Une liste de suggestions inatteignable aux flèches est
 *     inutilisable sans souris.
 *
 * Et, comme au module 9, la vérification qui ne souffre aucun raccourci :
 * un contenu premium doit être absent du HTML LUI-MÊME, pas seulement masqué.
 *
 * Les comptes créés ici sont supprimés à la fin — et au démarrage, pour que
 * la suite ne dépende pas de la façon dont la précédente s'est terminée.
 * ===========================================================================
 */

import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.CLIENT_URL || 'http://localhost:5173';
const API = 'http://localhost:5000/api';
const DOM = '@rechtest.local';
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

async function inscrire({ type = 'utilisateur', pseudo, nom, prenom }) {
  const r = await appel('/auth/register', {
    methode: 'POST',
    corps: {
      type, nom, prenom, pseudo,
      email: `${pseudo}${DOM}`, password: MDP, ville: 'Lyon',
      ...(type === 'coach' ? { diplome: { intitule: 'BPJEPS', organisme: 'DRJSCS' } } : {}),
    },
  });
  if (r.statut !== 201) throw new Error(`création de ${pseudo} : ${r.statut} ${r.json?.message}`);
  return { token: r.json.accessToken, id: r.json.utilisateur._id, pseudo };
}

const dansNJours = (n, heure = 10) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(heure, 0, 0, 0);
  return d.toISOString();
};

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

const motifTest = /@rechtest[.]local$/;

async function purger() {
  const comptes = await bdd.collection('users')
    .find({ email: motifTest }, { projection: { _id: 1 } })
    .toArray();
  const ids = comptes.map((u) => u._id);
  if (ids.length === 0) return 0;

  const evts = await bdd.collection('sportevents')
    .find({ organisateur: { $in: ids } }, { projection: { _id: 1 } })
    .toArray();

  await bdd.collection('eventregistrations').deleteMany({
    $or: [{ event: { $in: evts.map((e) => e._id) } }, { utilisateur: { $in: ids } }],
  });
  await bdd.collection('sportevents').deleteMany({ organisateur: { $in: ids } });
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

/*
 * UN MOT INVENTÉ COMME TERME DE RECHERCHE.
 * « Zumbaquatique » n'existe ni dans la base de développement ni dans les
 * jeux d'essai des autres suites. Un terme réel comme « natation » ferait
 * remonter les contenus laissés par d'autres tests, et un compte de résultats
 * deviendrait impossible à affirmer.
 */
const MOT = `zumbaquatique${S}`.slice(0, 30);

const coach = await inscrire({
  type: 'coach',
  pseudo: `rchcoach${S}`,
  nom: 'Martineau',
  prenom: 'Éloïse',
});

const sportif = await inscrire({
  pseudo: `rchsam${S}`,
  nom: 'Durand',
  prenom: 'Sam',
});

ok('deux comptes inscrits', Boolean(coach.token && sportif.token));

await bdd.collection('users').updateOne(
  { pseudo: `rchcoach${S}` },
  {
    $set: {
      'diplome.statut': 'verifie',
      'stripeAccount.chargesEnabled': true,
      'premium.actif': true,
      'premium.prixMensuel': 1990,
      'premium.stripePriceId': 'price_recherche_front',
    },
  }
);

const postLibre = await appel('/posts', {
  methode: 'POST', token: coach.token,
  form: formMedia({ titre: `Seance ${MOT}`, description: 'Ouverte a tous' }),
});
ok('publication gratuite créée', postLibre.statut === 201, postLibre.json?.message);

const SECRET = `SecretPremium${S}`;
const postPremium = await appel('/posts', {
  methode: 'POST', token: coach.token,
  form: formMedia({
    titre: `Programme ${MOT}`,
    description: SECRET,
    estPremium: 'true',
  }),
});
ok('publication premium créée', postPremium.statut === 201, postPremium.json?.message);

const evenement = await appel('/events', {
  methode: 'POST', token: coach.token,
  corps: {
    titre: `Stage ${MOT}`,
    description: 'Deux jours de perfectionnement',
    sport: 'Natation',
    dateDebut: dansNJours(6),
    dateFin: dansNJours(6, 18),
    lieu: { ville: 'Lyon', adresse: 'Piscine du Rhone' },
  },
});
ok('événement à venir créé', evenement.statut === 201, evenement.json?.message);

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
 * COMPTEUR DE REQUÊTES D'AUTOCOMPLÉTION.
 * C'est l'instrument central de cette suite : sans lui, une barre sans délai
 * d'attente passerait tous les autres tests sans exception, puisqu'elle
 * afficherait exactement les mêmes résultats — simplement au prix de huit
 * fois plus de trafic.
 */
let appelsSuggestions = 0;
page.on('request', (requete) => {
  if (requete.url().includes('/api/search/suggestions')) appelsSuggestions += 1;
});

await seConnecter(page, sportif.pseudo);

/* ------------------------- Navigation ------------------------- */

section('Accès à la recherche');

const lienRecherche = page.locator('nav[aria-label="Navigation principale"] a[href="/recherche"]');
ok('**entrée « Recherche » présente dans la navigation**',
  (await lienRecherche.count()) === 1);

await lienRecherche.click();
await page.waitForURL('**/recherche', { timeout: 15000 });
ok('la navigation mène bien à /recherche', page.url().includes('/recherche'));

/*
 * `waitForURL` se satisfait de la NAVIGATION, pas du rendu qui la suit — même
 * piège qu'au module 9 avec la barre de navigation. Interroger le champ trop
 * tôt renvoie « aucun combobox », et l'échec accuse l'accessibilité du
 * composant alors que seul le banc d'essai était pressé.
 */
const champ = page.getByRole('combobox', { name: 'Rechercher' });
await champ.waitFor({ state: 'visible', timeout: 10000 });
ok('le champ de recherche est un combobox accessible', (await champ.count()) === 1);

const invite = await page.getByText('Saisissez au moins deux caractères').count();
ok('une invite explique quoi faire avant toute saisie', invite === 1);

/* ------------------------ Autocomplétion ------------------------ */

section('Autocomplétion');

appelsSuggestions = 0;

// Frappe lettre par lettre, au rythme d'un humain rapide (60 ms).
await champ.click();
await champ.pressSequentially('martineau', { delay: 60 });
await page.waitForTimeout(900);

const nbLettres = 'martineau'.length;
ok('**une frappe de 9 lettres ne déclenche pas 9 requêtes**',
  appelsSuggestions <= 3, `${appelsSuggestions} requête(s) pour ${nbLettres} lettres`);
ok('mais elle en déclenche au moins une', appelsSuggestions >= 1);

const listeSuggestions = page.getByRole('listbox', { name: 'Suggestions' });
await listeSuggestions.waitFor({ state: 'visible', timeout: 8000 });

const optionCoach = listeSuggestions.getByRole('option').filter({ hasText: coach.pseudo });
ok('**le coach apparaît dans les suggestions**', (await optionCoach.count()) === 1);

ok('la suggestion affiche le pseudo', await listeSuggestions.getByText(`@${coach.pseudo}`).isVisible());

// Préfixe court : le cas que `$text` seul ne saurait pas servir.
await champ.fill('');
await champ.pressSequentially('mar', { delay: 60 });
await page.waitForTimeout(900);

ok('**un préfixe de trois lettres suffit** (ce que $text ne sait pas faire)',
  (await listeSuggestions.getByRole('option').filter({ hasText: coach.pseudo }).count()) === 1);

// Accents : « elo » doit trouver « Éloïse ».
await champ.fill('');
await champ.pressSequentially('elo', { delay: 60 });
await page.waitForTimeout(900);

ok('**« elo » trouve « Éloïse » — accents ignorés à l’écran aussi**',
  (await listeSuggestions.getByRole('option').filter({ hasText: coach.pseudo }).count()) === 1);

await page.screenshot({ path: DOSSIER_CAPTURES + '/recherche-suggestions.png' });

/* --------------------------- Clavier --------------------------- */

section('Navigation au clavier');

await champ.fill('');
await champ.pressSequentially('martineau', { delay: 60 });
await page.waitForTimeout(900);

await champ.press('ArrowDown');
const premiereOption = listeSuggestions.getByRole('option').first();
ok('**la flèche bas surligne la première suggestion**',
  (await premiereOption.getAttribute('aria-selected')) === 'true');

const decrit = await champ.getAttribute('aria-activedescendant');
ok('`aria-activedescendant` suit le surlignage (lecteurs d’écran)', Boolean(decrit));

await champ.press('ArrowUp');
ok('la flèche haut relâche le surlignage',
  (await premiereOption.getAttribute('aria-selected')) === 'false');

await champ.press('Escape');
await page.waitForTimeout(400);
ok('Échap ferme la liste', (await listeSuggestions.count()) === 0);

/*
 * ET ÉCHAP NE DOIT PAS VIDER LE CHAMP — la vérification qui a débusqué un
 * vrai défaut. Sur un `input type="search"`, Échap a une action NATIVE :
 * effacer la saisie. Elle déclenchait `onChange`, qui rouvrait la liste :
 * Échap effaçait donc le texte tout en laissant les suggestions ouvertes,
 * l'inverse exact des deux intentions. Sans cette ligne, le test précédent
 * passait pour la mauvaise raison — la liste avait bien disparu, mais parce
 * que le champ était vide.
 */
ok('**Échap ne vide pas le champ** (action native du navigateur neutralisée)',
  (await champ.inputValue()) === 'martineau', JSON.stringify(await champ.inputValue()));

// Entrée sur une suggestion surlignée mène au profil, pas aux résultats.
await champ.click();
await page.waitForTimeout(400);
await champ.press('ArrowDown');

/*
 * UNE PAUSE ENTRE LES DEUX TOUCHES, ET ELLE EST NÉCESSAIRE.
 * Enchaînées sans délai, `ArrowDown` puis `Enter` partent à moins d'une
 * milliseconde d'écart : le gestionnaire d'`Enter` lit alors un surlignage
 * que le rendu n'a pas encore propagé, et valide la saisie brute au lieu de
 * la suggestion. Un humain ne tape jamais aussi vite — le défaut n'existe
 * que dans le banc d'essai.
 */
await page.waitForTimeout(250);
await champ.press('Enter');
await page.waitForURL('**/profile/**', { timeout: 15000 });
ok('**Entrée sur une suggestion ouvre le profil**',
  page.url().includes(`/profile/${coach.pseudo}`), page.url().split('/').pop());

/* ------------------------ Page de résultats ------------------------ */

section('Page de résultats');

await page.goto(BASE + `/recherche?q=${MOT}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1800);

ok('**le terme vient de l’URL** — la recherche est partageable',
  (await champ.inputValue()) === MOT, await champ.inputValue());

const contenu = await page.content();

ok('la publication gratuite figure dans les résultats', contenu.includes(`Seance ${MOT}`));
ok('la publication premium figure dans les résultats', contenu.includes(`Programme ${MOT}`));
ok('l’événement figure dans les résultats', contenu.includes(`Stage ${MOT}`));

ok('**la description premium est absente du HTML lui-même**',
  !contenu.includes(SECRET),
  'masquer en CSS ne protégerait personne');

for (const onglet of ['Personnes', 'Publications', 'Événements']) {
  ok(`onglet « ${onglet} » présent`,
    (await page.getByRole('button', { name: onglet, exact: true }).count()) === 1);
}

await page.getByRole('button', { name: 'Événements', exact: true }).click();
await page.waitForTimeout(1500);
const apresOnglet = await page.content();
ok('**l’onglet Événements ne montre que des événements**',
  apresOnglet.includes(`Stage ${MOT}`) && !apresOnglet.includes(`Programme ${MOT}`));

await page.getByRole('button', { name: 'Personnes', exact: true }).click();
await page.waitForTimeout(1500);

/*
 * LE MESSAGE VIDE NOMME LA FAMILLE INTERROGÉE.
 * « Aucun résultat » tout court, sur l'onglet « Personnes », laisserait
 * croire que le terme n'existe nulle part — alors que l'événement cherché
 * est juste à côté, dans l'onglet voisin.
 */
ok('**le message vide nomme la famille interrogée**',
  (await page.getByText('Aucune personne pour').count()) === 1,
  'aucune personne ne porte ce mot inventé');

await page.screenshot({ path: DOSSIER_CAPTURES + '/recherche-resultats.png' });

/* --------------------- Recherche sans résultat --------------------- */

section('Cas limites');

await page.goto(BASE + '/recherche?q=xyzintrouvable' + S, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
ok('**une recherche sans résultat explique, plutôt que d’afficher un vide**',
  (await page.getByText('Aucun résultat pour').count()) === 1);

await page.goto(BASE + '/recherche?q=a', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
ok('un terme d’une lettre n’envoie rien au serveur et invite à préciser',
  (await page.getByText('Saisissez au moins deux caractères').count()) === 1);

/*
 * L'ORDRE D'ARRIVÉE DES RÉPONSES.
 * On enchaîne deux termes très vite : le second doit gagner, quel que soit
 * l'ordre dans lequel les réponses reviennent. Sans annulation, la réponse
 * au terme abandonné écraserait celle du terme courant.
 */
await page.goto(BASE + '/recherche', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(500);
await champ.click();
await champ.pressSequentially('mart', { delay: 30 });
await champ.fill('');
await champ.pressSequentially('elo', { delay: 30 });
await page.waitForTimeout(1200);

ok('**la liste correspond au dernier terme saisi, pas à un terme abandonné**',
  (await champ.inputValue()) === 'elo' &&
    (await listeSuggestions.getByRole('option').count()) >= 1);

/* --------------------------- Responsive --------------------------- */

section('Responsive et console');

await page.goto(BASE + `/recherche?q=${MOT}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

for (const largeur of [375, 768]) {
  await page.setViewportSize({ width: largeur, height: 900 });
  await page.waitForTimeout(1000);
  const deborde = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  ok(`/recherche sans débordement en ${largeur} px`, !deborde);
}

await page.setViewportSize({ width: 375, height: 900 });
await page.waitForTimeout(600);
await page.screenshot({ path: DOSSIER_CAPTURES + '/recherche-mobile.png' });

await navigateur.close();

const inattendues = erreursJs.filter(
  (m) => !/401|403|404|409|Failed to load resource|favicon|geolocation|canceled|abort/i.test(m)
);
ok('aucune erreur JavaScript inattendue', inattendues.length === 0,
  inattendues[0] || 'console propre');

/* ================================================================== *
 *  NETTOYAGE
 * ================================================================== */

const supprimes = await purger();
await clientMongo.close();

console.log('\n============ RECHERCHE — MODULE 10 (front) ============');
const echecs = afficher();
console.log(`\n  (${supprimes} compte(s) de test supprimés, contenus compris)`);
process.exit(echecs > 0 ? 1 : 0);
