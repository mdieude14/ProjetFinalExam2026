/**
 * ===========================================================================
 *  ESCALADE FORCÉE DU PARCOURS « SUPPORT » (module 15)
 * ===========================================================================
 *
 *   npm run test:escalade
 *
 * CE QUE CETTE SUITE DÉFEND.
 *
 * Le widget propose deux entrées. « Contacter le support client » signifie
 * « je veux un humain », et cette demande ne doit JAMAIS pouvoir être refusée
 * par un classement automatique : un modèle qui lit « je n'arrive pas à
 * résilier » classera raisonnablement `usage`, répondra bien, et la personne
 * n'aura toujours pas parlé à quelqu'un.
 *
 *   - LE SERVICE DÉCIDE, PAS L'AGENT. La règle est écrite dans
 *     `support.service.js`, à côté de `intention === 'decision'`, et non dans
 *     une consigne de prompt — sans quoi le modèle pourrait l'activer comme la
 *     désactiver, et « réponds-moi sans escalader » suffirait à la contourner ;
 *   - L'IA RÉPOND QUAND MÊME. L'escalade n'annule pas la réponse : le dossier
 *     part à l'équipe ET la personne reçoit une première piste ;
 *   - `escaladeForcee` N'EST PAS ACCEPTÉ DU CORPS. Il est déduit de
 *     `parcours`. L'admettre permettrait de réclamer la trace « la personne a
 *     demandé l'équipe » sans avoir emprunté le parcours, donc une ligne
 *     fausse dans l'audit du back-office. C'est la vérification la plus
 *     importante du lot, et elle est marquée ;
 *   - DEUX ENVOIS IDENTIQUES FONT UN SEUL DOSSIER. Un double-clic ne doit pas
 *     faire répondre deux exploitants à la même personne ;
 *   - LE QUOTA REFUSE PROPREMENT. Cinq escalades par heure et par COMPTE.
 *
 * CE QUE CETTE SUITE NE PEUT PAS FAIRE, ET POURQUOI C'EST ASSUMÉ. Le quota est
 * NEUTRALISÉ en développement (`rateLimit.middleware.js`), et le serveur de dev
 * est celui que toutes les autres suites interrogent : le rallumer pour de bon
 * ferait tomber en 429 les centaines de connexions des trente-cinq suites. Le
 * limiteur est donc éprouvé DANS CE PROCESSUS, monté sur un Express minuscule,
 * avec le middleware RÉEL et `RATE_LIMIT_DEV=true`. Ce qui n'est pas prouvé
 * ainsi — que la route le monte bien, et APRÈS `protect` — l'est par une
 * lecture du fichier de routes, et c'est dit comme tel.
 *
 * AUCUN APPEL À UN MODÈLE DE LANGAGE : les dossiers sont déposés directement
 * sur l'API avec la clé d'agent, exactement comme n8n le fait. La suite ne
 * coûte rien en jetons.
 * ===========================================================================
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const API = 'http://localhost:5000/api';
const DOM = '@escaladetest.local';
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
  console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications réussies` +
    (interrompu ? `\nINTERROMPU : ${interrompu}` : ''));
  return echecs;
}

process.on('uncaughtException', async (e) => {
  afficher(e?.stack || e?.message || e); await purger().catch(() => {}); process.exit(1);
});
process.on('unhandledRejection', async (e) => {
  afficher(e?.message || e); await purger().catch(() => {}); process.exit(1);
});

async function appel(chemin, { methode = 'GET', corps, token, cleAgent } = {}) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (cleAgent) h['x-agent-key'] = cleAgent;
  if (corps) h['Content-Type'] = 'application/json';
  const r = await fetch(API + chemin, {
    method: methode, headers: h, body: corps ? JSON.stringify(corps) : undefined,
  });
  const t = await r.text();
  return { statut: r.status, json: (() => { try { return JSON.parse(t); } catch { return null; } })() };
}

/* ------------------------------ Base ------------------------------ */

const requireServeur = createRequire(new URL('../package.json', import.meta.url));
const { MongoClient, ObjectId } = requireServeur('mongodb');
const bcrypt = requireServeur('bcryptjs');
const express = requireServeur('express');

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const lireEnv = (cle) => {
  const ligne = env.split(/\r?\n/).find((l) => l.startsWith(`${cle}=`));
  return ligne ? ligne.slice(cle.length + 1).trim().replace(/^["']|["']$/g, '') : null;
};
const CLE_AGENT = lireEnv('SUPPORT_AGENT_KEY');

const clientMongo = new MongoClient(lireEnv('MONGO_URI'), { serverSelectionTimeoutMS: 8000 });
await clientMongo.connect();
const bdd = clientMongo.db();

async function purger() {
  const ids = (await bdd.collection('users')
    .find({ email: new RegExp(`${DOM.replace('.', '[.]')}$`) }, { projection: { _id: 1 } })
    .toArray()).map((u) => u._id);
  let dossiers = 0;
  if (ids.length > 0) {
    dossiers = (await bdd.collection('tickets').deleteMany({ auteur: { $in: ids } })).deletedCount;
    await bdd.collection('users').deleteMany({ _id: { $in: ids } });
  }
  return { dossiers, comptes: ids.length };
}

await purger();

/*
 * `type: 'utilisateur'` ET NON `'sportif'`. L'enum du modèle vaut
 * `['utilisateur', 'coach', 'admin']`, et `Ticket.roleAuteur` le recopie :
 * un compte créé en `'sportif'` fait échouer l'écriture du dossier en 400,
 * sur un message qui ne parle ni de parcours ni d'escalade. Le widget, lui,
 * affiche la présentation « sportif » pour tout ce qui n'est pas coach — deux
 * vocabulaires, et c'est l'enum qui tranche ici.
 */
const inscrire = async (pseudo, type = 'utilisateur') => {
  const { insertedId } = await bdd.collection('users').insertOne({
    type, nom: 'Escalade', prenom: 'Test', pseudo, email: `${pseudo}${DOM}`,
    password: bcrypt.hashSync(MDP, 12), isActive: true,
    createdAt: new Date(), updatedAt: new Date(),
  });
  const r = await appel('/auth/login', { methode: 'POST', corps: { identifiant: pseudo, password: MDP } });
  if (r.statut !== 200) throw new Error(`connexion ${pseudo} : ${r.statut}`);
  return { token: r.json.accessToken, id: insertedId, pseudo };
};

const alice = await inscrire(`escalalice${S}`);
const bob = await inscrire(`escalbob${S}`);
const admin = await inscrire(`escaladmin${S}`, 'admin');

/**
 * UN DÉPÔT TEL QUE n8n L'ENVOIE. La clé d'agent est présente par défaut :
 * sans elle, TOUT escalade (`parAgent: false`), et plus rien ne distinguerait
 * l'escalade forcée de l'escalade par défaut — la suite mesurerait alors le
 * contraire de ce qu'elle croit mesurer.
 */
const deposer = (sur = {}, { token = alice.token, cleAgent = CLE_AGENT } = {}) =>
  appel('/support/tickets', {
    methode: 'POST',
    token,
    cleAgent,
    corps: {
      question: 'Je n’arrive pas à résilier mon abonnement premium depuis mon compte.',
      origine: '/premium',
      intention: 'usage',
      reponse: 'La résiliation se fait depuis « Mon compte », onglet « Abonnements ».',
      ...sur,
    },
  });

/**
 * LE DOSSIER TEL QU'IL EST EN BASE, retrouvé par l'identifiant que la réponse
 * vient de rendre.
 *
 * PAR `_id` ET NON PAR LA RÉFÉRENCE. Une première version comparait la
 * référence recalculée à la main : elle prenait six signes en majuscules là où
 * `referenceDe` en prend HUIT en minuscules, et ne trouvait donc jamais rien.
 * Treize vérifications sont tombées sur ce seul écart — en annonçant un défaut
 * du code alors que le code allait bien. L'identifiant complet est dans la
 * réponse : s'en servir ne demande aucun calcul, donc ne peut pas se tromper.
 */
const dossierDe = async (reponse) => {
  const id = reponse.json?.ticket?._id;
  return id ? bdd.collection('tickets').findOne({ _id: new ObjectId(String(id)) }) : null;
};

/* ================================================================== *
 *  1 — LE PARCOURS « SUPPORT » ESCALADE TOUJOURS
 * ================================================================== */

section('Le parcours « support » escalade, quoi que dise le classifieur');

/*
 * LE CAS QUI JUSTIFIE TOUTE LA RÈGLE. `intention: 'usage'` est le classement
 * le plus banal qui soit, et celui qui AURAIT résolu le dossier sans escalade.
 */
const forcee = await deposer({ parcours: 'support', objet: 'Résiliation impossible' });
const dForcee = await dossierDe(forcee);

ok('**une demande au support client escalade, même classée « usage »**',
  forcee.statut === 201 && dForcee?.statut === 'escalade',
  `${forcee.statut} / statut ${dForcee?.statut}`);
ok('**et la trace dit que c’est la personne qui l’a demandée**',
  dForcee?.escaladeForcee === true, `escaladeForcee ${dForcee?.escaladeForcee}`);
ok('le motif ne parle pas de décision, mais de support client',
  dForcee?.motifEscalade === 'demande au support client', dForcee?.motifEscalade);
ok('**l’IA répond quand même** — l’escalade n’annule pas la réponse',
  typeof dForcee?.reponse === 'string' && dForcee.reponse.includes('Mon compte'));
ok('l’objet est enregistré dans son propre champ',
  dForcee?.objet === 'Résiliation impossible', dForcee?.objet);
ok('**et il n’est PAS collé à la question** — la borne des 2000 reste celle du message',
  dForcee?.question === 'Je n’arrive pas à résilier mon abonnement premium depuis mon compte.');
ok('le parcours est conservé pour le back-office',
  dForcee?.parcours === 'support', dForcee?.parcours);

/* Un motif plus précis venu de l'agent n'est pas écrasé par celui par défaut. */
const forceeDecision = await deposer({
  parcours: 'support', objet: 'Remboursement', question: 'Je veux être remboursé de mars.',
  intention: 'decision', motifEscalade: 'remboursement',
});
const dDecision = await dossierDe(forceeDecision);
ok('un motif donné par l’agent l’emporte sur le motif par défaut',
  dDecision?.motifEscalade === 'remboursement' && dDecision?.escaladeForcee === true,
  dDecision?.motifEscalade);

section('Les deux autres parcours ne changent rien');

const usage = await deposer({ parcours: 'usage', question: `Comment publier une story ? ${S}` });
const dUsage = await dossierDe(usage);
ok('**« question d’utilisation » n’escalade pas** — seul « decision » le fait',
  dUsage?.statut === 'resolu' && dUsage?.escaladeForcee === false,
  `statut ${dUsage?.statut}, forcee ${dUsage?.escaladeForcee}`);
ok('le parcours « usage » est tout de même tracé',
  dUsage?.parcours === 'usage', dUsage?.parcours);
ok('et aucun objet n’est retenu hors du parcours support',
  dUsage?.objet === undefined || dUsage?.objet === null, String(dUsage?.objet));

const sansChoix = await deposer({ parcours: null, objet: null, question: `Et les événements ? ${S}` });
const dSansChoix = await dossierDe(sansChoix);
ok('**aucun choix du tout est accepté** — rien n’a jamais été obligatoire',
  sansChoix.statut === 201 && dSansChoix?.statut === 'resolu', String(sansChoix.statut));
ok('et « rien choisi » ne s’enregistre pas comme un choix',
  dSansChoix?.parcours === undefined || dSansChoix?.parcours === null);

section('Ce que le corps de la requête ne peut PAS obtenir');

/*
 * LA VÉRIFICATION LA PLUS IMPORTANTE DE LA SUITE. `escaladeForcee` est la
 * ligne que lit l'exploitant pour savoir QUI a demandé l'escalade. Si le corps
 * pouvait la poser, cette ligne ne voudrait plus rien dire.
 */
const triche = await deposer({
  parcours: 'usage', escaladeForcee: true, question: `Triche ${S} : je pose la trace moi-même.`,
});
const dTriche = await dossierDe(triche);
ok('**`escaladeForcee` envoyé dans le corps est IGNORÉ**',
  dTriche?.escaladeForcee === false, `escaladeForcee ${dTriche?.escaladeForcee}`);
ok('**et il n’escalade rien** — le statut reste celui que le classement a décidé',
  dTriche?.statut === 'resolu', dTriche?.statut);

const parcoursInvente = await deposer({ parcours: 'urgence', question: `Invente ${S}` });
ok('un parcours inventé est refusé, pas accepté en silence',
  parcoursInvente.statut === 400, String(parcoursInvente.statut));

const objetTropLong = await deposer({ parcours: 'support', objet: 'o'.repeat(121) });
ok('un objet de plus de 120 signes est refusé',
  objetTropLong.statut === 400, String(objetTropLong.statut));

/* ================================================================== *
 *  2 — DEUX ENVOIS IDENTIQUES FONT UN SEUL DOSSIER
 * ================================================================== */

section('L’anti-doublon : un double-clic ne crée pas deux dossiers');

const jumeau = { parcours: 'support', objet: `Doublon ${S}`, question: `Même message exactement ${S}.` };
const premier = await deposer(jumeau);
const second = await deposer(jumeau);

ok('**le second envoi identique ne crée rien** — 200 et non 201',
  premier.statut === 201 && second.statut === 200,
  `${premier.statut} puis ${second.statut}`);
ok('**et il renvoie la référence du dossier qui existe déjà**',
  premier.json?.ticket?.reference === second.json?.ticket?.reference,
  `${premier.json?.ticket?.reference} / ${second.json?.ticket?.reference}`);

const compteJumeaux = await bdd.collection('tickets')
  .countDocuments({ auteur: alice.id, objet: jumeau.objet });
ok('un seul dossier en base pour les deux envois', compteJumeaux === 1, `${compteJumeaux} dossier(s)`);

/* Ce qui DIFFÈRE doit créer son dossier : l'anti-doublon ne doit rien avaler. */
const autreObjet = await deposer({ ...jumeau, objet: `Doublon ${S} bis` });
ok('un objet différent crée bien son dossier', autreObjet.statut === 201, String(autreObjet.statut));

const autreMessage = await deposer({ ...jumeau, question: `Message différent ${S}.` });
ok('un message différent crée bien son dossier', autreMessage.statut === 201, String(autreMessage.statut));

const chezBob = await deposer(jumeau, { token: bob.token });
ok('**et le même envoi d’un AUTRE compte n’est pas un doublon**',
  chezBob.statut === 201, String(chezBob.statut));

const horsSupport = { parcours: 'usage', question: `Question répétée ${S} ?` };
await deposer(horsSupport);
await deposer(horsSupport);
const compteUsage = await bdd.collection('tickets')
  .countDocuments({ auteur: alice.id, question: horsSupport.question });
ok('**hors escalade forcée, rien n’est dédoublonné** — deux questions sont deux échanges',
  compteUsage === 2, `${compteUsage} dossier(s)`);

/* ================================================================== *
 *  3 — LE QUOTA D'ESCALADES
 * ================================================================== */

section('Le quota : cinq escalades par heure et par compte');

/*
 * MONTÉ ICI, SUR LE MIDDLEWARE RÉEL. Voir l'en-tête de ce fichier : le quota
 * est neutralisé sur le serveur de dev, et le rallumer là-bas ferait tomber
 * les trente-cinq autres suites en 429.
 */
process.env.RATE_LIMIT_DEV = 'true';
const { limiteurEscaladeSupport, MAX_ESCALADES_PAR_HEURE } =
  await import('../src/middlewares/rateLimit.middleware.js');

const appTest = express();
appTest.use(express.json());
/* `protect` pose `req.user` ; on l'imite, puisque c'est le limiteur qu'on mesure. */
appTest.use((req, _res, suite) => { req.user = { _id: req.get('x-compte') }; suite(); });
appTest.post('/t', limiteurEscaladeSupport, (_req, res) => res.status(201).json({ succes: true }));

const serveurTest = appTest.listen(0);
await new Promise((r) => serveurTest.once('listening', r));
const PORT = serveurTest.address().port;

const frapper = async (compte, parcours) => {
  const r = await fetch(`http://localhost:${PORT}/t`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-compte': compte },
    body: JSON.stringify({ parcours }),
  });
  return { statut: r.status, json: await r.json().catch(() => null) };
};

const six = [];
for (let i = 0; i < 6; i += 1) six.push(await frapper('compteA', 'support'));

ok(`les ${MAX_ESCALADES_PAR_HEURE} premières escalades passent`,
  six.slice(0, 5).every((r) => r.statut === 201),
  six.slice(0, 5).map((r) => r.statut).join(' '));
ok('**la sixième de l’heure est refusée, proprement**',
  six[5].statut === 429, String(six[5].statut));
ok('**et le refus explique le quota au lieu d’annoncer une panne**',
  /support/i.test(six[5].json?.message ?? '') && /enregistr/i.test(six[5].json?.message ?? ''),
  six[5].json?.message);

const chezUnAutreCompte = await frapper('compteB', 'support');
ok('**le quota est par COMPTE, pas par adresse** — sinon n8n les compterait tous ensemble',
  chezUnAutreCompte.statut === 201, String(chezUnAutreCompte.statut));

const questionsOrdinaires = [];
for (let i = 0; i < 8; i += 1) questionsOrdinaires.push(await frapper('compteA', 'usage'));
ok('**les questions ordinaires ne sont pas comptées** — le même compte en passe huit après son refus',
  questionsOrdinaires.every((r) => r.statut === 201),
  questionsOrdinaires.map((r) => r.statut).join(' '));

delete process.env.RATE_LIMIT_DEV;
const neutralise = [];
for (let i = 0; i < 7; i += 1) neutralise.push(await frapper('compteC', 'support'));
ok('sans `RATE_LIMIT_DEV`, le quota est neutralisé en développement comme les autres',
  neutralise.every((r) => r.statut === 201),
  neutralise.map((r) => r.statut).join(' '));

serveurTest.close();

section('Le câblage du limiteur sur la vraie route (lecture du fichier)');

/*
 * UNE LECTURE DE SOURCE, ET C'EST DIT. Le quota étant neutralisé sur le
 * serveur de dev, aucune requête ne peut prouver que la route le monte : un
 * middleware qui `skip` ne laisse aucune trace, pas même un en-tête. Ce
 * contrôle vaut donc ce que vaut une lecture — mais il tombe le jour où
 * quelqu'un retire le limiteur de la route, et c'est exactement son rôle.
 */
const routes = readFileSync(new URL('../src/routes/support.routes.js', import.meta.url), 'utf8');
const bloc = routes.slice(routes.indexOf("router.post(\n  '/tickets'"), routes.indexOf('creerTicket\n);') + 14);

ok('la route des tickets monte bien le limiteur', bloc.includes('limiteurEscaladeSupport'));
ok('**et elle le monte APRÈS `protect`** — avant, sa clé serait `undefined` pour tout le monde',
  bloc.indexOf('protect') < bloc.indexOf('limiteurEscaladeSupport')
    && bloc.indexOf('protect') !== -1);
ok('le limiteur passe avant le validateur, car il ne lit que `parcours`',
  bloc.indexOf('limiteurEscaladeSupport') < bloc.indexOf('reglesCreationTicket'));

/* ================================================================== *
 *  4 — CE QUE VOIT L'EXPLOITANT
 * ================================================================== */

section('Le back-office distingue une escalade demandée d’une escalade décidée');

const file = await appel('/admin/support/tickets?statut=escalade&limite=50', { token: admin.token });
const vue = (file.json?.elements ?? file.json?.data ?? [])
  .find((t) => t.reference === forcee.json.ticket.reference);

ok('la file de l’exploitant est lisible', file.statut === 200, String(file.statut));
ok('**le dossier y porte son parcours, son objet et son escalade forcée**',
  vue?.parcours === 'support' && vue?.objet === 'Résiliation impossible' && vue?.escaladeForcee === true,
  vue ? `parcours ${vue.parcours}, objet ${vue.objet}, forcee ${vue.escaladeForcee}` : 'dossier absent de la file');

/* ------------------------------ Fin ------------------------------- */

const menage = await purger();
const echecs = afficher();
console.log(`\n  (${menage.dossiers} dossier(s) et ${menage.comptes} compte(s) de test supprimés)`);
await clientMongo.close();
process.exit(echecs > 0 ? 1 : 0);
