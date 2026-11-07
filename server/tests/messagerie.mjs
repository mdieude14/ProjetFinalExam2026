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
 *  À QUI PUIS-JE ÉCRIRE — GET /messages/destinataires
 * ================================================================== */

section('Destinataires possibles');

/*
 * CE QUE CE POINT D'ENTRÉE DOIT GARANTIR, ET POURQUOI IL EXISTE.
 * La page Messages propose depuis le 6 novembre 2026 de démarrer une
 * conversation sans passer par un profil. Il lui faut donc une liste de
 * destinataires légitimes, filtrable à la frappe.
 *
 * CETTE SECTION EST PLACÉE EN DERNIER, APRÈS « Ordre des routes », parce
 * qu'elle AJOUTE des relations de suivi. Les placer plus haut changerait le
 * sas d'entrée des sections précédentes — et l'échec ressemblerait alors à
 * une régression du sas, pas à un effet de bord du jeu de données.
 */

// Alice suit Carol : Carol devient un ABONNEMENT. Bob suit Alice depuis la
// mise en place : il est un ABONNÉ. Dave reste sans aucun lien.
const suiviCarol = await appel(`/follows/${carol.id}`, { methode: 'POST', token: alice.token });
ok('Alice suit Carol', [200, 201].includes(suiviCarol.statut), suiviCarol.json?.message);

const sansJetonDest = await appel('/messages/destinataires');
ok('**sans session : 401**', sansJetonDest.statut === 401, `statut ${sansJetonDest.statut}`);

const liste = await appel('/messages/destinataires', { token: alice.token });
ok('la liste répond 200', liste.statut === 200, `statut ${liste.statut}`);
const pseudos = (liste.json?.destinataires ?? []).map((d) => d.pseudo);

/*
 * L'ANCRE AVANT LES ABSENCES. Une liste vide validerait « Dave n'est pas
 * proposé » sans avoir rien vérifié : c'est le faux vert consigné au 28
 * octobre. On exige donc d'abord que les DEUX sens soient présents.
 */
const lesDeuxSens = pseudos.includes(bob.pseudo) && pseudos.includes(carol.pseudo);
ok('**les deux sens comptent** — un abonné ET un abonnement sont proposés',
  lesDeuxSens, pseudos.join(', '));

ok('**Dave, sans aucun lien, n’est PAS proposé**',
  lesDeuxSens && !pseudos.includes(dave.pseudo),
  lesDeuxSens ? '' : 'NON CONCLUANT : la liste ne contient pas mes relations');
ok('**je ne me propose pas à moi-même**',
  lesDeuxSens && !pseudos.includes(alice.pseudo),
  lesDeuxSens ? '' : 'NON CONCLUANT : liste sans mes relations');

ok('le nombre annoncé correspond à la liste rendue',
  liste.json?.nombre === (liste.json?.destinataires ?? []).length,
  `${liste.json?.nombre} annoncé(s)`);

/* ------------------------- Le filtre par préfixe ------------------------- */

const parPrefixe = await appel(`/messages/destinataires?q=${bob.pseudo}`, { token: alice.token });
const pp = (parPrefixe.json?.destinataires ?? []).map((d) => d.pseudo);
ok('un préfixe complet ramène la bonne personne', pp.includes(bob.pseudo), pp.join(', '));
ok('et elle seule', pp.length === 1, `${pp.length} résultat(s)`);

const uneLettre = await appel('/messages/destinataires?q=m', { token: alice.token });
ok('**une seule lettre ne propose rien** — en dessous de deux, on ne devine pas',
  (uneLettre.json?.destinataires ?? []).length === 0);

const introuvable = await appel('/messages/destinataires?q=zzzpersonne', { token: alice.token });
ok('un préfixe sans correspondance rend une liste vide',
  introuvable.statut === 200 && (introuvable.json?.destinataires ?? []).length === 0);

/* --------------------- Les bornes du validateur --------------------- */

ok('`q` au-delà de 60 signes : 400',
  (await appel(`/messages/destinataires?q=${'a'.repeat(61)}`, { token: alice.token })).statut === 400);
ok('`limite` à 0 : 400',
  (await appel('/messages/destinataires?limite=0', { token: alice.token })).statut === 400);
ok('`limite` à 31 : 400',
  (await appel('/messages/destinataires?limite=31', { token: alice.token })).statut === 400);
const borne = await appel('/messages/destinataires?limite=1', { token: alice.token });
ok('`limite=1` est respectée', (borne.json?.destinataires ?? []).length <= 1,
  `${(borne.json?.destinataires ?? []).length} resultat(s)`);

/* ----------------------- Le blocage ferme la porte ----------------------- */

/*
 * PROPOSER QUELQU'UN QUE L'OUVERTURE REFUSERAIT ENSUITE EN 404 SERAIT PIRE
 * QU'INUTILE : la liste aurait déjà confirmé l'existence du compte, et le
 * 404 d'`ouvrirConversation` — choisi précisément pour ne rien confirmer —
 * perdrait sa discrétion.
 */
await appel(`/users/${carol.id}/blocage`, { methode: 'POST', token: alice.token });

const apresBlocage = await appel('/messages/destinataires', { token: alice.token });
const pb = (apresBlocage.json?.destinataires ?? []).map((d) => d.pseudo);
ok('**un compte que J’AI bloqué disparaît de mes destinataires**',
  pb.includes(bob.pseudo) && !pb.includes(carol.pseudo),
  pb.join(', ') || 'liste vide');

const vuDeCarol = await appel('/messages/destinataires', { token: carol.token });
const pc = (vuDeCarol.json?.destinataires ?? []).map((d) => d.pseudo);
ok('**et je disparais de SA liste** — le blocage n’est pas à sens unique',
  !pc.includes(alice.pseudo), pc.join(', ') || 'liste vide');

/*
 * LA COHÉRENCE AVEC L'OUVERTURE, VÉRIFIÉE ET NON SUPPOSÉE. C'est le seul
 * moyen de prouver que la liste et l'ouverture appliquent bien la même règle.
 */
const ouvertureBloquee = await appel('/messages/conversations', {
  methode: 'POST', token: alice.token, corps: { destinataire: carol.id },
});
ok('**ce que la liste cache, l’ouverture le refuse aussi** (404)',
  ouvertureBloquee.statut === 404, `statut ${ouvertureBloquee.statut}`);

await appel(`/users/${carol.id}/blocage`, { methode: 'DELETE', token: alice.token });

/* ------------------- Une demande de suivi n'est pas un lien ------------------- */

/*
 * UN SUIVI « en_attente » NE DOIT PAS OUVRIR LA MESSAGERIE. S'en servir
 * contournerait le profil privé : il suffirait de demander à suivre pour
 * obtenir le droit d'écrire, sans jamais avoir été accepté.
 */
await bdd.collection('follows').updateOne(
  { follower: new ObjectId(bob.id), following: new ObjectId(alice.id) },
  { $set: { statut: 'en_attente' } }
);

const avecAttente = await appel('/messages/destinataires', { token: alice.token });
const pa = (avecAttente.json?.destinataires ?? []).map((d) => d.pseudo);
ok('**un suivi encore « en_attente » ne rend pas destinataire**',
  !pa.includes(bob.pseudo), pa.join(', ') || 'liste vide');

await bdd.collection('follows').updateOne(
  { follower: new ObjectId(bob.id), following: new ObjectId(alice.id) },
  { $set: { statut: 'accepte' } }
);

/* ------------------------ Un compte désactivé ------------------------ */

await bdd.collection('users').updateOne(
  { _id: new ObjectId(carol.id) },
  { $set: { isActive: false } }
);
const avecInactif = await appel('/messages/destinataires', { token: alice.token });
const pi = (avecInactif.json?.destinataires ?? []).map((d) => d.pseudo);
ok('**un compte désactivé n’est pas proposé**',
  pi.includes(bob.pseudo) && !pi.includes(carol.pseudo),
  pi.join(', ') || 'liste vide');
await bdd.collection('users').updateOne(
  { _id: new ObjectId(carol.id) },
  { $set: { isActive: true } }
);

/* ------------------------- L'ordre des routes ------------------------- */

ok('**`/destinataires` n’est pas lu comme un identifiant de conversation**',
  liste.statut === 200 && !/identifiant/i.test(liste.texte));


/* ================================================================== *
 *  MODIFIER UN MESSAGE
 * ================================================================== */

section('Modifier un message');

/*
 * CE QUE CETTE SECTION DÉFEND. Réécrire un message change le compte rendu de
 * ce qui a été dit, après que l'autre l'a peut-être déjà lu. Trois choses
 * doivent donc tenir : seul l'auteur peut le faire, la retouche LAISSE UNE
 * TRACE, et l'extrait de la liste — qui porte une copie du texte — suit.
 */

const convMod = await appel('/messages/conversations', {
  methode: 'POST', token: alice.token, corps: { destinataire: bob.id },
});
const idConvMod = convMod.json?.conversation?._id;
const envMod = await appel(`/messages/conversations/${idConvMod}/messages`, {
  methode: 'POST', token: alice.token, corps: { contenu: 'Texte initial a corriger.' },
});
const idMsgMod = envMod.json?.donnees?._id;
ok('message de départ créé', Boolean(idMsgMod));

const modifie = await appel(`/messages/${idMsgMod}`, {
  methode: 'PATCH', token: alice.token, corps: { contenu: 'Texte corrige.' },
});
ok('l’auteur peut modifier', modifie.statut === 200, `statut ${modifie.statut}`);
ok('le nouveau texte est rendu', modifie.json?.donnees?.contenu === 'Texte corrige.');
ok('**la date de modification est posée** — c’est elle qui rend la retouche visible',
  Boolean(modifie.json?.donnees?.modifieLe), String(modifie.json?.donnees?.modifieLe));

const relusMod = await appel(`/messages/conversations/${idConvMod}/messages`, { token: alice.token });
const messageEnBase = (relusMod.json?.messages ?? []).find((m) => m._id === idMsgMod);
ok('le texte modifié est bien en base', messageEnBase?.contenu === 'Texte corrige.', messageEnBase?.contenu);

const listeMod = await appel('/messages/conversations', { token: alice.token });
const extraitMod = (listeMod.json?.elements ?? []).find((c) => c._id === idConvMod)?.dernierMessage?.texte;
ok('**l’extrait de la liste suit la modification** — il en porte une copie',
  extraitMod === 'Texte corrige.', extraitMod);

ok('**un tiers ne peut PAS réécrire mes mots : 403**',
  (await appel(`/messages/${idMsgMod}`, { methode: 'PATCH', token: bob.token, corps: { contenu: 'Pirate.' } })).statut === 403);
ok('un texte vide : 400 — « modifier pour effacer » passe par la suppression',
  (await appel(`/messages/${idMsgMod}`, { methode: 'PATCH', token: alice.token, corps: { contenu: '   ' } })).statut === 400);
ok('au-delà de 2000 signes : 400',
  (await appel(`/messages/${idMsgMod}`, { methode: 'PATCH', token: alice.token, corps: { contenu: 'a'.repeat(2001) } })).statut === 400);
ok('sans session : 401',
  (await appel(`/messages/${idMsgMod}`, { methode: 'PATCH', corps: { contenu: 'x' } })).statut === 401);
ok('identifiant invalide : 400',
  (await appel('/messages/pasunid', { methode: 'PATCH', token: alice.token, corps: { contenu: 'x' } })).statut === 400);
ok('message inexistant : 404',
  (await appel('/messages/507f1f77bcf86cd799439011', { methode: 'PATCH', token: alice.token, corps: { contenu: 'x' } })).statut === 404);

const envSuppr = await appel(`/messages/conversations/${idConvMod}/messages`, {
  methode: 'POST', token: alice.token, corps: { contenu: 'Celui-ci partira.' },
});
await appel(`/messages/${envSuppr.json?.donnees?._id}`, { methode: 'DELETE', token: alice.token });
ok('**un message supprimé ne se modifie plus : 409** — sinon la suppression se contournerait',
  (await appel(`/messages/${envSuppr.json?.donnees?._id}`, {
    methode: 'PATCH', token: alice.token, corps: { contenu: 'Revenu !' },
  })).statut === 409);

/* ================================================================== *
 *  SUPPRIMER UNE CONVERSATION — POUR SOI
 * ================================================================== */

section('Supprimer une conversation');

/*
 * LE POINT CRITIQUE DE CETTE SECTION TIENT EN UNE LIGNE : la suppression ne
 * doit jamais toucher aux données de l'autre participant. Tout le reste en
 * découle — y compris le retour du fil au message suivant, sans lequel
 * supprimer vaudrait blocage silencieux.
 */

const avantSuppr = await appel('/messages/conversations', { token: alice.token });
ok('la conversation est dans ma liste avant',
  (avantSuppr.json?.elements ?? []).some((c) => c._id === idConvMod));

const supprConv = await appel(`/messages/conversations/${idConvMod}`, {
  methode: 'DELETE', token: alice.token,
});
ok('la suppression répond 200', supprConv.statut === 200, `statut ${supprConv.statut}`);

const apresSuppr = await appel('/messages/conversations', { token: alice.token });
ok('**elle a disparu de MA liste**',
  !(apresSuppr.json?.elements ?? []).some((c) => c._id === idConvMod));

const vueDeBob = await appel('/messages/conversations', { token: bob.token });
ok('**mais elle est INTACTE chez Bob** — on ne détruit pas les données de l’autre',
  (vueDeBob.json?.elements ?? []).some((c) => c._id === idConvMod));

const histoireBob = await appel(`/messages/conversations/${idConvMod}/messages`, { token: bob.token });
ok('et Bob garde tout l’historique', (histoireBob.json?.messages ?? []).length >= 2,
  `${(histoireBob.json?.messages ?? []).length} message(s)`);

await appel(`/messages/conversations/${idConvMod}/messages`, {
  methode: 'POST', token: bob.token, corps: { contenu: 'Tu es la ?' },
});
const revenue = await appel('/messages/conversations', { token: alice.token });
ok('**un message de l’autre la fait REVENIR** — sinon ce message serait perdu',
  (revenue.json?.elements ?? []).some((c) => c._id === idConvMod));

await appel(`/messages/conversations/${idConvMod}`, { methode: 'DELETE', token: alice.token });
await appel(`/messages/conversations/${idConvMod}/messages`, {
  methode: 'POST', token: alice.token, corps: { contenu: 'Me revoila.' },
});
const revenuePourMoi = await appel('/messages/conversations', { token: alice.token });
ok('**et écrire la rouvre pour moi aussi** — sinon j’enverrais dans le vide',
  (revenuePourMoi.json?.elements ?? []).some((c) => c._id === idConvMod));

await appel(`/messages/conversations/${idConvMod}`, { methode: 'DELETE', token: alice.token });
ok('**supprimer deux fois ne casse rien** — `$addToSet` est idempotent',
  (await appel(`/messages/conversations/${idConvMod}`, { methode: 'DELETE', token: alice.token })).statut === 200);

ok('**un non-participant : 404 et non 403** — un 403 confirmerait que le fil existe',
  (await appel(`/messages/conversations/${idConvMod}`, { methode: 'DELETE', token: carol.token })).statut === 404);
ok('sans session : 401',
  (await appel(`/messages/conversations/${idConvMod}`, { methode: 'DELETE' })).statut === 401);
ok('identifiant invalide : 400',
  (await appel('/messages/conversations/pasunid', { methode: 'DELETE', token: alice.token })).statut === 400);
ok('conversation inexistante : 404',
  (await appel('/messages/conversations/507f1f77bcf86cd799439011', { methode: 'DELETE', token: alice.token })).statut === 404);

/*
 * L'ORDRE DES ROUTES, VÉRIFIÉ ET NON SUPPOSÉ. `DELETE /conversations/:id`
 * est déclaré avant `DELETE /:id` : sans cela, « conversations » serait lu
 * comme un identifiant de message, et la suppression répondrait 404 sans
 * qu'on comprenne pourquoi.
 */
ok('**`/conversations/:id` n’est pas lu comme un identifiant de message**',
  supprConv.statut === 200 && !/Message introuvable/i.test(supprConv.texte));


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
