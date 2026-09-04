/**
 * ===========================================================================
 *  STORY PAR LA CAMÉRA — MODULE 5.6, PARCOURS NAVIGATEUR
 * ===========================================================================
 *
 *   npm run test:story-camera
 *
 * Prérequis : l'API (port 5000) et Vite (port 5173) doivent tourner.
 *
 * POURQUOI CETTE SUITE EXISTE, ET POURQUOI ELLE EXIGE UN VRAI NAVIGATEUR.
 *
 * Rien de ce qui suit n'est visible dans une réponse HTTP :
 *
 *   1. LE FLUX DOIT ÊTRE COUPÉ À LA FERMETURE. `getUserMedia` allume la
 *      caméra ; si les pistes ne sont pas arrêtées, le voyant de l'appareil
 *      reste allumé après la fermeture de la fenêtre. C'est le défaut le plus
 *      fréquent de ce genre de composant, et il ne se voit ni au lint, ni au
 *      build, ni dans une capture d'écran — seulement dans l'état des pistes.
 *
 *   2. LE « + » DOIT RESTER ATTEIGNABLE. Avant cette évolution, le bouton
 *      unique ouvrait le lecteur dès qu'une story existait : publier une
 *      seconde story était impossible depuis la barre.
 *
 *   3. LA PHOTO DOIT ARRIVER JUSQU'EN BASE ET S'AFFICHER. Une story créée
 *      dont l'image ne se charge pas est un échec que l'API déclare réussi —
 *      d'où la vérification `naturalWidth > 0`, héritée du module 5.
 *
 * La caméra est simulée par Chromium (`--use-fake-device-for-media-stream`),
 * ce qui rend la prise de vue réellement exécutable sans matériel.
 *
 * Les comptes créés ici sont supprimés à la fin — et au démarrage.
 * ===========================================================================
 */

import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';

const BASE = process.env.CLIENT_URL || 'http://localhost:5173';
const API = 'http://localhost:5000/api';
const DOM = '@storycam.local';
const MDP = 'MotDePasse123';
const S = Date.now();

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

/**
 * PNG uni, construit ici plutôt que lu sur disque : la suite n'a alors
 * aucun fichier annexe à transporter, et les dimensions sont connues —
 * le serveur les relit dans l'en-tête IHDR.
 */
function pngUni(largeur, hauteur, [r, v, b]) {
  const crcTable = [...Array(256)].map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const octet of buf) c = crcTable[(c ^ octet) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const bloc = (type, donnees) => {
    const nom = Buffer.from(type, 'ascii');
    const taille = Buffer.alloc(4);
    taille.writeUInt32BE(donnees.length);
    const somme = Buffer.alloc(4);
    somme.writeUInt32BE(crc(Buffer.concat([nom, donnees])));
    return Buffer.concat([taille, nom, donnees, somme]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0);
  ihdr.writeUInt32BE(hauteur, 4);
  ihdr[8] = 8;   // 8 bits par canal
  ihdr[9] = 2;   // couleur vraie, sans alpha

  const brut = Buffer.alloc(hauteur * (1 + largeur * 3));
  for (let y = 0; y < hauteur; y++) {
    const debut = y * (1 + largeur * 3);
    brut[debut] = 0; // filtre « aucun »
    for (let x = 0; x < largeur; x++) {
      brut[debut + 1 + x * 3] = r;
      brut[debut + 2 + x * 3] = v;
      brut[debut + 3 + x * 3] = b;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', ihdr),
    bloc('IDAT', zlib.deflateSync(brut)),
    bloc('IEND', Buffer.alloc(0)),
  ]);
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

const motifTest = /@storycam[.]local$/;

async function purger() {
  const comptes = await bdd.collection('users')
    .find({ email: motifTest }, { projection: { _id: 1 } })
    .toArray();
  const ids = comptes.map((u) => u._id);
  if (ids.length === 0) return 0;

  const stories = await bdd.collection('stories')
    .find({ auteur: { $in: ids } }, { projection: { _id: 1 } })
    .toArray();
  await bdd.collection('storyviews').deleteMany({
    story: { $in: stories.map((s) => s._id) },
  });
  await bdd.collection('stories').deleteMany({ auteur: { $in: ids } });
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

section('Mise en place');

const pseudo = `storycam${S}`;
const inscription = await appel('/auth/register', {
  methode: 'POST',
  corps: {
    type: 'utilisateur', nom: 'Cam', prenom: 'Test', pseudo,
    email: `${pseudo}${DOM}`, password: MDP, ville: 'Lyon',
  },
});
if (inscription.statut !== 201) {
  throw new Error(`création du compte : ${inscription.statut} ${inscription.json?.message}`);
}
const token = inscription.json.accessToken;
ok('compte de test créé', Boolean(token));

const avant = await appel('/stories', { token });
ok('aucune story au départ', (avant.json?.groupes || []).length === 0);

/* ================================================================== *
 *  NAVIGATEUR
 * ================================================================== */

/*
 * CAMÉRA SIMULÉE PAR CHROMIUM.
 *   --use-fake-device-for-media-stream : une mire animée en guise de caméra
 *   --use-fake-ui-for-media-stream     : la demande de permission est accordée
 * Sans ces deux drapeaux, `getUserMedia` resterait bloqué sur une machine
 * sans webcam, et la fonctionnalité ne serait jamais testée.
 */
const navigateur = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

const erreursJs = [];
const contexte = await navigateur.newContext({
  viewport: { width: 1280, height: 950 },
  locale: 'fr-FR',
  permissions: ['camera'],
});

/*
 * ESPION SUR getUserMedia.
 * Il garde une référence sur chaque piste ouverte. C'est le seul moyen de
 * vérifier, après coup, que la caméra a bien été relâchée : une piste non
 * arrêtée reste en `live` et le voyant de l'appareil reste allumé.
 */
await contexte.addInitScript(() => {
  window.__pistesCamera = [];
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (contraintes) => {
    const flux = await original(contraintes);
    window.__pistesCamera.push(...flux.getTracks());
    return flux;
  };
});

const page = await contexte.newPage();
page.on('pageerror', (e) => erreursJs.push(e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const url = m.location()?.url || '';
  /*
   * LE 401 SUR /auth/refresh EST LA RÉPONSE ATTENDUE au démarrage : la page
   * de connexion tente de restaurer une session, et il n'y a pas encore de
   * cookie. L'écarter nommément plutôt que d'ignorer tous les 401 : une
   * requête de story refusée doit, elle, faire échouer la suite.
   */
  if (url.includes('/auth/refresh')) return;
  erreursJs.push(`${m.text()} ${url}`.trim());
});

await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
await page.getByLabel('Email ou pseudo').fill(pseudo);
await page.getByLabel('Mot de passe').fill(MDP);
await page.getByRole('button', { name: 'Se connecter' }).click();
await page.waitForURL('**/home', { timeout: 25000 });
await page.waitForSelector('[data-test="ajouter-story"]', { timeout: 15000 });

/* ------------------------------------------------------------------ *
 *  Le choix de la source
 * ------------------------------------------------------------------ */

section('Choix de la source');

await page.locator('[data-test="ajouter-story"]').click();
await page.waitForSelector('[data-test="choix-source-story"]', { timeout: 5000 });

ok('le « + » ouvre le choix de la source',
  await page.locator('[data-test="choix-source-story"]').isVisible());
ok('« Importer un fichier » proposé',
  await page.locator('[data-test="source-fichier"]').isVisible());
ok('« Prendre une photo » proposé',
  await page.locator('[data-test="source-camera"]').isVisible());

/*
 * STYLES DES DEUX SOURCES — blanches au repos, marque au survol.
 * On lit le style CALCULÉ, pas la liste des classes : deux utilitaires
 * Tailwind de même spécificité peuvent se contredire, et c'est l'ordre de la
 * feuille générée qui tranche — invisible dans le JSX.
 */
const styleDe = async (cle, survol) => {
  const bouton = page.locator(`[data-test="${cle}"]`);
  if (survol) await bouton.hover();
  else await page.mouse.move(5, 5);
  await page.waitForTimeout(250); // la transition dure 150 ms
  return bouton.evaluate((n) => {
    const s = getComputedStyle(n);
    return { fond: s.backgroundColor, curseur: s.cursor };
  });
};

for (const [cle, libelle] of [
  ['source-fichier', 'Importer un fichier'],
  ['source-camera', 'Prendre une photo'],
]) {
  const repos = await styleDe(cle, false);
  const survol = await styleDe(cle, true);

  ok(`« ${libelle} » est blanc au repos (#ffffff)`,
    repos.fond === 'rgb(255, 255, 255)', repos.fond);
  ok(`« ${libelle} » passe à #f97316 au survol`,
    survol.fond === 'rgb(249, 115, 22)', survol.fond);
  ok(`« ${libelle} » affiche le curseur main`,
    survol.curseur === 'pointer', survol.curseur);
}

await page.mouse.move(5, 5);

/* ------------------------------------------------------------------ *
 *  Prise de vue
 * ------------------------------------------------------------------ */

section('Prise de vue');

await page.locator('[data-test="source-camera"]').click();
await page.waitForSelector('[data-test="capture-photo"]', { timeout: 5000 });

/*
 * ON ATTEND UNE IMAGE RÉELLE, PAS SEULEMENT LA BALISE.
 * `videoWidth` reste à 0 tant que la première trame n'est pas arrivée :
 * déclencher avant produirait une photo noire, et le test passerait quand
 * même si l'on se contentait de vérifier la présence du <video>.
 */
await page.waitForFunction(
  () => document.querySelector('[data-test="flux-camera"]')?.videoWidth > 0,
  { timeout: 20000 }
);

const dimensions = await page.locator('[data-test="flux-camera"]').evaluate((v) => ({
  largeur: v.videoWidth, hauteur: v.videoHeight,
}));
ok('le flux caméra est ouvert et fournit des images',
  dimensions.largeur > 0 && dimensions.hauteur > 0,
  `${dimensions.largeur}×${dimensions.hauteur}`);

const pistesVivantes = await page.evaluate(
  () => window.__pistesCamera.filter((p) => p.readyState === 'live').length
);
ok('une piste vidéo est active pendant la prise de vue', pistesVivantes >= 1);

/*
 * CURSEUR DU DÉCLENCHEUR, vérifié sur le style CALCULÉ.
 * Tailwind 4 pose `cursor: default` sur les boutons : l'oubli ne se voit sur
 * aucune capture d'écran, et une liste de classes ne dit pas laquelle gagne.
 * La caméra est prête ici, donc le bouton est actif — c'est l'état dans
 * lequel le pointeur doit apparaître.
 */
const declencheur = page.locator('[data-test="declencher"]');
const curseur = await declencheur.evaluate((n) => getComputedStyle(n).cursor);
ok('« Prendre la photo » affiche le curseur main', curseur === 'pointer', curseur);
ok('le déclencheur est bien actif quand la caméra est prête',
  await declencheur.isEnabled());

await page.locator('[data-test="declencher"]').click();
await page.waitForSelector('[data-test="apercu-photo"]', { timeout: 10000 });

const apercu = await page.locator('[data-test="apercu-photo"]').evaluate((img) => ({
  chargee: img.naturalWidth > 0,
  largeur: img.naturalWidth,
  hauteur: img.naturalHeight,
}));
ok('la photo prise s’affiche réellement en relecture', apercu.chargee,
  `${apercu.largeur}×${apercu.hauteur}`);
ok('la photo est bornée à 1920 px sur son plus grand côté',
  Math.max(apercu.largeur, apercu.hauteur) <= 1920);

ok('« Reprendre » est proposé avant publication',
  await page.locator('[data-test="reprendre"]').isVisible());

/*
 * LA CAMÉRA EST COUPÉE DÈS LA PRISE, pas seulement à la fermeture : garder
 * le flux ouvert pendant la relecture laisse le voyant allumé sans raison.
 */
const vivantesApresPrise = await page.evaluate(
  () => window.__pistesCamera.filter((p) => p.readyState === 'live').length
);
ok('la caméra est relâchée dès la photo prise', vivantesApresPrise === 0);

/* ------------------------------------------------------------------ *
 *  Publication
 * ------------------------------------------------------------------ */

section('Publication');

await page.locator('[data-test="valider-photo"]').click();

// La barre se recharge après l'envoi ; la fenêtre doit s'être fermée.
await page.waitForSelector('[data-test="capture-photo"]', { state: 'detached', timeout: 10000 });
ok('la fenêtre de prise de vue se ferme après publication', true);

/* La preuve vient de l'API, pas de l'écran. */
let creee = null;
for (let i = 0; i < 20 && !creee; i++) {
  const r = await appel('/stories', { token });
  const mien = (r.json?.groupes || []).find((g) => g.estMoi);
  if (mien && mien.stories?.length >= 1) creee = mien.stories[0];
  if (!creee) await new Promise((r) => setTimeout(r, 500));
}

ok('la story est créée en base', Boolean(creee));
ok('son média est une image', creee?.media?.type === 'image',
  creee?.media?.type || 'aucun');
ok('son URL est renseignée', Boolean(creee?.media?.url));

/*
 * L'IMAGE DOIT SE CHARGER. Une URL correcte dans une réponse JSON ne prouve
 * rien : c'est exactement le défaut trouvé au module 5, où 53 tests passaient
 * sur des images cassées.
 */
if (creee?.media?.url) {
  const chargee = await page.evaluate(
    (url) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth > 0);
        img.onerror = () => resolve(false);
        img.src = url;
        setTimeout(() => resolve(false), 15000);
      }),
    creee.media.url
  );
  ok('l’image publiée se charge réellement (naturalWidth > 0)', chargee);
}

/* ------------------------------------------------------------------ *
 *  Le « + » reste atteignable
 * ------------------------------------------------------------------ */

section('Ajout d’une seconde story');

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-test="ajouter-story"]', { timeout: 15000 });

ok('le « + » est toujours présent alors qu’une story existe',
  await page.locator('[data-test="ajouter-story"]').isVisible());

await page.locator('[data-test="ajouter-story"]').click();
await page.waitForSelector('[data-test="choix-source-story"]', { timeout: 5000 });
ok('il ouvre bien le choix de la source, et non le lecteur',
  await page.locator('[data-test="choix-source-story"]').isVisible());

/* ------------------------------------------------------------------ *
 *  L'import de fichier n'a pas régressé
 * ------------------------------------------------------------------ */

section('Import de fichier');

await page.locator('[data-test="source-fichier"]').click();
await page.setInputFiles('#nouvelle-story', {
  name: 'story-importee.png',
  mimeType: 'image/png',
  buffer: pngUni(720, 1280, [234, 88, 12]),
});

let deux = false;
for (let i = 0; i < 20 && !deux; i++) {
  const r = await appel('/stories', { token });
  const mien = (r.json?.groupes || []).find((g) => g.estMoi);
  deux = (mien?.stories?.length || 0) >= 2;
  if (!deux) await new Promise((r) => setTimeout(r, 500));
}
ok('la voie « import de fichier » publie toujours', deux);

/* ------------------------------------------------------------------ *
 *  Libération de la caméra
 * ------------------------------------------------------------------ */

section('Libération de la caméra');

// On rouvre la caméra puis on ferme la fenêtre sans prendre de photo :
// c'est le chemin qui laisse le plus souvent le flux ouvert.
await page.locator('[data-test="ajouter-story"]').click();
await page.waitForSelector('[data-test="choix-source-story"]', { timeout: 5000 });
await page.locator('[data-test="source-camera"]').click();
await page.waitForSelector('[data-test="capture-photo"]', { timeout: 5000 });
await page.waitForFunction(
  () => document.querySelector('[data-test="flux-camera"]')?.videoWidth > 0,
  { timeout: 20000 }
);

ok('la caméra est rouverte',
  (await page.evaluate(() => window.__pistesCamera.filter((p) => p.readyState === 'live').length)) >= 1);

await page.keyboard.press('Escape');
await page.waitForSelector('[data-test="capture-photo"]', { state: 'detached', timeout: 5000 });

const vivantesApresFermeture = await page.evaluate(
  () => window.__pistesCamera.filter((p) => p.readyState === 'live').length
);
ok('toutes les pistes sont arrêtées après fermeture par Échap',
  vivantesApresFermeture === 0,
  `${vivantesApresFermeture} piste(s) encore actives`);

/*
 * L'espion est reposé à chaque navigation : après le rechargement de page
 * plus haut, le compteur ne porte que sur les ouvertures de cette section.
 * Ce qui compte est le rapport ouvertes / restées actives.
 */
const total = await page.evaluate(() => window.__pistesCamera.length);
ok('toutes les ouvertures de flux ont été refermées',
  total >= 1 && vivantesApresFermeture === 0,
  `${total} ouverte(s), ${vivantesApresFermeture} active(s)`);

/* ------------------------------------------------------------------ *
 *  Console
 * ------------------------------------------------------------------ */

section('Console');
ok('aucune erreur JavaScript pendant le parcours', erreursJs.length === 0,
  erreursJs.slice(0, 2).join(' | '));

/* ================================================================== *
 *  NETTOYAGE
 * ================================================================== */

await contexte.close();
await navigateur.close();

const supprimes = await purger();
console.log(`\n  (nettoyage : ${supprimes} compte(s) de test supprimé(s))`);
await clientMongo.close();

process.exit(afficher() > 0 ? 1 : 0);
