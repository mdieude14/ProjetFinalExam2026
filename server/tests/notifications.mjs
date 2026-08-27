/**
 * ===========================================================================
 *  NOTIFICATIONS — MODULE 12
 * ===========================================================================
 *
 *   npm run test:notifications
 *
 * Prérequis : l'API (port 5000) doit tourner et MongoDB être joignable.
 *
 * CE QUE CETTE SUITE VÉRIFIE AVANT TOUT.
 *
 * Le module 12 ne crée rien de neuf : il branche huit actions existantes sur
 * un point de génération unique. Son risque n'est donc pas dans un algorithme
 * mais dans la RÉPÉTITION — huit appelants, huit occasions d'oublier une
 * règle. Deux d'entre elles sont vérifiées sur chaque type :
 *
 *   1. ON NE SE NOTIFIE JAMAIS SOI-MÊME. Aimer sa propre publication,
 *      commenter son propre événement : gestes courants, et qui ne doivent
 *      rien produire.
 *
 *   2. LES ACTIONS RÉVERSIBLES NE S'EMPILENT PAS. Liker, dé-liker, re-liker
 *      est une hésitation, pas trois événements.
 *
 * Les comptes créés ici sont supprimés à la fin — et au démarrage.
 * ===========================================================================
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const API = 'http://localhost:5000/api';
const DOM = '@notiftest.local';
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

async function inscrire(prefixe, prenom, extra = {}) {
  const pseudo = `${prefixe}${S}`;
  const r = await appel('/auth/register', {
    methode: 'POST',
    corps: {
      type: 'utilisateur', nom: 'Notif', prenom, pseudo,
      email: `${pseudo}${DOM}`, password: MDP, ville: 'Lyon', ...extra,
    },
  });
  if (r.statut !== 201) throw new Error(`création de ${pseudo} : ${r.statut} ${r.json?.message}`);
  return { token: r.json.accessToken, id: r.json.utilisateur._id, pseudo };
}

/** Notifications d'un utilisateur, du plus récent au plus ancien. */
async function notifsDe(token, options = '') {
  const r = await appel(`/notifications${options}`, { token });
  return r.json?.elements || [];
}

const compter = (liste, type) => liste.filter((n) => n.type === type).length;

/* ------------------------- Accès direct à la base ------------------------ */

const requireLocal = createRequire(import.meta.url);
const { MongoClient, ObjectId } = requireLocal('mongodb');

const uriMongo = readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .find((ligne) => ligne.startsWith('MONGO_URI='))
  .slice('MONGO_URI='.length)
  .trim()
  .replace(/^["']|["']$/g, '');

const clientMongo = new MongoClient(uriMongo, { serverSelectionTimeoutMS: 8000 });
await clientMongo.connect();
const bdd = clientMongo.db();

const motifTest = /@notiftest[.]local$/;

async function purger() {
  const comptes = await bdd.collection('users')
    .find({ email: motifTest }, { projection: { _id: 1 } })
    .toArray();
  const ids = comptes.map((u) => u._id);
  if (ids.length === 0) return 0;

  const convs = await bdd.collection('conversations')
    .find({ participants: { $in: ids } }, { projection: { _id: 1 } })
    .toArray();
  const evts = await bdd.collection('sportevents')
    .find({ organisateur: { $in: ids } }, { projection: { _id: 1 } })
    .toArray();

  await bdd.collection('notifications').deleteMany({
    $or: [{ destinataire: { $in: ids } }, { emetteur: { $in: ids } }],
  });
  await bdd.collection('messages').deleteMany({ conversation: { $in: convs.map((c) => c._id) } });
  await bdd.collection('conversations').deleteMany({ participants: { $in: ids } });
  await bdd.collection('eventregistrations').deleteMany({
    $or: [{ event: { $in: evts.map((e) => e._id) } }, { utilisateur: { $in: ids } }],
  });
  await bdd.collection('sportevents').deleteMany({ organisateur: { $in: ids } });
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
 *  MISE EN PLACE
 * ================================================================== */

section('Mise en place');

const auteur = await inscrire('ntauteur', 'Alice');
const acteur = await inscrire('ntacteur', 'Bob');
const tiers = await inscrire('nttiers', 'Carol');
const prive = await inscrire('ntprive', 'Dave');

ok('quatre comptes inscrits',
  Boolean(auteur.token && acteur.token && tiers.token && prive.token));

await appel('/users/me/visibilite', {
  methode: 'PATCH', token: prive.token, corps: { visibilite: 'prive' },
});

const post = await appel('/posts', {
  methode: 'POST', token: auteur.token,
  form: formMedia({ titre: 'Seance du jour', description: 'Entrainement complet' }),
});
ok('publication créée', post.statut === 201, post.json?.message);
const idPost = post.json?.post?._id;

const vide = await appel('/notifications', { token: auteur.token });
ok('aucune notification au départ', (vide.json?.elements || []).length === 0);

/* ================================================================== *
 *  ON NE SE NOTIFIE JAMAIS SOI-MÊME
 * ================================================================== */

section('Auto-notification');

await appel(`/posts/${idPost}/like`, { methode: 'POST', token: auteur.token });
await appel(`/posts/${idPost}/comments`, {
  methode: 'POST', token: auteur.token, corps: { texte: 'Mon propre commentaire' },
});

const apresSoi = await notifsDe(auteur.token);
ok('**aimer sa propre publication ne notifie personne**',
  compter(apresSoi, 'like') === 0, `${compter(apresSoi, 'like')} notification(s)`);
ok('**commenter sa propre publication non plus**',
  compter(apresSoi, 'commentaire') === 0);
ok('la liste reste vide', apresSoi.length === 0, `${apresSoi.length}`);

// On retire le like pour ne pas fausser les comptes suivants.
await appel(`/posts/${idPost}/like`, { methode: 'POST', token: auteur.token });

/* ================================================================== *
 *  LIKE — ET LE REGROUPEMENT
 * ================================================================== */

section('Like et regroupement');

await appel(`/posts/${idPost}/like`, { methode: 'POST', token: acteur.token });

const apresLike = await notifsDe(auteur.token);
ok('**un like notifie l’auteur**', compter(apresLike, 'like') === 1);

const notifLike = apresLike.find((n) => n.type === 'like');
ok('l’émetteur est identifié', notifLike?.emetteur?.pseudo === acteur.pseudo);
ok('la cible pointe sur la publication',
  notifLike?.cibleType === 'Post' && String(notifLike?.cible) === String(idPost));
ok('elle est non lue', notifLike?.lu === false);

/*
 * L'HÉSITATION NE DOIT PAS S'EMPILER.
 * Dé-liker puis re-liker deux fois : sans regroupement, l'auteur recevrait
 * trois « Bob a aimé votre publication » pour un seul intérêt réel.
 */
await appel(`/posts/${idPost}/like`, { methode: 'POST', token: acteur.token }); // retrait
await appel(`/posts/${idPost}/like`, { methode: 'POST', token: acteur.token }); // repose
await appel(`/posts/${idPost}/like`, { methode: 'POST', token: acteur.token }); // retrait
await appel(`/posts/${idPost}/like`, { methode: 'POST', token: acteur.token }); // repose

const apresHesitation = await notifsDe(auteur.token);
ok('**liker, dé-liker, re-liker ne produit QU’UNE notification**',
  compter(apresHesitation, 'like') === 1,
  `${compter(apresHesitation, 'like')} notification(s)`);

const enBase = await bdd.collection('notifications').countDocuments({
  destinataire: new ObjectId(auteur.id),
  type: 'like',
});
ok('un seul document en base', enBase === 1, `${enBase}`);

ok('**retirer un like ne notifie rien** (« X n’aime plus » n’a aucun usage)',
  compter(apresHesitation, 'like') === 1);

/* ================================================================== *
 *  COMMENTAIRE
 * ================================================================== */

section('Commentaire');

await appel(`/posts/${idPost}/comments`, {
  methode: 'POST', token: acteur.token, corps: { texte: 'Bravo pour cette seance' },
});
await appel(`/posts/${idPost}/comments`, {
  methode: 'POST', token: acteur.token, corps: { texte: 'Une question en plus' },
});

const apresCommentaires = await notifsDe(auteur.token);
ok('**deux commentaires font deux notifications** — ce sont deux contributions',
  compter(apresCommentaires, 'commentaire') === 2,
  `${compter(apresCommentaires, 'commentaire')}`);

/* ================================================================== *
 *  SUIVI
 * ================================================================== */

section('Suivi');

await appel(`/follows/${auteur.id}`, { methode: 'POST', token: acteur.token });

const apresSuivi = await notifsDe(auteur.token);
ok('**un nouvel abonné notifie**', compter(apresSuivi, 'follow') === 1);

/*
 * PROFIL PRIVÉ : ce n'est pas un abonné, c'est une DEMANDE.
 * Les confondre laisserait des demandes en attente indéfiniment, faute
 * d'avoir compris qu'il fallait répondre.
 */
await appel(`/follows/${prive.id}`, { methode: 'POST', token: acteur.token });

const chezPrive = await notifsDe(prive.token);
ok('**un compte privé reçoit une DEMANDE, pas un abonné**',
  compter(chezPrive, 'demande_follow') === 1 && compter(chezPrive, 'follow') === 0,
  `demande_follow: ${compter(chezPrive, 'demande_follow')}`);

const demandes = await appel('/follows/demandes', { token: prive.token });
const idDemande = demandes.json?.elements?.[0]?._id || demandes.json?.demandes?.[0]?._id;

if (idDemande) {
  await appel(`/follows/demandes/${idDemande}/accepter`, {
    methode: 'POST', token: prive.token,
  });

  const chezActeur = await notifsDe(acteur.token);
  ok('**accepter une demande prévient le demandeur**',
    compter(chezActeur, 'follow') === 1, `${compter(chezActeur, 'follow')}`);
} else {
  ok('**accepter une demande prévient le demandeur**', false, 'demande introuvable');
}

/* ================================================================== *
 *  MESSAGERIE
 * ================================================================== */

section('Messagerie');

const conv = await appel('/messages/conversations', {
  methode: 'POST', token: tiers.token, corps: { destinataire: auteur.id },
});
const idConv = conv.json?.conversation?._id;

await appel(`/messages/conversations/${idConv}/messages`, {
  methode: 'POST', token: tiers.token, corps: { contenu: 'Bonjour, je me presente' },
});

const apresDemandeChat = await notifsDe(auteur.token);
ok('**un premier message dans un fil en attente est une DEMANDE de chat**',
  compter(apresDemandeChat, 'demande_chat') === 1,
  `${compter(apresDemandeChat, 'demande_chat')}`);
ok('et non un message ordinaire', compter(apresDemandeChat, 'message') === 0);

// L'auteur accepte, puis répond : le fil devient ordinaire.
await appel(`/messages/conversations/${idConv}`, {
  methode: 'PATCH', token: auteur.token, corps: { action: 'accepter' },
});
await appel(`/messages/conversations/${idConv}/messages`, {
  methode: 'POST', token: tiers.token, corps: { contenu: 'Merci de votre reponse' },
});

const apresMessage = await notifsDe(auteur.token);
ok('**une fois le fil ouvert, c’est un message ordinaire**',
  compter(apresMessage, 'message') === 1, `${compter(apresMessage, 'message')}`);

/* ================================================================== *
 *  ÉVÉNEMENT
 * ================================================================== */

section('Événement');

const coach = await inscrire('ntcoach', 'Emma', {
  type: 'coach', diplome: { intitule: 'BPJEPS', organisme: 'DRJSCS' },
});

await bdd.collection('users').updateOne(
  { pseudo: `ntcoach${S}` },
  { $set: { 'diplome.statut': 'verifie' } }
);

const demain = new Date();
demain.setDate(demain.getDate() + 5);
demain.setHours(10, 0, 0, 0);
const fin = new Date(demain);
fin.setHours(18, 0, 0, 0);

const evenement = await appel('/events', {
  methode: 'POST', token: coach.token,
  corps: {
    titre: 'Sortie course', sport: 'Course',
    dateDebut: demain.toISOString(), dateFin: fin.toISOString(),
    lieu: { ville: 'Lyon' },
  },
});
const idEvenement = evenement.json?.evenement?._id;
ok('événement créé', evenement.statut === 201, evenement.json?.message);

await appel(`/events/${idEvenement}/inscription`, { methode: 'POST', token: acteur.token });

const chezCoach = await notifsDe(coach.token);
ok('**une inscription notifie l’organisateur**',
  compter(chezCoach, 'inscription_event') === 1,
  `${compter(chezCoach, 'inscription_event')}`);

const notifEvt = chezCoach.find((n) => n.type === 'inscription_event');
ok('la cible pointe sur l’événement',
  notifEvt?.cibleType === 'SportEvent' && String(notifEvt?.cible) === String(idEvenement));

/* ================================================================== *
 *  DIPLÔME — LA NOTIFICATION SANS ÉMETTEUR
 * ================================================================== */

section('Diplôme vérifié');

/*
 * SEUL TYPE SANS ÉMETTEUR : la décision vient de l'administration, pas d'une
 * personne dont on afficherait l'avatar. C'est la raison pour laquelle le
 * champ `emetteur` est facultatif dans le schéma.
 */
const candidat = await inscrire('ntcandidat', 'Farid', {
  type: 'coach', diplome: { intitule: 'BPJEPS', organisme: 'DRJSCS' },
});

await bdd.collection('users').updateOne(
  { pseudo: `ntcandidat${S}` },
  { $set: { 'diplome.statut': 'en_attente', 'diplome.dateSoumission': new Date() } }
);

const admin = await bdd.collection('users').findOne({ type: 'admin' });

if (admin) {
  await bdd.collection('notifications').deleteMany({
    destinataire: new ObjectId(candidat.id),
  });

  const jwt = requireLocal('jsonwebtoken');
  const secret = readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('JWT_ACCESS_SECRET='))
    .slice('JWT_ACCESS_SECRET='.length)
    .trim()
    .replace(/^["']|["']$/g, '');

  const jetonAdmin = jwt.sign({ sub: String(admin._id), type: 'admin' }, secret, {
    expiresIn: '15m',
  });

  const decision = await appel(`/admin/diplomes/${candidat.id}`, {
    methode: 'PATCH', token: jetonAdmin, corps: { decision: 'verifie' },
  });

  const chezCandidat = await notifsDe(candidat.token);
  const notifDiplome = chezCandidat.find((n) => n.type === 'diplome_verifie');

  ok('**la décision sur un diplôme notifie le coach**',
    Boolean(notifDiplome), `décision ${decision.statut}`);
  ok('**et cette notification n’a pas d’émetteur** (elle vient de l’administration)',
    notifDiplome ? !notifDiplome.emetteur : false);
} else {
  ok('**la décision sur un diplôme notifie le coach**', false,
    'aucun compte admin en base — lancer npm run creer-admin');
  ok('**et cette notification n’a pas d’émetteur**', false, 'non testable');
}

/* ================================================================== *
 *  LECTURE ET COMPTEURS
 * ================================================================== */

section('Compteurs et lecture');

const compteur = await appel('/notifications/non-lues', { token: auteur.token });
const toutes = await notifsDe(auteur.token);

ok('le compteur correspond au nombre de non lues',
  compteur.json?.nombre === toutes.filter((n) => !n.lu).length,
  `${compteur.json?.nombre} / ${toutes.length}`);

ok('les notifications sortent de la plus récente à la plus ancienne',
  toutes.length < 2 ||
    new Date(toutes[0].createdAt) >= new Date(toutes[1].createdAt));

const filtreNonLues = await appel('/notifications?nonLues=true', { token: auteur.token });
ok('le filtre « non lues » fonctionne',
  (filtreNonLues.json?.elements || []).every((n) => !n.lu));

/* -------------------- Marquer une notification lue -------------------- */

const premiere = toutes[0];
const marquage = await appel(`/notifications/${premiere._id}/lu`, {
  methode: 'PATCH', token: auteur.token,
});
ok('marquer une notification comme lue', marquage.statut === 200);
ok('elle est bien lue', marquage.json?.notification?.lu === true);

const apresUneLecture = await appel('/notifications/non-lues', { token: auteur.token });
ok('le compteur a baissé de un',
  apresUneLecture.json?.nombre === compteur.json?.nombre - 1,
  `${apresUneLecture.json?.nombre}`);

const dateLecture = await bdd.collection('notifications').findOne({
  _id: new ObjectId(premiere._id),
});
ok('**`luLe` est renseigné** — c’est lui qui déclenche la purge automatique',
  Boolean(dateLecture?.luLe));

/* ------------------------ Tout marquer comme lu ------------------------ */

const tout = await appel('/notifications/tout-lu', { methode: 'POST', token: auteur.token });
ok('« tout marquer comme lu » accepté', tout.statut === 200);

const apresTout = await appel('/notifications/non-lues', { token: auteur.token });
ok('**le compteur retombe à zéro**', apresTout.json?.nombre === 0,
  `${apresTout.json?.nombre}`);

const relance = await appel('/notifications/tout-lu', { methode: 'POST', token: auteur.token });
ok('relancer ne casse rien et annonce zéro', relance.json?.marquees === 0);

/* ================================================================== *
 *  CLOISONNEMENT
 * ================================================================== */

section('Cloisonnement');

const chezTiers = await notifsDe(tiers.token);
ok('**un tiers ne voit pas les notifications d’autrui**',
  !chezTiers.some((n) => n._id === premiere._id));

const marquageIntrus = await appel(`/notifications/${premiere._id}/lu`, {
  methode: 'PATCH', token: tiers.token,
});
ok('**et ne peut pas les marquer lues** — 404, jamais 403',
  marquageIntrus.statut === 404, `statut ${marquageIntrus.statut}`);

const suppressionIntrus = await appel(`/notifications/${premiere._id}`, {
  methode: 'DELETE', token: tiers.token,
});
ok('ni les supprimer', suppressionIntrus.statut === 404);

const suppression = await appel(`/notifications/${premiere._id}`, {
  methode: 'DELETE', token: auteur.token,
});
ok('le destinataire, lui, peut supprimer', suppression.statut === 200);

ok('aucune adresse email dans les notifications', !JSON.stringify(toutes).includes(DOM));

const sansSession = await appel('/notifications');
ok('liste refusée sans session', sansSession.statut === 401);

/* ================================================================== *
 *  CIBLE DISPARUE
 * ================================================================== */

section('Cible supprimée');

/*
 * UNE NOTIFICATION SURVIT À SA CIBLE, et l'écran doit le supporter.
 * « X a commenté votre publication » reste une information juste même si la
 * publication a été supprimée depuis. Ce qui ne doit pas arriver, c'est que
 * la liste entière échoue à s'afficher pour cette seule raison.
 */
await appel(`/posts/${idPost}`, { methode: 'DELETE', token: auteur.token });

const apresSuppression = await appel('/notifications', { token: auteur.token });
ok('**la liste s’affiche encore quand la cible a disparu**',
  apresSuppression.statut === 200, `statut ${apresSuppression.statut}`);
ok('les notifications orphelines sont conservées',
  (apresSuppression.json?.elements || []).some((n) => n.cibleType === 'Post'));

/* ================================================================== *
 *  ORDRE DES ROUTES
 * ================================================================== */

section('Ordre des routes');

const routeNonLues = await appel('/notifications/non-lues', { token: auteur.token });
ok('**/notifications/non-lues n’est pas lu comme un identifiant**',
  routeNonLues.statut === 200 && typeof routeNonLues.json?.nombre === 'number');

const routeToutLu = await appel('/notifications/tout-lu', {
  methode: 'POST', token: auteur.token,
});
ok('/notifications/tout-lu non plus', routeToutLu.statut === 200);

const idInvalide = await appel('/notifications/pasunid/lu', {
  methode: 'PATCH', token: auteur.token,
});
ok('identifiant invalide rejeté en 400', idInvalide.statut === 400);

const inexistante = await appel('/notifications/507f1f77bcf86cd799439011/lu', {
  methode: 'PATCH', token: auteur.token,
});
ok('notification inexistante en 404', inexistante.statut === 404);

/* ================================================================== *
 *  NETTOYAGE
 * ================================================================== */

const supprimes = await purger();
await clientMongo.close();

console.log('\n============= NOTIFICATIONS — MODULE 12 =============');
const echecs = afficher();
console.log(`\n  (${supprimes} compte(s) de test supprimés, notifications comprises)`);
process.exit(echecs > 0 ? 1 : 0);
