/**
 * ===========================================================================
 *  SUPPORT AUTOMATISÉ — module 15
 * ===========================================================================
 *
 *   npm run test:support
 *
 * CE QUE CETTE SUITE DÉFEND.
 *
 * Le module introduit une nouveauté dans le projet : un appelant qui n'est
 * PAS un utilisateur. L'orchestrateur n8n se présente avec une clé de
 * service, et la question qui décide de tout est : jusqu'où cette clé va-t-elle ?
 *
 * La réponse doit être « deux routes, pas une de plus ». La tentation était
 * de donner à n8n un jeton d'administrateur pour lui faire relever la file ;
 * cela lui aurait ouvert du même coup la VÉRIFICATION DES DIPLÔMES — donc le
 * droit de décider qui peut vendre — et la DÉSACTIVATION DES COMPTES.
 *
 * Les vérifications marquées en gras sont celles qui échoueraient si
 * quelqu'un élargissait la portée de cette clé sans y penser. Ce sont les
 * plus importantes de la suite : elles ne prouvent pas qu'une fonction
 * marche, elles prouvent qu'une porte reste fermée.
 * ===========================================================================
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const API = 'http://localhost:5000/api';
const DOM = '@supporttest.local';
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

/**
 * Appel HTTP. `cleService` ajoute l'en-tête de relève ; `cleAgent` celui qui
 * authentifie ce que l'agent écrit — il s'AJOUTE au jeton, il ne le remplace pas.
 */
async function appel(chemin, { methode = 'GET', corps, token, cleService, cleAgent } = {}) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (cleService) h['x-service-key'] = cleService;
  if (cleAgent) h['x-agent-key'] = cleAgent;
  if (corps) h['Content-Type'] = 'application/json';

  const r = await fetch(API + chemin, {
    method: methode,
    headers: h,
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const t = await r.text();
  return { statut: r.status, texte: t, json: (() => { try { return JSON.parse(t); } catch { return null; } })() };
}

/* ------------------------------ Base ------------------------------ */

const requireServeur = createRequire(new URL('../package.json', import.meta.url));
const { MongoClient } = requireServeur('mongodb');

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const lireEnv = (cle) => {
  const ligne = env.split(/\r?\n/).find((l) => l.startsWith(`${cle}=`));
  return ligne ? ligne.slice(cle.length + 1).trim().replace(/^["']|["']$/g, '') : null;
};

const CLE_SERVICE = lireEnv('SUPPORT_SERVICE_KEY');
if (!CLE_SERVICE) {
  console.error('SUPPORT_SERVICE_KEY absente de server/.env — la suite ne peut pas s’exécuter.');
  process.exit(1);
}

const CLE_AGENT = lireEnv('SUPPORT_AGENT_KEY');
if (!CLE_AGENT) {
  console.error('SUPPORT_AGENT_KEY absente de server/.env — la suite ne peut pas s’exécuter.');
  process.exit(1);
}

const clientMongo = new MongoClient(lireEnv('MONGO_URI'), { serverSelectionTimeoutMS: 8000 });
await clientMongo.connect();
const bdd = clientMongo.db();

const motifTest = /@supporttest[.]local$/;

async function purger() {
  const comptes = await bdd.collection('users')
    .find({ email: motifTest }, { projection: { _id: 1 } }).toArray();
  const ids = comptes.map((u) => u._id);
  if (ids.length === 0) return 0;
  await bdd.collection('tickets').deleteMany({ auteur: { $in: ids } });
  await bdd.collection('users').deleteMany({ _id: { $in: ids } });
  return ids.length;
}

await purger();

/* --------------------------- Jeu de comptes --------------------------- */

const inscrire = async (pseudo, prenom, type = 'utilisateur') => {
  const r = await appel('/auth/register', {
    methode: 'POST',
    corps: { type, prenom, nom: 'Support', pseudo, ville: 'Lyon',
             email: `${pseudo}${DOM}`, password: MDP },
  });
  if (r.statut !== 201) throw new Error(`${pseudo} : ${r.statut} ${r.texte.slice(0, 160)}`);
  return { token: r.json.accessToken, id: r.json.utilisateur._id, pseudo };
};

const alice = await inscrire(`alice${S}`, 'Alice');
const bruno = await inscrire(`bruno${S}`, 'Bruno');

/* ================================================================== *
 *  1 — ZONE UTILISATEUR
 * ================================================================== */

section('Création d’un ticket');

// Le parcours normal : n8n écrit AVEC le jeton d'Alice ET la clé d'agent.
const cree = await appel('/support/tickets', {
  methode: 'POST',
  token: alice.token,
  cleAgent: CLE_AGENT,
  corps: {
    question: 'Comment faire vérifier mon diplôme ?',
    origine: '/profil/diplome',
    intention: 'usage',
    reponse: 'Déposez votre justificatif depuis l’écran « Mon diplôme ».',
    outils: [{ outil: 'GET /users/me', statut: 200, dureeMs: 42 }],
  },
});
ok('ticket créé', cree.statut === 201, `statut ${cree.statut}`);
ok('il est rendu résolu, pas escaladé', cree.json?.ticket?.statut === 'resolu',
  cree.json?.ticket?.statut);

const idTicket = cree.json?.ticket?._id;

const enBase = await bdd.collection('tickets').findOne({
  _id: new (requireServeur('mongodb').ObjectId)(String(idTicket)),
});
ok('**l’auteur vient du jeton, pas du corps**',
  String(enBase?.auteur) === String(alice.id), 'auteur = Alice');
ok('le rôle est enregistré', enBase?.roleAuteur === 'utilisateur', enBase?.roleAuteur);
ok('l’outil appelé est tracé', enBase?.outils?.[0]?.outil === 'GET /users/me');

/*
 * ON N'ENREGISTRE PAS CE QUE L'OUTIL A RENVOYÉ. Recopier la réponse de
 * `/users/me` dupliquerait une donnée personnelle hors des quatre vues de
 * sérialisation qui la protègent, et créerait une seconde source de vérité.
 */
ok('**mais pas ce qu’il a renvoyé**',
  enBase?.outils?.[0]?.reponse === undefined && enBase?.outils?.[0]?.contenu === undefined);

section('Escalade décidée par le serveur');

const escalade = await appel('/support/tickets', {
  methode: 'POST',
  token: alice.token,
  cleAgent: CLE_AGENT,
  corps: {
    question: 'Je veux être remboursé de mon abonnement.',
    intention: 'decision',
    reponse: 'Je transmets votre demande.',
  },
});
/*
 * L'AGENT N'A RIEN DEMANDÉ ICI : pas de `motifEscalade` dans le corps. Un
 * modèle de langage peut se laisser convaincre de ne pas escalader ; c'est
 * le service qui tranche, pas lui.
 */
ok('**une intention « decision » escalade, même sans que l’agent le demande**',
  escalade.json?.ticket?.statut === 'escalade', escalade.json?.ticket?.statut);

const idEscalade = escalade.json?.ticket?._id;

section('Cloisonnement entre utilisateurs');

const mesTickets = await appel('/support/tickets', { token: alice.token });
ok('Alice voit ses deux tickets', mesTickets.json?.elements?.length === 2,
  `${mesTickets.json?.elements?.length} ticket(s)`);

const brunoListe = await appel('/support/tickets', { token: bruno.token });
ok('Bruno n’en voit aucun', brunoListe.json?.elements?.length === 0,
  `${brunoListe.json?.elements?.length} ticket(s)`);

const vol = await appel(`/support/tickets/${idTicket}`, { token: bruno.token });
/*
 * 404 ET NON 403. Un 403 dirait « il existe, mais il n'est pas à vous » et
 * confirmerait donc son existence — même raisonnement qu'au module 9 pour
 * les ressources nominatives.
 */
ok('**le ticket d’Alice est introuvable pour Bruno — 404, pas 403**',
  vol.statut === 404, `statut ${vol.statut}`);

const anonyme = await appel('/support/tickets', { methode: 'POST', corps: { question: 'test' } });
ok('un visiteur anonyme ne peut pas créer de ticket', anonyme.statut === 401,
  `statut ${anonyme.statut}`);

/* ================================================================== *
 *  2 — ZONE SERVICE : LA CLÉ, ET SA PORTÉE
 * ================================================================== */

section('La clé de service — ce qu’elle ouvre');

const sansCle = await appel('/support/service/a-notifier');
ok('sans clé, la relève est refusée', sansCle.statut === 401, `statut ${sansCle.statut}`);

const mauvaiseCle = await appel('/support/service/a-notifier', { cleService: 'x'.repeat(64) });
ok('avec une mauvaise clé, refusée aussi', mauvaiseCle.statut === 401, `statut ${mauvaiseCle.statut}`);

const releve = await appel('/support/service/a-notifier', { cleService: CLE_SERVICE });
ok('avec la bonne clé, la relève répond', releve.statut === 200, `statut ${releve.statut}`);
ok('elle ramène le ticket escaladé',
  releve.json?.tickets?.some((t) => String(t._id) === String(idEscalade)),
  `${releve.json?.nombre} ticket(s)`);
ok('et pas le ticket résolu',
  !releve.json?.tickets?.some((t) => String(t._id) === String(idTicket)));

/* ------------------------------------------------------------------ *
 *  OÙ LA RELÈVE DOIT-ELLE ANNONCER
 *
 *  LA PANNE QUI A MOTIVÉ CETTE SECTION. La conversation de destination
 *  vivait dans un champ de l'éditeur n8n, saisie une fois à la main.
 *  Régénérer le workflow l'a effacée : n8n a classé le nœud « en défaut »
 *  et a REFUSÉ d'exécuter la relève pendant des heures, sans qu'aucune
 *  escalade ne parte et sans que rien ne le signale. Ce qui ne peut pas
 *  être régénéré ne doit pas vivre dans un workflow.
 * ------------------------------------------------------------------ */
section('La clé de service — où annoncer les escalades');

ok('**la relève rend aussi les destinations** — plus rien à recopier dans n8n',
  Array.isArray(releve.json?.destinations), typeof releve.json?.destinations);

const exploitant = await inscrire(`exploit${S}`, 'Exploitant');
const CONVERSATION_TEST = String(700000000 + (S % 100000000));

const majExploitant = (champs) =>
  bdd.collection('users').updateOne({ pseudo: exploitant.pseudo }, { $set: champs });

const destinations = async () =>
  (await appel('/support/service/a-notifier', { cleService: CLE_SERVICE })).json?.destinations ?? [];

const yFigure = async () =>
  (await destinations()).some((d) => d.conversation === CONVERSATION_TEST);

await majExploitant({ 'telegram.conversation': CONVERSATION_TEST });
ok('**un compte ORDINAIRE rattaché ne reçoit pas les escalades** — la console est à l’équipe',
  (await yFigure()) === false);

await majExploitant({ type: 'admin' });
ok('un administrateur rattaché y figure', (await yFigure()) === true);

const ligne = (await destinations()).find((d) => d.conversation === CONVERSATION_TEST);
ok('avec son pseudo, pour qu’une exécution n8n soit lisible', ligne?.pseudo === exploitant.pseudo);

await majExploitant({ isActive: false });
ok('**un compte désactivé cesse de recevoir** — sans qu’il faille penser à le délier',
  (await yFigure()) === false);

await majExploitant({ isActive: true });
await bdd.collection('users').updateOne(
  { pseudo: exploitant.pseudo },
  { $unset: { 'telegram.conversation': 1 } }
);
ok('et délier suffit à ne plus rien recevoir', (await yFigure()) === false);

/*
 * L'AIDE PUBLIQUE, POUR LES CANAUX SANS IDENTITÉ (Telegram, courriel).
 *
 * Ces canaux n'apportent aucun jeton : un compte Telegram ne prouve rien,
 * une adresse d'expéditeur se falsifie. Ils lisent donc la base de
 * connaissances avec le rôle le moins doté — jamais celui d'un coach.
 */
section('La clé de service — l’aide publique');

const fichesSansCle = await appel('/support/service/fiches/recherche?q=story');
ok('sans clé, la recherche de service est refusée', fichesSansCle.statut === 401,
  `statut ${fichesSansCle.statut}`);

const fichesService = await appel('/support/service/fiches/recherche?q=comment publier une story',
  { cleService: CLE_SERVICE });
ok('avec la bonne clé, elle répond', fichesService.statut === 200, `statut ${fichesService.statut}`);
ok('et trouve la fiche attendue',
  fichesService.json?.resultats?.[0]?.slug === 'publier-une-story',
  fichesService.json?.resultats?.[0]?.slug ?? 'rien');
ok('**elle rend la fiche ENTIÈRE, pas un extrait** — le canal n’a pas de second appel à faire',
  typeof fichesService.json?.resultats?.[0]?.corps === 'string' &&
  fichesService.json.resultats[0].corps.length > 100,
  `${fichesService.json?.resultats?.[0]?.corps?.length ?? 0} caractères`);

const fichesBornees = await appel('/support/service/fiches/recherche?q=story&limite=10',
  { cleService: CLE_SERVICE });
ok('**le lot est borné à trois fiches** — elles partent dans un prompt facturé au jeton',
  (fichesBornees.json?.resultats?.length ?? 99) <= 3,
  `${fichesBornees.json?.resultats?.length} fiche(s)`);

/*
 * LE POINT QUI COMPTE : un canal anonyme ne doit pas recevoir les fiches
 * réservées aux coachs. La question ci-dessous ramène une fiche coach quand
 * elle est posée par un coach authentifié (vérifié plus haut dans la suite).
 */
const COACH_SEULEMENT = [
  'activer-les-paiements-stripe',
  'faire-verifier-son-diplome',
  'organiser-un-evenement',
  'suivre-ses-revenus',
  'vendre-du-contenu-premium',
];

const questionDeCoach = 'activer les paiements stripe et vendre du contenu premium a mes abonnes';

const coachTemoin = await inscrire(`coachsvc${S}`, 'Coach', 'coach');

const fichesCoachAuthentifie = await appel(
  `/support/fiches/recherche?q=${encodeURIComponent(questionDeCoach)}`,
  { token: coachTemoin.token }
);
ok('témoin : un coach authentifié reçoit bien ses fiches réservées',
  (fichesCoachAuthentifie.json?.resultats ?? []).some((f) => COACH_SEULEMENT.includes(f.slug)),
  (fichesCoachAuthentifie.json?.resultats ?? []).map((f) => f.slug).join(', ') || 'rien');

const fichesCoachParService = await appel(
  `/support/service/fiches/recherche?q=${encodeURIComponent(questionDeCoach)}`,
  { cleService: CLE_SERVICE }
);
/*
 * LA RÉPONSE DOIT ÊTRE UN VRAI 200 AVEC DE VRAIES FICHES. Se contenter de
 * « aucune fiche coach » laisserait passer une route cassée : un 404 rend une
 * liste vide, qui ne contient évidemment aucune fiche coach. La vérification
 * exigerait alors précisément ce qu'elle est censée détecter.
 */
const rendues = fichesCoachParService.json?.resultats ?? [];
ok('**la même question par la route de service ne rend AUCUNE fiche coach**',
  fichesCoachParService.statut === 200 &&
  rendues.length > 0 &&
  rendues.every((f) => !COACH_SEULEMENT.includes(f.slug)),
  `statut ${fichesCoachParService.statut} — ${rendues.map((f) => f.slug).join(', ') || 'aucune fiche'}`);

const fichesParCleAgent = await appel('/support/service/fiches/recherche?q=story',
  { cleService: CLE_AGENT });
ok('**la clé d’agent n’ouvre pas non plus l’aide de service**', fichesParCleAgent.statut === 401,
  `statut ${fichesParCleAgent.statut}`);

const rechercheSansQuestion = await appel('/support/service/fiches/recherche',
  { cleService: CLE_SERVICE });
ok('une recherche sans question est refusée', rechercheSansQuestion.statut === 400,
  `statut ${rechercheSansQuestion.statut}`);

section('La clé de service — ce qu’elle N’ouvre PAS');

/*
 * LE CŒUR DE LA SUITE.
 *
 * Ces quatre vérifications prouvent qu'un orchestrateur compromis ne peut pas
 * certifier de faux coachs ni désactiver des comptes. Elles échoueraient si
 * quelqu'un remplaçait la clé de service par un jeton d'administrateur — ce
 * qui était la conception initiale, et l'erreur que ce module corrige.
 */
for (const [libelle, chemin, methode] of [
  ['la file de modération', '/admin/signalements', 'GET'],
  ['la file des diplômes', '/admin/diplomes', 'GET'],
  ['les statistiques globales', '/admin/stats', 'GET'],
  ['la file des tickets du back-office', '/admin/support/tickets', 'GET'],
]) {
  const r = await appel(chemin, { methode, cleService: CLE_SERVICE });
  ok(`**${libelle} reste fermée à la clé de service**`, r.statut === 401,
    `statut ${r.statut}`);
}

/*
 * ET L'INVERSE : trancher un dossier n'existe pas sur la route de service.
 * Instruire est une décision humaine.
 */
const tentativeTrancher = await appel(`/support/service/tickets/${idEscalade}`, {
  methode: 'PATCH',
  cleService: CLE_SERVICE,
  corps: { decision: 'remboursé' },
});
ok('**aucune route de service ne permet de trancher un dossier**',
  tentativeTrancher.statut === 404, `statut ${tentativeTrancher.statut}`);

section('Relève et marquage — deux appels distincts');

const marque = await appel('/support/service/notifies', {
  methode: 'POST',
  cleService: CLE_SERVICE,
  corps: { ids: [idEscalade] },
});
ok('le marquage répond', marque.statut === 200, `statut ${marque.statut}`);
ok('un ticket marqué', marque.json?.marques === 1, `${marque.json?.marques}`);

const releve2 = await appel('/support/service/a-notifier', { cleService: CLE_SERVICE });
ok('**le ticket annoncé ne remonte plus**',
  !releve2.json?.tickets?.some((t) => String(t._id) === String(idEscalade)),
  `${releve2.json?.nombre} ticket(s)`);

const remarque = await appel('/support/service/notifies', {
  methode: 'POST',
  cleService: CLE_SERVICE,
  corps: { ids: [idEscalade] },
});
ok('remarquer un ticket déjà annoncé ne change rien', remarque.json?.marques === 0,
  `${remarque.json?.marques}`);

/* ================================================================== *
 *  3 — ZONE EXPLOITANT
 * ================================================================== */

section('Back-office — un humain, pas un service');

const fileParAlice = await appel('/admin/support/tickets', { token: alice.token });
ok('**un compte ordinaire n’accède pas à la file**', fileParAlice.statut === 403,
  `statut ${fileParAlice.statut}`);

await bdd.collection('users').insertOne({
  type: 'admin', nom: 'Support', prenom: 'Admin',
  pseudo: `adminsup${S}`, email: `adminsup${S}${DOM}`,
  password: (await import('bcryptjs')).default.hashSync(MDP, 12),
  isActive: true, createdAt: new Date(), updatedAt: new Date(),
});

const cxAdmin = await appel('/auth/login', {
  methode: 'POST',
  corps: { identifiant: `adminsup${S}`, password: MDP },
});
ok('connexion du compte administrateur', cxAdmin.statut === 200, `statut ${cxAdmin.statut}`);
const jetonAdmin = cxAdmin.json?.accessToken;

const file = await appel('/admin/support/tickets?statut=escalade', { token: jetonAdmin });
ok('l’administrateur reçoit la file', file.statut === 200, `statut ${file.statut}`);

const dossier = file.json?.elements?.find((t) => String(t._id) === String(idEscalade));
ok('le dossier escaladé y figure', Boolean(dossier));
ok('avec l’auteur identifié', dossier?.auteur?.pseudo === alice.pseudo, dossier?.auteur?.pseudo);
ok('et le motif d’escalade', Boolean(dossier?.motifEscalade), dossier?.motifEscalade);

/*
 * UN AUTEUR SUPPRIMÉ NE FAIT PAS TOMBER LA FILE. Mongoose laisse alors le
 * champ peuplé à `null` tout en le déclarant peuplé ; lire `._id` dessus
 * levait une erreur, et la file entière renvoyait 500 pour un seul ticket.
 */
const carole = await inscrire(`carole${S}`, 'Carole');
await appel('/support/tickets', {
  methode: 'POST',
  token: carole.token,
  corps: { question: 'Je conteste un refus de diplôme.', intention: 'decision' },
});
await bdd.collection('users').deleteOne({
  _id: new (requireServeur('mongodb').ObjectId)(String(carole.id)),
});
const fileOrpheline = await appel('/admin/support/tickets?statut=escalade', { token: jetonAdmin });
ok('**la file s’affiche encore quand l’auteur d’un ticket a été supprimé**',
  fileOrpheline.statut === 200, `statut ${fileOrpheline.statut}`);
ok('et les autres dossiers y figurent toujours',
  Boolean(fileOrpheline.json?.elements?.some((t) => String(t._id) === String(idEscalade))));
// Le compte n'existe plus : la purge par domaine ne retrouverait pas son ticket.
await bdd.collection('tickets').deleteMany({
  auteur: new (requireServeur('mongodb').ObjectId)(String(carole.id)),
});

section('Instruction du dossier');

const sansDecision = await appel(`/admin/support/tickets/${idEscalade}`, {
  methode: 'PATCH', token: jetonAdmin, corps: {},
});
ok('une décision vide est refusée', sansDecision.statut === 400, `statut ${sansDecision.statut}`);

const tranche = await appel(`/admin/support/tickets/${idEscalade}`, {
  methode: 'PATCH',
  token: jetonAdmin,
  corps: { decision: 'Remboursement accordé, traité par Stripe.', statut: 'clos' },
});
ok('**le dossier est instruit**', tranche.statut === 200, `statut ${tranche.statut}`);
ok('il passe en « clos »', tranche.json?.ticket?.statut === 'clos', tranche.json?.ticket?.statut);
ok('l’instructeur est tracé', Boolean(tranche.json?.ticket?.traitePar));

const apres = await bdd.collection('tickets').findOne({
  _id: new (requireServeur('mongodb').ObjectId)(String(idEscalade)),
});
ok('le dossier est CONSERVÉ, pas supprimé', Boolean(apres));

const vuAuteur = await appel(`/support/tickets/${idEscalade}`, { token: alice.token });
ok('Alice voit la décision', vuAuteur.json?.ticket?.decision?.includes('Remboursement'));
/*
 * La vue de l'auteur omet `traitePar` : savoir QUEL administrateur a traité
 * son dossier n'apporte rien à l'utilisateur et expose une identité interne.
 */
ok('**mais pas quel administrateur l’a traitée**',
  vuAuteur.json?.ticket?.traitePar === undefined);

const deuxFois = await appel(`/admin/support/tickets/${idEscalade}`, {
  methode: 'PATCH', token: jetonAdmin, corps: { decision: 'Encore une décision' },
});
ok('un dossier clos ne se tranche pas deux fois', deuxFois.statut === 409,
  `statut ${deuxFois.statut}`);

section('Une décision humaine ne s’écrase pas');

/*
 * LE DÉFAUT QUE CETTE SECTION DÉFEND. Seul le statut « clos » était protégé
 * contre une seconde décision. Un dossier instruit en « resolu » pouvait
 * l'être à nouveau : la seconde décision remplaçait la première, ET
 * `traitePar` avec elle — l'historique perdait jusqu'à l'identité de celui
 * qui avait tranché. Le scénario réel : deux administrateurs, un même dossier.
 */
await bdd.collection('users').insertOne({
  type: 'admin', nom: 'Support', prenom: 'Second',
  pseudo: `adminbis${S}`, email: `adminbis${S}${DOM}`,
  password: (await import('bcryptjs')).default.hashSync(MDP, 12),
  isActive: true, createdAt: new Date(), updatedAt: new Date(),
});
const cxSecond = await appel('/auth/login', {
  methode: 'POST',
  corps: { identifiant: `adminbis${S}`, password: MDP },
});
const jetonSecond = cxSecond.json?.accessToken;

const premiere = await appel(`/admin/support/tickets/${idTicket}`, {
  methode: 'PATCH',
  token: jetonAdmin,
  corps: { decision: 'Réponse de l’agent relue et confirmée.', statut: 'resolu' },
});
ok('un premier administrateur instruit un dossier en « resolu »', premiere.statut === 200,
  `statut ${premiere.statut}`);

const seconde = await appel(`/admin/support/tickets/${idTicket}`, {
  methode: 'PATCH',
  token: jetonSecond,
  corps: { decision: 'Une autre décision.', statut: 'resolu' },
});
ok('**un second administrateur ne peut pas le trancher à nouveau**', seconde.statut === 409,
  `statut ${seconde.statut}`);

const instruit = await bdd.collection('tickets').findOne({
  _id: new (requireServeur('mongodb').ObjectId)(String(idTicket)),
});
ok('**la première décision est intacte**',
  instruit?.decision === 'Réponse de l’agent relue et confirmée.', instruit?.decision);
ok('**et l’identité de celui qui l’a prise aussi**',
  String(instruit?.traitePar) === String(cxAdmin.json?.utilisateur?._id));

/*
 * DEUX DÉCISIONS AU MÊME INSTANT. Une vérification suivie d'un enregistrement
 * laisserait passer les deux, et le dernier écrirait par-dessus l'autre. Les
 * deux requêtes partent ensemble : exactement une doit aboutir.
 */
const simultane = await appel('/support/tickets', {
  methode: 'POST',
  token: alice.token,
  corps: { question: 'Je conteste la désactivation de mon compte.', intention: 'decision' },
});
const idSimultane = simultane.json?.ticket?._id;

const [decisionA, decisionB] = await Promise.all([
  appel(`/admin/support/tickets/${idSimultane}`, {
    methode: 'PATCH', token: jetonAdmin, corps: { decision: 'Décision du premier.' },
  }),
  appel(`/admin/support/tickets/${idSimultane}`, {
    methode: 'PATCH', token: jetonSecond, corps: { decision: 'Décision du second.' },
  }),
]);
const statuts = [decisionA.statut, decisionB.statut].sort();
ok('**deux décisions simultanées : une seule aboutit**',
  statuts[0] === 200 && statuts[1] === 409, `statuts ${statuts.join(' et ')}`);

const gagnante = decisionA.statut === 200 ? decisionA : decisionB;
const retenu = await bdd.collection('tickets').findOne({
  _id: new (requireServeur('mongodb').ObjectId)(String(idSimultane)),
});
ok('et la base garde celle qui a abouti', retenu?.decision === gagnante.json?.ticket?.decision,
  retenu?.decision);

/* ================================================================== *
 *  CE QUE L'AGENT ÉCRIT EST AUTHENTIFIÉ
 * ================================================================== */

/*
 * LE DÉFAUT QUE CETTE SECTION DÉFEND. La création d'un ticket n'exigeait que
 * le jeton de l'utilisateur — celui avec lequel n8n agit, mais que
 * l'utilisateur détient aussi. N'importe qui pouvait donc écrire lui-même
 * « l'agent m'a promis un remboursement » et le présenter au back-office
 * comme une réponse de l'agent.
 *
 * Placée APRÈS la relève : un ticket sans agent s'escalade, et fausserait
 * les comptes de tickets à annoncer vérifiés plus haut.
 */
section('Ce que l’agent écrit est authentifié');

const usurpation = await appel('/support/tickets', {
  methode: 'POST',
  token: alice.token,
  corps: {
    question: 'Où en est mon remboursement ?',
    intention: 'usage',
    reponse: 'L’agent confirme : remboursement de 500 € accordé.',
    outils: [{ outil: 'GET /stripe/premium/revenus', statut: 200, dureeMs: 10 }],
  },
});
ok('sans clé d’agent, le ticket est tout de même enregistré', usurpation.statut === 201,
  `statut ${usurpation.statut}`);

const usurpe = await bdd.collection('tickets').findOne({
  _id: new (requireServeur('mongodb').ObjectId)(String(usurpation.json?.ticket?._id)),
});
ok('**mais la « réponse de l’agent » fournie par l’utilisateur est ignorée**',
  usurpe?.reponse === undefined, usurpe?.reponse);
ok('**et les outils déclarés aussi**', (usurpe?.outils?.length ?? 0) === 0,
  `${usurpe?.outils?.length} outil(s)`);
ok('**il est marqué comme écrit sans agent**', usurpe?.ecritParAgent === false,
  String(usurpe?.ecritParAgent));

/*
 * SEUL L'AGENT PEUT CLASSER UN TICKET « RÉSOLU ». Sans lui, personne n'a
 * répondu : un ticket « usage » créé directement irait dans « Non escaladés »
 * sans que personne ne le lise jamais. Il remonte donc à un humain.
 */
ok('**sans agent, le ticket remonte à un humain au lieu d’être « résolu »**',
  usurpe?.statut === 'escalade', usurpe?.statut);
ok('avec un motif qui dit pourquoi', usurpe?.motifEscalade === 'demande sans agent',
  usurpe?.motifEscalade);

const mauvaiseCleAgent = await appel('/support/tickets', {
  methode: 'POST',
  token: alice.token,
  cleAgent: 'f'.repeat(64),
  corps: { question: 'Question avec une fausse clé', intention: 'usage', reponse: 'Faux.' },
});
ok('**une clé d’agent fausse est refusée, pas ignorée en silence**', mauvaiseCleAgent.statut === 401,
  `statut ${mauvaiseCleAgent.statut}`);

/*
 * LES DEUX CLÉS NE SONT PAS INTERCHANGEABLES. L'agent du widget est exposé à
 * du contenu non fiable ; il ne doit pas pouvoir relever la file de
 * l'exploitant. Et la clé de relève n'authentifie pas une réponse d'agent.
 */
const releveParAgent = await appel('/support/service/a-notifier', { cleService: CLE_AGENT });
ok('**la clé d’agent n’ouvre pas la relève des escalades**', releveParAgent.statut === 401,
  `statut ${releveParAgent.statut}`);

const agentParCleReleve = await appel('/support/tickets', {
  methode: 'POST',
  token: alice.token,
  cleAgent: CLE_SERVICE,
  corps: { question: 'Question avec la clé de relève', intention: 'usage', reponse: 'Faux.' },
});
ok('**la clé de relève n’authentifie pas l’agent**', agentParCleReleve.statut === 401,
  `statut ${agentParCleReleve.statut}`);

const parAgent = await bdd.collection('tickets').findOne({ _id: enBase?._id });
ok('avec la clé, le ticket est marqué comme écrit par l’agent', parAgent?.ecritParAgent === true,
  String(parAgent?.ecritParAgent));

const vueExploitant = await appel('/admin/support/tickets?statut=escalade', { token: jetonAdmin });
const carteUsurpee = vueExploitant.json?.elements?.find(
  (t) => String(t._id) === String(usurpation.json?.ticket?._id)
);
ok('le back-office reçoit l’information', carteUsurpee?.ecritParAgent === false);

section('Les deux clés doivent différer — vérifié au démarrage');

/*
 * UNE RECOMMANDATION NE SUFFIT PAS. Copier la même valeur dans les deux
 * variables est l'erreur naturelle ; elle annulerait toute la séparation. La
 * configuration est chargée dans un processus à part, avec deux clés
 * identiques : il doit refuser de démarrer.
 */
const { spawnSync } = await import('node:child_process');
const chargerConfig = (cles) => spawnSync(
  process.execPath,
  ['--input-type=module', '-e', "await import('./src/config/env.js'); console.log('CONFIG CHARGEE');"],
  {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, NODE_ENV: 'development', ...cles },
    encoding: 'utf8',
    timeout: 20000,
  }
);

const identiques = chargerConfig({ SUPPORT_SERVICE_KEY: 'meme-valeur', SUPPORT_AGENT_KEY: 'meme-valeur' });
ok('**deux clés identiques : l’API refuse de démarrer**',
  identiques.status === 1 && !identiques.stdout.includes('CONFIG CHARGEE'),
  `code ${identiques.status}`);
ok('avec un message qui dit quoi corriger',
  /SUPPORT_AGENT_KEY/.test(identiques.stderr) && /SUPPORT_SERVICE_KEY/.test(identiques.stderr));

const differentes = chargerConfig({ SUPPORT_SERVICE_KEY: 'valeur-a', SUPPORT_AGENT_KEY: 'valeur-b' });
ok('deux clés différentes : démarrage normal',
  differentes.status === 0 && differentes.stdout.includes('CONFIG CHARGEE'),
  `code ${differentes.status}`);

/* ================================================================== *
 *  BASE DE CONNAISSANCES
 * ================================================================== */

section('Base de connaissances — accès et cloisonnement');

const sansJeton = await appel('/support/fiches');
ok('un visiteur anonyme ne lit pas les fiches', sansJeton.statut === 401, `statut ${sansJeton.statut}`);

const coachKb = await inscrire(`coachkb${S}`, 'Coach', 'coach');
const catCoach = await appel('/support/fiches', { token: coachKb.token });
const catSportif = await appel('/support/fiches', { token: alice.token });

ok('le catalogue d’un coach compte une vingtaine de fiches', catCoach.json?.total >= 20,
  `${catCoach.json?.total} fiches`);
ok('**un sportif ne reçoit aucune fiche réservée aux coachs**',
  catSportif.json?.fiches?.length > 0 && catSportif.json.fiches.every((f) => f.public !== 'coach'),
  `${catSportif.json?.total} fiches`);
ok('et un coach aucune fiche réservée aux sportifs',
  catCoach.json?.fiches?.every((f) => f.public !== 'sportif'));

const story = await appel(`/support/fiches/recherche?q=${encodeURIComponent('comment je publie une story ?')}`,
  { token: alice.token });
ok('la recherche répond — `/recherche` n’est pas pris pour un identifiant', story.statut === 200,
  `statut ${story.statut}`);
ok('« comment je publie une story ? » ramène la bonne fiche en tête',
  story.json?.resultats?.[0]?.slug === 'publier-une-story', story.json?.resultats?.[0]?.slug);
ok('avec un extrait et les écrans concernés',
  Boolean(story.json?.resultats?.[0]?.extrait) && story.json?.resultats?.[0]?.ecrans?.includes('/home'));

const diplomeSportif = await appel(`/support/fiches/recherche?q=${encodeURIComponent('faire valider mon diplôme')}`,
  { token: alice.token });
ok('**une question de coach posée par un sportif ne lui sert pas la fiche coach**',
  !diplomeSportif.json?.resultats?.some((r) => r.slug === 'faire-verifier-son-diplome'));

const ficheCoachParSportif = await appel('/support/fiches/faire-verifier-son-diplome', { token: alice.token });
ok('lire une fiche coach en sportif : 404, comme une fiche inexistante',
  ficheCoachParSportif.statut === 404, `statut ${ficheCoachParSportif.statut}`);
const ficheCoach = await appel('/support/fiches/faire-verifier-son-diplome', { token: coachKb.token });
ok('le coach la lit entière', ficheCoach.statut === 200 && ficheCoach.json?.fiche?.corps?.length > 100);

const horsSujet = await appel(`/support/fiches/recherche?q=${encodeURIComponent('capitale de la Mongolie')}`,
  { token: alice.token });
ok('**une question hors sujet ne ramène rien, plutôt que la moins mauvaise fiche**',
  horsSujet.json?.resultats?.length === 0, `${horsSujet.json?.resultats?.length} résultat(s)`);

const sansQuestion = await appel('/support/fiches/recherche', { token: alice.token });
ok('une recherche sans question est refusée', sansQuestion.statut === 400, `statut ${sansQuestion.statut}`);
const slugInvalide = await appel('/support/fiches/Pas_Un_Slug', { token: alice.token });
ok('un identifiant qui n’a pas la forme d’un nom de fiche est refusé', slugInvalide.statut === 400,
  `statut ${slugInvalide.statut}`);

section('Base de connaissances — les fiches elles-mêmes');

const kb = await import('../src/services/connaissances.service.js');

ok('**aucune fiche écartée au chargement**', kb.fichesRejetees.length === 0,
  kb.fichesRejetees.map((r) => `${r.fichier} : ${r.raison}`).join(' ; '));

/*
 * UNE FICHE QUI CITE UN ÉCRAN INEXISTANT MENT À L'UTILISATEUR. Les écrans
 * déclarés en en-tête sont confrontés aux routes réellement déclarées dans le
 * routeur du client : renommer une page sans corriger ses fiches fait échouer
 * cette vérification.
 */
const routesClient = new Set(
  [...readFileSync(new URL('../../client/src/App.jsx', import.meta.url), 'utf8')
    .matchAll(/path="([^"]+)"/g)].map((m) => m[1])
);
const ecransInconnus = kb.catalogue('admin')
  .flatMap((f) => f.ecrans.map((e) => ({ slug: f.slug, ecran: e })))
  .filter(({ ecran }) => !routesClient.has(ecran));
ok('**chaque écran cité par une fiche existe dans le routeur du client**', ecransInconnus.length === 0,
  ecransInconnus.map((x) => `${x.slug} → ${x.ecran}`).join(' ; ') || `${routesClient.size} routes connues`);

/*
 * DEUX BANCS D'ESSAI, ET ILS N'ONT PAS LE MÊME STATUT.
 *
 * Le banc de RÉGLAGE a servi à ajuster le score (rareté, pluriel) et les
 * mots-clés : sa réussite est en partie construite. Le banc TÉMOIN a été écrit
 * après les réglages et n'a servi à aucun : c'est lui qui mesure ce que la
 * recherche vaut sur une question qu'on n'avait pas prévue.
 *
 * Les seuils sont ceux mesurés à la mise en place — ce sont des garde-fous
 * contre une régression, pas des objectifs. Et le témoin, désormais connu,
 * n'est plus aveugle : un futur réglage devra s'évaluer sur un nouveau banc.
 *
 * Le critère qui compte est « dans les trois premières » : l'agent reçoit
 * trois extraits et choisit.
 */
const BANC_REGLAGE = [
  ['utilisateur', 'comment je publie une story ?', 'publier-une-story'],
  ['utilisateur', 'ma caméra ne marche pas', 'publier-une-story'],
  ['utilisateur', 'je veux arrêter mon abonnement premium', 'resilier-un-abonnement-premium'],
  ['utilisateur', 'je veux être remboursé', 'resilier-un-abonnement-premium'],
  ['utilisateur', "j'ai payé mais je ne vois toujours pas les vidéos du coach", 'contenu-premium-verrouille'],
  ['utilisateur', 'comment payer pour avoir accès au contenu d’un coach', 'sabonner-au-premium'],
  ['utilisateur', "j'ai oublié mon mot de passe", 'connexion-et-mot-de-passe'],
  ['utilisateur', 'comment changer ma photo de profil', 'modifier-son-profil'],
  ['utilisateur', 'je veux que seuls mes amis voient mes posts', 'profil-prive-et-demandes-de-suivi'],
  ['utilisateur', "quelqu'un me harcèle en message", 'bloquer-restreindre-signaler'],
  ['utilisateur', "je n'arrive pas à envoyer une vidéo dans la messagerie", 'messagerie'],
  ['utilisateur', 'comment trouver un coach près de chez moi', 'carte-et-autour-de-moi'],
  ['utilisateur', "comment s'inscrire à une sortie running", 'participer-a-un-evenement'],
  ['utilisateur', 'quelle différence entre abonnés et mes abonnements', 'abonnes-abonnements-et-mes-abonnements'],
  ['utilisateur', 'je veux supprimer mon compte', 'desactiver-son-compte'],
  ['utilisateur', 'comment mettre un commentaire', 'aimer-et-commenter'],
  ['utilisateur', 'je ne trouve pas une personne dans la recherche', 'rechercher'],
  ['coach', 'comment faire valider mon diplôme', 'faire-verifier-son-diplome'],
  ['coach', 'mon diplôme a été refusé pourquoi', 'faire-verifier-son-diplome'],
  ['coach', 'comment recevoir les paiements sur mon compte bancaire', 'activer-les-paiements-stripe'],
  ['coach', 'le lien stripe a expiré', 'activer-les-paiements-stripe'],
  ['coach', 'comment changer mon prix mensuel', 'vendre-du-contenu-premium'],
  ['coach', "l'option contenu premium est grisée", 'vendre-du-contenu-premium'],
  ['coach', "combien j'ai gagné ce mois-ci", 'suivre-ses-revenus'],
  ['coach', 'comment créer un événement', 'organiser-un-evenement'],
  ['coach', 'je dois annuler ma séance de samedi à cause de la météo', 'organiser-un-evenement'],
  ['coach', "je n'apparais pas sur la carte", 'carte-et-autour-de-moi'],
];

const BANC_TEMOIN = [
  ['utilisateur', 'où je vois quand mon abonnement se renouvelle', 'abonnes-abonnements-et-mes-abonnements'],
  ['utilisateur', 'comment ne plus suivre quelqu’un', 'suivre-un-profil'],
  ['utilisateur', 'je ne reçois pas de notifications', 'notifications'],
  ['utilisateur', 'mon pseudo ne me plaît plus', 'modifier-son-profil'],
  ['utilisateur', 'la carte ne me localise pas', 'carte-et-autour-de-moi'],
  ['utilisateur', 'la personne ne peut pas me répondre', 'messagerie'],
  ['utilisateur', 'combien de temps reste une story', 'publier-une-story'],
  ['utilisateur', 'mon fichier est trop lourd pour publier', 'publier-une-publication'],
  ['utilisateur', 'comment accepter une demande de suivi', 'profil-prive-et-demandes-de-suivi'],
  ['utilisateur', 'je me suis fait débiter deux fois', 'sabonner-au-premium'],
  ['utilisateur', 'le cours est complet', 'participer-a-un-evenement'],
  ['utilisateur', 'mon compte a été désactivé', 'desactiver-son-compte'],
  ['coach', 'pourquoi je ne peux pas organiser de sortie', 'organiser-un-evenement'],
  ['coach', 'quand est-ce que stripe me verse l’argent', 'suivre-ses-revenus'],
  ['coach', 'comment réserver une séance à mes abonnés payants', 'vendre-du-contenu-premium'],
];

const mesurer = (banc) => banc.reduce((m, [role, question, attendu]) => {
  const rang = kb.rechercher(question, role, { limite: 3 }).findIndex((r) => r.slug === attendu);
  if (rang === 0) m.tete += 1;
  if (rang >= 0) m.trois += 1;
  else m.manques.push(question);
  return m;
}, { tete: 0, trois: 0, manques: [] });

const reglage = mesurer(BANC_REGLAGE);
ok('banc de réglage : la bonne fiche dans les trois premières, 27 fois sur 27',
  reglage.trois === BANC_REGLAGE.length,
  `${reglage.trois}/${BANC_REGLAGE.length} (en tête : ${reglage.tete})` +
    (reglage.manques.length ? ` — manquées : ${reglage.manques.join(' | ')}` : ''));

const temoin = mesurer(BANC_TEMOIN);
ok('**banc témoin : dans les trois premières au moins 14 fois sur 15**', temoin.trois >= 14,
  `${temoin.trois}/${BANC_TEMOIN.length} (en tête : ${temoin.tete})` +
    (temoin.manques.length ? ` — manquées : ${temoin.manques.join(' | ')}` : ''));

/* ------------------------------ Fin ------------------------------ */

const supprimes = await purger();
await clientMongo.close();

console.log('\n============ SUPPORT AUTOMATISÉ — MODULE 15 ============');
const echecs = afficher();
console.log(`\n  (${supprimes} compte(s) de test supprimés, tickets compris)`);
process.exit(echecs > 0 ? 1 : 0);
