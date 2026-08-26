/**
 * ===========================================================================
 *  PARCOURS DE PAIEMENT COMPLET — DE BOUT EN BOUT
 * ===========================================================================
 *
 *   npm run test:paiement       (depuis client/)
 *
 * Cycle réel : tarif → sportif → session Checkout → paiement avec la carte
 * de test `4242…` → webhook → création de l'abonnement → déverrouillage du
 * contenu premium → résiliation.
 *
 * PRÉREQUIS
 *   - serveur sur le port 5000 ;
 *   - `stripe listen --forward-to localhost:5000/api/webhooks/stripe` actif ;
 *   - le coach `coachdemo` a FINALISÉ son inscription Stripe
 *     (`npm run coach-demo` côté serveur, puis remplir le formulaire).
 *
 * TOUT PASSE PAR L'API HTTP, jamais par la base directement. C'est plus
 * proche d'un usage réel, et cela évite de dépendre du CLI Docker — qui
 * s'est révélé fragile après une saturation disque.
 *
 * Le paiement est RÉELLEMENT effectué chez Stripe, en mode test : aucune
 * somme n'est débitée, mais l'abonnement et les webhooks sont ceux d'un
 * vrai parcours.
 * ===========================================================================
 */

import { chromium } from '@playwright/test';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

// Construit sans antislash litteral : les passes d'edition automatisees de ce
// projet les ont deja mangés une fois, avec une expression rationnelle invalide
// a la cle.
const SEPARATEUR_LIGNES = new RegExp(String.fromCharCode(92) + 'r?' + String.fromCharCode(92) + 'n');

const API = 'http://localhost:5000/api';
const COACH = 'coachdemo';
const MDP = 'MotDePasse123';
const DOM = '@paiementtest.local';
const S = Date.now();

const resultats = [];
const ok = (l, c, d = '') => resultats.push(`${c ? 'OK   ' : 'ECHEC'} ${l}${d ? '  -> ' + d : ''}`);

function afficher(interrompu) {
  console.log('\n========== PARCOURS DE PAIEMENT COMPLET ==========');
  resultats.forEach((r) => console.log(r));
  const e = resultats.filter((r) => r.startsWith('ECHEC')).length;
  console.log(`\n${resultats.length - e}/${resultats.length} vérifications réussies`);
  if (interrompu) console.log(`INTERROMPU : ${interrompu}`);
  return e;
}
process.on('uncaughtException', (e) => { afficher(e.message); process.exit(1); });
process.on('unhandledRejection', (e) => { afficher(e?.message || e); process.exit(1); });

async function appel(chemin, { methode = 'GET', corps, token, form } = {}) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (corps && !form) h['Content-Type'] = 'application/json';
  const r = await fetch(API + chemin, {
    method: methode, headers: h,
    body: form || (corps ? JSON.stringify(corps) : undefined),
  });
  let json = null;
  try { json = await r.json(); } catch { /* vide */ }
  return { statut: r.status, json };
}

/** PNG minimal valide, pour la publication premium. */
function png(l = 120, h = 80) {
  const lignes = [];
  for (let y = 0; y < h; y++) {
    const ligne = Buffer.alloc(l * 3 + 1);
    for (let x = 0; x < l; x++) {
      ligne[1 + x * 3] = 90; ligne[2 + x * 3] = 60; ligne[3 + x * 3] = 180;
    }
    lignes.push(ligne);
  }
  const bloc = (t, d) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
    const corps = Buffer.concat([Buffer.from(t, 'ascii'), d]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(corps));
    return Buffer.concat([len, corps, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(l, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', ihdr), bloc('IDAT', zlib.deflateSync(Buffer.concat(lignes))),
    bloc('IEND', Buffer.alloc(0)),
  ]);
}

/** Attend qu'une condition se réalise : les webhooks arrivent en différé. */
async function attendre(libelle, condition, timeoutMs = 40000) {
  const debut = Date.now();
  while (Date.now() - debut < timeoutMs) {
    if (await condition()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.warn(`  (délai dépassé : ${libelle})`);
  return false;
}

/* ============ 1. LE COACH DÉFINIT SON TARIF ============ */

const cxCoach = await appel('/auth/login', {
  methode: 'POST', corps: { identifiant: COACH, password: MDP },
});
ok('connexion du coach', cxCoach.statut === 200, `statut ${cxCoach.statut}`);
const jetonCoach = cxCoach.json.accessToken;

const statutConnect = await appel('/stripe/connect/statut', { token: jetonCoach });
ok('**compte Stripe du coach actif**', statutConnect.json?.chargesEnabled === true,
  `statut ${statutConnect.json?.statut}`);

const tarif = await appel('/stripe/premium/tarif', {
  methode: 'PUT', token: jetonCoach,
  corps: { prixMensuel: 19.9, description: 'Programmes et suivi personnalisé' },
});
ok('tarif défini à 19,90 €', tarif.statut === 200, tarif.json?.message);
ok('**peutMonetiser passe à vrai**', tarif.json?.peutMonetiser === true);

/* ============ 2. LE COACH PUBLIE DU CONTENU PREMIUM ============ */

const formPost = new FormData();
formPost.append('medias', new Blob([png()], { type: 'image/png' }), 'programme.png');
formPost.append('titre', 'Programme 12 semaines');
formPost.append('description', 'Contenu réservé aux abonnés premium');
formPost.append('estPremium', 'true');

const post = await appel('/posts', { methode: 'POST', token: jetonCoach, form: formPost });
ok('publication premium créée', post.statut === 201, post.json?.message);
const idPost = post.json?.post?._id;

/* ============ 3. UN SPORTIF S INSCRIT ET SUIT LE COACH ============ */

const pseudoSportif = `sportif${S}`;
const insc = await appel('/auth/register', {
  methode: 'POST',
  corps: { type: 'utilisateur', nom: 'Test', prenom: 'Julie', pseudo: pseudoSportif,
           email: `${pseudoSportif}${DOM}`, password: MDP, ville: 'Lyon' },
});
ok('sportif inscrit', insc.statut === 201);
const jetonSportif = insc.json.accessToken;

const suivi = await appel(`/follows/${COACH}`, { methode: 'POST', token: jetonSportif });
ok('le sportif suit le coach (gratuit)', suivi.json?.statut === 'accepte');

/* ============ 4. VERROUILLÉ AVANT PAIEMENT ============ */

const avant = await appel(`/posts/${idPost}`, { token: jetonSportif });
ok('**contenu premium verrouillé avant paiement**', avant.json?.post?.verrouille === true);
ok('médias retirés de la réponse', avant.json?.post?.medias?.length === 0);
ok('description masquée', avant.json?.post?.description === null);

const statutAvant = await appel(`/subscriptions/statut/${COACH}`, { token: jetonSportif });
ok('pas encore abonné', statutAvant.json?.abonne === false);
ok('offre disponible et prix exposé', statutAvant.json?.offreDisponible === true &&
  statutAvant.json?.prixMensuel === 1990);

/* ============ 5. SESSION DE PAIEMENT ============ */

const checkout = await appel(`/subscriptions/${COACH}/checkout`, {
  methode: 'POST', token: jetonSportif,
});
ok('**session Checkout créée**', checkout.statut === 200,
  `statut ${checkout.statut} ${checkout.json?.message || ''}`);
ok('URL de paiement Stripe renvoyée', checkout.json?.url?.startsWith('https://'),
  checkout.json?.url?.slice(0, 46) + '…');

/* ============ 6. PAIEMENT AVEC LA CARTE DE TEST ============ */

console.log('\n  → ouverture de la page de paiement Stripe…');

const navigateur = await chromium.launch();
const page = await navigateur.newPage({ viewport: { width: 1280, height: 950 } });
await page.goto(checkout.json.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
ok('page Stripe Checkout chargée', page.url().includes('stripe.com'));

/**
 * IL FAUT D'ABORD SÉLECTIONNER « Carte ».
 *
 * Stripe Checkout présente les moyens de paiement en accordéon — Carte,
 * Klarna, Satispay — et les champs de carte N'EXISTENT PAS dans le DOM tant
 * que l'option n'est pas cochée. Chercher `#cardNumber` d'emblée ne trouve
 * rien, et le formulaire n'est jamais soumis.
 *
 * On coche le bouton radio plutôt que de cliquer le libellé : le bouton de
 * l'accordéon porte la classe `AccordionButton-open` mais reste invisible,
 * et Playwright refuse de cliquer un élément non visible.
 */
await page
  .locator('#payment-method-accordion-item-title-card')
  .check({ force: true })
  .catch(async () => {
    await page.locator('#payment-method-accordion-item-title-card').click({ force: true });
  });
await page.waitForTimeout(3500);
ok('moyen de paiement « Carte » sélectionné',
  (await page.locator('#cardNumber').count()) > 0);

const remplir = async (selecteurs, valeur) => {
  for (const s of selecteurs) {
    const champ = page.locator(s).first();
    if (await champ.count()) {
      await champ.fill(valeur).catch(() => {});
      return true;
    }
  }
  return false;
};

await remplir(['#cardNumber', 'input[name="cardNumber"]'], '4242 4242 4242 4242');
await remplir(['#cardExpiry', 'input[name="cardExpiry"]'], '12 / 34');
await remplir(['#cardCvc', 'input[name="cardCvc"]'], '123');
await remplir(['#billingName', 'input[name="billingName"]'], 'Julie Test');
await remplir(['#billingAddressLine1', 'input[name="billingAddressLine1"]'], '1 rue de la Paix');
await remplir(['#billingPostalCode', 'input[name="billingPostalCode"]'], '69001');
await remplir(['#billingLocality', 'input[name="billingLocality"]'], 'Lyon');
await page.waitForTimeout(800);

await page.getByTestId('hosted-payment-submit-button').click({ timeout: 20000 })
  .catch(async () => { await page.locator('button[type="submit"]').first().click(); });

console.log('  → paiement soumis, attente de la redirection…');

const redirige = await page
  .waitForURL(/localhost:5173/, { timeout: 90000 })
  .then(() => true)
  .catch(() => false);

ok('**paiement accepté, redirection vers le site**', redirige, page.url().slice(0, 56) + '…');
await navigateur.close();

/* ============ 7. LE WEBHOOK CRÉE L ABONNEMENT ============ */

console.log('  → attente du webhook checkout.session.completed…');

const cree = await attendre('création de l’abonnement', async () => {
  const r = await appel('/subscriptions', { token: jetonSportif });
  return (r.json?.elements?.length || 0) > 0;
});
ok('**abonnement créé en base par le webhook**', cree);

const mesAbos = await appel('/subscriptions', { token: jetonSportif });
const abo = mesAbos.json?.elements?.[0];

ok('statut « actif »', abo?.statut === 'actif', abo?.statut);
ok('montant enregistré', abo?.montant === 1990, `${abo?.montant} centimes`);
ok('fin de période renseignée', Boolean(abo?.periodeFin),
  abo?.periodeFin ? new Date(abo.periodeFin).toLocaleDateString('fr-FR') : '—');
ok('le virtuel donneAcces est vrai', abo?.donneAcces === true);
ok('le coach est bien identifié', abo?.coach?.pseudo === COACH);

const profilCoach = await appel(`/users/${COACH}`);
ok('compteur d’abonnés premium du coach à 1',
  profilCoach.json?.profil?.stats?.abonnesPremiumCount === 1,
  `${profilCoach.json?.profil?.stats?.abonnesPremiumCount}`);

/* ============ 8. LE CONTENU EST DÉVERROUILLÉ ============ */

const apres = await appel(`/posts/${idPost}`, { token: jetonSportif });
ok('**contenu premium DÉVERROUILLÉ après paiement**', apres.json?.post?.verrouille === false);
ok('médias désormais présents', apres.json?.post?.medias?.length === 1);
ok('description désormais visible',
  apres.json?.post?.description === 'Contenu réservé aux abonnés premium');
ok('URL du média désormais fournie',
  apres.json?.post?.medias?.[0]?.url?.startsWith('https://'));

const feed = await appel('/posts/feed', { token: jetonSportif });
const premiumFeed = feed.json?.elements?.find((p) => p.estPremium);
ok('déverrouillé dans le fil également', premiumFeed?.verrouille === false);

const statutApres = await appel(`/subscriptions/statut/${COACH}`, { token: jetonSportif });
ok('statut d’abonnement exposé au front', statutApres.json?.abonne === true);

/* ============ 9. DOUBLON REFUSÉ ============ */

const doublon = await appel(`/subscriptions/${COACH}/checkout`, {
  methode: 'POST', token: jetonSportif,
});
ok('**second abonnement au même coach refusé (409)**', doublon.statut === 409,
  doublon.json?.message);

/* ============ 10. RÉSILIATION ============ */

const resiliation = await appel(`/subscriptions/${abo._id}`, {
  methode: 'DELETE', token: jetonSportif,
});
ok('résiliation acceptée', resiliation.statut === 200,
  resiliation.json?.message?.slice(0, 62));
ok('résiliation programmée en fin de période',
  resiliation.json?.abonnement?.annuleALaFinPeriode === true);
ok('**l’accès est CONSERVÉ jusqu’à la fin de la période payée**',
  resiliation.json?.abonnement?.donneAcces === true);

const contenuApres = await appel(`/posts/${idPost}`, { token: jetonSportif });
ok('contenu toujours accessible après résiliation',
  contenuApres.json?.post?.verrouille === false);

const reprise = await appel(`/subscriptions/${abo._id}/reprendre`, {
  methode: 'POST', token: jetonSportif,
});
ok('reprise de l’abonnement', reprise.statut === 200);
ok('résiliation annulée', reprise.json?.abonnement?.annuleALaFinPeriode === false);

/* ============ 11. REVENUS DU COACH ============ */

const revenus = await appel('/stripe/premium/revenus', { token: jetonCoach });
const r = revenus.json?.revenus;
ok('revenus : 1 abonné actif', r?.abonnesActifs === 1);
ok('brut mensuel 19,90 €', r?.brutMensuel === 1990, `${r?.brutMensuel} centimes`);
ok('commission 15 % soit 2,99 €', r?.commissionPlateforme === 299,
  `${r?.commissionPlateforme} centimes`);
ok('net pour le coach 16,91 €', r?.netMensuel === 1691, `${r?.netMensuel} centimes`);

/* ============ 12. REVERROUILLAGE SUR ÉCHEC DE PAIEMENT ============ */

/*
 * LE SENS CRITIQUE N'EST PAS LE DÉVERROUILLAGE, C'EST LE REVERROUILLAGE.
 *
 * Un contenu qui ne s'ouvre pas alors qu'on a payé est un incident
 * commercial : le client se plaint, on corrige. Un contenu qui reste ouvert
 * alors que le prélèvement a échoué est une perte sèche pour le coach, et
 * personne ne vient la signaler. C'est donc ce sens-là qu'il faut prouver.
 *
 * On écrit le statut « impaye » directement en base — c'est exactement ce que
 * fait le gestionnaire de `invoice.payment_failed`, dont la signature et
 * l'idempotence sont déjà couvertes par `server/tests/stripe.mjs`. Ce qui
 * est vérifié ici est l'autre moitié : que le CHEMIN DE LECTURE en tienne
 * compte, immédiatement et sans redémarrage.
 */

const requireServeur = createRequire(new URL('../../server/package.json', import.meta.url));
const { MongoClient } = requireServeur('mongodb');

const uriMongo = readFileSync(new URL('../../server/.env', import.meta.url), 'utf8')
  .split(SEPARATEUR_LIGNES)
  .find((ligne) => ligne.startsWith('MONGO_URI='))
  .slice('MONGO_URI='.length)
  .trim()
  .replace(/^["']|["']$/g, '');

const clientMongo = new MongoClient(uriMongo, { serverSelectionTimeoutMS: 8000 });
await clientMongo.connect();
const collectionAbos = clientMongo.db().collection('subscriptions');

const { ObjectId } = requireServeur('mongodb');
const filtreAbo = { _id: new ObjectId(String(abo._id)) };

// On mémorise l'état pour le restaurer : le nettoyage qui suit résilie
// proprement l'abonnement chez Stripe, ce qui exige qu'il soit encore actif.
const avantEchec = await collectionAbos.findOne(filtreAbo);

await collectionAbos.updateOne(filtreAbo, { $set: { statut: 'impaye' } });

const verrouilleANouveau = await appel(`/posts/${idPost}`, { token: jetonSportif });
ok('**contenu REVERROUILLÉ après échec de prélèvement**',
  verrouilleANouveau.json?.post?.verrouille === true);
ok('médias de nouveau retirés de la réponse',
  (verrouilleANouveau.json?.post?.medias?.length || 0) === 0);
ok('description de nouveau masquée',
  !verrouilleANouveau.json?.post?.description);

const filApresEchec = await appel('/posts/feed', { token: jetonSportif });
const premiumApresEchec = filApresEchec.json?.elements?.find((p) => p.estPremium);
ok('reverrouillé dans le fil également', premiumApresEchec?.verrouille === true);

const statutApresEchec = await appel(`/subscriptions/statut/${COACH}`, { token: jetonSportif });
ok('l’accès est retiré côté statut', statutApresEchec.json?.abonne === false);

// Remise en état avant le nettoyage.
await collectionAbos.updateOne(filtreAbo, { $set: { statut: avantEchec.statut } });
// La connexion reste ouverte : le nettoyage ci-dessous s'en sert.

/* ============ NETTOYAGE ============ */

/*
 * POURQUOI LES APPELS D'API NE SUFFISENT PAS À NETTOYER.
 *
 * Les deux routes ci-dessous se comportent exactement comme elles le
 * doivent en production, et c’est précisément ce qui laisse des traces :
 *
 *   DELETE /subscriptions/:id  résilie **en fin de période** — l’abonné a
 *                              payé le mois, il le garde. Le document reste
 *                              donc `actif` pendant encore un mois.
 *   DELETE /users/me           **désactive** le compte sans le supprimer
 *                              (règle du module 4 : on ne perd jamais de
 *                              données).
 *
 * Résultat : chaque exécution laissait un abonné actif de plus au coach de
 * démonstration, et les assertions de revenus — qui attendent « 1 abonné »
 * — échouaient dès la deuxième exécution. Non pas à cause d’une régression,
 * mais de la suite elle-même. Le nettoyage descend donc en base pour
 * retirer ce qu’aucune API n’a vocation à retirer.
 */

// D’abord la résiliation chez Stripe : sans elle, l’abonnement continuerait
// de se renouveler côté Stripe même après effacement de notre copie.
await appel(`/subscriptions/${abo._id}`, { methode: 'DELETE', token: jetonSportif });
await appel(`/posts/${idPost}`, { methode: 'DELETE', token: jetonCoach });
await appel(`/follows/${COACH}`, { methode: 'DELETE', token: jetonSportif });
await appel('/users/me', { methode: 'DELETE', token: jetonSportif });

const bdd = clientMongo.db();

// Balayage large plutôt que ciblé : on retire aussi les restes d’exécutions
// précédentes interrompues (coupure réseau, Checkout expiré). La suite se
// répare ainsi d’elle-même au lieu d’exiger une purge manuelle.
const motifTest = new RegExp(DOM.replace('.', '[.]') + '$');
const comptesTest = await bdd
  .collection('users')
  .find({ email: motifTest }, { projection: { _id: 1 } })
  .toArray();
const idsTest = comptesTest.map((u) => u._id);

const abosRetires = await bdd
  .collection('subscriptions')
  .deleteMany({ utilisateur: { $in: idsTest } });
await bdd.collection('users').deleteMany({ _id: { $in: idsTest } });

// Le compteur du coach est recalculé, jamais décrémenté : c’est la règle
// posée pour les webhooks au module 7, elle vaut aussi ici.
const coachEnBase = await bdd.collection('users').findOne({ pseudo: COACH });
if (coachEnBase) {
  const restants = await bdd
    .collection('subscriptions')
    .countDocuments({ coach: coachEnBase._id, statut: 'actif' });
  await bdd
    .collection('users')
    .updateOne({ _id: coachEnBase._id }, { $set: { 'stats.abonnesPremium': restants } });
}

await clientMongo.close();

console.log(
  `
  (abonnement résilié chez Stripe, ${abosRetires.deletedCount} abonnement(s) ` +
    `et ${idsTest.length} compte(s) de test retirés de la base)`
);

const echecs = afficher();
process.exit(echecs > 0 ? 1 : 0);
