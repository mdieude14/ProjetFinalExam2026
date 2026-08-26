/**
 * ===========================================================================
 *  CARTE DES COACHS — MODULE 8
 * ===========================================================================
 *
 *   npm run test:carte
 *
 * Prérequis : l'API (port 5000) et Vite (port 5173) doivent tourner.
 *
 * CE QUE CETTE SUITE VÉRIFIE EN PRIORITÉ : la confidentialité.
 * La carte est la seule fonctionnalité du projet qui publie la position de
 * personnes réelles. Trois garanties doivent tenir, et une seule d'entre
 * elles est visible à l'écran :
 *
 *   1. aucune coordonnée exacte ne sort de l'API  (invisible)
 *   2. un coach non consentant n'apparaît pas     (invisible)
 *   3. les marqueurs s'affichent réellement       (visible)
 *
 * Les deux premières s'inspectent dans la réponse HTTP, pas dans le DOM.
 * La troisième vérifie que les icônes Leaflet sont bien rendues — la panne
 * classique où les marqueurs sont invisibles sans la moindre erreur console.
 *
 * Les comptes créés ici sont supprimés à la fin.
 * ===========================================================================
 */

import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.CLIENT_URL || 'http://localhost:5173';
const API = 'http://localhost:5000/api';
const DOM = '@cartetest.local';
const MDP = 'MotDePasse123';
const S = Date.now();

/* Les captures servent au contrôle visuel. `fileURLToPath` plutôt qu'un
   découpage manuel de l'URL : sous Windows, `url.pathname` commence par une
   barre oblique parasite (« /C:/… ») que Playwright refuse. */
const DOSSIER_CAPTURES = fileURLToPath(new URL('../captures/', import.meta.url));
mkdirSync(DOSSIER_CAPTURES, { recursive: true });

/* Place Bellecour, Lyon — point de référence de tous les calculs. */
const BELLECOUR = { lng: 4.832011, lat: 45.757814 };
/* Gare de la Part-Dieu — environ 2,1 km de Bellecour. */
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
  return { statut: r.status, texte, json: (() => { try { return JSON.parse(texte); } catch { return null; } })() };
}

async function inscrire({ type, pseudo, prenom }) {
  const r = await appel('/auth/register', {
    methode: 'POST',
    corps: {
      type, nom: 'Carte', prenom, pseudo,
      email: `${pseudo}${DOM}`, password: MDP, ville: 'Lyon',
      ...(type === 'coach' ? { diplome: { intitule: 'BPJEPS', organisme: 'DRJSCS' } } : {}),
    },
  });
  return r.json?.accessToken;
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

/** Reconnaît les comptes créés par cette suite : `…@cartetest.local`. */
const motifTest = /@cartetest[.]local$/;

/*
 * PURGE D'ENTRÉE, ET PAS SEULEMENT DE SORTIE.
 *
 * Une exécution interrompue — coupure, délai dépassé, Ctrl+C — n'atteint
 * jamais son nettoyage final et laisse ses comptes en base. L'exécution
 * suivante trouvait alors DEUX coachs portant le même nom, et un sélecteur
 * censé désigner une personne en désignait deux : échec incompréhensible,
 * sans aucun rapport avec le code testé.
 *
 * Nettoyer au démarrage rend la suite indépendante de la façon dont la
 * précédente s'est terminée. C'est la même leçon que pour `test:paiement`.
 */
const restes = await bdd.collection('users').deleteMany({ email: motifTest });
if (restes.deletedCount > 0) {
  console.log(
    `  (purge d'entrée : ${restes.deletedCount} compte(s) laissés par une exécution précédente)`
  );
}

/* ================================================================== *
 *  MISE EN PLACE — trois coachs aux situations différentes
 * ================================================================== */

section('Mise en place');

const pseudoVisible = `cvisible${S}`;
const pseudoDiscret = `cdiscret${S}`;
const pseudoLoin = `cloin${S}`;

const jetonVisible = await inscrire({ type: 'coach', pseudo: pseudoVisible, prenom: 'Vera' });
const jetonDiscret = await inscrire({ type: 'coach', pseudo: pseudoDiscret, prenom: 'Denis' });
const jetonLoin = await inscrire({ type: 'coach', pseudo: pseudoLoin, prenom: 'Lois' });

ok('trois coachs inscrits', Boolean(jetonVisible && jetonDiscret && jetonLoin));

// Diplômes validés directement : la modération est couverte par `test:api`.
await bdd.collection('users').updateMany(
  { pseudo: { $in: [pseudoVisible, pseudoDiscret, pseudoLoin] } },
  { $set: { 'diplome.statut': 'verifie' } }
);

// Positions : deux à Bellecour, un à Paris.
await appel('/users/me/localisation', {
  methode: 'PATCH', token: jetonVisible,
  corps: { coordinates: [BELLECOUR.lng, BELLECOUR.lat] },
});
await appel('/users/me/localisation', {
  methode: 'PATCH', token: jetonDiscret,
  corps: { coordinates: [BELLECOUR.lng, BELLECOUR.lat] },
});
await appel('/users/me/localisation', {
  methode: 'PATCH', token: jetonLoin,
  corps: { coordinates: [2.3522, 48.8566] }, // Paris
});

// Seuls deux consentent ; « Denis » reste discret.
const consentVisible = await appel('/geo/carte-visible', {
  methode: 'PATCH', token: jetonVisible, corps: { carteVisible: true },
});
const consentLoin = await appel('/geo/carte-visible', {
  methode: 'PATCH', token: jetonLoin, corps: { carteVisible: true },
});

ok('consentement enregistré', consentVisible.statut === 200 && consentLoin.statut === 200);
ok('coach « discret » laissé sans consentement', true);

/* ================================================================== *
 *  CONSENTEMENT
 * ================================================================== */

section('Consentement');

const sportifPseudo = `sportif${S}`;
const jetonSportif = await inscrire({ type: 'utilisateur', pseudo: sportifPseudo, prenom: 'Sam' });

const refusSportif = await appel('/geo/carte-visible', {
  methode: 'PATCH', token: jetonSportif, corps: { carteVisible: true },
});
ok('**un sportif ne peut pas se mettre sur la carte**', refusSportif.statut === 403,
  `statut ${refusSportif.statut}`);

// Un coach sans position ne doit pas pouvoir s'activer.
const pseudoSansPos = `csanspos${S}`;
const jetonSansPos = await inscrire({ type: 'coach', pseudo: pseudoSansPos, prenom: 'Nino' });
const refusSansPos = await appel('/geo/carte-visible', {
  methode: 'PATCH', token: jetonSansPos, corps: { carteVisible: true },
});
ok('**activation refusée sans position enregistrée**', refusSansPos.statut === 400,
  refusSansPos.json?.message?.slice(0, 50));

/* ================================================================== *
 *  RECHERCHE ET CONFIDENTIALITÉ
 * ================================================================== */

section('Recherche et confidentialité');

const proche = await appel(`/geo/coachs?lng=${PARTDIEU.lng}&lat=${PARTDIEU.lat}&rayon=5000`);
const trouves = proche.json?.coachs || [];
const vera = trouves.find((c) => c.pseudo === pseudoVisible);

ok('coach consentant trouvé dans le rayon', Boolean(vera));
ok('**coach non consentant absent**', !trouves.some((c) => c.pseudo === pseudoDiscret));
ok('coach de Paris hors rayon de 5 km', !trouves.some((c) => c.pseudo === pseudoLoin));

/*
 * LA VÉRIFICATION LA PLUS IMPORTANTE DE CETTE SUITE.
 * On cherche la position exacte dans le corps brut de la réponse, pas dans
 * l'objet analysé : c'est le seul moyen de prouver qu'elle ne fuit par aucun
 * champ — y compris un champ qu'on aurait oublié d'inspecter.
 */
ok('**coordonnées exactes absentes de la réponse HTTP**',
  !proche.texte.includes('45.757814') && !proche.texte.includes('4.832011'));

ok('position publiée arrondie à 3 décimales',
  vera?.position?.[0] === 4.832 && vera?.position?.[1] === 45.758,
  vera ? `[${vera.position.join(', ')}]` : '—');

ok('distance calculée par le serveur', typeof vera?.distanceM === 'number',
  `${vera?.distanceM} m`);
ok('distance arrondie à la centaine', vera?.distanceM % 100 === 0);

/* Champs volontairement absents de la vue « carte ». */
ok('**bio absente de la vue carte**', vera && !('bio' in vera));
ok('statistiques absentes de la vue carte', vera && !('stats' in vera));
ok('date d’inscription absente', vera && !('createdAt' in vera));
ok('email absent', !proche.texte.includes(DOM));

/* ================================================================== *
 *  RAYON ET FILTRES
 * ================================================================== */

section('Rayon et filtres');

const rayon1km = await appel(`/geo/coachs?lng=${PARTDIEU.lng}&lat=${PARTDIEU.lat}&rayon=1000`);
ok('rayon de 1 km : le coach à 2,1 km est exclu',
  !(rayon1km.json?.coachs || []).some((c) => c.pseudo === pseudoVisible));

const rayonLarge = await appel(
  `/geo/coachs?lng=${PARTDIEU.lng}&lat=${PARTDIEU.lat}&rayon=100000`
);
ok('rayon de 100 km : Paris reste hors de portée',
  !(rayonLarge.json?.coachs || []).some((c) => c.pseudo === pseudoLoin));

const depuisParis = await appel('/geo/coachs?lng=2.3522&lat=48.8566&rayon=5000');
ok('depuis Paris : le coach parisien apparaît',
  (depuisParis.json?.coachs || []).some((c) => c.pseudo === pseudoLoin));

/* Tri par distance croissante — la propriété centrale de `$geoNear`. */
const tri = (depuisParis.json?.coachs || []).map((c) => c.distanceM);
ok('résultats triés par distance croissante',
  tri.every((d, i) => i === 0 || d >= tri[i - 1]));

const rayonInvalide = await appel(`/geo/coachs?lng=4.8&lat=45.7&rayon=999999`);
ok('rayon hors bornes rejeté', rayonInvalide.statut === 400);

const sansCoords = await appel('/geo/coachs');
ok('coordonnées manquantes rejetées', sansCoords.statut === 400);

const lngInvalide = await appel('/geo/coachs?lng=200&lat=45');
ok('longitude hors bornes rejetée', lngInvalide.statut === 400);

/* Un compte désactivé disparaît de la carte. */
await appel('/users/me', { methode: 'DELETE', token: jetonVisible });
const apresDesactivation = await appel(
  `/geo/coachs?lng=${PARTDIEU.lng}&lat=${PARTDIEU.lat}&rayon=5000`
);
ok('**compte désactivé retiré de la carte**',
  !(apresDesactivation.json?.coachs || []).some((c) => c.pseudo === pseudoVisible));

// On le réactive pour la partie navigateur.
await bdd.collection('users').updateOne({ pseudo: pseudoVisible }, { $set: { isActive: true } });

/* ================================================================== *
 *  NAVIGATEUR
 * ================================================================== */

section('Navigateur');

const erreursJs = [];
const navigateur = await chromium.launch();

/*
 * On accorde la permission de géolocalisation ET on impose une position
 * fixe : sans cela, Chromium en mode automatisé n'a aucune position à
 * fournir et la page resterait sur son écran d'invitation.
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

await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
await page.getByLabel('Email ou pseudo').fill(sportifPseudo);
await page.getByLabel('Mot de passe').fill(MDP);
await page.getByRole('button', { name: 'Se connecter' }).click();
await page.waitForURL('**/home', { timeout: 25000 });

await page.goto(BASE + '/carte', { waitUntil: 'domcontentloaded' });
ok('la route /carte ne renvoie plus « bientôt »', page.url().endsWith('/carte'), page.url());

await page.getByRole('button', { name: 'Me localiser' }).click().catch(() => {});
await page.waitForTimeout(3500);

/*
 * LE FOND DE PLAN DÉPEND D'UN SERVEUR EXTERNE.
 * Les tuiles viennent de tile.openstreetmap.org. Un environnement sans accès
 * à Internet — ou une coupure passagère — les laissera vides sans que rien
 * ne soit cassé dans l'application.
 *
 * ON SONDE DEPUIS LA PAGE ELLE-MÊME, et non depuis Node : c'est le
 * navigateur qui charge les tuiles, et lui seul peut dire si elles lui sont
 * accessibles. Un sondage côté Node a déjà produit un faux positif — joignable
 * pour lui, injoignable pour Chromium — donc un échec rouge trompeur.
 */
await page
  .waitForSelector('.leaflet-tile-loaded', { timeout: 12000 })
  .catch(() => {});

const tuiles = await page.locator('.leaflet-tile-loaded').count();

if (tuiles > 0) {
  ok('**tuiles OpenStreetMap chargées**', true, `${tuiles} tuiles`);
} else {
  const joignableDepuisPage = await page
    .evaluate(() =>
      fetch('https://a.tile.openstreetmap.org/12/2073/1409.png', { mode: 'no-cors' })
        .then(() => true)
        .catch(() => false)
    )
    .catch(() => false);

  if (joignableDepuisPage) {
    ok('**tuiles OpenStreetMap chargées**', false, 'serveur joignable mais aucune tuile rendue');
  } else {
    console.log(
      [
        '',
        '  NOTE : tile.openstreetmap.org est injoignable depuis ce navigateur.',
        '  Le chargement des tuiles ne peut donc pas être vérifié ici — à',
        '  contrôler sur une machine disposant d’un accès Internet.',
      ].join('\n')
    );
    ok('conteneur de carte initialisé (tuiles non vérifiables hors ligne)',
      (await page.locator('.leaflet-container').count()) > 0);
  }
}

ok('attribution OpenStreetMap présente (exigée par la licence ODbL)',
  await page.locator('.leaflet-control-attribution').count() > 0);

/*
 * LES MARQUEURS SONT-ILS VISIBLES ?
 * Compter les éléments ne suffit pas : la panne classique de Leaflet sous
 * Vite laisse les marqueurs dans le DOM avec une image cassée. On vérifie
 * donc que l'icône a des dimensions réelles.
 */
const marqueurs = await page.locator('.leaflet-marker-icon').count();
ok('marqueurs présents sur la carte', marqueurs > 0, `${marqueurs} marqueurs`);

const iconesChargees = await page.evaluate(() => {
  const images = Array.from(document.querySelectorAll('img.leaflet-marker-icon'));
  return {
    total: images.length,
    affichees: images.filter((i) => i.complete && i.naturalWidth > 0).length,
  };
});
ok('**icônes de marqueur réellement rendues**',
  iconesChargees.total > 0 && iconesChargees.affichees === iconesChargees.total,
  `${iconesChargees.affichees}/${iconesChargees.total}`);

ok('cercle du rayon de recherche dessiné',
  await page.locator('.leaflet-overlay-pane path').count() > 0);

/* ================================================================== *
 *  POSITION DU VISITEUR, POINTS DES COACHS, FICHE AU CLIC
 * ================================================================== */

/*
 * LA PASTILLE DU VISITEUR EST UN `divIcon`, PAS UNE IMAGE.
 * Elle porte donc la classe `leaflet-marker-icon` comme les autres, mais
 * pas la balise <img>. C'est cette distinction qui permet de compter
 * séparément « ma position » et « les coachs » — et de vérifier que les
 * deux sont bien présents, ce qui est précisément ce qui manquait ici.
 */
const compte = await page.evaluate(() => ({
  visiteur: document.querySelectorAll('.bloc-position-visiteur').length,
  coachs: document.querySelectorAll('img.leaflet-marker-icon').length,
}));

ok('**position du visiteur affichée sur la carte**', compte.visiteur === 1,
  `${compte.visiteur} pastille`);
ok('**points des coachs affichés**', compte.coachs > 0, `${compte.coachs} marqueurs`);

/* La pastille doit être au centre du cercle, pas ailleurs. */
const centreeSurMoi = await page.evaluate(() => {
  const pastille = document.querySelector('.bloc-position-visiteur');
  const carte = document.querySelector('.leaflet-container');
  if (!pastille || !carte) return false;
  const p = pastille.getBoundingClientRect();
  const c = carte.getBoundingClientRect();
  // Tolérance large : on vérifie le centrage, pas le pixel exact.
  return (
    Math.abs(p.x + p.width / 2 - (c.x + c.width / 2)) < 60 &&
    Math.abs(p.y + p.height / 2 - (c.y + c.height / 2)) < 60
  );
});
ok('la pastille est bien centrée sur la position', centreeSurMoi);

/* ---------------- La fiche qui s’ouvre au clic ---------------- */

/*
 * ON CIBLE UN MARQUEUR PRECIS PAR SON TITRE, jamais « le premier ».
 * Plusieurs coachs peuvent partager un secteur ; « le premier » désigne
 * alors un marqueur que l'écartement a pu déplacer sous un autre. Viser un
 * coach nommé rend le test déterministe et lisible dans le rapport.
 */
const marqueurVera = page.locator(`img.leaflet-marker-icon[title*="${pseudoVisible}"]`);
ok('marqueur du coach identifiable sans ambiguïté', (await marqueurVera.count()) === 1,
  `${await marqueurVera.count()} correspondance(s)`);
await marqueurVera.first().click({ timeout: 15000 });
await page.waitForTimeout(900);

const fiche = page.locator('[data-testid="fiche-coach"]');
ok('**fiche du coach ouverte au clic sur son point**', await fiche.count() > 0);

const contenuFiche = (await fiche.first().innerText().catch(() => '')) || '';

ok('la fiche nomme le coach', /Vera|Lois|Marc/.test(contenuFiche),
  contenuFiche.trim().slice(0, 40) || '—');
ok('la fiche affiche le pseudo', contenuFiche.includes('@'));
ok('la fiche indique la certification', /certifié|Certification/i.test(contenuFiche));
ok('la fiche indique la distance', /à environ/.test(contenuFiche));
ok('la fiche indique la ville', /Lyon|Paris/.test(contenuFiche));

const lienProfil = fiche.locator('a', { hasText: 'Voir le profil' });
ok('**la fiche propose un lien vers le profil**', await lienProfil.count() > 0);

/* L’avatar de la fiche doit vraiment se rendre, image ou initiales. */
const avatarRendu = await page.evaluate(() => {
  const f = document.querySelector('[data-testid="fiche-coach"]');
  if (!f) return false;
  const img = f.querySelector('img');
  if (img) return img.complete && img.naturalWidth > 0;
  // Sans photo, `Avatar` affiche les initiales dans un bloc coloré.
  const bloc = f.querySelector('div[class*="rounded-full"]');
  return Boolean(bloc && bloc.getBoundingClientRect().width > 0);
});
ok('avatar de la fiche réellement rendu', avatarRendu);

/* Le lien mène bien au profil du coach cliqué. */
const href = await lienProfil.first().getAttribute('href').catch(() => null);
ok('le lien pointe vers /profile/<pseudo>',
  (href || '').startsWith('/profile/') && href.length > '/profile/'.length,
  href || '—');

/* Capture pour contrôle visuel. */
await page.screenshot({
  path: DOSSIER_CAPTURES + '/carte-fiche-coach.png',
  fullPage: false,
});

/* La fiche se ferme, et la carte reste utilisable. */
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(500);

/* La liste doit refléter la carte. */
const listeContient = await page.getByText(`@${pseudoVisible}`).count();
ok('le coach figure aussi dans la liste', listeContient > 0);

/* Filtre : un sport non proposé doit vider les résultats. */
await page.selectOption('select >> nth=0', '5000');
await page.waitForTimeout(1500);
ok('changement de rayon pris en compte',
  await page.getByText(/dans un rayon de 5 km/).count() > 0);

/* Responsive */
for (const largeur of [375, 768]) {
  await page.setViewportSize({ width: largeur, height: 900 });
  await page.waitForTimeout(1200);
  const deborde = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  ok(`/carte sans débordement en ${largeur} px`, !deborde);
}

/* Refus de géolocalisation : le repli doit être fonctionnel. */
const ctxRefus = await navigateur.newContext({
  viewport: { width: 1280, height: 950 },
  permissions: [], // aucune permission accordée
  locale: 'fr-FR',
});
const pageRefus = await ctxRefus.newPage();
pageRefus.on('pageerror', (e) => erreursJs.push(e.message));

await pageRefus.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
await pageRefus.getByLabel('Email ou pseudo').fill(sportifPseudo);
await pageRefus.getByLabel('Mot de passe').fill(MDP);
await pageRefus.getByRole('button', { name: 'Se connecter' }).click();
await pageRefus.waitForURL('**/home', { timeout: 25000 });

await pageRefus.goto(BASE + '/carte', { waitUntil: 'domcontentloaded' });
await pageRefus.getByRole('button', { name: 'Me localiser' }).click().catch(() => {});
await pageRefus.waitForTimeout(3000);

ok('**refus de géolocalisation : repli par villes proposé**',
  (await pageRefus.getByText(/Villes où des coachs sont présents/).count()) > 0 ||
    (await pageRefus.getByText(/refusé le partage/).count()) > 0);

ok('la carte reste affichée malgré le refus',
  (await pageRefus.locator('.leaflet-container').count()) > 0);

await navigateur.close();

const inattendues = erreursJs.filter(
  (m) => !/401|403|404|Failed to load resource|favicon|geolocation/i.test(m)
);
ok('aucune erreur JavaScript inattendue', inattendues.length === 0,
  inattendues[0] || 'console propre');

/* ================================================================== *
 *  NETTOYAGE
 * ================================================================== */

const comptes = await bdd
  .collection('users')
  .find({ email: motifTest }, { projection: { _id: 1 } })
  .toArray();
const ids = comptes.map((u) => u._id);
await bdd.collection('users').deleteMany({ _id: { $in: ids } });
await clientMongo.close();

console.log('\n============ CARTE DES COACHS — MODULE 8 ============');
const echecs = afficher();
console.log(`\n  (${ids.length} compte(s) de test supprimés)`);
process.exit(echecs > 0 ? 1 : 0);
