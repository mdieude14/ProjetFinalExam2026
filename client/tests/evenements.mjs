/**
 * ===========================================================================
 *  ÉVÉNEMENTS SPORTIFS — MODULE 9, PARCOURS NAVIGATEUR
 * ===========================================================================
 *
 *   npm run test:evenements
 *
 * Prérequis : l'API (port 5000) et Vite (port 5173) doivent tourner.
 *
 * CE QUE CETTE SUITE AJOUTE À `server/tests/evenements.mjs`.
 * La suite serveur prouve que les règles tiennent : capacité, concurrence,
 * accès premium, annulation. Elle ne dit rien de ce que l'utilisateur voit.
 * Or trois pannes classiques ne se manifestent QUE dans un navigateur :
 *
 *   - une réponse correcte affichée nulle part (bouton absent, liste vide) ;
 *   - un champ masqué à l'écran mais présent dans le HTML — donc lisible par
 *     qui ouvre l'inspecteur : le contraire d'une protection ;
 *   - une mise en page qui déborde sous 375 px, invisible sur un écran large.
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
const DOM = '@evtest.local';
const MDP = 'MotDePasse123';
const S = Date.now();

const DOSSIER_CAPTURES = fileURLToPath(new URL('../captures/', import.meta.url));
mkdirSync(DOSSIER_CAPTURES, { recursive: true });

/* Place Bellecour, Lyon — lieu des événements. */
const BELLECOUR = { lng: 4.832011, lat: 45.757814 };
/* Gare de la Part-Dieu — position du visiteur, à ~2,1 km. */
const PARTDIEU = { lng: 4.8592, lat: 45.7605 };

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

async function inscrire({ type, pseudo, prenom }) {
  const r = await appel('/auth/register', {
    methode: 'POST',
    corps: {
      type, nom: 'Event', prenom, pseudo,
      email: `${pseudo}${DOM}`, password: MDP, ville: 'Lyon',
      ...(type === 'coach' ? { diplome: { intitule: 'BPJEPS', organisme: 'DRJSCS' } } : {}),
    },
  });
  return r.json?.accessToken;
}

/** Dans N jours, à l'heure ronde. */
const dansNJours = (n, heure = 10) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(heure, 0, 0, 0);
  return d.toISOString();
};

/** Connecte un contexte navigateur avec un compte donné. */
async function seConnecter(page, pseudo) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email ou pseudo').fill(pseudo);
  await page.getByLabel('Mot de passe').fill(MDP);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL('**/home', { timeout: 25000 });

  /*
   * `waitForURL` se satisfait de la NAVIGATION, pas du rendu qui la suit.
   * La barre de navigation est montée un instant plus tard, et l'interroger
   * trop tôt renvoie « aucun lien » — un échec qui accuse le composant alors
   * que seul le banc d'essai était pressé.
   */
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

const motifTest = /@evtest[.]local$/;

/**
 * PURGE D'ENTRÉE, ET PAS SEULEMENT DE SORTIE.
 * Une exécution interrompue laisse ses comptes et ses événements en base.
 * La suivante trouverait deux « Sortie course » et un sélecteur censé
 * désigner un événement en désignerait deux : échec incompréhensible, sans
 * rapport avec le code testé.
 */
async function purger() {
  const comptes = await bdd
    .collection('users')
    .find({ email: motifTest }, { projection: { _id: 1 } })
    .toArray();
  const ids = comptes.map((u) => u._id);

  if (ids.length === 0) return 0;

  const evenements = await bdd
    .collection('sportevents')
    .find({ organisateur: { $in: ids } }, { projection: { _id: 1 } })
    .toArray();
  const idsEvenements = evenements.map((e) => e._id);

  await bdd.collection('eventregistrations').deleteMany({
    $or: [{ event: { $in: idsEvenements } }, { utilisateur: { $in: ids } }],
  });
  await bdd.collection('sportevents').deleteMany({ _id: { $in: idsEvenements } });
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

const pseudoCoach = `evcoach${S}`;
const pseudoSportif = `evsportif${S}`;
const pseudoNovice = `evnovice${S}`; // coach au diplôme non vérifié

const jetonCoach = await inscrire({ type: 'coach', pseudo: pseudoCoach, prenom: 'Camille' });
const jetonSportif = await inscrire({ type: 'utilisateur', pseudo: pseudoSportif, prenom: 'Sam' });
const jetonNovice = await inscrire({ type: 'coach', pseudo: pseudoNovice, prenom: 'Noa' });

ok('trois comptes inscrits', Boolean(jetonCoach && jetonSportif && jetonNovice));

// Seul le premier coach est certifié : la modération est couverte ailleurs.
await bdd.collection('users').updateOne(
  { pseudo: pseudoCoach },
  { $set: { 'diplome.statut': 'verifie' } }
);

const evenementPublic = await appel('/events', {
  methode: 'POST',
  token: jetonCoach,
  corps: {
    titre: `Sortie course ${S}`,
    description: 'Dix kilomètres à allure modérée, retour au point de départ.',
    sport: 'Course à pied',
    dateDebut: dansNJours(3),
    dateFin: dansNJours(3, 12),
    capaciteMax: 4,
    lieu: {
      ville: 'Lyon',
      adresse: 'Place Bellecour',
      longitude: BELLECOUR.lng,
      latitude: BELLECOUR.lat,
    },
  },
});
ok('événement public créé', evenementPublic.statut === 201, evenementPublic.json?.message);

const evenementPrive = await appel('/events', {
  methode: 'POST',
  token: jetonCoach,
  corps: {
    titre: `Stage privé ${S}`,
    type: 'prive',
    dateDebut: dansNJours(5),
    dateFin: dansNJours(5, 16),
    lieu: {
      ville: 'Lyon',
      adresse: 'Gymnase secret rue Confidentielle',
      longitude: BELLECOUR.lng,
      latitude: BELLECOUR.lat,
    },
  },
});
ok('événement privé créé', evenementPrive.statut === 201, evenementPrive.json?.message);

const idPublic = evenementPublic.json?.evenement?._id;
const idPrive = evenementPrive.json?.evenement?._id;

/* ================================================================== *
 *  NAVIGATEUR — LE SPORTIF
 * ================================================================== */

section('Sportif — liste et inscription');

const erreursJs = [];
const navigateur = await chromium.launch();

/*
 * Permission de géolocalisation ACCORDÉE et position IMPOSÉE : sans les deux,
 * Chromium en mode automatisé n'a aucune position à fournir et l'onglet
 * « Autour de moi » resterait sur son écran d'invitation.
 */
const ctx = await navigateur.newContext({
  viewport: { width: 1280, height: 950 },
  permissions: ['geolocation'],
  geolocation: { longitude: PARTDIEU.lng, latitude: PARTDIEU.lat },
  locale: 'fr-FR',
});

const page = await ctx.newPage();
page.on('pageerror', (e) => erreursJs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') erreursJs.push(m.text()); });

await seConnecter(page, pseudoSportif);

// L'entrée de navigation doit exister : une page sans porte d'entrée
// n'existe pas pour l'utilisateur.
ok('entrée « Événements » dans la navigation',
  (await page.getByRole('link', { name: /Événements/ }).count()) > 0);

await page.goto(BASE + '/evenements', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

ok('la page des événements s’ouvre', page.url().endsWith('/evenements'), page.url());
ok('l’événement public figure dans la liste',
  (await page.getByText(`Sortie course ${S}`).count()) > 0);
ok('les places restantes sont annoncées',
  (await page.getByText(/place[s]? sur 4/).count()) > 0);

ok('**un sportif ne se voit pas proposer de créer un événement**',
  (await page.getByRole('button', { name: 'Créer un événement' }).count()) === 0);

/* ---------------------- Fiche et inscription ---------------------- */

await page.goto(BASE + `/evenements/${idPublic}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

ok('la fiche affiche le titre',
  (await page.getByRole('heading', { name: `Sortie course ${S}` }).count()) > 0);
ok('l’adresse d’un événement public est visible',
  (await page.getByText('Place Bellecour').count()) > 0);

ok('**la liste des participants n’est pas servie à un simple visiteur**',
  (await page.getByRole('heading', { name: /^Participants/ }).count()) === 0);

await page.getByRole('button', { name: 'Je participe' }).click();
await page.waitForTimeout(2000);

ok('**inscription confirmée à l’écran**',
  (await page.getByText('Vous êtes inscrit à cet événement').count()) > 0);
ok('le compteur passe à 1 / 4', (await page.getByText('1 / 4').count()) > 0);

await page.screenshot({ path: DOSSIER_CAPTURES + '/evenement-inscrit.png' });

/* ------------------------ Mes inscriptions ------------------------ */

await page.goto(BASE + '/evenements', { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Mes inscriptions' }).click();
await page.waitForTimeout(1800);

ok('l’événement figure dans « mes inscriptions »',
  (await page.getByText(`Sortie course ${S}`).count()) > 0);

/* -------------------------- Désinscription -------------------------- */

await page.goto(BASE + `/evenements/${idPublic}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Me désinscrire' }).click();
await page.waitForTimeout(2000);

ok('**la place est rendue**', (await page.getByText('Votre place a été libérée').count()) > 0);
ok('le compteur revient à 0 / 4', (await page.getByText('0 / 4').count()) > 0);

/* ================================================================== *
 *  ÉVÉNEMENT PRIVÉ
 * ================================================================== */

section('Événement privé');

await page.goto(BASE + `/evenements/${idPrive}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

const html = await page.content();

/*
 * LA VÉRIFICATION QUI COMPTE : l'adresse ne doit pas être DANS LE HTML.
 * La masquer en CSS ne protégerait de personne — il suffirait d'ouvrir
 * l'inspecteur. C'est le serveur qui la retire de la réponse, et c'est cela
 * que l'on mesure ici.
 */
ok('**l’adresse exacte est absente du HTML pour un non-abonné**',
  !html.includes('Confidentielle'));

ok('la ville reste visible', (await page.getByText('Lyon').count()) > 0);
ok('le titre reste visible',
  (await page.getByRole('heading', { name: `Stage privé ${S}` }).count()) > 0);
ok('le verrouillage est expliqué, pas subi',
  (await page.getByText(/réservé aux abonnés premium/i).count()) > 0);
ok('aucun bouton « Je participe » trompeur',
  (await page.getByRole('button', { name: 'Je participe' }).count()) === 0);

/* ================================================================== *
 *  AUTOUR DE MOI
 * ================================================================== */

section('Autour de moi');

await page.goto(BASE + '/evenements', { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Autour de moi' }).click();
await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Me localiser' }).click().catch(() => {});
await page.waitForTimeout(3500);

ok('la carte est rendue', (await page.locator('.leaflet-container').count()) > 0);

/*
 * LE FOND DE PLAN DÉPEND D'UN SERVEUR EXTERNE (tile.openstreetmap.org).
 * On le sonde depuis la PAGE, pas depuis Node : c'est le navigateur qui
 * charge les tuiles, et lui seul peut dire si elles lui sont accessibles.
 */
await page.waitForSelector('.leaflet-tile-loaded', { timeout: 12000 }).catch(() => {});
const tuiles = await page.locator('.leaflet-tile-loaded').count();
if (tuiles === 0) {
  console.log('  (fond de plan indisponible — vérifications de tuiles ignorées)');
} else {
  ok('fond de plan chargé', tuiles > 0, `${tuiles} tuiles`);
}

const marqueurs = await page.locator('.leaflet-marker-icon').count();
// Un marqueur pour la position du visiteur, au moins un pour l'événement.
ok('**les marqueurs d’événements sont visibles**', marqueurs >= 2, `${marqueurs} marqueurs`);

ok('la distance calculée par le serveur est affichée',
  (await page.getByText(/à [0-9]/).count()) > 0);

await page.screenshot({ path: DOSSIER_CAPTURES + '/evenements-carte.png' });

/* --------------------------- Responsive --------------------------- */

for (const largeur of [375, 768]) {
  await page.setViewportSize({ width: largeur, height: 900 });
  await page.waitForTimeout(1200);
  const deborde = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  ok(`/evenements sans débordement en ${largeur} px`, !deborde);
}

await page.setViewportSize({ width: 375, height: 900 });
await page.goto(BASE + `/evenements/${idPublic}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const debordeDetail = await page.evaluate(
  () => document.documentElement.scrollWidth > window.innerWidth + 1
);
ok('la fiche sans débordement en 375 px', !debordeDetail);
await page.screenshot({ path: DOSSIER_CAPTURES + '/evenement-mobile.png' });

/* ================================================================== *
 *  NAVIGATEUR — LE COACH ORGANISATEUR
 * ================================================================== */

section('Coach — création, participants, annulation');

const ctxCoach = await navigateur.newContext({
  viewport: { width: 1280, height: 950 },
  permissions: ['geolocation'],
  geolocation: { longitude: BELLECOUR.lng, latitude: BELLECOUR.lat },
  locale: 'fr-FR',
});
const pageCoach = await ctxCoach.newPage();
pageCoach.on('pageerror', (e) => erreursJs.push(e.message));
pageCoach.on('console', (m) => { if (m.type() === 'error') erreursJs.push(m.text()); });

await seConnecter(pageCoach, pseudoCoach);
await pageCoach.goto(BASE + '/evenements', { waitUntil: 'domcontentloaded' });
await pageCoach.waitForTimeout(1200);

ok('**un coach certifié peut créer un événement**',
  (await pageCoach.getByRole('button', { name: 'Créer un événement' }).count()) > 0);

await pageCoach.getByRole('button', { name: 'Créer un événement' }).click();
await pageCoach.waitForTimeout(600);

/*
 * ON CIBLE L'INTÉRIEUR DE LA FENÊTRE MODALE, pas la page entière.
 * Les filtres de la liste restent dans le DOM derrière la modale : un
 * `getByLabel('Sport')` global en trouve deux et échoue. Le champ visé n'est
 * pas ambigu pour l'utilisateur — il ne voit que la fenêtre ouverte —, le
 * sélecteur doit donc l'être aussi peu.
 */
const modale = pageCoach.getByRole('dialog', { name: 'Nouvel événement' });

const titreCree = `Cours collectif ${S}`;
await modale.getByLabel('Titre').fill(titreCree);
await modale.getByLabel('Sport').fill('Renforcement');
await modale.getByLabel('Ville').fill('Lyon');
await modale.getByLabel('Adresse du rendez-vous').fill('Parc de la Tête d’Or');
await modale.getByLabel('Nombre de places').fill('12');

await modale.getByRole('button', { name: 'Créer l’événement' }).click();
await pageCoach.waitForURL('**/evenements/**', { timeout: 20000 });
await pageCoach.waitForTimeout(1500);

ok('la création mène à la fiche du nouvel événement',
  (await pageCoach.getByRole('heading', { name: titreCree }).count()) > 0);

ok('**l’organisateur voit la liste de ses participants**',
  (await pageCoach.getByRole('heading', { name: /^Participants/ }).count()) > 0);

ok('l’organisateur ne se voit pas proposer de s’inscrire',
  (await pageCoach.getByText('Vous organisez cet événement').count()) > 0);

/* ---------------------------- Modification ---------------------------- */

await pageCoach.getByRole('button', { name: 'Modifier' }).click();
await pageCoach.waitForTimeout(600);

const modaleEdition = pageCoach.getByRole('dialog', { name: 'Modifier l’événement' });
await modaleEdition.getByLabel('Titre').fill(`${titreCree} — corrigé`);
await modaleEdition.getByRole('button', { name: 'Enregistrer' }).click();
await pageCoach.waitForTimeout(2000);

ok('la modification est prise en compte',
  (await pageCoach.getByRole('heading', { name: `${titreCree} — corrigé` }).count()) > 0);

/* ----------------------------- Annulation ----------------------------- */

await pageCoach.getByRole('button', { name: 'Annuler l’événement' }).click();
await pageCoach.waitForTimeout(600);

const modaleAnnulation = pageCoach.getByRole('dialog', { name: 'Annuler cet événement' });
await modaleAnnulation.getByLabel(/Motif/).fill('Météo défavorable');
await modaleAnnulation.getByRole('button', { name: 'Confirmer l’annulation' }).click();
await pageCoach.waitForTimeout(2500);

/*
 * ANNULER N'EST PAS SUPPRIMER : l'événement doit rester consultable, avec
 * son motif. Le faire disparaître laisserait les inscrits avec une date
 * bloquée et aucune explication.
 */
ok('**l’événement existe toujours après annulation**',
  (await pageCoach.getByRole('heading', { name: `${titreCree} — corrigé` }).count()) > 0);
ok('le statut « annulé » est affiché',
  (await pageCoach.getByText('Annulé', { exact: true }).count()) > 0);
ok('le motif est visible', (await pageCoach.getByText('Météo défavorable').count()) > 0);

await pageCoach.screenshot({ path: DOSSIER_CAPTURES + '/evenement-annule.png' });

/* ================================================================== *
 *  COACH NON CERTIFIÉ
 * ================================================================== */

section('Coach non certifié');

const ctxNovice = await navigateur.newContext({ viewport: { width: 1280, height: 950 }, locale: 'fr-FR' });
const pageNovice = await ctxNovice.newPage();
pageNovice.on('pageerror', (e) => erreursJs.push(e.message));

await seConnecter(pageNovice, pseudoNovice);
await pageNovice.goto(BASE + '/evenements', { waitUntil: 'domcontentloaded' });
await pageNovice.waitForTimeout(1200);

/*
 * Le serveur refuserait de toute façon. Ne pas afficher le bouton évite de
 * promettre une action vouée au refus — la meilleure façon de faire croire
 * à une panne.
 */
ok('**pas de bouton de création pour un diplôme non vérifié**',
  (await pageNovice.getByRole('button', { name: 'Créer un événement' }).count()) === 0);

await navigateur.close();

const inattendues = erreursJs.filter(
  (m) => !/401|403|404|409|Failed to load resource|favicon|geolocation/i.test(m)
);
ok('aucune erreur JavaScript inattendue', inattendues.length === 0,
  inattendues[0] || 'console propre');

/* ================================================================== *
 *  NETTOYAGE
 * ================================================================== */

const supprimes = await purger();
await clientMongo.close();

console.log('\n========= ÉVÉNEMENTS SPORTIFS — MODULE 9 (front) =========');
const echecs = afficher();
console.log(`\n  (${supprimes} compte(s) de test supprimés, événements compris)`);
process.exit(echecs > 0 ? 1 : 0);
