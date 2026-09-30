/**
 * ===========================================================================
 *  CARROUSEL DES PUBLICATIONS — module 5
 * ===========================================================================
 *
 *   npm run test:carrousel
 *
 * CE QUE CETTE SUITE DÉFEND.
 *
 * La demande tient en une phrase : « un seul média, rien ne change ; plusieurs
 * médias, un carrousel comme chez Instagram ». Les deux moitiés se vérifient :
 *
 *   un média       aucune flèche, aucune pastille, aucun compteur
 *   plusieurs      flèches, pastilles, compteur, glissement au doigt,
 *                  flèches du clavier, et une HAUTEUR QUI NE BOUGE PAS
 *
 * La hauteur constante est la vérification la moins évidente et la plus
 * utile : en prenant le format de chaque média plutôt que celui du premier,
 * le fil entier sautait sous le doigt à chaque changement d'image.
 * ===========================================================================
 */

import { chromium, selectors } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

selectors.setTestIdAttribute('data-test');

const BASE = process.env.CLIENT_URL || 'http://localhost:5173';
const API = 'http://localhost:5000/api';
const DOM = '@carrousel.local';
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

async function appel(chemin, { methode = 'GET', corps, token, form } = {}) {
  const entetes = {};
  if (token) entetes.Authorization = `Bearer ${token}`;
  if (corps && !form) entetes['Content-Type'] = 'application/json';
  const r = await fetch(API + chemin, {
    method: methode,
    headers: entetes,
    body: form || (corps ? JSON.stringify(corps) : undefined),
  });
  let json = null;
  try { json = await r.json(); } catch { /* corps vide */ }
  return { statut: r.status, json };
}

/** PNG valide aux dimensions demandées — même fabrique que la suite serveur. */
function png(largeur = 60, hauteur = 40) {
  const lignes = [];
  for (let y = 0; y < hauteur; y++) {
    const ligne = Buffer.alloc(largeur * 3 + 1);
    for (let x = 0; x < largeur; x++) {
      ligne[1 + x * 3] = (x * 7) % 255; ligne[2 + x * 3] = 140; ligne[3 + x * 3] = 200;
    }
    lignes.push(ligne);
  }
  const bloc = (type, donnees) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(donnees.length);
    const corps = Buffer.concat([Buffer.from(type, 'ascii'), donnees]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(corps));
    return Buffer.concat([len, corps, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0); ihdr.writeUInt32BE(hauteur, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', ihdr),
    bloc('IDAT', zlib.deflateSync(Buffer.concat(lignes))),
    bloc('IEND', Buffer.alloc(0)),
  ]);
}

/** Publication avec autant de médias que de dimensions fournies. */
async function creerPublication(token, titre, dimensions) {
  const fd = new FormData();
  dimensions.forEach(([l, h], i) => {
    fd.append('medias', new Blob([png(l, h)], { type: 'image/png' }), `media${i}.png`);
  });
  fd.append('titre', titre);
  const r = await appel('/posts', { methode: 'POST', token, form: fd });
  if (r.statut !== 201) throw new Error(`création de « ${titre} » : ${r.statut} ${r.json?.message}`);
  return r.json.post;
}

/* ------------------------- Accès direct à la base ------------------------ */

const requireServeur = createRequire(new URL('../../server/package.json', import.meta.url));
const { MongoClient } = requireServeur('mongodb');

const uriMongo = readFileSync(new URL('../../server/.env', import.meta.url), 'utf8')
  .split(/\r?\n/).find((l) => l.startsWith('MONGO_URI='))
  .slice('MONGO_URI='.length).trim().replace(/^["']|["']$/g, '');

const clientMongo = new MongoClient(uriMongo, { serverSelectionTimeoutMS: 8000 });
await clientMongo.connect();
const bdd = clientMongo.db();

async function purger() {
  const comptes = await bdd.collection('users')
    .find({ email: /@carrousel[.]local$/ }, { projection: { _id: 1 } }).toArray();
  const ids = comptes.map((u) => u._id);
  if (ids.length === 0) return 0;
  await bdd.collection('posts').deleteMany({ auteur: { $in: ids } });
  await bdd.collection('users').deleteMany({ _id: { $in: ids } });
  return ids.length;
}

const restes = await purger();
if (restes > 0) console.log(`  (purge d'entrée : ${restes} compte(s) d'une exécution précédente)`);

/* ------------------------------ Jeu de données ------------------------------ */

const pseudo = `carrousel${S}`;
const inscription = await appel('/auth/register', {
  methode: 'POST',
  corps: { type: 'utilisateur', nom: 'Test', prenom: 'Carrousel', pseudo,
           email: `${pseudo}${DOM}`, password: MDP, ville: 'Lyon' },
});
if (inscription.statut !== 201) throw new Error(`inscription : ${inscription.statut}`);
const token = inscription.json.accessToken;

const TITRE_SEUL = `Une seule photo ${S}`;
const TITRE_MULTI = `Ma séance en images ${S}`;

// Le plus récent s'affiche en tête du fil : on crée donc le multi en dernier.
await creerPublication(token, TITRE_SEUL, [[120, 80]]);
// Trois formats DIFFÉRENTS : paysage, portrait, carré. C'est ce qui révèle
// une hauteur calculée média par média.
const multi = await creerPublication(token, TITRE_MULTI, [[120, 80], [60, 120], [100, 100]]);
ok('publication de trois médias créée', multi.medias?.length === 3, `${multi.medias?.length} médias`);

let codeSortie = 1;
const navigateur = await chromium.launch();

try {
  const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await contexte.newPage();

  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email ou pseudo').fill(pseudo);
  await page.getByLabel('Mot de passe').fill(MDP);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL('**/home', { timeout: 25000 });

  const carteMulti = page.locator('article').filter({ hasText: TITRE_MULTI });
  const carteSeule = page.locator('article').filter({ hasText: TITRE_SEUL });
  await carteMulti.getByTestId('carrousel').waitFor({ state: 'visible', timeout: 20000 });

  /* =================================================================== *
   *  UN SEUL MÉDIA : RIEN NE CHANGE
   * =================================================================== */
  section('Un seul média : rien ne change');

  const seul = carteSeule.getByTestId('carrousel');
  await seul.waitFor({ state: 'visible', timeout: 15000 });
  ok('**aucun compteur**', (await carteSeule.getByTestId('carrousel-compteur').count()) === 0);
  ok('**aucune pastille**', (await carteSeule.getByTestId('carrousel-pastille-0').count()) === 0);
  ok('**aucune flèche**', (await carteSeule.getByTestId('carrousel-suivant').count()) === 0);
  ok('l’image est affichée', await carteSeule.getByTestId('carrousel-media-0').isVisible());
  ok('et la région n’est pas annoncée comme un carrousel',
    (await seul.getAttribute('aria-roledescription')) === null);

  /* =================================================================== *
   *  PLUSIEURS MÉDIAS
   * =================================================================== */
  section('Plusieurs médias : repères de position');

  const compteur = carteMulti.getByTestId('carrousel-compteur');
  ok('le compteur annonce le premier média', (await compteur.innerText()) === '1/3');
  ok('trois pastilles', (await carteMulti.locator('[data-test^="carrousel-pastille-"]').count()) === 3);
  ok('la région est annoncée comme un carrousel',
    (await carteMulti.getByTestId('carrousel').getAttribute('aria-roledescription')) === 'carrousel');
  ok('**la position est aussi annoncée aux lecteurs d’écran**',
    (await carteMulti.getByTestId('carrousel-annonce').innerText()).includes('Média 1 sur 3'));
  ok('aucune flèche « précédent » sur le premier média',
    (await carteMulti.getByTestId('carrousel-precedent').count()) === 0);

  const hauteurDepart = (await carteMulti.getByTestId('carrousel').boundingBox()).height;

  section('Navigation à la flèche');

  await carteMulti.getByTestId('carrousel-suivant').click();
  await page.waitForTimeout(400);
  ok('le compteur suit', (await compteur.innerText()) === '2/3');
  ok('l’annonce suit', (await carteMulti.getByTestId('carrousel-annonce').innerText()).includes('Média 2 sur 3'));

  /*
   * LA PISTE EST DÉPLACÉE, LES MÉDIAS NE SONT PAS REMPLACÉS. On lit la
   * transformation appliquée : c'est elle qui produit le glissement, et elle
   * prouve que les trois médias restent montés côte à côte.
   */
  const transformation = await carteMulti.getByTestId('carrousel-piste')
    .evaluate((el) => getComputedStyle(el).transform);
  const largeur = (await carteMulti.getByTestId('carrousel').boundingBox()).width;
  const deplacement = Number(transformation.split(',')[4]);
  ok('**la piste est décalée d’exactement une largeur**',
    Math.abs(deplacement + largeur) < 2, `${Math.round(deplacement)} px pour ${Math.round(largeur)} px`);

  await carteMulti.getByTestId('carrousel-suivant').click();
  await page.waitForTimeout(400);
  ok('on atteint le dernier média', (await compteur.innerText()) === '3/3');
  ok('**et la flèche « suivant » disparaît — pas de bouclage**',
    (await carteMulti.getByTestId('carrousel-suivant').count()) === 0);

  section('La hauteur ne bouge pas');

  const hauteurFin = (await carteMulti.getByTestId('carrousel').boundingBox()).height;
  ok('**même hauteur au premier et au dernier média**, malgré trois formats différents',
    Math.abs(hauteurDepart - hauteurFin) < 1,
    `${Math.round(hauteurDepart)} px puis ${Math.round(hauteurFin)} px`);

  section('Navigation au clavier');

  await carteMulti.getByTestId('carrousel').focus();
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(400);
  ok('la flèche gauche revient en arrière', (await compteur.innerText()) === '2/3');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  ok('la flèche droite avance', (await compteur.innerText()) === '3/3');

  section('Glissement au doigt');

  /*
   * ON REJOUE DE VRAIS ÉVÉNEMENTS DE POINTAGE, avec `pointerType: touch` :
   * c'est ce que reçoit le composant sur un téléphone. Un simple `click` ne
   * testerait pas le geste, qui est pourtant LE mode de navigation sur mobile.
   */
  const glisser = async (depuisX, versX) => {
    const cadre = carteMulti.getByTestId('carrousel');
    const boite = await cadre.boundingBox();
    const y = boite.y + boite.height / 2;
    const commun = { pointerType: 'touch', pointerId: 1, isPrimary: true, bubbles: true };
    await cadre.dispatchEvent('pointerdown', { ...commun, clientX: depuisX, clientY: y });
    await cadre.dispatchEvent('pointermove', { ...commun, clientX: (depuisX + versX) / 2, clientY: y });
    await cadre.dispatchEvent('pointermove', { ...commun, clientX: versX, clientY: y });
    await cadre.dispatchEvent('pointerup', { ...commun, clientX: versX, clientY: y });
    await page.waitForTimeout(400);
  };

  const boite = await carteMulti.getByTestId('carrousel').boundingBox();
  const centreX = boite.x + boite.width / 2;

  await glisser(centreX, centreX + 200); // vers la droite = média précédent
  ok('**glisser vers la droite revient au média précédent**', (await compteur.innerText()) === '2/3',
    await compteur.innerText());

  await glisser(centreX, centreX - 200); // vers la gauche = média suivant
  ok('**glisser vers la gauche avance**', (await compteur.innerText()) === '3/3',
    await compteur.innerText());

  await glisser(centreX, centreX - 20); // trop court : on revient en place
  ok('un geste trop court ne change pas de média', (await compteur.innerText()) === '3/3');

  section('Économie de données');

  ok('**seul le premier média est chargé sans attendre**',
    (await carteMulti.getByTestId('carrousel-media-0').getAttribute('loading')) === 'eager' &&
      (await carteMulti.getByTestId('carrousel-media-1').getAttribute('loading')) === 'lazy');

  section('Largeur des publications');

  /*
   * DEUX RENDUS, DEUX INTENTIONS. Sur ordinateur, la publication reste une
   * carte posée dans la page, avec ses marges — c'est l'affichage d'origine,
   * et il ne doit pas bouger. Sur téléphone, elle va d'un bord à l'autre,
   * comme chez Instagram : sur un écran de 375 px, 32 px de marges, c'est un
   * dixième de la largeur perdu de chaque côté du contenu.
   */
  const largeurVisible = () => page.evaluate(() => document.documentElement.clientWidth);

  const boiteOrdi = await carteMulti.boundingBox();
  const pageOrdi = await largeurVisible();
  ok('**1280 px : la publication garde les marges de la page**',
    boiteOrdi.x > 20 && boiteOrdi.width <= pageOrdi - 40,
    `${Math.round(boiteOrdi.width)} px de large, à ${Math.round(boiteOrdi.x)} px du bord`);

  section('Mobile');

  await page.setViewportSize({ width: 375, height: 800 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await carteMulti.getByTestId('carrousel').waitFor({ state: 'visible', timeout: 20000 });

  const boiteTel = await carteMulti.boundingBox();
  const pageTel = await largeurVisible();
  ok('**375 px : la publication occupe toute la largeur, comme Instagram**',
    Math.abs(boiteTel.width - pageTel) < 2 && boiteTel.x < 2,
    `${Math.round(boiteTel.width)} px pour un écran utile de ${pageTel} px, à ${Math.round(boiteTel.x)} px du bord`);

  ok('les repères restent visibles', await carteMulti.getByTestId('carrousel-compteur').isVisible());
  ok('**les flèches, elles, sont masquées — le geste suffit**',
    !(await carteMulti.getByTestId('carrousel-suivant').isVisible()));

  const debordeMobile = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  ok('aucun débordement horizontal en 375 px', !debordeMobile);

  await carteMulti.screenshot({ path: `${DOSSIER_CAPTURES}carrousel-mobile.png` });

  await contexte.close();
} finally {
  await navigateur.close();
  const supprimes = await purger();
  await clientMongo.close();
  console.log('\n============ CARROUSEL DES PUBLICATIONS ============');
  codeSortie = afficher(null) > 0 ? 1 : 0;
  console.log(`\n  (${supprimes} compte(s) de test supprimé(s), publications comprises)`);
}

process.exit(codeSortie);
