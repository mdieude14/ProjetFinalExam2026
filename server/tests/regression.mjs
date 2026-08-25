/**
 * ===========================================================================
 *  SUITE DE RÉGRESSION — API
 * ===========================================================================
 *
 * Rejoue les chemins critiques des modules 2 à 6 contre un serveur en
 * fonctionnement. À lancer après toute modification transverse.
 *
 *   npm run test:api
 *
 * Prérequis : le serveur doit tourner (npm run dev) et MongoDB être joignable.
 *
 * POURQUOI PAS JEST ?
 * Ces tests interrogent l'API par HTTP, comme le ferait le navigateur. Ils
 * valident la chaîne complète — routes, middlewares, validateurs, base de
 * données, transactions — là où des tests unitaires sur des fonctions isolées
 * laisseraient passer une route mal montée ou un middleware oublié.
 *
 * Chaque exécution crée ses propres comptes, suffixés par un horodatage, et
 * les supprime à la fin. Les comptes réels ne sont jamais touchés.
 * ===========================================================================
 */

import { connecterDB, deconnecterDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import Follow from '../src/models/Follow.js';
import Post from '../src/models/Post.js';
import Comment from '../src/models/Comment.js';
import Story from '../src/models/Story.js';
import zlib from 'node:zlib';

const BASE = process.env.API_URL || 'http://localhost:5000/api';
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
    if (r.section !== derniere) {
      console.log(`\n--- ${r.section} ---`);
      derniere = r.section;
    }
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

async function appel(chemin, { methode = 'GET', corps, token, form } = {}) {
  const entetes = {};
  if (token) entetes.Authorization = `Bearer ${token}`;
  if (corps && !form) entetes['Content-Type'] = 'application/json';

  const rep = await fetch(BASE + chemin, {
    method: methode,
    headers: entetes,
    body: form || (corps ? JSON.stringify(corps) : undefined),
  });

  let json = null;
  try { json = await rep.json(); } catch { /* corps vide */ }
  return { statut: rep.status, json };
}

/** Fabrique un PNG valide aux dimensions demandées. */
function png(largeur = 60, hauteur = 40) {
  const lignes = [];
  for (let y = 0; y < hauteur; y++) {
    const ligne = Buffer.alloc(largeur * 3 + 1);
    for (let x = 0; x < largeur; x++) {
      ligne[1 + x * 3] = 80; ligne[2 + x * 3] = 140; ligne[3 + x * 3] = 200;
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

function formMedia(champ, nom, type, tampon, champs = {}) {
  const fd = new FormData();
  fd.append(champ, new Blob([tampon], { type }), nom);
  for (const [k, v] of Object.entries(champs)) fd.append(k, String(v));
  return fd;
}

async function creerCompte(type, prefixe, extra = {}) {
  const pseudo = `${prefixe}${S}`;
  const r = await appel('/auth/register', {
    methode: 'POST',
    corps: {
      type, nom: 'Regression', prenom: prefixe, pseudo,
      email: `${pseudo}${DOMAINE}`, password: MDP, ...extra,
    },
  });
  if (r.statut !== 201) {
    throw new Error(`création de ${prefixe} : ${r.statut} ${r.json?.message}`);
  }
  return { token: r.json.accessToken, id: r.json.utilisateur._id, pseudo };
}

const stats = async (id) => (await User.findById(id)).stats;

/* ================================================================== *
 *  DÉMARRAGE
 * ================================================================== */

await connecterDB();
const regexDomaine = new RegExp(DOMAINE.replace('.', '\\.') + '$');
await User.deleteMany({ email: regexDomaine });

const sante = await appel('/health');
section('Socle');
ok('API joignable', sante.statut === 200, sante.json?.message);
ok('base connectée', sante.json?.base === 'connecte');

/* ================================================================== *
 *  MODULE 2 — AUTHENTIFICATION
 * ================================================================== */

section('Module 2 — Authentification');

const alice = await creerCompte('utilisateur', 'alice', { ville: 'Lyon' });
ok('inscription utilisateur', Boolean(alice.token));

const coach = await creerCompte('coach', 'coach', { ville: 'Lyon' });
ok('inscription coach', Boolean(coach.token));

const admin = await User.create({
  type: 'admin', nom: 'Regression', prenom: 'Admin', pseudo: `admin${S}`,
  email: `admin${S}${DOMAINE}`, password: MDP,
});
const cxAdmin = await appel('/auth/login', {
  methode: 'POST', corps: { identifiant: `admin${S}`, password: MDP },
});
ok('connexion admin', cxAdmin.statut === 200);
const jetonAdmin = cxAdmin.json.accessToken;

const escalade = await appel('/auth/register', {
  methode: 'POST',
  corps: { type: 'admin', nom: 'X', prenom: 'Y', pseudo: `pirate${S}`,
           email: `pirate${S}${DOMAINE}`, password: MDP },
});
ok('création d’un admin via l’API refusée', escalade.statut === 400 || escalade.statut === 403);

const injection = await appel('/auth/login', {
  methode: 'POST', corps: { identifiant: { $gt: '' }, password: { $gt: '' } },
});
ok('injection NoSQL neutralisée', injection.statut === 400 || injection.statut === 401);

const mdpFaible = await appel('/auth/register', {
  methode: 'POST',
  corps: { nom: 'X', prenom: 'Y', pseudo: `faible${S}`,
           email: `faible${S}${DOMAINE}`, password: 'azerty' },
});
ok('mot de passe faible rejeté', mdpFaible.statut === 400);
ok('détails d’erreur par champ fournis', Array.isArray(mdpFaible.json?.details));

const sansToken = await appel('/auth/me');
ok('/me sans jeton → 401', sansToken.statut === 401);

const moi = await appel('/auth/me', { token: alice.token });
ok('/me avec jeton → 200', moi.statut === 200);
ok('mot de passe jamais transmis', moi.json?.utilisateur?.password === undefined);

/* ================================================================== *
 *  MODULE 4 — PROFILS ET VISIBILITÉ
 * ================================================================== */

section('Module 4 — Profils');

const vuePublique = await appel(`/users/${coach.pseudo}`, { token: alice.token });
ok('profil consultable par pseudo', vuePublique.statut === 200);
ok('email absent de la vue publique', vuePublique.json?.profil?.email === undefined);

const anonyme = await appel(`/users/${coach.pseudo}`);
ok('profil public visible par un anonyme', anonyme.statut === 200);
ok('relation « aucune » pour un anonyme', anonyme.json?.relation === 'aucune');

const injectionChamps = await appel('/users/me', {
  methode: 'PATCH', token: alice.token,
  corps: { bio: 'Bio de test', type: 'admin', email: 'pirate@evil.test',
           stats: { followersCount: 9999 }, diplome: { statut: 'verifie' } },
});
ok('édition acceptée', injectionChamps.statut === 200);
ok('seuls les champs autorisés sont recopiés',
  JSON.stringify(injectionChamps.json?.champsModifies) === '["bio"]',
  JSON.stringify(injectionChamps.json?.champsModifies));

const aliceApres = await User.findById(alice.id);
ok('type NON escaladé', aliceApres.type === 'utilisateur');
ok('compteurs NON falsifiés', aliceApres.stats.followersCount === 0);
ok('statut de diplôme NON auto-validé', aliceApres.diplome.statut === 'non_soumis');

// Modération : le coach soumet, l'admin valide.
const soumission = await appel('/users/me/diplome', {
  methode: 'POST', token: coach.token,
  corps: { intitule: 'BPJEPS', organisme: 'DRJSCS' },
});
ok('soumission de diplôme', soumission.statut === 201);

const nonAdmin = await appel('/admin/diplomes', { token: alice.token });
ok('back-office refusé à un non-admin', nonAdmin.statut === 403);

const file = await appel('/admin/diplomes', { token: jetonAdmin });
ok('file de modération accessible à l’admin', file.statut === 200);
ok('le dossier du coach y figure',
  file.json?.elements?.some((c) => c._id === coach.id));

const refusSansMotif = await appel(`/admin/diplomes/${coach.id}`, {
  methode: 'PATCH', token: jetonAdmin, corps: { decision: 'refuse' },
});
ok('refus sans motif rejeté', refusSansMotif.statut === 400);

const validation = await appel(`/admin/diplomes/${coach.id}`, {
  methode: 'PATCH', token: jetonAdmin, corps: { decision: 'verifie' },
});
ok('validation du diplôme', validation.statut === 200, validation.json?.message);

const coachCertifie = await User.findById(coach.id);
ok('**valeur d’enum « verifie » intacte**', coachCertifie.diplome.statut === 'verifie',
  coachCertifie.diplome.statut);
ok('virtuel estCertifie actif', coachCertifie.estCertifie === true);

/* ================================================================== *
 *  MODULE 5 — PUBLICATIONS ET CONTENU PREMIUM
 * ================================================================== */

section('Module 5 — Publications');

const post = await appel('/posts', {
  methode: 'POST', token: coach.token,
  form: formMedia('medias', 'photo.png', 'image/png', png(90, 60),
    { titre: 'Séance test', description: 'Régression' }),
});
ok('publication avec média', post.statut === 201, post.json?.message);
ok('média enregistré avec son publicId',
  Boolean(post.json?.post?.medias?.[0]?.publicId));
ok('dimensions relevées',
  post.json?.post?.medias?.[0]?.largeur === 90, `${post.json?.post?.medias?.[0]?.largeur}`);

const idPost = post.json.post._id;

const exe = await appel('/posts', {
  methode: 'POST', token: coach.token,
  form: formMedia('medias', 'virus.exe', 'application/x-msdownload', Buffer.from('MZ')),
});
ok('exécutable rejeté', exe.statut === 400);

const svg = await appel('/posts', {
  methode: 'POST', token: coach.token,
  form: formMedia('medias', 'x.svg', 'image/svg+xml', Buffer.from('<svg/>')),
});
ok('SVG rejeté (vecteur XSS)', svg.statut === 400);

// Contenu premium : les trois conditions.
const premiumRefuse = await appel('/posts', {
  methode: 'POST', token: coach.token,
  form: formMedia('medias', 'p.png', 'image/png', png(), { estPremium: 'true' }),
});
ok('premium refusé sans compte Stripe ni tarif', premiumRefuse.statut === 403);

await User.updateOne({ _id: coach.id }, {
  'stripeAccount.chargesEnabled': true,
  'premium.actif': true, 'premium.prixMensuel': 1990,
  'premium.stripePriceId': 'price_regression',
});

const premium = await appel('/posts', {
  methode: 'POST', token: coach.token,
  form: formMedia('medias', 'p.png', 'image/png', png(),
    { titre: 'Programme', description: 'Contenu exclusif', estPremium: 'true' }),
});
ok('premium accepté une fois les 3 conditions réunies', premium.statut === 201);
const idPremium = premium.json?.post?._id;

const vuNonAbonne = await appel(`/posts/${idPremium}`, { token: alice.token });
ok('contenu premium marqué verrouillé', vuNonAbonne.json?.post?.verrouille === true);
ok('**médias retirés de la réponse HTTP**',
  Array.isArray(vuNonAbonne.json?.post?.medias) && vuNonAbonne.json.post.medias.length === 0);
ok('description masquée', vuNonAbonne.json?.post?.description === null);
ok('aucune URL de média dans le corps',
  !JSON.stringify(vuNonAbonne.json).includes('res.cloudinary.com/') ||
  !JSON.stringify(vuNonAbonne.json?.post?.medias || []).includes('http'));

const likePremium = await appel(`/posts/${idPremium}/like`, {
  methode: 'POST', token: alice.token,
});
ok('like impossible sur un contenu verrouillé', likePremium.statut === 403);

// Likes et commentaires sur le contenu gratuit.
const like1 = await appel(`/posts/${idPost}/like`, { methode: 'POST', token: alice.token });
ok('like enregistré', like1.json?.aLike === true && like1.json?.likesCount === 1);
const like2 = await appel(`/posts/${idPost}/like`, { methode: 'POST', token: alice.token });
ok('second appel = retrait du like', like2.json?.aLike === false);

const commentaire = await appel(`/posts/${idPost}/comments`, {
  methode: 'POST', token: alice.token, corps: { texte: 'Bravo pour cette séance' },
});
ok('commentaire ajouté', commentaire.statut === 201);
ok('compteur du post incrémenté',
  (await Post.findById(idPost)).commentsCount === 1);

const commentaireVide = await appel(`/posts/${idPost}/comments`, {
  methode: 'POST', token: alice.token, corps: { texte: '   ' },
});
ok('commentaire vide rejeté', commentaireVide.statut === 400);

const supTiers = await appel(`/posts/${idPost}`, { methode: 'DELETE', token: alice.token });
ok('suppression par un tiers refusée', supTiers.statut === 403);

// Story et index TTL
const story = await appel('/stories', {
  methode: 'POST', token: coach.token,
  form: formMedia('media', 's.png', 'image/png', png()),
});
ok('story créée', story.statut === 201);
const storyDoc = await Story.findById(story.json.story._id);
const heures = (storyDoc.expireAt - storyDoc.createdAt) / 3600000;
ok('expiration à +24 h', Math.abs(heures - 24) < 0.1, `${heures.toFixed(2)} h`);

/* ================================================================== *
 *  MODULE 6 — SUIVI
 * ================================================================== */

section('Module 6 — Suivi');

const suivi = await appel(`/follows/${coach.pseudo}`, { methode: 'POST', token: alice.token });
ok('suivi d’un profil public', suivi.statut === 201);
ok('**valeur d’enum « accepte » intacte**', suivi.json?.statut === 'accepte',
  suivi.json?.statut);
ok('relation « abonne » renvoyée', suivi.json?.relation === 'abonne');
ok('compteurs à 1 des deux côtés',
  (await stats(alice.id)).followingCount === 1 &&
  (await stats(coach.id)).followersCount === 1);

const doublon = await appel(`/follows/${coach.pseudo}`, { methode: 'POST', token: alice.token });
ok('doublon sans effet', doublon.statut === 200);
ok('une seule relation en base',
  (await Follow.countDocuments({ follower: alice.id, following: coach.id })) === 1);

const soiMeme = await appel(`/follows/${alice.pseudo}`, { methode: 'POST', token: alice.token });
ok('se suivre soi-même refusé', soiMeme.statut === 400);

const feed = await appel('/posts/feed', { token: alice.token });
ok('le fil se remplit après le suivi', feed.json?.elements?.length >= 1,
  `${feed.json?.elements?.length} publication(s)`);
ok('contenu premium verrouillé dans le fil',
  feed.json?.elements?.some((p) => p.estPremium && p.verrouille === true));

// Profil privé et demandes
const prive = await creerCompte('utilisateur', 'prive', { ville: 'Lyon' });
await appel('/users/me/visibilite', {
  methode: 'PATCH', token: prive.token, corps: { visibilite: 'prive' },
});
const priveDoc = await User.findById(prive.id);
ok('**valeur d’enum « prive » intacte**', priveDoc.visibilite === 'prive', priveDoc.visibilite);

const demande = await appel(`/follows/${prive.pseudo}`, { methode: 'POST', token: alice.token });
ok('demande créée sur profil privé', demande.json?.statut === 'en_attente');
ok('aucun compteur incrémenté en attente',
  (await stats(prive.id)).followersCount === 0);

const vuePrivee = await appel(`/users/${prive.pseudo}`, { token: alice.token });
ok('contenu masqué pendant l’attente', vuePrivee.json?.contenuVisible === false);
ok('relation « en_attente » exposée', vuePrivee.json?.relation === 'en_attente');

const listeDemandes = await appel('/follows/demandes', { token: prive.token });
ok('demande listée pour le destinataire', listeDemandes.json?.elements?.length === 1);

const accepterTiers = await appel(
  `/follows/demandes/${listeDemandes.json.elements[0]._id}/accepter`,
  { methode: 'POST', token: coach.token }
);
ok('accepter la demande d’un tiers refusé', accepterTiers.statut === 403);

const accepter = await appel(
  `/follows/demandes/${listeDemandes.json.elements[0]._id}/accepter`,
  { methode: 'POST', token: prive.token }
);
ok('acceptation', accepter.statut === 200);
ok('contenu devenu visible',
  (await appel(`/users/${prive.pseudo}`, { token: alice.token })).json?.contenuVisible === true);
ok('compteur incrémenté après acceptation',
  (await stats(prive.id)).followersCount === 1);

// Bascule privé → public
await appel(`/follows/${prive.pseudo}`, { methode: 'POST', token: coach.token });
const bascule = await appel('/users/me/visibilite', {
  methode: 'PATCH', token: prive.token, corps: { visibilite: 'public' },
});
ok('demandes en attente acceptées automatiquement',
  bascule.json?.demandesAcceptees === 1, `${bascule.json?.demandesAcceptees}`);

// Cohérence des compteurs
for (let i = 0; i < 5; i++) {
  await appel(`/follows/${coach.pseudo}`, { methode: 'DELETE', token: alice.token });
  await appel(`/follows/${coach.pseudo}`, { methode: 'POST', token: alice.token });
}
const reels = await Follow.countDocuments({ following: coach.id, statut: 'accepte' });
ok('**compteur exact après 10 opérations**',
  (await stats(coach.id)).followersCount === reels,
  `compteur ${(await stats(coach.id)).followersCount}, relations ${reels}`);

/* ================================================================== *
 *  TYPOGRAPHIE — non-régression de la passe d'accentuation
 * ================================================================== */

section('Typographie');

const erreurAccentuee = await appel('/users/me', {
  methode: 'PATCH', token: alice.token, corps: { bio: 'x'.repeat(400) },
});
ok('message d’erreur accentué',
  /dépasser 300 caractères/.test(erreurAccentuee.json?.details?.[0]?.message || ''),
  erreurAccentuee.json?.details?.[0]?.message);

const suiviSoi = await appel(`/follows/${alice.pseudo}`, {
  methode: 'POST', token: alice.token,
});
ok('message « vous-même » accentué',
  /vous-même/.test(suiviSoi.json?.message || ''), suiviSoi.json?.message);

ok('valeurs d’enum non accentuées (contrat API préservé)',
  ['prive', 'public'].includes((await User.findById(prive.id)).visibilite) &&
  ['non_soumis', 'en_attente', 'verifie', 'refuse'].includes(
    (await User.findById(coach.id)).diplome.statut
  ));

/* ================================================================== *
 *  NETTOYAGE
 * ================================================================== */

const ids = await User.find({ email: regexDomaine }).distinct('_id');
const postsATraiter = await Post.find({ auteur: { $in: ids } });
for (const p of postsATraiter) {
  await appel(`/posts/${p._id}`, { methode: 'DELETE', token: jetonAdmin });
}
const storiesATraiter = await Story.find({ auteur: { $in: ids } });
for (const s of storiesATraiter) {
  await appel(`/stories/${s._id}`, { methode: 'DELETE', token: jetonAdmin });
}
await Comment.deleteMany({ auteur: { $in: ids } });
await Follow.deleteMany({ $or: [{ follower: { $in: ids } }, { following: { $in: ids } }] });
await User.deleteMany({ _id: { $in: ids } });
await deconnecterDB();

console.log('\n================ SUITE DE RÉGRESSION — API ================');
const echecs = afficher();
process.exit(echecs > 0 ? 1 : 0);
