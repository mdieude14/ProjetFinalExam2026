/**
 * ===========================================================================
 *  SUITE DE RÉGRESSION — NAVIGATEUR
 * ===========================================================================
 *
 * Rejoue les parcours utilisateur critiques dans un vrai Chromium.
 *
 *   npm run test:ui
 *
 * Prérequis : le serveur d'API (port 5000) et Vite (port 5173) doivent
 * tourner, et MongoDB être joignable.
 *
 * CE QUE CETTE SUITE ATTRAPE ET QUE L'API NE VOIT PAS :
 *   - un formulaire qui ne se soumet pas,
 *   - une redirection de route qui ne part pas,
 *   - une session non restaurée après F5,
 *   - une image dont l'URL est correcte mais qui ne se charge pas,
 *   - une mise en page qui déborde sur mobile,
 *   - une exception React, invisible dans le HTML.
 *
 * Chaque exécution crée ses propres comptes et les supprime à la fin.
 * ===========================================================================
 */

import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';

const BASE = process.env.CLIENT_URL || 'http://localhost:5173';
const DOMAINE = '@regression.local';
const S = Date.now();
const MDP = 'MotDePasse123';

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

/* ------------------------------------------------------------------ *
 *  OUTILS
 * ------------------------------------------------------------------ */

function png(largeur = 90, hauteur = 60) {
  const lignes = [];
  for (let y = 0; y < hauteur; y++) {
    const l = Buffer.alloc(largeur * 3 + 1);
    for (let x = 0; x < largeur; x++) {
      l[1 + x * 3] = 60; l[2 + x * 3] = 160; l[3 + x * 3] = 90;
    }
    lignes.push(l);
  }
  const bloc = (t, d) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
    const corps = Buffer.concat([Buffer.from(t, 'ascii'), d]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(corps));
    return Buffer.concat([len, corps, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0); ihdr.writeUInt32BE(hauteur, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', ihdr), bloc('IDAT', zlib.deflateSync(Buffer.concat(lignes))),
    bloc('IEND', Buffer.alloc(0)),
  ]);
}

const fichier = (nom) => ({ name: nom, mimeType: 'image/png', buffer: png() });

/**
 * Acces direct a la base, pour les rares etats qu'aucune API ne permet
 * d'atteindre : un diplome valide, un compte Stripe capable d'encaisser.
 *
 * ON NE PASSE PLUS PAR `docker exec … mongosh`.
 * Cet appel dependait du CLI Docker, qui peut ne pas repondre — et comme il
 * n'a pas de delai d'expiration, le test se figeait indefiniment au lieu
 * d'echouer. Le pilote MongoDB parle au meme serveur, sans intermediaire.
 *
 * On emprunte le pilote et l'URI au serveur plutot que de les redeclarer :
 * une seule source de verite pour l'adresse de la base.
 */
const requireServeur = createRequire(new URL('../../server/package.json', import.meta.url));
const { MongoClient } = requireServeur('mongodb');

const uriMongo = readFileSync(new URL('../../server/.env', import.meta.url), 'utf8')
  // Un decoupage sur le seul saut de ligne suffit : un eventuel retour
  // chariot final est retire par le `trim()` juste en dessous.
  .split(/\r?\n/)
  .find((ligne) => ligne.startsWith('MONGO_URI='))
  .slice('MONGO_URI='.length)
  .trim()
  .replace(/^["']|["']$/g, '');

const clientMongo = new MongoClient(uriMongo, { serverSelectionTimeoutMS: 8000 });
await clientMongo.connect();
const bdd = clientMongo.db();

/**
 * `isVisible()` de Playwright NE PATIENTE PAS : il renvoie false si le rendu
 * React n'est pas terminé. On attend explicitement.
 */
const visible = (loc, t = 8000) =>
  loc.first().waitFor({ state: 'visible', timeout: t }).then(() => true).catch(() => false);

const navigateur = await chromium.launch();
const erreursJs = [];

async function acteur(largeur = 1280) {
  const ctx = await navigateur.newContext({ viewport: { width: largeur, height: 950 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => erreursJs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') erreursJs.push(m.text()); });
  return page;
}

async function inscrire(page, { type, prenom, pseudo }) {
  await page.goto(BASE + '/register', { waitUntil: 'networkidle' });
  if (type === 'coach') await page.getByRole('button', { name: /Coach/ }).click();
  await page.getByLabel('Prénom').fill(prenom);
  await page.getByLabel('Nom', { exact: true }).fill('Régression');
  await page.getByLabel('Pseudo').fill(pseudo);
  await page.getByLabel('Email').fill(`${pseudo}${DOMAINE}`);
  await page.getByLabel('Mot de passe').fill(MDP);
  await page.getByLabel('Ville').fill('Lyon');
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await page.waitForURL('**/home', { timeout: 25000 });
}

/* ================================================================== *
 *  MODULE 3 — AUTHENTIFICATION
 * ================================================================== */

section('Module 3 — Authentification');

const coachPseudo = `coach${S}`;
const alicePseudo = `alice${S}`;
const privePseudo = `prive${S}`;

const alice = await acteur();

await alice.goto(BASE + '/home', { waitUntil: 'networkidle' });
ok('route protégée redirige vers /login', alice.url().endsWith('/login'), alice.url());

await alice.getByLabel('Email ou pseudo').fill('inconnu@nulle.part');
await alice.getByLabel('Mot de passe').fill('MauvaisMdp123');
await alice.getByRole('button', { name: 'Se connecter' }).click();
ok('erreur de connexion affichée',
  await visible(alice.getByText('Identifiants invalides')));

const coach = await acteur();
await inscrire(coach, { type: 'coach', prenom: 'Marc', pseudo: coachPseudo });
ok('inscription coach → /home', coach.url().endsWith('/home'));

await coach.reload({ waitUntil: 'networkidle' });
ok('**session restaurée après F5**', coach.url().endsWith('/home'));
// Le prénom apparaît dans l'invite de publication : sa présence prouve que
// l'utilisateur a bien été rechargé, pas seulement que l'URL est la bonne.
ok('utilisateur toujours identifié après F5',
  await visible(coach.getByRole('button', { name: /Partagez votre séance, Marc/ })));

await alice.goto(BASE + '/register', { waitUntil: 'networkidle' });
await inscrire(alice, { type: 'utilisateur', prenom: 'Alice', pseudo: alicePseudo });

/* ================================================================== *
 *  TYPOGRAPHIE — non-régression de la passe d'accentuation
 * ================================================================== */

section('Typographie');

await coach.goto(BASE + '/settings', { waitUntil: 'networkidle' });
ok('titre de page accentué', await visible(coach.getByRole('heading', { name: 'Paramètres' })));
ok('libellé « Prénom » accentué', await visible(coach.getByLabel('Prénom')));
ok('section « Confidentialité » accentuée',
  await visible(coach.getByText('Confidentialité')));

await coach.getByRole('button', { name: 'Menu du compte' }).click();
await coach.waitForTimeout(300);
ok('menu « Déconnexion » accentué',
  await visible(coach.getByRole('menuitem', { name: 'Déconnexion' })));
await coach.keyboard.press('Escape');
await coach.goto(BASE + '/home', { waitUntil: 'networkidle' });

/* ================================================================== *
 *  MODULE 5 — PUBLICATIONS
 * ================================================================== */

section('Module 5 — Publications');

await bdd.collection('users').updateOne(
  { pseudo: coachPseudo },
  { $set: { 'diplome.statut': 'verifie' } }
);
await coach.reload({ waitUntil: 'networkidle' });

await coach.getByRole('button', { name: /Partagez votre séance/ }).click();
await coach.waitForTimeout(300);
await coach.locator('#choix-medias').setInputFiles([fichier('a.png'), fichier('b.png')]);
await coach.waitForTimeout(400);
ok('aperçus affichés avant envoi',
  (await coach.locator('ul.grid img').count()) === 2);

await coach.getByLabel('Titre (facultatif)').fill('Séance de régression');
await coach.getByLabel('Description').fill('Publication créée par la suite de tests');
await coach.locator('form').getByRole('button', { name: 'Publier', exact: true }).click();
await coach.waitForSelector('article', { timeout: 25000 });
ok('publication créée et affichée',
  await visible(coach.locator('article').getByText('Séance de régression')));
ok('carrousel actif', await visible(coach.getByText('1/2')));

await coach.locator('#choix-medias').setInputFiles({
  name: 'v.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ'),
}).catch(() => {});
await coach.waitForTimeout(400);

const boutonLike = coach.locator('article button[aria-pressed]').first();
await boutonLike.click();
await coach.waitForTimeout(900);
ok('like enregistré', (await boutonLike.innerText()).includes('1'));

await coach.locator('article button[aria-expanded]').first().click();
await coach.waitForTimeout(600);
await coach.getByPlaceholder('Ajouter un commentaire...').fill('Commentaire de test');
await coach.locator('article form').getByRole('button', { name: 'Publier', exact: true }).click();
await coach.waitForTimeout(1200);
ok('commentaire publié', await visible(coach.getByText('Commentaire de test')));

/* ================================================================== *
 *  CONTENU PREMIUM — la vérification centrale
 * ================================================================== */

section('Contenu premium');

// Un compte Stripe reellement capable d'encaisser ne s'obtient que par
// l'onboarding : on simule ici l'etat d'arrivee pour tester le verrouillage
// du contenu, pas le paiement — celui-ci a sa propre suite de bout en bout.
await bdd.collection('users').updateOne(
  { pseudo: coachPseudo },
  {
    $set: {
      'stripeAccount.chargesEnabled': true,
      'premium.actif': true,
      'premium.prixMensuel': 1990,
      'premium.stripePriceId': 'price_reg',
    },
  }
);
await coach.reload({ waitUntil: 'networkidle' });

await coach.getByRole('button', { name: /Partagez votre séance/ }).click();
await coach.waitForTimeout(400);
await coach.locator('#choix-medias').setInputFiles(fichier('p.png'));
await coach.getByLabel('Titre (facultatif)').fill('Programme exclusif');
await coach.getByLabel('Description').fill('Réservé aux abonnés premium');
await coach.locator('input[type="checkbox"]').check();
await coach.locator('form').getByRole('button', { name: 'Publier', exact: true }).click();
await coach.waitForTimeout(3000);
ok('publication premium créée', await visible(coach.getByText('Programme exclusif')));

// On inspecte la RÉPONSE HTTP, pas le HTML rendu : la page contient
// légitimement les URL du post gratuit affiché à côté.
const [reponsePosts] = await Promise.all([
  alice.waitForResponse(
    (r) => r.url().includes('/api/posts/utilisateur/') && r.status() === 200,
    { timeout: 20000 }
  ),
  alice.goto(`${BASE}/profile/${coachPseudo}`, { waitUntil: 'networkidle' }),
]);
const corps = await reponsePosts.json();
const postPremium = corps.elements.find((p) => p.estPremium);

ok('publication premium présente dans la réponse', Boolean(postPremium));
ok('marquée verrouillée par le serveur', postPremium?.verrouille === true);
ok('**tableau medias VIDE dans la réponse HTTP**',
  Array.isArray(postPremium?.medias) && postPremium.medias.length === 0);
ok('description premium absente de la réponse', postPremium?.description === null);
ok('description premium absente du HTML rendu',
  !(await alice.content()).includes('Réservé aux abonnés premium'));
ok('superposition « Contenu exclusif » affichée',
  await visible(alice.getByText('Contenu exclusif')));

/* ================================================================== *
 *  IMAGES — chargement réel
 * ================================================================== */

section('Médias');

await alice.waitForTimeout(1500);
const etatImages = await alice.evaluate(() =>
  Array.from(document.querySelectorAll('img')).map((i) => ({
    src: i.getAttribute('src'),
    chargee: i.complete && i.naturalWidth > 0,
  }))
);
const cassees = etatImages.filter((i) => !i.chargee);
ok('**toutes les images se chargent réellement**',
  etatImages.length > 0 && cassees.length === 0,
  `${etatImages.length - cassees.length}/${etatImages.length}` +
    (cassees.length ? ` — cassées : ${cassees.map((c) => c.src).join(', ')}` : ''));

/* ================================================================== *
 *  MODULE 6 — SUIVI
 * ================================================================== */

section('Module 6 — Suivi');

const boutonSuivre = alice.getByRole('button', { name: 'Suivre ce profil' });
ok('bouton « Suivre » présent sur le profil', await visible(boutonSuivre));
await boutonSuivre.click();
await alice.waitForTimeout(1500);
ok('bouton passe à l’état abonné',
  await visible(alice.getByRole('button', { name: /Se désabonner de ce profil/ })));

await alice.goto(BASE + '/home', { waitUntil: 'networkidle' });
await alice.waitForSelector('article', { timeout: 20000 });
ok('le fil se remplit après le suivi',
  await visible(alice.getByText('Séance de régression')));

await alice.goto(`${BASE}/profile/${coachPseudo}`, { waitUntil: 'networkidle' });
await alice.waitForTimeout(1000);
await alice.getByRole('button', { name: /Abonnés/ }).click();
await alice.waitForTimeout(1200);
ok('modale des relations ouverte', await visible(alice.getByRole('dialog')));
ok('onglet « Abonnements » accentué',
  await visible(alice.getByRole('dialog').getByRole('button', { name: 'Abonnements', exact: true })));
await alice.keyboard.press('Escape');

// Profil privé et demande
const prive = await acteur();
await inscrire(prive, { type: 'utilisateur', prenom: 'Sofia', pseudo: privePseudo });
await prive.goto(BASE + '/settings', { waitUntil: 'networkidle' });
await prive.getByRole('button', { name: /Passer en privé/ }).click();
await prive.waitForSelector('text=désormais privé', { timeout: 15000 });
ok('bascule en profil privé', true);

await alice.goto(`${BASE}/profile/${privePseudo}`, { waitUntil: 'networkidle' });
await alice.waitForTimeout(1200);
ok('contenu du profil privé masqué',
  await visible(alice.getByText('Ce compte est privé')));
await alice.getByRole('button', { name: 'Suivre ce profil' }).click();
await alice.waitForTimeout(1500);
ok('demande envoyée',
  await visible(alice.getByRole('button', { name: 'Annuler la demande de suivi' })));

await prive.goto(BASE + '/home', { waitUntil: 'networkidle' });
await prive.waitForTimeout(1500);
ok('pastille de demande dans la navigation',
  await visible(prive.locator('button[aria-haspopup="menu"] span.bg-marque-500')));

await prive.goto(BASE + '/demandes', { waitUntil: 'networkidle' });
await prive.waitForTimeout(1200);
ok('demande listée', await visible(prive.getByText(`@${alicePseudo}`)));
await prive.getByRole('button', { name: 'Accepter' }).click();
await prive.waitForTimeout(1800);
ok('acceptation confirmée', await visible(prive.getByText(/vous suit désormais/)));

await alice.reload({ waitUntil: 'networkidle' });
await alice.waitForTimeout(1500);
ok('**accès au contenu privé obtenu**',
  (await alice.getByText('Ce compte est privé').count()) === 0);

/* ================================================================== *
 *  RESPONSIVE ET CONSOLE
 * ================================================================== */

section('Responsive et console');

for (const [nom, largeur, hauteur] of [
  ['mobile 375 px', 375, 812],
  ['tablette 768 px', 768, 1024],
  ['desktop 1440 px', 1440, 900],
]) {
  await alice.setViewportSize({ width: largeur, height: hauteur });
  for (const chemin of ['/home', '/settings', `/profile/${coachPseudo}`]) {
    await alice.goto(BASE + chemin, { waitUntil: 'networkidle' });
    await alice.waitForTimeout(350);
    const debordement = await alice.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    ok(`${chemin} sans débordement en ${nom}`, !debordement);
  }
}

await alice.setViewportSize({ width: 375, height: 812 });
await alice.goto(BASE + '/home', { waitUntil: 'networkidle' });
const navMobile = await alice
  .getByRole('navigation', { name: 'Navigation mobile' })
  .boundingBox();
ok('barre de navigation mobile en bas', navMobile && navMobile.y > 700,
  `y = ${Math.round(navMobile?.y ?? -1)}`);

const reelles = erreursJs.filter((e) => !/40[0139]|Failed to load resource/.test(e));
ok('aucune erreur JavaScript inattendue', reelles.length === 0,
  reelles.slice(0, 2).join(' | ') || 'console propre');

/* ================================================================== *
 *  NETTOYAGE
 * ================================================================== */

await navigateur.close();

// Nettoyage : on ne garde aucun compte de test en base.
const comptesTest = await bdd
  .collection('users')
  .find({ email: /@regression[.]local$/ }, { projection: { _id: 1 } })
  .toArray();
const idsTest = comptesTest.map((u) => u._id);

await Promise.all([
  bdd.collection('posts').deleteMany({ auteur: { $in: idsTest } }),
  bdd.collection('stories').deleteMany({ auteur: { $in: idsTest } }),
  bdd.collection('comments').deleteMany({ auteur: { $in: idsTest } }),
  bdd.collection('follows').deleteMany({
    $or: [{ follower: { $in: idsTest } }, { following: { $in: idsTest } }],
  }),
  bdd.collection('subscriptions').deleteMany({
    $or: [{ utilisateur: { $in: idsTest } }, { coach: { $in: idsTest } }],
  }),
]);
await bdd.collection('users').deleteMany({ _id: { $in: idsTest } });

// Sans fermeture explicite, la connexion garde le processus en vie et le
// test ne rend jamais la main.
await clientMongo.close();

console.log('\n============ SUITE DE RÉGRESSION — NAVIGATEUR ============');
const echecs = afficher();
console.log(
  '\nNote : les médias téléversés restent sur Cloudinary tant que ' +
    '`npm run nettoyer-medias -- --confirmer` n’a pas été lancé.'
);
process.exit(echecs > 0 ? 1 : 0);
