/**
 * ===========================================================================
 *  MESSAGERIE — MODULE 11
 * ===========================================================================
 *
 *   npm run test:messagerie
 *
 * Prérequis : l'API (port 5000) doit tourner et MongoDB être joignable.
 *
 * LES DEUX VÉRIFICATIONS QUI JUSTIFIENT L'ARCHITECTURE DU MODULE :
 *
 *   1. LE SOCKET N'EST PAS UNE AUTORITÉ. Un jeton falsifié n'obtient pas
 *      l'identité qu'il revendique ; un client ne peut pas s'inviter dans une
 *      conversation dont il n'est pas membre, ni recevoir ce qui ne lui est
 *      pas destiné. Ces points ne se lisent pas dans le code : il faut ouvrir
 *      de vraies connexions et essayer.
 *
 *   2. LE SAS D'ENTRÉE TIENT. Un message passe pour se présenter, les
 *      suivants attendent un accord, et un refus ferme définitivement. Sans
 *      cela, la messagerie est un outil de harcèlement.
 *
 * Les comptes créés ici sont supprimés à la fin — et au démarrage, pour que
 * la suite ne dépende pas de la façon dont la précédente s'est terminée.
 * ===========================================================================
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const API = 'http://localhost:5000/api';
const ORIGINE = 'http://localhost:5000';
const DOM = '@msgtest.local';
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

async function inscrire(prefixe, prenom) {
  const pseudo = `${prefixe}${S}`;
  const r = await appel('/auth/register', {
    methode: 'POST',
    corps: {
      type: 'utilisateur', nom: 'Msg', prenom, pseudo,
      email: `${pseudo}${DOM}`, password: MDP, ville: 'Lyon',
    },
  });
  if (r.statut !== 201) throw new Error(`création de ${pseudo} : ${r.statut} ${r.json?.message}`);
  return { token: r.json.accessToken, id: r.json.utilisateur._id, pseudo };
}

/* ------------------------- Accès direct à la base ------------------------ */

const requireLocal = createRequire(import.meta.url);
const { MongoClient, ObjectId } = requireLocal('mongodb');
const { io: connecterSocket } = requireLocal('socket.io-client');

const uriMongo = readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .find((ligne) => ligne.startsWith('MONGO_URI='))
  .slice('MONGO_URI='.length)
  .trim()
  .replace(/^["']|["']$/g, '');

const clientMongo = new MongoClient(uriMongo, { serverSelectionTimeoutMS: 8000 });
await clientMongo.connect();
const bdd = clientMongo.db();

const motifTest = /@msgtest[.]local$/;

async function purger() {
  const comptes = await bdd.collection('users')
    .find({ email: motifTest }, { projection: { _id: 1 } })
    .toArray();
  const ids = comptes.map((u) => u._id);
  if (ids.length === 0) return 0;

  const convs = await bdd.collection('conversations')
    .find({ participants: { $in: ids } }, { projection: { _id: 1 } })
    .toArray();

  await bdd.collection('messages').deleteMany({ conversation: { $in: convs.map((c) => c._id) } });
  await bdd.collection('conversations').deleteMany({ participants: { $in: ids } });
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

/* ------------------------------ Sockets ------------------------------ */

const socketsOuverts = [];

/**
 * Ouvre un socket et attend son verdict.
 *
 * RÉSOUT DANS LES DEUX CAS — connexion établie OU refusée. Une promesse qui
 * ne se résout que sur succès transformerait chaque test de refus en
 * expiration de délai : l'échec serait signalé au bon endroit, mais trente
 * secondes plus tard et avec le mauvais message.
 */
function ouvrirSocket(token, options = {}) {
  return new Promise((resoudre) => {
    const socket = connecterSocket(ORIGINE, {
      auth: { token, ...options.auth },
      transports: ['websocket'],
      reconnection: false,
      timeout: 8000,
    });

    socketsOuverts.push(socket);

    socket.on('connect', () => resoudre({ socket, connecte: true }));
    socket.on('connect_error', (e) =>
      resoudre({ socket, connecte: false, erreur: e.message })
    );
  });
}

/** Attend un événement précis, ou rend `null` au bout du délai imparti. */
function attendre(socket, evenement, delai = 4000) {
  return new Promise((resoudre) => {
    const minuteur = setTimeout(() => {
      socket.off(evenement, surEvenement);
      resoudre(null);
    }, delai);

    function surEvenement(charge) {
      clearTimeout(minuteur);
      socket.off(evenement, surEvenement);
      resoudre(charge);
    }

    socket.on(evenement, surEvenement);
  });
}

/* ================================================================== *
 *  MISE EN PLACE
 * ================================================================== */

section('Mise en place');

const alice = await inscrire('msgalice', 'Alice');
const bob = await inscrire('msgbob', 'Bob');
const carol = await inscrire('msgcarol', 'Carol');
const dave = await inscrire('msgdave', 'Dave');

ok('quatre comptes inscrits',
  Boolean(alice.token && bob.token && carol.token && dave.token));

/*
 * BOB SUIT ALICE — le sens compte.
 * La règle est « la CIBLE suit déjà l'INITIATEUR ». Bob suivant Alice, une
 * conversation ouverte par Alice vers Bob doit s'ouvrir directement : Bob a
 * manifesté son intérêt. L'inverse — Alice suivant Bob — ne prouverait rien :
 * suivre quelqu'un n'est pas consentir à recevoir ses messages privés.
 */
const suivi = await appel(`/follows/${alice.id}`, { methode: 'POST', token: bob.token });
ok('Bob suit Alice', suivi.statut === 201 || suivi.statut === 200, suivi.json?.message);

/* ================================================================== *
 *  OUVERTURE DE CONVERSATION
 * ================================================================== */

section('Ouverture et sas d’entrée');

const versSoi = await appel('/messages/conversations', {
  methode: 'POST', token: alice.token, corps: { destinataire: alice.id },
});
ok('**s’écrire à soi-même est refusé**', versSoi.statut === 400, versSoi.json?.message);

const avecBob = await appel('/messages/conversations', {
  methode: 'POST', token: alice.token, corps: { destinataire: bob.id },
});
ok('conversation ouverte avec Bob', avecBob.statut === 201);
ok('**acceptée d’emblée : Bob suit déjà Alice**',
  avecBob.json?.conversation?.statut === 'accepte', avecBob.json?.conversation?.statut);

const idBob = avecBob.json.conversation._id;

const avecCarol = await appel('/messages/conversations', {
  methode: 'POST', token: alice.token, corps: { destinataire: carol.id },
});
ok('conversation ouverte avec Carol', avecCarol.statut === 201);
ok('**en attente : Carol n’a rien demandé**',
  avecCarol.json?.conversation?.statut === 'en_attente', avecCarol.json?.conversation?.statut);

const idCarol = avecCarol.json.conversation._id;

const reouverture = await appel('/messages/conversations', {
  methode: 'POST', token: alice.token, corps: { destinataire: bob.id },
});
ok('rouvrir retrouve la même conversation',
  reouverture.json?.conversation?._id === idBob);

/*
 * LA COURSE À L'OUVERTURE.
 * Dix requêtes simultanées « ouvrir avec Dave ». Chercher-puis-créer laisse
 * une fenêtre entre les deux : sans l'index unique sur la paire triée, on
 * obtiendrait plusieurs conversations pour un même échange — deux fils qui
 * s'ignorent, et des messages qui semblent disparaître.
 */
const rafale = await Promise.all(
  Array.from({ length: 10 }, () =>
    appel('/messages/conversations', {
      methode: 'POST', token: alice.token, corps: { destinataire: dave.id },
    })
  )
);
const idsCrees = new Set(rafale.map((r) => r.json?.conversation?._id).filter(Boolean));
ok('**10 ouvertures simultanées donnent UNE seule conversation**',
  idsCrees.size === 1, `${idsCrees.size} conversation(s)`);

const enBase = await bdd.collection('conversations').countDocuments({
  participants: { $all: [new ObjectId(alice.id), new ObjectId(dave.id)] },
});
ok('un seul document en base', enBase === 1, `${enBase} document(s)`);

const idDave = [...idsCrees][0];

/* ================================================================== *
 *  LE PLAFOND DE LA DEMANDE
 * ================================================================== */

section('Demande de chat');

const premier = await appel(`/messages/conversations/${idCarol}/messages`, {
  methode: 'POST', token: alice.token, corps: { contenu: 'Bonjour Carol, je me presente' },
});
ok('le premier message passe', premier.statut === 201, premier.json?.message);

const second = await appel(`/messages/conversations/${idCarol}/messages`, {
  methode: 'POST', token: alice.token, corps: { contenu: 'Vous etes la ?' },
});
ok('**le second est refusé tant que la demande est en attente**',
  second.statut === 403, second.json?.message);

const acceptationParSoi = await appel(`/messages/conversations/${idCarol}`, {
  methode: 'PATCH', token: alice.token, corps: { action: 'accepter' },
});
ok('**le demandeur ne peut pas accepter sa propre demande**',
  acceptationParSoi.statut === 403, acceptationParSoi.json?.message);

const reponseCarol = await appel(`/messages/conversations/${idCarol}/messages`, {
  methode: 'POST', token: carol.token, corps: { contenu: 'Bonjour, je vous ecoute' },
});
ok('la cible, elle, répond librement', reponseCarol.statut === 201);

const acceptation = await appel(`/messages/conversations/${idCarol}`, {
  methode: 'PATCH', token: carol.token, corps: { action: 'accepter' },
});
ok('Carol accepte la demande', acceptation.statut === 200);
ok('statut « accepte »', acceptation.json?.conversation?.statut === 'accepte');

const apresAcceptation = await appel(`/messages/conversations/${idCarol}/messages`, {
  methode: 'POST', token: alice.token, corps: { contenu: 'Merci !' },
});
ok('Alice peut de nouveau écrire', apresAcceptation.statut === 201);

const dejaTraitee = await appel(`/messages/conversations/${idCarol}`, {
  methode: 'PATCH', token: carol.token, corps: { action: 'refuser' },
});
ok('une demande déjà traitée ne se retraite pas', dejaTraitee.statut === 409);

/* ---------------------------- Le refus ---------------------------- */

await appel(`/messages/conversations/${idDave}/messages`, {
  methode: 'POST', token: alice.token, corps: { contenu: 'Bonjour Dave' },
});

const refus = await appel(`/messages/conversations/${idDave}`, {
  methode: 'PATCH', token: dave.token, corps: { action: 'refuser' },
});
ok('Dave refuse la demande', refus.statut === 200);

const apresRefus = await appel(`/messages/conversations/${idDave}/messages`, {
  methode: 'POST', token: alice.token, corps: { contenu: 'Vous etes sur ?' },
});
ok('**une conversation refusée n’accepte plus rien**',
  apresRefus.statut === 403, apresRefus.json?.message);

const refuseeCoteDave = await appel(`/messages/conversations/${idDave}/messages`, {
  methode: 'POST', token: dave.token, corps: { contenu: 'Non merci' },
});
ok('même pour celui qui a refusé', refuseeCoteDave.statut === 403);

/* ================================================================== *
 *  CLOISONNEMENT
 * ================================================================== */

section('Cloisonnement');

const intrus = await appel(`/messages/conversations/${idCarol}/messages`, {
  methode: 'POST', token: bob.token, corps: { contenu: 'Je passais par la' },
});
ok('**un tiers ne peut pas écrire dans une conversation**',
  intrus.statut === 403, intrus.json?.message);

const lectureIntrus = await appel(`/messages/conversations/${idCarol}/messages`, {
  token: bob.token,
});
ok('**ni la lire**', lectureIntrus.statut === 403);

const vide = await appel(`/messages/conversations/${idBob}/messages`, {
  methode: 'POST', token: alice.token, corps: { contenu: '   ' },
});
ok('un message vide est refusé', vide.statut === 400 || vide.statut === 422,
  `statut ${vide.statut}`);

const listeAlice = await appel('/messages/conversations', { token: alice.token });
const idsVus = (listeAlice.json?.elements || []).map((c) => c._id);
ok('Alice voit ses conversations', idsVus.includes(idBob) && idsVus.includes(idCarol));

const listeBob = await appel('/messages/conversations', { token: bob.token });
ok('**Bob ne voit pas la conversation Alice–Carol**',
  !(listeBob.json?.elements || []).map((c) => c._id).includes(idCarol));

ok('aucune adresse email dans la liste', !listeAlice.texte.includes(DOM));

/* ================================================================== *
 *  COMPTEURS DE NON-LUS
 * ================================================================== */

section('Compteurs de non-lus');

await appel(`/messages/conversations/${idBob}/lu`, { methode: 'POST', token: bob.token });

for (const texte of ['un', 'deux', 'trois']) {
  await appel(`/messages/conversations/${idBob}/messages`, {
    methode: 'POST', token: alice.token, corps: { contenu: `message ${texte}` },
  });
}

const vueBob = await appel('/messages/conversations', { token: bob.token });
const convBob = (vueBob.json?.elements || []).find((c) => c._id === idBob);
ok('**trois messages, trois non-lus côté Bob**', convBob?.nonLus === 3, `${convBob?.nonLus}`);

const vueAlice = await appel('/messages/conversations', { token: alice.token });
const convAlice = (vueAlice.json?.elements || []).find((c) => c._id === idBob);
ok('**et zéro côté Alice** : on ne se notifie pas soi-même',
  convAlice?.nonLus === 0, `${convAlice?.nonLus}`);

ok('l’extrait du dernier message est à jour',
  convBob?.dernierMessage?.texte === 'message trois', convBob?.dernierMessage?.texte);

const totalBob = await appel('/messages/non-lus', { token: bob.token });
ok('le total global compte bien 3', totalBob.json?.nombre === 3, `${totalBob.json?.nombre}`);

const lecture = await appel(`/messages/conversations/${idBob}/lu`, {
  methode: 'POST', token: bob.token,
});
ok('marquage en lu accepté', lecture.statut === 200);

const apresLecture = await appel('/messages/non-lus', { token: bob.token });
ok('**le compteur retombe à zéro**', apresLecture.json?.nombre === 0);

const messagesBob = await appel(`/messages/conversations/${idBob}/messages`, {
  token: bob.token,
});
const recus = (messagesBob.json?.messages || []).filter(
  (m) => String(m.expediteur?._id) === String(alice.id)
);
ok('les messages reçus sont marqués lus', recus.every((m) => m.lu === true));

const envoyesParBob = (messagesBob.json?.messages || []).filter(
  (m) => String(m.expediteur?._id) === String(bob.id)
);
ok('**mais pas ceux que Bob a envoyés** : lire n’est pas être lu',
  envoyesParBob.every((m) => m.lu === false) || envoyesParBob.length === 0);

ok('les messages sortent du plus ancien au plus récent',
  (messagesBob.json?.messages || [])[0]?.contenu !== 'message trois');

/* ================================================================== *
 *  TEMPS RÉEL — AUTHENTIFICATION
 * ================================================================== */

section('Socket — authentification');

const sansJeton = await ouvrirSocket(undefined);
ok('**socket refusé sans jeton**', !sansJeton.connecte, sansJeton.erreur);

const jetonBidon = await ouvrirSocket('ceci.nest.pas.un.jeton');
ok('**socket refusé avec un jeton invalide**', !jetonBidon.connecte, jetonBidon.erreur);

/*
 * LE JETON EXPIRÉ.
 * Signé avec le bon secret mais périmé : c'est le cas qu'un contrôle naïf
 * laisse passer, puisque la signature est valide.
 */
const jwt = requireLocal('jsonwebtoken');
const secret = readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .find((l) => l.startsWith('JWT_ACCESS_SECRET='))
  .slice('JWT_ACCESS_SECRET='.length)
  .trim()
  .replace(/^["']|["']$/g, '');

const jetonExpire = jwt.sign({ sub: alice.id, type: 'utilisateur' }, secret, { expiresIn: '-1s' });
const expire = await ouvrirSocket(jetonExpire);
ok('**socket refusé avec un jeton expiré**', !expire.connecte, expire.erreur);

const socketAlice = await ouvrirSocket(alice.token);
ok('socket accepté avec un jeton valide', socketAlice.connecte, socketAlice.erreur);

const socketBob = await ouvrirSocket(bob.token);
const socketCarol = await ouvrirSocket(carol.token);
ok('Bob et Carol connectés', socketBob.connecte && socketCarol.connecte);

/*
 * L'USURPATION D'IDENTITÉ.
 * On envoie l'identifiant de Bob dans la poignée de main d'Alice. Si le
 * serveur faisait la moindre confiance à ce que le client déclare, Alice
 * recevrait les messages de Bob.
 */
const usurpateur = await ouvrirSocket(alice.token, { auth: { userId: bob.id, _id: bob.id } });
const identite = await new Promise((resoudre) => {
  usurpateur.socket.emit('moi', resoudre);
  setTimeout(() => resoudre(null), 4000);
});
ok('**un identifiant envoyé par le client est ignoré**',
  identite?._id === String(alice.id), `le serveur répond ${identite?.pseudo}`);
ok('le socket est dans SA salle, pas dans une autre',
  identite?.salle === `utilisateur:${alice.id}`, identite?.salle);

/* ================================================================== *
 *  TEMPS RÉEL — DIFFUSION
 * ================================================================== */

section('Socket — diffusion');

const attenteBob = attendre(socketBob.socket, 'message:nouveau');
const attenteCarol = attendre(socketCarol.socket, 'message:nouveau', 2500);

await appel(`/messages/conversations/${idBob}/messages`, {
  methode: 'POST', token: alice.token, corps: { contenu: 'message en direct' },
});

const recuBob = await attenteBob;
ok('**Bob reçoit le message en direct, sans rechargement**',
  recuBob?.message?.contenu === 'message en direct', recuBob?.message?.contenu);
ok('la conversation est identifiée', recuBob?.conversation === idBob);

const recuCarol = await attenteCarol;
ok('**Carol ne reçoit rien : elle n’est pas dans la conversation**',
  recuCarol === null);

const majAlice = attendre(socketAlice.socket, 'conversation:maj');
await appel(`/messages/conversations/${idBob}/messages`, {
  methode: 'POST', token: alice.token, corps: { contenu: 'second onglet' },
});
const vueAliceDirect = await majAlice;
ok('**l’expéditeur est notifié aussi** (ses autres onglets)',
  vueAliceDirect?.conversation?._id === idBob);
ok('avec SA vue des non-lus', vueAliceDirect?.conversation?.nonLus === 0,
  `${vueAliceDirect?.conversation?.nonLus}`);

const attenteLus = attendre(socketAlice.socket, 'messages:lus');
await appel(`/messages/conversations/${idBob}/lu`, { methode: 'POST', token: bob.token });
const lus = await attenteLus;
ok('**la double coche arrive en direct**', lus?.conversation === idBob, JSON.stringify(lus));

/* --------------------- Indicateur de saisie --------------------- */

const saisieBob = attendre(socketBob.socket, 'saisie:debut');
const saisieSoi = attendre(socketAlice.socket, 'saisie:debut', 2000);

socketAlice.socket.emit('saisie:debut', { conversation: idBob });

const vuParBob = await saisieBob;
ok('Bob voit qu’Alice écrit', vuParBob?.utilisateur === String(alice.id));
ok('**Alice ne se voit pas écrire elle-même**', (await saisieSoi) === null);

/*
 * L'INDICATEUR EST AUSSI UNE FUITE POSSIBLE.
 * Carol émet une saisie sur la conversation Alice–Bob, à laquelle elle ne
 * participe pas. Sans contrôle, elle se signalerait dans un fil étranger —
 * et prouverait au passage qu'il existe.
 */
const saisieIntrus = attendre(socketBob.socket, 'saisie:debut', 2000);
socketCarol.socket.emit('saisie:debut', { conversation: idBob });
ok('**une saisie émise par un tiers n’est pas relayée**',
  (await saisieIntrus) === null);

const saisieRefusee = attendre(socketAlice.socket, 'saisie:debut', 2000);
socketAlice.socket.emit('saisie:debut', { conversation: idDave });
ok('ni dans une conversation refusée', (await saisieRefusee) === null);

/* ================================================================== *
 *  SUPPRESSION
 * ================================================================== */

section('Suppression');

const aSupprimer = await appel(`/messages/conversations/${idBob}/messages`, {
  methode: 'POST', token: alice.token, corps: { contenu: 'a effacer' },
});
const idMessage = aSupprimer.json?.donnees?._id;

const parAutrui = await appel(`/messages/${idMessage}`, { methode: 'DELETE', token: bob.token });
ok('**seul l’expéditeur supprime son message**', parAutrui.statut === 403);

const suppression = await appel(`/messages/${idMessage}`, { methode: 'DELETE', token: alice.token });
ok('suppression acceptée', suppression.statut === 200);

const apres = await appel(`/messages/conversations/${idBob}/messages`, { token: bob.token });
const efface = (apres.json?.messages || []).find((m) => m._id === idMessage);
ok('**le message reste dans le fil** (pas de trou)', Boolean(efface));
ok('marqué supprimé', efface?.supprime === true);
ok('**son contenu est absent de la réponse HTTP**',
  efface?.contenu === null && !apres.texte.includes('a effacer'));

/* ================================================================== *
 *  ORDRE DES ROUTES
 * ================================================================== */

section('Ordre des routes');

const nonLusRoute = await appel('/messages/non-lus', { token: alice.token });
ok('**/messages/non-lus n’est pas confondu avec un identifiant**',
  nonLusRoute.statut === 200 && typeof nonLusRoute.json?.nombre === 'number');

const idInvalide = await appel('/messages/conversations/pasunid/messages', { token: alice.token });
ok('identifiant invalide rejeté en 400', idInvalide.statut === 400);

const inexistante = await appel('/messages/conversations/507f1f77bcf86cd799439011/messages', {
  token: alice.token,
});
ok('conversation inexistante en 404', inexistante.statut === 404);

const sansSession = await appel('/messages/conversations');
ok('liste refusée sans session', sansSession.statut === 401);

/* ================================================================== *
 *  NETTOYAGE
 * ================================================================== */

for (const socket of socketsOuverts) socket.close();

const supprimes = await purger();
await clientMongo.close();

console.log('\n============== MESSAGERIE — MODULE 11 ==============');
const echecs = afficher();
console.log(`\n  (${supprimes} compte(s) de test supprimés, conversations comprises)`);
process.exit(echecs > 0 ? 1 : 0);
