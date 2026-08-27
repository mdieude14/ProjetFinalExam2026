/**
 * ===========================================================================
 *  PERFORMANCE — CÔTÉ API
 * ===========================================================================
 *
 *   npm run test:perf
 *
 * Prérequis : l'API (port 5000) doit tourner et MongoDB être joignable.
 *
 * CE QUE CETTE SUITE MESURE, ET CE QU'ELLE NE MESURE PAS.
 *
 * Elle ne cherche pas à établir la capacité du serveur : sur une machine de
 * développement, avec une base de quelques centaines de documents, un chiffre
 * de « requêtes par seconde » ne dirait rien de la production.
 *
 * Elle cherche les défauts de performance qui sont des défauts de CONCEPTION,
 * et qui, eux, se voient dès le premier document :
 *
 *   1. UNE REQUÊTE QUI BALAIE LA COLLECTION au lieu d'utiliser un index. Elle
 *      répond en 3 ms sur cent documents et en 3 secondes sur cent mille. Le
 *      plan d'exécution le dit ; le chronomètre, non.
 *
 *   2. LE PROBLÈME N+1 : un écran qui fait une requête par élément affiché.
 *      Invisible sur une liste de trois, mortel sur une liste de cinquante.
 *      On le détecte en comparant le temps d'une liste courte à celui d'une
 *      liste longue — s'il croît proportionnellement, la requête par élément
 *      est là.
 *
 *   3. UNE RÉPONSE ANORMALEMENT LENTE sur un chemin critique, comparée à un
 *      budget explicite. Le budget est large à dessein : il doit attraper une
 *      régression d'un ordre de grandeur, pas les variations de la machine.
 *
 * Les comptes créés ici sont supprimés à la fin — et au démarrage.
 * ===========================================================================
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const API = 'http://localhost:5000/api';
const DOM = '@perftest.local';
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
    json: (() => { try { return JSON.parse(texte); } catch { return null; } })(),
  };
}

/**
 * Chronomètre un appel répété, et rend la médiane et le 95e centile.
 *
 * LA MÉDIANE PLUTÔT QUE LA MOYENNE : une seule mesure aberrante — un ramasse-
 * miettes, une écriture disque — décale la moyenne et fait échouer une suite
 * sur un incident sans rapport. La médiane l'ignore.
 *
 * LE 95e CENTILE EST LÀ POUR L'AUTRE MOITIÉ DE L'HISTOIRE : une médiane
 * excellente peut cacher une requête sur vingt qui prend une seconde, et
 * c'est celle-là que l'utilisateur remarque.
 *
 * ON ÉCARTE LES PREMIÈRES MESURES (rodage) : le premier appel paie la
 * compilation du plan de requête, l'ouverture de la connexion et le
 * remplissage des caches. Le compter reviendrait à mesurer le démarrage.
 */
async function chronometrer(faire, { repetitions = 20, rodage = 3 } = {}) {
  for (let i = 0; i < rodage; i++) await faire();

  const durees = [];
  for (let i = 0; i < repetitions; i++) {
    const debut = performance.now();
    await faire();
    durees.push(performance.now() - debut);
  }

  durees.sort((a, b) => a - b);

  return {
    mediane: Math.round(durees[Math.floor(durees.length / 2)]),
    p95: Math.round(durees[Math.floor(durees.length * 0.95)] ?? durees.at(-1)),
    min: Math.round(durees[0]),
    max: Math.round(durees.at(-1)),
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

async function inscrire(prefixe, prenom) {
  const pseudo = `${prefixe}${S}`;
  const r = await appel('/auth/register', {
    methode: 'POST',
    corps: {
      type: 'utilisateur', nom: 'Perf', prenom, pseudo,
      email: `${pseudo}${DOM}`, password: MDP, ville: 'Lyon',
    },
  });
  if (r.statut !== 201) throw new Error(`création de ${pseudo} : ${r.statut} ${r.json?.message}`);
  return { token: r.json.accessToken, id: r.json.utilisateur._id, pseudo };
}

/* ------------------------- Accès direct à la base ------------------------ */

const requireLocal = createRequire(import.meta.url);
const { MongoClient } = requireLocal('mongodb');

const uriMongo = readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .find((ligne) => ligne.startsWith('MONGO_URI='))
  .slice('MONGO_URI='.length)
  .trim()
  .replace(/^["']|["']$/g, '');

const clientMongo = new MongoClient(uriMongo, { serverSelectionTimeoutMS: 8000 });
await clientMongo.connect();
const bdd = clientMongo.db();

const motifTest = /@perftest[.]local$/;

async function purger() {
  const comptes = await bdd.collection('users')
    .find({ email: motifTest }, { projection: { _id: 1 } })
    .toArray();
  const ids = comptes.map((u) => u._id);
  if (ids.length === 0) return 0;

  await bdd.collection('notifications').deleteMany({
    $or: [{ destinataire: { $in: ids } }, { emetteur: { $in: ids } }],
  });
  await bdd.collection('comments').deleteMany({ auteur: { $in: ids } });
  await bdd.collection('posts').deleteMany({ auteur: { $in: ids } });
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
 *  LES INDEX SONT-ILS RÉELLEMENT UTILISÉS ?
 * ================================================================== */

section('Plans d’exécution — la vérification qui ne ment pas');

/**
 * Résume le plan retenu par MongoDB pour une requête.
 *
 * C'EST LA SEULE MESURE QUI RESTE VRAIE À GRANDE ÉCHELLE. Un chronomètre sur
 * une base de développement ne distingue pas un index d'un balayage : les
 * deux répondent en quelques millisecondes sur trois cents documents. Le plan
 * d'exécution, lui, dit lequel des deux se produira sur trois cent mille.
 */
async function planDe(collection, filtre, options = {}) {
  const explication = await bdd
    .collection(collection)
    .find(filtre, options)
    .explain('queryPlanner');

  const etapes = [];
  let etape = explication.queryPlanner.winningPlan;
  while (etape) {
    etapes.push(etape.stage + (etape.indexName ? ` (${etape.indexName})` : ''));
    etape = etape.inputStage || etape.inputStages?.[0];
  }

  return { chaine: etapes.join(' ← '), balayage: etapes.some((e) => e.startsWith('COLLSCAN')) };
}

const planAutocompletion = await planDe('users', {
  isActive: true,
  termesRecherche: /^mar/,
});
ok('**autocomplétion : index parcouru, pas la collection**',
  !planAutocompletion.balayage, planAutocompletion.chaine);

const planNotifications = await planDe(
  'notifications',
  { destinataire: { $exists: true }, lu: false },
  { sort: { createdAt: -1 } }
);
ok('notifications non lues : index utilisé',
  !planNotifications.balayage, planNotifications.chaine);

const planFil = await planDe('posts', { auteur: { $exists: true } }, { sort: { createdAt: -1 } });
ok('publications d’un auteur : index utilisé', !planFil.balayage, planFil.chaine);

const planEvenements = await planDe(
  'sportevents',
  { dateFin: { $gte: new Date() } },
  { sort: { dateDebut: 1 } }
);
ok('événements à venir : index utilisé', !planEvenements.balayage, planEvenements.chaine);

const planConversations = await planDe('conversations', { participants: { $exists: true } });
ok('conversations d’un participant : index utilisé',
  !planConversations.balayage, planConversations.chaine);

/* ================================================================== *
 *  LATENCE DES CHEMINS CRITIQUES
 * ================================================================== */

section('Latence des chemins critiques');

const alice = await inscrire('perfalice', 'Alice');
const bob = await inscrire('perfbob', 'Bob');

/*
 * BUDGETS LARGES, ET C'EST DÉLIBÉRÉ.
 *
 * Ils ne décrivent pas une cible de performance : ils attrapent une
 * régression d'un ORDRE DE GRANDEUR. Un budget serré sur une machine de
 * développement ferait échouer la suite au premier antivirus qui s'active,
 * et l'on finirait par l'ignorer — ce qui est pire que pas de budget du tout.
 */
const BUDGETS = { rapide: 250, moyen: 600, lourd: 1200 };

const sante = await chronometrer(() => appel('/health'));
ok(`santé sous ${BUDGETS.rapide} ms`, sante.mediane < BUDGETS.rapide,
  `médiane ${sante.mediane} ms · p95 ${sante.p95} ms`);

const suggestions = await chronometrer(() => appel('/search/suggestions?q=per'));
ok(`**autocomplétion sous ${BUDGETS.rapide} ms** (frappée à chaque mot saisi)`,
  suggestions.mediane < BUDGETS.rapide,
  `médiane ${suggestions.mediane} ms · p95 ${suggestions.p95} ms`);

const fil = await chronometrer(() => appel('/posts/feed', { token: alice.token }));
ok(`fil d’actualité sous ${BUDGETS.moyen} ms`, fil.mediane < BUDGETS.moyen,
  `médiane ${fil.mediane} ms · p95 ${fil.p95} ms`);

const conversations = await chronometrer(() =>
  appel('/messages/conversations', { token: alice.token })
);
ok(`liste des conversations sous ${BUDGETS.moyen} ms`,
  conversations.mediane < BUDGETS.moyen,
  `médiane ${conversations.mediane} ms · p95 ${conversations.p95} ms`);

const compteurs = await chronometrer(() => appel('/notifications/non-lues', { token: alice.token }));
ok(`**compteur de notifications sous ${BUDGETS.rapide} ms** (appelé à chaque navigation)`,
  compteurs.mediane < BUDGETS.rapide,
  `médiane ${compteurs.mediane} ms · p95 ${compteurs.p95} ms`);

const evenements = await chronometrer(() => appel('/events'));
ok(`liste des événements sous ${BUDGETS.moyen} ms`, evenements.mediane < BUDGETS.moyen,
  `médiane ${evenements.mediane} ms · p95 ${evenements.p95} ms`);

const rechercheGlobale = await chronometrer(
  () => appel('/search?q=perf', { token: alice.token }),
  { repetitions: 12 }
);
ok(`**recherche globale sous ${BUDGETS.lourd} ms** (trois familles en parallèle)`,
  rechercheGlobale.mediane < BUDGETS.lourd,
  `médiane ${rechercheGlobale.mediane} ms · p95 ${rechercheGlobale.p95} ms`);

/* ================================================================== *
 *  LE PROBLÈME N+1
 * ================================================================== */

section('Recherche du problème N+1');

/*
 * ON COMPARE UNE LISTE COURTE À UNE LISTE LONGUE.
 *
 * Si le temps de réponse croît PROPORTIONNELLEMENT au nombre d'éléments,
 * c'est qu'une requête part par élément — le défaut N+1. Une liste servie par
 * une seule requête, elle, coûte à peu près la même chose pour trois ou pour
 * trente : la différence tient à la sérialisation, pas aux allers-retours.
 *
 * Le seuil est fixé à 4× pour dix fois plus d'éléments : au-delà, la
 * croissance n'est plus explicable par la seule taille de la réponse.
 */

for (let i = 0; i < 12; i++) {
  await appel('/posts', {
    methode: 'POST', token: bob.token,
    form: formMedia({ titre: `Publication ${i}`, description: 'Mesure de charge' }),
  });
}

await appel(`/follows/${bob.id}`, { methode: 'POST', token: alice.token });

const filCourt = await chronometrer(
  () => appel('/posts/feed?limite=2', { token: alice.token }),
  { repetitions: 10 }
);
const filLong = await chronometrer(
  () => appel('/posts/feed?limite=12', { token: alice.token }),
  { repetitions: 10 }
);

const facteur = filCourt.mediane > 0 ? filLong.mediane / filCourt.mediane : 1;

ok('**le fil ne fait pas une requête par publication**',
  facteur < 4,
  `2 posts : ${filCourt.mediane} ms · 12 posts : ${filLong.mediane} ms ` +
    `(×${facteur.toFixed(1)} pour 6× plus d’éléments)`);

/*
 * MÊME MESURE SUR LES NOTIFICATIONS, dont chaque ligne peuple un émetteur.
 * C'est le cas le plus exposé au N+1 : un `populate` mal fait produit une
 * requête par notification.
 */
for (let i = 0; i < 12; i++) {
  const post = await appel('/posts', {
    methode: 'POST', token: alice.token,
    form: formMedia({ titre: `Cible ${i}`, description: 'Mesure' }),
  });
  await appel(`/posts/${post.json.post._id}/like`, { methode: 'POST', token: bob.token });
}

const notifsCourt = await chronometrer(
  () => appel('/notifications?limite=2', { token: alice.token }),
  { repetitions: 10 }
);
const notifsLong = await chronometrer(
  () => appel('/notifications?limite=12', { token: alice.token }),
  { repetitions: 10 }
);

const facteurNotifs = notifsCourt.mediane > 0 ? notifsLong.mediane / notifsCourt.mediane : 1;

ok('**les notifications ne font pas une requête par émetteur**',
  facteurNotifs < 4,
  `2 : ${notifsCourt.mediane} ms · 12 : ${notifsLong.mediane} ms ` +
    `(×${facteurNotifs.toFixed(1)})`);

/* ================================================================== *
 *  TENUE SOUS REQUÊTES SIMULTANÉES
 * ================================================================== */

section('Requêtes simultanées');

/*
 * TRENTE APPELS EN PARALLÈLE sur le chemin le plus sollicité.
 *
 * On ne cherche pas un débit : on vérifie qu'aucune requête n'est PERDUE ni
 * anormalement retardée quand elles arrivent ensemble. Un serveur qui
 * sérialise tout répondrait juste, mais la dernière attendrait trente fois
 * la première.
 */
const debut = performance.now();
const rafale = await Promise.all(
  Array.from({ length: 30 }, () => appel('/search/suggestions?q=per'))
);
const duree = Math.round(performance.now() - debut);

ok('**30 requêtes simultanées, toutes servies**',
  rafale.every((r) => r.statut === 200),
  `${rafale.filter((r) => r.statut === 200).length}/30 en ${duree} ms`);

ok('la rafale entière tient sous 3 s', duree < 3000, `${duree} ms`);

/* ================================================================== *
 *  TAILLE DES RÉPONSES
 * ================================================================== */

section('Taille des réponses');

/*
 * UNE RÉPONSE TROP GROSSE EST UN DÉFAUT DE CONCEPTION, pas de performance :
 * elle signale qu'on envoie des champs dont le client n'a que faire. Le coût
 * se paie en bande passante chez l'utilisateur, pas sur le serveur — donc
 * nulle part dans un chronomètre.
 */
const reponseFil = await fetch(`${API}/posts/feed?limite=12`, {
  headers: { Authorization: `Bearer ${alice.token}` },
});
const tailleFil = (await reponseFil.text()).length;

ok('un fil de 12 publications tient sous 100 ko',
  tailleFil < 100_000, `${Math.round(tailleFil / 1024)} ko`);

const reponseSuggestions = await fetch(`${API}/search/suggestions?q=per`);
const tailleSuggestions = (await reponseSuggestions.text()).length;

ok('**les suggestions restent minuscules** (envoyées à chaque mot saisi)',
  tailleSuggestions < 8_000, `${Math.round(tailleSuggestions / 1024)} ko`);

/* ================================================================== *
 *  NETTOYAGE
 * ================================================================== */

const supprimes = await purger();
await clientMongo.close();

console.log('\n============= PERFORMANCE — API =============');
const echecs = afficher();
console.log(`\n  (${supprimes} compte(s) de test supprimés)`);
process.exit(echecs > 0 ? 1 : 0);
