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
 * dans l'Aisne, à 691 km, et l'adresse de recette portait une faute de frappe.
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
/* Castres (Aisne) — l'homonyme, à 691 km. Un point ici serait un faux. */
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
 * 691 km. Le code postal est le seul désambiguïsateur : le service doit
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

/* ================================================================== *
 *  4 — « AUTOUR DE MOI » SANS GÉOLOCALISATION (voie 3)
 *
 *  L'onglet restait VIDE pour qui refuse la géolocalisation du navigateur,
 *  sans rien proposer d'autre. Un refus est un choix légitime, pas une panne :
 *  `PATCH /users/me/localisation-depuis-ville` déduit un point de la ville du
 *  profil, à la demande, une personne à la fois.
 *
 *  LE PIÈGE QUE CETTE SECTION SURVEILLE. Un point déduit d'une ville est
 *  précis au kilomètre. `carteVisible` n'exigeait qu'« une position
 *  enregistrée » : sans garde-fou, un coach qui a seulement voulu CHERCHER
 *  autour de lui deviendrait éligible à la carte publique, où il apparaîtrait
 *  au centre-ville avec l'apparence d'un relevé GPS — la carte arrondissant
 *  déjà à ~110 m, rien ne les distinguerait. Trois vérifications ci-dessous
 *  existent pour cela seul, et elles sont marquées.
 * ================================================================== */

section('La position déduite de la ville du profil');

/*
 * UNE ROUTE QUI NE LIT RIEN DU CORPS DE LA REQUÊTE. La ville vient du jeton,
 * donc du compte : c'est ce qui la rend sûre, et ce qui justifie qu'elle soit
 * séparée de `/me/localisation` — dont le validateur garantit, lui, qu'une
 * coordonnée reçue a bien été fournie par le client.
 */
const sansSession = await appel('/users/me/localisation-depuis-ville', { methode: 'PATCH' });
ok('sans session, la route refuse', sansSession.statut === 401, `statut ${sansSession.statut}`);

/* Un compte SANS ville : l'échec doit être explicite, pas un point au hasard. */
const inscSansVille = await appel('/auth/register', {
  methode: 'POST',
  corps: {
    type: 'utilisateur', prenom: 'Sans', nom: 'Ville', pseudo: `geosv${S}`,
    email: `geosv${S}${DOM}`, password: MDP,
  },
});
const tokenSansVille = inscSansVille.json?.accessToken;
const refusSansVille = await appel('/users/me/localisation-depuis-ville', {
  methode: 'PATCH', token: tokenSansVille,
});
ok('**un profil sans ville reçoit un 400 qui le dit**',
  refusSansVille.statut === 400 && /ville/i.test(refusSansVille.json?.message ?? ''),
  `${refusSansVille.statut} — ${refusSansVille.json?.message}`);

/*
 * UNE VILLE FANTAISISTE DOIT DONNER 422, PAS 400 ET PAS 200.
 *
 * La distinction compte pour la personne : 400 dit « corrigez votre demande »,
 * 422 dit « votre demande est correcte, c'est Nominatim qui ne connaît pas ».
 * Et surtout, un 200 avec un point nul reproduirait EXACTEMENT le défaut qu'on
 * corrige — un écran vide sans raison affichée.
 */
await bdd.collection('users').updateOne({ pseudo: `geosv${S}` }, { $set: { ville: 'Zzzqqqxxwww' } });
const villeIntrouvable = await appel('/users/me/localisation-depuis-ville', {
  methode: 'PATCH', token: tokenSansVille,
});
ok('**une ville introuvable donne 422, et non un succès vide**',
  villeIntrouvable.statut === 422, `statut ${villeIntrouvable.statut}`);
ok('et le message nomme la ville en cause',
  (villeIntrouvable.json?.message ?? '').includes('Zzzqqqxxwww'),
  villeIntrouvable.json?.message);

/*
 * L'HOMONYME EST REFUSÉ, ET CETTE VÉRIFICATION A TROUVÉ UN VRAI DÉFAUT.
 *
 * La première version de la route appelait `geocoder({ ville })` et écrivait
 * ce qui revenait. Pour « Castres », Nominatim rend Castres dans l'AISNE :
 * l'épreuve a mesuré **691 km** d'écart avec le Tarn. Le profil ne portant que
 * `ville`, rien ne permettait de départager — et un point faux ne se signale
 * pas : « Autour de moi » se serait rempli d'événements plausibles, à 700 km.
 *
 * Le service refuse donc désormais de trancher, et dit comment en sortir.
 */
await bdd.collection('users').updateOne({ pseudo: `geosv${S}` }, { $set: { ville: 'Castres' } });
const ambigue = await appel('/users/me/localisation-depuis-ville', {
  methode: 'PATCH', token: tokenSansVille,
});
ok('**une ville à homonyme est REFUSÉE, pas tranchée au hasard**',
  ambigue.statut === 409, `statut ${ambigue.statut}`);
ok('**et le refus donne la sortie exacte** — ajouter le code postal au profil',
  /code postal/i.test(ambigue.json?.message ?? ''), ambigue.json?.message);

const nonEcrit = await bdd.collection('users').findOne({ pseudo: `geosv${S}` });
ok('**aucun point n’a été écrit** — un refus ne laisse pas de trace à moitié posée',
  !nonEcrit?.localisation, JSON.stringify(nonEcrit?.localisation ?? null));

/* Le remède annoncé par le message doit effectivement marcher. */
await bdd.collection('users').updateOne(
  { pseudo: `geosv${S}` }, { $set: { ville: 'Castres 81100' } }
);
const depuisVille = await appel('/users/me/localisation-depuis-ville', {
  methode: 'PATCH', token: tokenSansVille,
});
ok('une ville précisée rend un point', depuisVille.statut === 200, `statut ${depuisVille.statut}`);
ok('**et il tombe bien sur Castres (Tarn), pas sur son homonyme de l’Aisne**',
  depuisVille.json?.localisation
    && ecartKm(depuisVille.json.localisation.coordinates, TARN) < 15,
  depuisVille.json?.localisation
    ? `${ecartKm(depuisVille.json.localisation.coordinates, TARN)} km du centre`
    : 'aucun point');

const compteVille = await bdd.collection('users').findOne({ pseudo: `geosv${S}` });
ok('le point est bien écrit en base, pas seulement renvoyé',
  compteVille?.localisation?.type === 'Point' && compteVille.localisation.coordinates.length === 2);
ok('**la PROVENANCE est enregistrée** — sans elle, la carte publique ne peut pas trancher',
  compteVille?.localisationSource === 'ville', String(compteVille?.localisationSource));
ok('et la réponse annonce la précision au client',
  depuisVille.json?.source === 'ville', String(depuisVille.json?.source));

/*
 * ET LE POINT EST RÉELLEMENT LU PAR `$geoNear`. Sans cette vérification, on
 * aurait pu écrire une coordonnée que personne n'interroge — le défaut aurait
 * survécu au correctif, invisible.
 */
const autour = await appel(
  `/events/proches?lng=${compteVille.localisation.coordinates[0]}&lat=${compteVille.localisation.coordinates[1]}&rayon=25000`,
  { token: tokenSansVille }
);
ok('**le point déduit sert bien à « Autour de moi »**',
  autour.statut === 200 && Array.isArray(autour.json?.evenements),
  `statut ${autour.statut}, ${autour.json?.evenements?.length ?? 0} événement(s)`);

section('Un point déduit d’une ville n’ouvre pas la carte publique');

/*
 * LE COACH DE LA SECTION 2 a un point relevé par le navigateur : il doit
 * pouvoir figurer sur la carte. Celui-ci part d'une ville : il ne doit pas.
 */
const inscCoachVille = await appel('/auth/register', {
  methode: 'POST',
  corps: {
    type: 'coach', prenom: 'Cora', nom: 'Ville', pseudo: `geocv${S}`,
    /* Précisée : « Castres » seul est refusé pour homonymie, voir plus haut. */
    ville: 'Castres 81100', email: `geocv${S}${DOM}`, password: MDP,
    diplome: { intitule: 'BPJEPS AF', organisme: 'DRAJES' },
  },
});
const tokenCoachVille = inscCoachVille.json?.accessToken;

const sansPosition = await appel('/geo/carte-visible', {
  methode: 'PATCH', token: tokenCoachVille, corps: { carteVisible: true },
});
ok('sans aucune position, la carte est refusée — le garde-fou d’origine tient',
  sansPosition.statut === 400, `statut ${sansPosition.statut}`);

await appel('/users/me/localisation-depuis-ville', { methode: 'PATCH', token: tokenCoachVille });
const avecPointVille = await appel('/geo/carte-visible', {
  methode: 'PATCH', token: tokenCoachVille, corps: { carteVisible: true },
});
ok('**avec un point déduit de la ville, la carte est refusée AUSSI**',
  avecPointVille.statut === 400, `statut ${avecPointVille.statut}`);
ok('**et le refus dit comment en sortir**, au lieu de laisser deviner',
  /géolocalisation/i.test(avecPointVille.json?.message ?? ''),
  avecPointVille.json?.message);

const pasSurLaCarte = await bdd.collection('users').findOne({ pseudo: `geocv${S}` });
ok('le coach n’est effectivement pas passé sur la carte',
  pasSurLaCarte?.carteVisible !== true, String(pasSurLaCarte?.carteVisible));

/*
 * LA SORTIE FONCTIONNE : relever sa vraie position rebascule la provenance,
 * et la carte s'ouvre. Sans cette bascule, un coach ayant une fois géocodé sa
 * ville resterait exclu de la carte pour toujours.
 */
const releve = await appel('/users/me/localisation', {
  methode: 'PATCH', token: tokenCoachVille,
  corps: { coordinates: [2.2411, 43.6045], ville: 'Castres' },
});
ok('relever sa position exacte est accepté', releve.statut === 200, `statut ${releve.statut}`);

const apresReleve = await bdd.collection('users').findOne({ pseudo: `geocv${S}` });
ok('**la provenance repasse à « navigateur »**',
  apresReleve?.localisationSource === 'navigateur', String(apresReleve?.localisationSource));

const carteRouverte = await appel('/geo/carte-visible', {
  methode: 'PATCH', token: tokenCoachVille, corps: { carteVisible: true },
});
ok('**et la carte publique s’ouvre alors** — le refus n’était pas définitif',
  carteRouverte.statut === 200, `statut ${carteRouverte.statut}`);

/* ------------------------------ Fin ------------------------------ */

const supprimes = await purger();
await clientMongo.close();

console.log('\n============ GÉOCODAGE DES ÉVÉNEMENTS — CORRECTIF 9.8 ============');
const echecs = afficher();
console.log(`\n  (${supprimes} compte(s) de test supprimés, événements compris)`);
process.exit(echecs > 0 ? 1 : 0);
