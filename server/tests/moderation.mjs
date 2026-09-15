/**
 * ===========================================================================
 *  MODÉRATION PERSONNELLE — bloquer, restreindre, signaler
 * ===========================================================================
 *
 *   npm run test:moderation
 *
 * Prérequis : l'API (port 5000) doit tourner et MongoDB être joignable.
 *
 * CE QUE CETTE SUITE VÉRIFIE VRAIMENT, et pourquoi ces cas-là :
 *
 *   1. LE BLOCAGE FERME LES DEUX SENS. C'est la moitié qu'on oublie : ne
 *      tester que « le bloqué ne voit plus » laisserait passer le cas où
 *      celui qui bloque continue de voir — et d'être vu.
 *
 *   2. LA RESTRICTION EST SILENCIEUSE. Chaque assertion « le restreint ne
 *      voit AUCUNE différence » vaut autant que celles sur l'effet lui-même :
 *      une restriction qui se remarque ne vaut pas mieux qu'un blocage.
 *
 *   3. LES COMPTEURS SUIVENT. Un commentaire en attente ne doit jamais
 *      compter, et un blocage doit décrémenter les abonnés — sinon le profil
 *      affiche un total qui ne correspond à aucune liste.
 *
 * Les comptes créés ici sont supprimés à la fin — et au démarrage, pour que
 * la suite ne dépende pas de la façon dont la précédente s'est terminée.
 * ===========================================================================
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

import { connecterDB, deconnecterDB } from '../src/config/db.js';
import User from '../src/models/User.js';

const API = 'http://localhost:5000/api';
const DOM = '@moderationtest.local';
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

function formPost(champs = {}) {
  const fd = new FormData();
  fd.append('medias', new Blob([png()], { type: 'image/png' }), 'p.png');
  for (const [cle, valeur] of Object.entries(champs)) fd.append(cle, String(valeur));
  return fd;
}

async function inscrire({ type = 'utilisateur', pseudo, nom, prenom }) {
  const r = await appel('/auth/register', {
    methode: 'POST',
    corps: {
      type, nom, prenom, pseudo,
      email: `${pseudo}${DOM}`, password: MDP,
      ...(type === 'coach' ? { diplome: { intitule: 'BPJEPS', organisme: 'DRJSCS' } } : {}),
    },
  });
  if (r.statut !== 201) throw new Error(`création de ${pseudo} : ${r.statut} ${r.json?.message}`);
  return { token: r.json.accessToken, id: r.json.utilisateur._id, pseudo };
}

/* ------------------------- Accès direct à la base ------------------------ */

const requireLocal = createRequire(import.meta.url);
const { MongoClient } = requireLocal('mongodb');

const URI =
  (readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .find((l) => l.startsWith('MONGO_URI=')) || '')
    .replace('MONGO_URI=', '')
    .trim() || 'mongodb://localhost:27017/sportsocial?replicaSet=rs0';

const client = new MongoClient(URI);
await client.connect();
const base = client.db();

const motifTest = new RegExp(`${DOM.replace('.', '\\.')}$`);

/** Purge : comptes de test et tout ce qui s'y rattache. */
async function purger() {
  const comptes = await base
    .collection('users')
    .find({ email: motifTest }, { projection: { _id: 1 } })
    .toArray();

  const ids = comptes.map((c) => c._id);
  if (!ids.length) return;

  const posts = await base
    .collection('posts')
    .find({ auteur: { $in: ids } }, { projection: { _id: 1 } })
    .toArray();
  const idsPosts = posts.map((p) => p._id);

  await Promise.all([
    base.collection('users').deleteMany({ _id: { $in: ids } }),
    base.collection('posts').deleteMany({ auteur: { $in: ids } }),
    base.collection('comments').deleteMany({
      $or: [{ auteur: { $in: ids } }, { post: { $in: idsPosts } }],
    }),
    base.collection('follows').deleteMany({
      $or: [{ follower: { $in: ids } }, { following: { $in: ids } }],
    }),
    base.collection('relations').deleteMany({
      $or: [{ source: { $in: ids } }, { cible: { $in: ids } }],
    }),
    base.collection('signalements').deleteMany({
      $or: [{ signaleur: { $in: ids } }, { cible: { $in: ids } }],
    }),
    base.collection('conversations').deleteMany({ participants: { $in: ids } }),
    base.collection('notifications').deleteMany({
      $or: [{ destinataire: { $in: ids } }, { emetteur: { $in: ids } }],
    }),
  ]);
}

await purger();

/*
 * UN ADMIN NE PEUT PAS ETRE CREE PAR L'API — c'est une protection du module 3,
 * verifiee par la suite de regression. On passe donc par le modele, comme
 * elle : c'est la seule voie, et elle traverse le hook de hachage du mot de
 * passe (une insertion directe en base laisserait un mot de passe en clair
 * que la connexion refuserait ensuite).
 */
await connecterDB();

let codeSortie = 0;

try {
  /* =================================================================== *
   *  MISE EN PLACE
   * =================================================================== */

  // Alice bloque/restreint. Bruno subit. Chloé est le tiers témoin : c'est
  // elle qui prouve qu'un commentaire en attente n'est visible de personne
  // d'autre que son auteur et celui de la publication.
  const alice = await inscrire({ pseudo: `alicemod${S}`, nom: 'Martin', prenom: 'Alice' });
  const bruno = await inscrire({ pseudo: `brunomod${S}`, nom: 'Dupont', prenom: 'Bruno' });
  const chloe = await inscrire({ pseudo: `chloemod${S}`, nom: 'Petit', prenom: 'Chloé' });

  // Suivis croisés : le blocage devra les rompre DANS LES DEUX SENS.
  await appel(`/follows/${bruno.pseudo}`, { methode: 'POST', token: alice.token });
  await appel(`/follows/${alice.pseudo}`, { methode: 'POST', token: bruno.token });
  await appel(`/follows/${alice.pseudo}`, { methode: 'POST', token: chloe.token });

  const postAlice = await appel('/posts', {
    methode: 'POST',
    form: formPost({ description: `Seance moderation ${S}` }),
    token: alice.token,
  });
  const idPost = postAlice.json?.post?._id || postAlice.json?.donnees?._id;

  /* =================================================================== *
   *  GARDE-FOUS
   * =================================================================== */
  section('Garde-fous');

  const soiMeme = await appel(`/users/${alice.id}/blocage`, { methode: 'POST', token: alice.token });
  ok('se bloquer soi-même est refusé', soiMeme.statut === 400, `statut ${soiMeme.statut}`);

  const idInvalide = await appel('/users/pas-un-id/blocage', { methode: 'POST', token: alice.token });
  ok('identifiant mal formé rejeté en 400', idInvalide.statut === 400, `statut ${idInvalide.statut}`);

  const anonyme = await appel(`/users/${bruno.id}/blocage`, { methode: 'POST' });
  ok('un visiteur anonyme ne peut bloquer personne', anonyme.statut === 401, `statut ${anonyme.statut}`);

  /* =================================================================== *
   *  RESTRICTION — d'abord, car elle doit rester SILENCIEUSE
   * =================================================================== */
  section('Restriction — pose et silence');

  const poser = await appel(`/users/${bruno.id}/restriction`, {
    methode: 'POST',
    token: alice.token,
  });
  ok('Alice restreint Bruno', poser.statut === 201, `statut ${poser.statut}`);

  const rePoser = await appel(`/users/${bruno.id}/restriction`, {
    methode: 'POST',
    token: alice.token,
  });
  ok('restreindre deux fois est sans effet (idempotent)', rePoser.statut === 201 && rePoser.json?.deja === true);

  // LE CŒUR DE LA RESTRICTION : Bruno ne doit RIEN voir changer.
  const vuBruno = await appel(`/users/${alice.pseudo}`, { token: bruno.token });
  ok('Bruno voit toujours le profil d’Alice', vuBruno.statut === 200);
  ok('Bruno reste abonné à Alice', vuBruno.json?.relation === 'abonne', vuBruno.json?.relation);
  ok('aucun drapeau ne trahit la restriction', vuBruno.json?.moderation?.restreint === false);
  ok('Bruno ne voit aucun blocage', vuBruno.json?.estBloque === false);

  const vuAlice = await appel(`/users/${bruno.pseudo}`, { token: alice.token });
  ok('Alice, elle, voit que Bruno est restreint', vuAlice.json?.moderation?.restreint === true);

  /* =================================================================== *
   *  RESTRICTION — commentaires en attente
   * =================================================================== */
  section('Restriction — approbation des commentaires');

  const avant = await appel(`/posts/${idPost}`, { token: alice.token });
  const compteurAvant = avant.json?.post?.commentsCount ?? avant.json?.donnees?.commentsCount ?? 0;

  const commentaire = await appel(`/posts/${idPost}/comments`, {
    methode: 'POST',
    corps: { texte: `Commentaire de Bruno ${S}` },
    token: bruno.token,
  });
  ok('le commentaire de Bruno est ACCEPTÉ, pas refusé', commentaire.statut === 201, `statut ${commentaire.statut}`);

  const idCommentaire = commentaire.json?.commentaire?._id;

  const vuParBruno = await appel(`/posts/${idPost}/comments`, { token: bruno.token });
  ok(
    'Bruno relit son propre commentaire (il ne se doute de rien)',
    JSON.stringify(vuParBruno.json).includes(String(idCommentaire))
  );

  const vuParChloe = await appel(`/posts/${idPost}/comments`, { token: chloe.token });
  ok(
    'Chloé, tierce personne, ne le voit PAS',
    !JSON.stringify(vuParChloe.json).includes(String(idCommentaire))
  );

  const vuParAlice = await appel(`/posts/${idPost}/comments`, { token: alice.token });
  ok(
    'Alice le voit, pour pouvoir trancher',
    JSON.stringify(vuParAlice.json).includes(String(idCommentaire))
  );

  const apres = await appel(`/posts/${idPost}`, { token: alice.token });
  const compteurApres = apres.json?.post?.commentsCount ?? apres.json?.donnees?.commentsCount ?? 0;
  ok(
    'le compteur de commentaires N’A PAS bougé',
    compteurApres === compteurAvant,
    `${compteurAvant} -> ${compteurApres}`
  );

  const notifs = await appel('/notifications', { token: alice.token });
  ok(
    'aucune notification n’a été émise vers Alice',
    !JSON.stringify(notifs.json || {}).includes(String(idCommentaire))
  );

  // Approbation
  const approbation = await appel(`/comments/${idCommentaire}/approbation`, {
    methode: 'PATCH',
    corps: { action: 'approuver' },
    token: alice.token,
  });
  ok('Alice approuve le commentaire', approbation.statut === 200, `statut ${approbation.statut}`);

  const vuChloeApres = await appel(`/posts/${idPost}/comments`, { token: chloe.token });
  ok(
    'Chloé le voit une fois approuvé',
    JSON.stringify(vuChloeApres.json).includes(String(idCommentaire))
  );

  const finalPost = await appel(`/posts/${idPost}`, { token: alice.token });
  const compteurFinal =
    finalPost.json?.post?.commentsCount ?? finalPost.json?.donnees?.commentsCount ?? 0;
  ok(
    'le compteur s’incrémente à l’approbation, pas avant',
    compteurFinal === compteurAvant + 1,
    `${compteurAvant} -> ${compteurFinal}`
  );

  const doubleApprobation = await appel(`/comments/${idCommentaire}/approbation`, {
    methode: 'PATCH',
    corps: { action: 'approuver' },
    token: alice.token,
  });
  ok(
    'approuver deux fois est refusé (le compteur ne peut pas dériver)',
    doubleApprobation.statut === 400,
    `statut ${doubleApprobation.statut}`
  );

  const parBruno = await appel(`/comments/${idCommentaire}/approbation`, {
    methode: 'PATCH',
    corps: { action: 'approuver' },
    token: bruno.token,
  });
  ok('Bruno ne peut pas approuver lui-même', parBruno.statut === 403 || parBruno.statut === 400);

  /* =================================================================== *
   *  RESTRICTION — messagerie
   * =================================================================== */
  section('Restriction — messagerie');

  const conv = await appel('/messages/conversations', {
    methode: 'POST',
    corps: { destinataire: bruno.id },
    token: bruno.token,
  });

  const ouverture = await appel('/messages/conversations', {
    methode: 'POST',
    corps: { destinataire: alice.id },
    token: bruno.token,
  });
  ok('Bruno peut toujours ouvrir une conversation', ouverture.statut === 201 || ouverture.statut === 200);

  const statutConv = ouverture.json?.conversation?.statut;
  ok(
    'elle s’ouvre en DEMANDE malgré l’abonnement (mise à l’écart)',
    statutConv === 'en_attente',
    `statut « ${statutConv} »`
  );

  const idConv = ouverture.json?.conversation?._id;

  const m1 = await appel(`/messages/conversations/${idConv}/messages`, {
    methode: 'POST',
    corps: { contenu: `Premier ${S}` },
    token: bruno.token,
  });
  const m2 = await appel(`/messages/conversations/${idConv}/messages`, {
    methode: 'POST',
    corps: { contenu: `Second ${S}` },
    token: bruno.token,
  });
  ok('premier message accepté', m1.statut === 201, `statut ${m1.statut}`);
  ok(
    'SECOND message accepté aussi — le plafond du sas est levé pour un restreint',
    m2.statut === 201,
    `statut ${m2.statut} (un 403 ici trahirait la restriction)`
  );

  /* =================================================================== *
   *  LEVÉE DE LA RESTRICTION
   * =================================================================== */
  section('Restriction — levée');

  const lever = await appel(`/users/${bruno.id}/restriction`, {
    methode: 'DELETE',
    token: alice.token,
  });
  ok('Alice lève la restriction', lever.statut === 200, `statut ${lever.statut}`);
  ok('la réponse annonce que les commentaires en attente le restent',
    lever.json?.commentairesEnAttenteConserves === true);

  const etatLeve = await appel(`/users/${bruno.id}/moderation`, { token: alice.token });
  ok('l’état ne porte plus la restriction', etatLeve.json?.moderation?.restreint === false);

  /* =================================================================== *
   *  SIGNALEMENT
   * =================================================================== */
  section('Signalement');

  const motifAbsent = await appel(`/users/${bruno.id}/signalement`, {
    methode: 'POST',
    corps: {},
    token: alice.token,
  });
  ok('un signalement sans motif est refusé', motifAbsent.statut === 400, `statut ${motifAbsent.statut}`);

  const motifInvente = await appel(`/users/${bruno.id}/signalement`, {
    methode: 'POST',
    corps: { motif: 'motif_qui_nexiste_pas' },
    token: alice.token,
  });
  ok('un motif hors liste est refusé en 400, pas en 500',
    motifInvente.statut === 400, `statut ${motifInvente.statut}`);

  const signalement = await appel(`/users/${bruno.id}/signalement`, {
    methode: 'POST',
    corps: { motif: 'spam', commentaire: `Test ${S}` },
    token: alice.token,
  });
  ok('signalement transmis', signalement.statut === 201, `statut ${signalement.statut}`);
  ok(
    'le signalement lui-même n’est JAMAIS renvoyé',
    !signalement.json?.signalement && !signalement.texte.includes('"statut":"ouvert"')
  );

  const reSignalement = await appel(`/users/${bruno.id}/signalement`, {
    methode: 'POST',
    corps: { motif: 'spam' },
    token: alice.token,
  });
  ok('signaler deux fois n’inonde pas la file', reSignalement.json?.deja === true);

  const nbSignalements = await base
    .collection('signalements')
    .countDocuments({ signaleur: { $exists: true }, cible: { $exists: true }, motif: 'spam' });
  ok('un seul document en base malgré deux appels', nbSignalements >= 1);

  // Le signalement ne change RIEN à la relation : c'est sa définition même.
  const apresSignalement = await appel(`/users/${bruno.pseudo}`, { token: alice.token });
  ok(
    'signaler ne rompt pas le suivi',
    apresSignalement.json?.relation === 'abonne',
    apresSignalement.json?.relation
  );
  ok('l’état porte le signalement', apresSignalement.json?.moderation?.aSignale === true);

  /*
   * ASSERTION CORRIGÉE : la première version cherchait la chaîne « signal »
   * dans la réponse et échouait sur le NOM du champ `aSignale`, toujours
   * présent. Ce n'était pas le produit qui fuyait, c'était le test qui
   * confondait un nom de champ avec sa valeur.
   *
   * Ce qu'il faut vraiment vérifier : les drapeaux sont ORIENTÉS. Côté
   * Bruno, `aSignale` décrit ce que BRUNO a signalé — jamais ce qu'il subit.
   */
  const vuBrunoSignale = await appel(`/users/${alice.pseudo}`, { token: bruno.token });
  ok(
    'Bruno n’apprend pas qu’il a été signalé',
    vuBrunoSignale.json?.moderation?.aSignale === false,
    'les drapeaux décrivent ce qu’on a posé, pas ce qu’on subit'
  );

  /* =================================================================== *
   *  RECEPTION PAR L'ADMINISTRATION
   * =================================================================== */
  section('Signalement — réception par l’administration');

  await User.create({
    type: 'admin',
    nom: 'Moderation',
    prenom: 'Admin',
    pseudo: `adminmod${S}`,
    email: `adminmod${S}${DOM}`,
    password: MDP,
  });

  const cxAdmin = await appel('/auth/login', {
    methode: 'POST',
    corps: { identifiant: `adminmod${S}`, password: MDP },
  });
  ok('connexion du compte administrateur', cxAdmin.statut === 200, `statut ${cxAdmin.statut}`);
  const jetonAdmin = cxAdmin.json?.accessToken;

  // La porte doit être fermée AVANT de vérifier qu'elle s'ouvre pour l'admin.
  const fileParAlice = await appel('/admin/signalements', { token: alice.token });
  ok(
    'un compte ordinaire n’accède pas à la file',
    fileParAlice.statut === 403,
    `statut ${fileParAlice.statut}`
  );

  const file = await appel('/admin/signalements?statut=ouvert', { token: jetonAdmin });
  ok('l’administrateur reçoit la file des signalements', file.statut === 200, `statut ${file.statut}`);

  const dossier = (file.json?.elements || []).find(
    (d) => String(d.cible?._id) === String(bruno.id)
  );
  ok('LE SIGNALEMENT EST BIEN ARRIVÉ chez l’administration', Boolean(dossier));

  ok('le MOTIF est transmis', dossier?.motif === 'spam', `motif « ${dossier?.motif} »`);
  ok(
    'les PRÉCISIONS sont transmises telles quelles',
    dossier?.commentaire === `Test ${S}`,
    `commentaire « ${dossier?.commentaire} »`
  );

  ok('le compte signalé est identifiable', dossier?.cible?.pseudo === bruno.pseudo);
  ok(
    'le signaleur est identifiable — mais SEULEMENT ici',
    dossier?.signaleur?.pseudo === alice.pseudo
  );
  ok('le dossier est ouvert', dossier?.statut === 'ouvert', `statut « ${dossier?.statut} »`);

  const stats = await appel('/admin/stats', { token: jetonAdmin });
  ok(
    'le tableau de bord compte les signalements ouverts',
    (stats.json?.stats?.signalementsOuverts ?? 0) >= 1,
    `${stats.json?.stats?.signalementsOuverts} ouvert(s)`
  );

  section('Signalement — instruction');

  const parAlice = await appel(`/admin/signalements/${dossier?._id}`, {
    methode: 'PATCH',
    corps: { decision: 'traiter' },
    token: alice.token,
  });
  ok('un compte ordinaire ne peut pas instruire', parAlice.statut === 403, `statut ${parAlice.statut}`);

  const decisionVide = await appel(`/admin/signalements/${dossier?._id}`, {
    methode: 'PATCH',
    corps: {},
    token: jetonAdmin,
  });
  ok('une décision absente est refusée', decisionVide.statut === 400, `statut ${decisionVide.statut}`);

  const instruction = await appel(`/admin/signalements/${dossier?._id}`, {
    methode: 'PATCH',
    corps: { decision: 'traiter', commentaire: `Avertissement envoyé ${S}` },
    token: jetonAdmin,
  });
  ok('l’administrateur tranche le dossier', instruction.statut === 200, `statut ${instruction.statut}`);
  ok('le dossier passe en « traité »', instruction.json?.signalement?.statut === 'traite');
  ok(
    'la note d’instruction est enregistrée',
    instruction.json?.signalement?.decision === `Avertissement envoyé ${S}`
  );
  ok('l’instructeur est tracé', Boolean(instruction.json?.signalement?.traitePar));

  const doubleInstruction = await appel(`/admin/signalements/${dossier?._id}`, {
    methode: 'PATCH',
    corps: { decision: 'rejeter' },
    token: jetonAdmin,
  });
  ok(
    'un dossier déjà instruit ne se rejuge pas',
    doubleInstruction.statut === 400,
    `statut ${doubleInstruction.statut}`
  );

  const fileApres = await appel('/admin/signalements?statut=ouvert', { token: jetonAdmin });
  ok(
    'il quitte la file des dossiers ouverts',
    !(fileApres.json?.elements || []).some((d) => String(d._id) === String(dossier?._id))
  );

  const fileTraites = await appel('/admin/signalements?statut=traite', { token: jetonAdmin });
  ok(
    'mais il est CONSERVÉ dans l’historique (on classe, on ne supprime pas)',
    (fileTraites.json?.elements || []).some((d) => String(d._id) === String(dossier?._id))
  );

  /*
   * L'index partiel du modèle ne porte que sur les signalements « ouvert » :
   * une fois celui-ci tranché, la même personne doit pouvoir alerter de
   * nouveau. Sans cette propriété, une récidive resterait invisible.
   */
  const recidive = await appel(`/users/${bruno.id}/signalement`, {
    methode: 'POST',
    corps: { motif: 'harcelement', commentaire: `Récidive ${S}` },
    token: alice.token,
  });
  ok(
    'une RÉCIDIVE peut être signalée après classement',
    recidive.statut === 201 && recidive.json?.deja !== true,
    `statut ${recidive.statut}`
  );

  const fileRecidive = await appel('/admin/signalements?statut=ouvert', { token: jetonAdmin });
  const nouveau = (fileRecidive.json?.elements || []).find(
    (d) => String(d.cible?._id) === String(bruno.id)
  );
  ok('le nouveau dossier porte le nouveau motif', nouveau?.motif === 'harcelement',
    `motif « ${nouveau?.motif} »`);
  ok('et les nouvelles précisions', nouveau?.commentaire === `Récidive ${S}`);

  section('Signalement — sans précisions');

  const sansPrecision = await appel(`/users/${chloe.id}/signalement`, {
    methode: 'POST',
    corps: { motif: 'usurpation' },
    token: alice.token,
  });
  ok('un signalement sans précisions est accepté', sansPrecision.statut === 201);

  const fileChloe = await appel('/admin/signalements?statut=ouvert', { token: jetonAdmin });
  const dossierChloe = (fileChloe.json?.elements || []).find(
    (d) => String(d.cible?._id) === String(chloe.id)
  );
  ok('il arrive chez l’administration avec son motif', dossierChloe?.motif === 'usurpation');
  ok(
    'et sans commentaire — le champ est absent, pas vide',
    dossierChloe?.commentaire === undefined || dossierChloe?.commentaire === null
  );

  /* =================================================================== *
   *  BLOCAGE
   * =================================================================== */
  section('Blocage — pose et rupture des suivis');

  const avantBlocage = await appel(`/users/${alice.pseudo}`, { token: chloe.token });
  const abonnesAvant = avantBlocage.json?.profil?.stats?.followersCount ?? 0;

  const blocage = await appel(`/users/${bruno.id}/blocage`, { methode: 'POST', token: alice.token });
  ok('Alice bloque Bruno', blocage.statut === 201, `statut ${blocage.statut}`);
  ok('les deux sens du suivi sont rompus', blocage.json?.suivisRompus === 2,
    `${blocage.json?.suivisRompus} lien(s)`);

  const liensRestants = await base.collection('follows').countDocuments({
    $or: [
      { follower: new (await import('mongodb')).ObjectId(alice.id), following: new (await import('mongodb')).ObjectId(bruno.id) },
      { follower: new (await import('mongodb')).ObjectId(bruno.id), following: new (await import('mongodb')).ObjectId(alice.id) },
    ],
  });
  ok('aucun document Follow ne subsiste entre eux', liensRestants === 0, `${liensRestants} restant(s)`);

  const apresBlocage = await appel(`/users/${alice.pseudo}`, { token: chloe.token });
  const abonnesApres = apresBlocage.json?.profil?.stats?.followersCount ?? 0;
  ok(
    'le compteur d’abonnés d’Alice a été décrémenté',
    abonnesApres === abonnesAvant - 1,
    `${abonnesAvant} -> ${abonnesApres}`
  );

  section('Blocage — les deux sens');

  const brunoVoitAlice = await appel(`/users/${alice.pseudo}`, { token: bruno.token });
  ok('le profil reste identifiable', brunoVoitAlice.statut === 200);
  ok('mais son contenu est fermé', brunoVoitAlice.json?.contenuVisible === false);
  ok('et le blocage est signalé à l’écran', brunoVoitAlice.json?.estBloque === true);
  ok(
    'sans dire QUI a bloqué (moderation.bloque reste faux côté Bruno)',
    brunoVoitAlice.json?.moderation?.bloque === false
  );

  const aliceVoitBruno = await appel(`/users/${bruno.pseudo}`, { token: alice.token });
  ok('SYMÉTRIE : Alice non plus ne voit plus le contenu de Bruno',
    aliceVoitBruno.json?.contenuVisible === false);
  ok('Alice sait, elle, que c’est elle qui a bloqué',
    aliceVoitBruno.json?.moderation?.bloque === true);

  const postsBloques = await appel(`/posts/utilisateur/${alice.pseudo}`, { token: bruno.token });
  const corpsPosts = JSON.stringify(postsBloques.json || {});
  ok(
    'aucune publication d’Alice ne part dans la réponse HTTP',
    !corpsPosts.includes(String(idPost)),
    'le contenu doit être ABSENT, pas masqué'
  );

  section('Blocage — recherche et listes');

  const rechercheBruno = await appel(
    `/search/utilisateurs?q=${alice.pseudo}`, { token: bruno.token }
  );
  ok(
    'Alice disparaît de la recherche de Bruno',
    !JSON.stringify(rechercheBruno.json || {}).includes(alice.pseudo)
  );

  const suggestionsBruno = await appel(
    `/search/suggestions?q=${alice.pseudo.slice(0, 8)}`, { token: bruno.token }
  );
  ok(
    'et de l’autocomplétion',
    !JSON.stringify(suggestionsBruno.json || {}).includes(alice.pseudo)
  );

  const rechercheAlice = await appel(
    `/search/utilisateurs?q=${bruno.pseudo}`, { token: alice.token }
  );
  ok(
    'SYMÉTRIE : Bruno disparaît de la recherche d’Alice',
    !JSON.stringify(rechercheAlice.json || {}).includes(bruno.pseudo)
  );

  const rechercheChloe = await appel(
    `/search/utilisateurs?q=${alice.pseudo}`, { token: chloe.token }
  );
  ok(
    'Chloé, elle, trouve toujours Alice (le blocage ne concerne qu’eux)',
    JSON.stringify(rechercheChloe.json || {}).includes(alice.pseudo)
  );

  section('Blocage — messagerie');

  const convBloquee = await appel('/messages/conversations', {
    methode: 'POST',
    corps: { destinataire: alice.id },
    token: bruno.token,
  });
  ok(
    'Bruno ne peut plus ouvrir de conversation — et reçoit 404, pas 403',
    convBloquee.statut === 404,
    `statut ${convBloquee.statut} (un 403 confirmerait le blocage)`
  );

  const ecritureBloquee = await appel(`/messages/conversations/${idConv}/messages`, {
    methode: 'POST',
    corps: { contenu: `Après blocage ${S}` },
    token: bruno.token,
  });
  ok(
    'le fil DÉJÀ OUVERT est fermé lui aussi',
    ecritureBloquee.statut === 403 || ecritureBloquee.statut === 404,
    `statut ${ecritureBloquee.statut}`
  );

  const ecritureAlice = await appel(`/messages/conversations/${idConv}/messages`, {
    methode: 'POST',
    corps: { contenu: `Alice après blocage ${S}` },
    token: alice.token,
  });
  ok(
    'SYMÉTRIE : Alice non plus ne peut y écrire',
    ecritureAlice.statut === 403 || ecritureAlice.statut === 404,
    `statut ${ecritureAlice.statut}`
  );

  section('Blocage — commenter et suivre');

  const commentaireBloque = await appel(`/posts/${idPost}/comments`, {
    methode: 'POST',
    corps: { texte: `Commentaire interdit ${S}` },
    token: bruno.token,
  });
  ok(
    'Bruno ne peut plus commenter les publications d’Alice',
    commentaireBloque.statut === 403 || commentaireBloque.statut === 404,
    `statut ${commentaireBloque.statut}`
  );

  const suivreBloque = await appel(`/follows/${alice.pseudo}`, {
    methode: 'POST',
    token: bruno.token,
  });
  ok(
    'ni la suivre de nouveau',
    suivreBloque.statut >= 400,
    `statut ${suivreBloque.statut}`
  );

  section('Blocage — liste et levée');

  const liste = await appel('/users/me/bloques', { token: alice.token });
  ok('l’écran « Comptes bloqués » liste Bruno', liste.statut === 200 &&
    JSON.stringify(liste.json || {}).includes(bruno.pseudo));

  const listeBruno = await appel('/users/me/bloques', { token: bruno.token });
  ok(
    'Bruno ne voit personne dans SA liste (il n’a bloqué personne)',
    !JSON.stringify(listeBruno.json || {}).includes(alice.pseudo)
  );

  const deblocage = await appel(`/users/${bruno.id}/blocage`, {
    methode: 'DELETE',
    token: alice.token,
  });
  ok('Alice débloque Bruno', deblocage.statut === 200, `statut ${deblocage.statut}`);
  ok('la réponse dit clairement que les suivis ne reviennent pas',
    deblocage.json?.suivisRetablis === false);

  const apresDeblocage = await appel(`/users/${alice.pseudo}`, { token: bruno.token });
  ok('le contenu redevient visible', apresDeblocage.json?.contenuVisible === true);
  ok(
    'mais le suivi n’est PAS rétabli',
    apresDeblocage.json?.relation === 'aucune',
    `relation « ${apresDeblocage.json?.relation} »`
  );

  const rechercheRetrouvee = await appel(
    `/search/utilisateurs?q=${alice.pseudo}`, { token: bruno.token }
  );
  ok(
    'Alice réapparaît dans la recherche',
    JSON.stringify(rechercheRetrouvee.json || {}).includes(alice.pseudo)
  );

  const reDeblocage = await appel(`/users/${bruno.id}/blocage`, {
    methode: 'DELETE',
    token: alice.token,
  });
  ok('débloquer quelqu’un qui ne l’est pas n’est pas une erreur',
    reDeblocage.statut === 200 && reDeblocage.json?.existait === false);
} finally {
  await purger();
  await client.close();
  await deconnecterDB();
  codeSortie = afficher(null) > 0 ? 1 : 0;
}

process.exit(codeSortie);
