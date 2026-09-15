/**
 * ===========================================================================
 *  GÉOCODAGE DES ÉVÉNEMENTS — correctif 9.8
 * ===========================================================================
 *
 *   npm run test:geocodage
 *
 * CE QUE CETTE SUITE DÉFEND, ET POURQUOI ELLE EXISTE.
 * Un événement sans point n'entre pas dans l'index `2dsphere` : il devient
 * introuvable dans « Autour de moi », définitivement et sans message d'erreur.
 * La création réussit, la liste reste vide, et rien ne relie les deux. C'est
 * exactement le défaut qui a été signalé en recette, et il ne se voit qu'à
 * l'exécution.
 *
 * ELLE APPELLE NOMINATIM POUR DE VRAI. Un faux géocodeur passerait quelle que
 * soit l'implémentation et ne prouverait rien : les deux défauts trouvés
 * pendant le développement — l'adresse en bloc et l'homonyme de commune —
 * viennent du comportement réel du service, pas du nôtre.
 *
 * ELLE EST DONC LENTE, ET C'EST NORMAL : la politique d'usage de Nominatim
 * impose une requête par seconde, et le service la respecte.
 *
 * LES ADRESSES SONT CHOISIES POUR ÊTRE DIFFICILES. « Paris » aurait
 * fonctionné du premier coup et masqué les deux pièges. Castres a un homonyme
 * dans l'Aisne, à 430 km, et l'adresse de recette portait une faute de frappe.
 * ===========================================================================
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

import { geocoder } from '../src/services/geocodage.service.js';

const API = 'http://localhost:5000/api';
const DOM = '@geotest.local';
const MDP = 'MotDePasse123';
const S = Date.now();

/* Castres (Tarn) — la bonne. */
const TARN = { lat: 43.61, lng: 2.25 };
/* Castres (Aisne) — l'homonyme, à 430 km. Un point ici serait un faux. */
const AISNE = { lat: 49.80, lng: 3.24 };

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
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (corps) h['Content-Type'] = 'application/json';
  const r = await fetch(API + chemin, {
    method: methode,
    headers: h,
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const t = await r.text();
  return { statut: r.status, texte: t, json: (() => { try { return JSON.parse(t); } catch { return null; } })() };
}

/** Distance approximative en km, suffisante pour distinguer deux communes. */
const ecartKm = ([lng, lat], ref) =>
  Math.round(Math.hypot((lat - ref.lat) * 111, (lng - ref.lng) * 111 * Math.cos((lat * Math.PI) / 180)));

const dansNJours = (n, heure = 10) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(heure, 0, 0, 0);
  return d.toISOString();
};

/* ------------------------------ Base ------------------------------ */

const requireServeur = createRequire(new URL('../package.json', import.meta.url));
const { MongoClient, ObjectId } = requireServeur('mongodb');

const uriMongo = readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .find((l) => l.startsWith('MONGO_URI='))
  .slice('MONGO_URI='.length)
  .trim()
  .replace(/^["']|["']$/g, '');

const clientMongo = new MongoClient(uriMongo, { serverSelectionTimeoutMS: 8000 });
await clientMongo.connect();
const bdd = clientMongo.db();

const motifTest = new RegExp(`${DOM.replace('.', '[.]')}$`);

async function purger() {
  const comptes = await bdd.collection('users')
    .find({ email: motifTest }, { projection: { _id: 1 } }).toArray();
  const ids = comptes.map((u) => u._id);
  if (ids.length === 0) return 0;
  await bdd.collection('sportevents').deleteMany({ organisateur: { $in: ids } });
  await bdd.collection('users').deleteMany({ _id: { $in: ids } });
  return ids.length;
}

await purger();

/* ================================================================== *
 *  1 — LE SERVICE SEUL
 * ================================================================== */

section('Le service de géocodage');

const complet = await geocoder({ adresse: 'Place Jean Jaurès', codePostal: '81100', ville: 'Castres' });
ok('une adresse correcte rend un point',
  complet?.type === 'Point' && Array.isArray(complet.coordinates),
  complet ? complet.coordinates.map((n) => n.toFixed(4)).join(', ') : 'null');
ok('le point est bien dans le Tarn',
  complet && ecartKm(complet.coordinates, TARN) < 15,
  complet ? `${ecartKm(complet.coordinates, TARN)} km du centre` : '—');

/*
 * LE CAS RÉEL DE LA RECETTE. « park Gourjade » est une faute de frappe pour
 * « Parc de Gourjade » : Nominatim traite la chaîne EN BLOC et ne rend rien
 * plutôt que d'ignorer le morceau qu'il ne reconnaît pas. Sans repli, la
 * ville échouait avec l'adresse.
 */
const fautif = await geocoder({ adresse: 'park Gourjade', codePostal: '81100', ville: 'Castres' });
ok('**une adresse fautive ne fait pas perdre la ville**',
  fautif !== null && ecartKm(fautif.coordinates, TARN) < 15,
  fautif ? `${ecartKm(fautif.coordinates, TARN)} km du centre` : 'AUCUN POINT');

/*
 * LE PIÈGE DE L'HOMONYME. « Castres » seul renvoie Castres dans l'Aisne, à
 * 430 km. Le code postal est le seul désambiguïsateur : le service doit
 * refuser de retomber sur la ville nue tant qu'un code postal est fourni.
 */
const homonyme = await geocoder({ adresse: 'rue totalement inexistante xyzq', codePostal: '81100', ville: 'Castres' });
ok('**l’homonyme de l’Aisne n’est jamais retenu**',
  homonyme !== null && ecartKm(homonyme.coordinates, AISNE) > 300,
  homonyme ? `${ecartKm(homonyme.coordinates, AISNE)} km de Castres (Aisne)` : 'AUCUN POINT');

const sansRien = await geocoder({});
ok('un lieu vide rend null, sans appel réseau', sansRien === null);

const introuvable = await geocoder({ ville: 'Zzzqqqxyz', codePostal: '99999' });
ok('une commune inexistante rend null, pas une exception', introuvable === null);

/* ================================================================== *
 *  2 — LA CRÉATION D'ÉVÉNEMENT
 * ================================================================== */

section('Création sans coordonnées fournies');

const insc = await appel('/auth/register', {
  methode: 'POST',
  corps: {
    type: 'coach', prenom: 'Gina', nom: 'Geo', pseudo: `geo${S}`,
    ville: 'Castres', email: `geo${S}${DOM}`, password: MDP,
    diplome: { intitule: 'BPJEPS AF', organisme: 'DRAJES' },
  },
});
ok('coach inscrit', insc.statut === 201, `statut ${insc.statut}`);

const token = insc.json?.accessToken;
await bdd.collection('users').updateOne(
  { pseudo: `geo${S}` },
  { $set: { 'diplome.statut': 'verifie', 'diplome.dateVerification': new Date() } }
);

const cree = await appel('/events', {
  methode: 'POST',
  token,
  corps: {
    titre: `Sortie géocodage ${S}`,
    description: 'Créée sans cocher « utiliser ma position actuelle ».',
    sport: 'course',
    dateDebut: dansNJours(2),
    dateFin: dansNJours(2, 12),
    capaciteMax: 10,
    lieu: { adresse: 'park Gourjade', ville: 'Castres', codePostal: '81100' },
  },
});
ok('événement créé sans longitude ni latitude', cree.statut === 201, `statut ${cree.statut}`);

const idEvenement = cree.json?.evenement?._id;
const enBase = idEvenement
  ? await bdd.collection('sportevents').findOne({ _id: new ObjectId(String(idEvenement)) })
  : null;
const point = enBase?.lieu?.localisation?.coordinates;

ok('**LE SERVEUR A POSÉ LE POINT TOUT SEUL**', Array.isArray(point),
  point ? point.map((n) => n.toFixed(4)).join(', ') : 'aucun point');
ok('et il est dans le Tarn', Array.isArray(point) && ecartKm(point, TARN) < 15,
  point ? `${ecartKm(point, TARN)} km` : '—');

/* ================================================================== *
 *  3 — LA POSITION EXPLICITE GARDE LA PRIORITÉ
 * ================================================================== */

section('Position explicite');

/*
 * Quand l'organisateur coche la case, il sait où il est mieux qu'un géocodeur
 * ne saura lire son adresse. On envoie donc une position volontairement
 * éloignée de la ville écrite : c'est elle qui doit être retenue.
 */
const avecPosition = await appel('/events', {
  methode: 'POST',
  token,
  corps: {
    titre: `Position explicite ${S}`,
    description: 'La case « utiliser ma position » est cochée.',
    sport: 'course',
    dateDebut: dansNJours(3),
    dateFin: dansNJours(3, 12),
    capaciteMax: 10,
    lieu: { ville: 'Castres', codePostal: '81100', longitude: 1.4442, latitude: 43.6047 },
  },
});
ok('événement créé avec position explicite', avecPosition.statut === 201, `statut ${avecPosition.statut}`);

const idExplicite = avecPosition.json?.evenement?._id;
const docExplicite = idExplicite
  ? await bdd.collection('sportevents').findOne({ _id: new ObjectId(String(idExplicite)) })
  : null;
const pointExplicite = docExplicite?.lieu?.localisation?.coordinates;

ok('**la position fournie l’emporte sur l’adresse écrite**',
  Array.isArray(pointExplicite) &&
    Math.abs(pointExplicite[0] - 1.4442) < 0.01 &&
    Math.abs(pointExplicite[1] - 43.6047) < 0.01,
  pointExplicite ? pointExplicite.map((n) => n.toFixed(4)).join(', ') : 'aucun point');

/* ================================================================== *
 *  4 — « AUTOUR DE MOI »
 * ================================================================== */

section('Remontée dans « Autour de moi »');

const proches = await appel(`/events/proches?lng=${TARN.lng}&lat=${TARN.lat}&rayon=25000`);
ok('la route répond', proches.statut === 200, `statut ${proches.statut}`);

const liste = proches.json?.evenements ?? [];
const notre = liste.find((e) => String(e._id) === String(idEvenement));

ok('**L’ÉVÉNEMENT GÉOCODÉ REMONTE**', Boolean(notre),
  notre ? `${notre.distanceM} m` : `${liste.length} résultat(s), pas le nôtre`);
ok('avec une distance calculée par le serveur',
  notre && Number.isFinite(notre.distanceM) && notre.distanceM < 25000,
  notre ? `${notre.distanceM} m` : '—');

/*
 * LE TÉMOIN NÉGATIF. Sans lui, la vérification précédente passerait même si
 * la route rendait tout le contenu de la base : on ne saurait pas qu'elle
 * filtre réellement par distance.
 */
const loin = await appel('/events/proches?lng=2.3522&lat=48.8566&rayon=25000'); // Paris
const listeLoin = loin.json?.evenements ?? [];
ok('et ne remonte PAS depuis Paris, à 600 km',
  !listeLoin.some((e) => String(e._id) === String(idEvenement)),
  `${listeLoin.length} résultat(s) autour de Paris`);

/* ================================================================== *
 *  5 — REGÉOCODAGE À LA MODIFICATION
 * ================================================================== */

section('Modification de l’adresse');

const modifie = await appel(`/events/${idEvenement}`, {
  methode: 'PATCH',
  token,
  corps: { lieu: { ville: 'Albi', codePostal: '81000', adresse: 'Place Sainte-Cécile' } },
});
ok('modification acceptée', modifie.statut === 200, `statut ${modifie.statut}`);

const apresModif = await bdd.collection('sportevents')
  .findOne({ _id: new ObjectId(String(idEvenement)) });
const pointAlbi = apresModif?.lieu?.localisation?.coordinates;

/* Albi ≈ 43,93 / 2,15 — à une trentaine de kilomètres de Castres. */
ok('**LE POINT A SUIVI LA NOUVELLE VILLE**',
  Array.isArray(pointAlbi) && Math.abs(pointAlbi[1] - 43.93) < 0.15,
  pointAlbi ? pointAlbi.map((n) => n.toFixed(4)).join(', ') : 'aucun point');

/*
 * ET IL NE BOUGE PAS QUAND L'ADRESSE NE CHANGE PAS. Le front renvoie le lieu
 * entier à chaque édition : sans la comparaison avant/après du contrôleur,
 * corriger un titre déplacerait le point — et consommerait un appel à
 * Nominatim au passage.
 */
const avantTitre = JSON.stringify(pointAlbi);
await appel(`/events/${idEvenement}`, {
  methode: 'PATCH',
  token,
  corps: {
    titre: `Titre corrigé ${S}`,
    lieu: { ville: 'Albi', codePostal: '81000', adresse: 'Place Sainte-Cécile' },
  },
});
const apresTitre = await bdd.collection('sportevents')
  .findOne({ _id: new ObjectId(String(idEvenement)) });

ok('changer le titre ne déplace pas le point',
  JSON.stringify(apresTitre?.lieu?.localisation?.coordinates) === avantTitre);

/* ------------------------------ Fin ------------------------------ */

const supprimes = await purger();
await clientMongo.close();

console.log('\n============ GÉOCODAGE DES ÉVÉNEMENTS — CORRECTIF 9.8 ============');
const echecs = afficher();
console.log(`\n  (${supprimes} compte(s) de test supprimés, événements compris)`);
process.exit(echecs > 0 ? 1 : 0);
