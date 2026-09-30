/**
 * ===========================================================================
 *  RÉPONDRE À UNE DEMANDE — brouillon, validation, envoi (module 15)
 * ===========================================================================
 *
 *   npm run test:reponse
 *
 * CE QUE CETTE SUITE DÉFEND.
 *
 * Écrire à un utilisateur au nom de l'équipe est la capacité la plus lourde du
 * module : le message part chez quelqu'un, et ne se rattrape pas. Trois portes
 * la gardent, et chacune est vérifiée ici :
 *
 *   - LA CLÉ DE SERVICE NE SUFFIT PAS. Elle dit d'où vient l'appel, pas qui
 *     agit. Une conversation Telegram rattachée à un compte ADMINISTRATEUR est
 *     exigée en plus, et c'est elle qui signe le dossier ;
 *   - RIEN NE PART SANS VALIDATION. Le brouillon se réécrit autant qu'on veut ;
 *     l'envoi est un second geste, explicite ;
 *   - UN SEUL COURRIEL, JAMAIS DEUX. L'envoi verrouille le dossier avant
 *     d'écrire : deux validations simultanées, une depuis Telegram et une
 *     depuis le back-office, ne peuvent pas doubler l'envoi.
 *
 * SANS SMTP CONFIGURÉ, le courriel est déposé dans `server/.boite-mails/` :
 * la suite le vérifie là, et contrôle que le dossier enregistre ce chemin
 * plutôt que d'annoncer un envoi qui n'a pas eu lieu.
 * ===========================================================================
 */

import { createRequire } from 'node:module';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = 'http://localhost:5000/api';
const DOM = '@reponsetest.local';
const MDP = 'MotDePasse123';
const S = Date.now();
const CONV_ADMIN = '7712000001';
const CONV_AUTRE = '7712000002';

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

process.on('uncaughtException', async (e) => { afficher(e.message); await purger().catch(() => {}); process.exit(1); });
process.on('unhandledRejection', async (e) => { afficher(e?.message || e); await purger().catch(() => {}); process.exit(1); });

async function appel(chemin, { methode = 'GET', corps, token, cleService, cleAgent } = {}) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (cleService) h['x-service-key'] = cleService;
  if (cleAgent) h['x-agent-key'] = cleAgent;
  if (corps) h['Content-Type'] = 'application/json';
  const r = await fetch(API + chemin, { method: methode, headers: h, body: corps ? JSON.stringify(corps) : undefined });
  const t = await r.text();
  return { statut: r.status, texte: t, json: (() => { try { return JSON.parse(t); } catch { return null; } })() };
}

/* ------------------------------ Base ------------------------------ */

const requireServeur = createRequire(new URL('../package.json', import.meta.url));
const { MongoClient, ObjectId } = requireServeur('mongodb');
const bcrypt = requireServeur('bcryptjs');

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const lireEnv = (cle) => {
  const ligne = env.split(/\r?\n/).find((l) => l.startsWith(`${cle}=`));
  return ligne ? ligne.slice(cle.length + 1).trim().replace(/^["']|["']$/g, '') : null;
};
const CLE_SERVICE = lireEnv('SUPPORT_SERVICE_KEY');
const CLE_AGENT = lireEnv('SUPPORT_AGENT_KEY');

const BOITE = fileURLToPath(new URL('../.boite-mails/', import.meta.url));

const clientMongo = new MongoClient(lireEnv('MONGO_URI'), { serverSelectionTimeoutMS: 8000 });
await clientMongo.connect();
const bdd = clientMongo.db();

async function purger() {
  const ids = (await bdd.collection('users').find({ email: /@reponsetest[.]local$/ }, { projection: { _id: 1 } }).toArray())
    .map((u) => u._id);
  if (ids.length === 0) return 0;
  await bdd.collection('tickets').deleteMany({ auteur: { $in: ids } });
  await bdd.collection('users').deleteMany({ _id: { $in: ids } });
  return ids.length;
}
await purger();

const inscrire = async (pseudo) => {
  const r = await appel('/auth/register', {
    methode: 'POST',
    corps: { type: 'utilisateur', prenom: 'Test', nom: 'Reponse', pseudo, ville: 'Lyon', email: `${pseudo}${DOM}`, password: MDP },
  });
  if (r.statut !== 201) throw new Error(`${pseudo} : ${r.statut}`);
  return { token: r.json.accessToken, id: new ObjectId(r.json.utilisateur._id), pseudo, email: `${pseudo}${DOM}` };
};

const inscrireAdmin = async (pseudo, conversation) => {
  const { insertedId } = await bdd.collection('users').insertOne({
    type: 'admin', nom: 'Reponse', prenom: 'Admin', pseudo, email: `${pseudo}${DOM}`,
    password: bcrypt.hashSync(MDP, 12), isActive: true, createdAt: new Date(), updatedAt: new Date(),
    ...(conversation ? { telegram: { conversation, lieLe: new Date() } } : {}),
  });
  const r = await appel('/auth/login', { methode: 'POST', corps: { identifiant: pseudo, password: MDP } });
  if (r.statut !== 200) throw new Error(`connexion ${pseudo} : ${r.statut}`);
  return { token: r.json.accessToken, id: insertedId, pseudo };
};

const utilisateur = await inscrire(`repuser${S}`);
const admin = await inscrireAdmin(`repadmin${S}`, CONV_ADMIN);
const second = await inscrireAdmin(`repsecond${S}`, CONV_AUTRE);

/** Une demande escaladée, telle que l'agent l'écrit. */
const creerDemande = async (question = 'Je veux être remboursé de mon abonnement.') => {
  const r = await appel('/support/tickets', {
    methode: 'POST', token: utilisateur.token, cleAgent: CLE_AGENT,
    corps: { question, intention: 'decision', motifEscalade: 'remboursement', reponse: 'Transmis à un conseiller.' },
  });
  if (r.statut !== 201) throw new Error(`création du ticket : ${r.statut} ${r.texte.slice(0, 120)}`);
  return r.json.ticket;
};

const dossier = (reference, conversation = CONV_ADMIN, cle = CLE_SERVICE) =>
  appel(`/support/service/tickets/${reference}?conversation=${conversation}`, { cleService: cle });
const brouillon = (reference, texte, conversation = CONV_ADMIN, cle = CLE_SERVICE) =>
  appel(`/support/service/tickets/${reference}/brouillon`, { methode: 'POST', cleService: cle, corps: { conversation, texte } });
const envoyer = (reference, conversation = CONV_ADMIN, cle = CLE_SERVICE) =>
  appel(`/support/service/tickets/${reference}/envoyer`, { methode: 'POST', cleService: cle, corps: { conversation } });

/* ================================================================== *
 *  1 — QUI A LE DROIT D'ÉCRIRE AU NOM DE L'ÉQUIPE
 * ================================================================== */

section('La clé de service ne suffit pas');

const demande = await creerDemande();
const REF = demande.reference;

ok('la demande escaladée porte une référence de huit signes', /^[0-9a-f]{8}$/.test(REF ?? ''), REF);
ok('**et c’est bien la fin de son identifiant**', REF === String(demande._id).slice(-8));

ok('sans clé de service : refusé',
  (await appel(`/support/service/tickets/${REF}?conversation=${CONV_ADMIN}`)).statut === 401);
ok('**avec la clé d’AGENT : refusé** — elle atteste une réponse, elle n’ouvre pas la file',
  (await dossier(REF, CONV_ADMIN, CLE_AGENT)).statut === 401);

ok('**avec la clé de service mais SANS conversation : refusé**',
  (await appel(`/support/service/tickets/${REF}`, { cleService: CLE_SERVICE })).statut === 400);
ok('**avec une conversation inconnue : refusé**', (await dossier(REF, '7799999999')).statut === 403);

// Un compte qui perd son rôle d'administrateur perd aussi la parole.
await bdd.collection('users').updateOne({ _id: second.id }, { $set: { type: 'utilisateur' } });
ok('**une conversation dont le compte n’est plus administrateur : refusée**',
  (await dossier(REF, CONV_AUTRE)).statut === 403);
await bdd.collection('users').updateOne({ _id: second.id }, { $set: { type: 'admin' } });

ok('un compte désactivé perd la parole aussi', await (async () => {
  await bdd.collection('users').updateOne({ _id: second.id }, { $set: { isActive: false } });
  const r = await dossier(REF, CONV_AUTRE);
  await bdd.collection('users').updateOne({ _id: second.id }, { $set: { isActive: true } });
  return r.statut === 403;
})());

section('Retrouver le dossier par sa référence');

const lu = await dossier(REF);
ok('un administrateur rattaché lit le dossier', lu.statut === 200, `statut ${lu.statut}`);
ok('avec la question posée', lu.json?.dossier?.question?.startsWith('Je veux être remboursé'));
ok('**et l’adresse de l’auteur** — c’est à elle que partira la réponse',
  lu.json?.dossier?.auteur?.email === utilisateur.email);
ok('le service dit au nom de qui il agit', lu.json?.administrateur === admin.pseudo);

ok('une référence de mauvaise forme est refusée sans chercher en base',
  (await dossier('zzz')).statut === 400);
ok('une référence inconnue répond 404', (await dossier('deadbeef')).statut === 404);

/* ================================================================== *
 *  2 — LE BROUILLON
 * ================================================================== */

section('Le brouillon se réécrit, et n’envoie rien');

ok('**un brouillon trop court est refusé** — « ok » n’est pas une réponse',
  (await brouillon(REF, 'ok')).statut === 400);

const b1 = await brouillon(REF, 'Bonjour, nous avons bien reçu votre demande de remboursement.');
ok('un brouillon valable est enregistré', b1.statut === 200, `statut ${b1.statut}`);
ok('il est relisible dans le dossier', b1.json?.dossier?.brouillonReponse?.startsWith('Bonjour, nous avons'));
ok('**et rien n’est encore parti**', !b1.json?.dossier?.reponseEnvoyeeLe);

const b2 = await brouillon(REF, 'Bonjour, après vérification, nous vous remboursons sous cinq jours.');
ok('il se réécrit autant de fois qu’on veut', b2.json?.dossier?.brouillonReponse?.includes('cinq jours'));

ok('le dossier retient qui a rédigé', Boolean(b2.json?.dossier?.traitePar));
ok('**et reste escaladé tant que rien n’est envoyé**', b2.json?.dossier?.statut === 'escalade');

/* ================================================================== *
 *  3 — L'ENVOI
 * ================================================================== */

section('L’envoi — un second geste, explicite');

const sansBrouillon = await creerDemande('Ma publication a disparu, pourquoi ?');
ok('**sans brouillon, rien ne part**', (await envoyer(sansBrouillon.reference)).statut === 400);

const avant = existsSync(BOITE) ? readdirSync(BOITE).length : 0;
const envoi = await envoyer(REF);
ok('la validation envoie la réponse', envoi.statut === 200, `statut ${envoi.statut}`);
ok('**le dossier dit par où elle est partie** — ici la boîte de dépôt, SMTP n’étant pas configuré',
  envoi.json?.canal === 'boite' || envoi.json?.canal === 'smtp', `canal ${envoi.json?.canal}`);
ok('le dossier est clos', envoi.json?.dossier?.statut === 'clos');
ok('la réponse envoyée est figée dans le dossier',
  envoi.json?.dossier?.reponseExploitant?.includes('cinq jours'));
ok('avec l’instant de l’envoi', Boolean(envoi.json?.dossier?.reponseEnvoyeeLe));

const apres = existsSync(BOITE) ? readdirSync(BOITE) : [];
const courriel = apres
  .filter((f) => f.includes(utilisateur.email))
  .sort()
  .pop();
ok('**un courriel est réellement produit pour l’auteur**', Boolean(courriel) && apres.length > avant,
  courriel ?? 'aucun');

if (courriel) {
  const contenu = JSON.parse(readFileSync(`${BOITE}${courriel}`, 'utf8'));
  ok('il porte le texte validé, et lui seul', contenu.text?.includes('cinq jours'));
  ok('**il ne porte pas le brouillon abandonné**', !contenu.text?.includes('bien reçu votre demande'));
  ok('son objet rappelle la référence du dossier', contenu.subject?.includes(REF));
}

section('Un seul courriel, jamais deux');

ok('**un second envoi est refusé**', (await envoyer(REF)).statut === 409);
ok('**et on ne peut plus réécrire le brouillon d’un dossier répondu**',
  (await brouillon(REF, 'Finalement, nous ne remboursons pas.')).statut === 409);

const course = await creerDemande('Question pour la course de validations.');
await brouillon(course.reference, 'Bonjour, voici notre réponse à votre demande.');
const deux = await Promise.all([envoyer(course.reference), envoyer(course.reference, CONV_AUTRE)]);
ok('**deux validations simultanées : un seul envoi**',
  deux.filter((r) => r.statut === 200).length === 1, deux.map((r) => r.statut).join(' / '));

/* ================================================================== *
 *  4 — LE MÊME PARCOURS DEPUIS LE BACK-OFFICE
 * ================================================================== */

section('Le back-office écrit dans les mêmes champs');

const parClavier = await creerDemande('Je n’arrive pas à activer mon compte Stripe.');

ok('**un utilisateur ordinaire n’y accède pas**',
  (await appel(`/admin/support/tickets/${parClavier._id}/brouillon`, {
    methode: 'PATCH', token: utilisateur.token, corps: { texte: 'Bonjour, voici la marche à suivre.' },
  })).statut === 403);

const bAdmin = await appel(`/admin/support/tickets/${parClavier._id}/brouillon`, {
  methode: 'PATCH', token: admin.token, corps: { texte: 'Bonjour, voici la marche à suivre pour Stripe.' },
});
ok('l’administrateur enregistre son brouillon au clavier', bAdmin.statut === 200, `statut ${bAdmin.statut}`);

ok('**le bot voit le même brouillon** — un seul dossier, deux chemins',
  (await dossier(parClavier.reference)).json?.dossier?.brouillonReponse?.includes('marche à suivre'));

const eAdmin = await appel(`/admin/support/tickets/${parClavier._id}/envoyer`, { methode: 'POST', token: admin.token });
ok('et l’envoie depuis le back-office', eAdmin.statut === 200, `statut ${eAdmin.statut}`);
ok('le dossier est clos, la réponse figée', eAdmin.json?.dossier?.statut === 'clos' &&
  eAdmin.json?.dossier?.reponseExploitant?.includes('Stripe'));

/* ================================================================== *
 *  5 — CE QUE L'AUTEUR EN VOIT
 * ================================================================== */

section('L’auteur est informé, sans recevoir deux fois le texte');

const mes = await appel('/support/tickets?limite=20', { token: utilisateur.token });
const sien = (mes.json?.elements ?? []).find((t) => t.reference === REF);

ok('il retrouve sa demande', Boolean(sien));
ok('**il voit qu’une réponse lui a été envoyée**', Boolean(sien?.reponseEnvoyeeLe));
ok('**mais pas le texte de la réponse** — il l’a par courriel, une seule source',
  !JSON.stringify(sien ?? {}).includes('cinq jours'));
ok('ni l’adresse ou l’identité de l’administrateur', !JSON.stringify(sien ?? {}).includes(admin.pseudo));
ok('l’avis n’est pas encore marqué comme vu', !sien?.vueParAuteurLe);

const vu = await appel(`/support/tickets/${sien?._id}/vu`, { methode: 'POST', token: utilisateur.token });
ok('le widget peut le marquer comme vu', vu.statut === 200);

const apresVu = await appel('/support/tickets?limite=20', { token: utilisateur.token });
ok('**et l’avis ne se réaffichera plus**',
  Boolean((apresVu.json?.elements ?? []).find((t) => t.reference === REF)?.vueParAuteurLe));

/*
 * L'INTRUSION SE TENTE SUR UN DOSSIER RÉPONDU MAIS NON ENCORE VU.
 *
 * Une première version la tentait sur un dossier DÉJÀ marqué comme vu : il n'y
 * avait donc rien à changer, et la vérification passait même en retirant le
 * garde. Un test qui ne peut pas échouer ne défend rien — celui-ci a été repris
 * après l'avoir constaté par mutation.
 */
const autre = await inscrire(`repvoisin${S}`);
const lireDossier = async (reference) =>
  (await appel('/support/tickets?limite=20', { token: utilisateur.token }))
    .json?.elements?.find((t) => t.reference === reference);

const cible = await lireDossier(parClavier.reference);
ok('témoin : ce dossier a bien reçu une réponse, et n’est pas encore vu',
  Boolean(cible?.reponseEnvoyeeLe) && !cible?.vueParAuteurLe);

await appel(`/support/tickets/${parClavier._id}/vu`, { methode: 'POST', token: autre.token });
ok('**un tiers ne peut pas marquer le dossier d’un autre**',
  !(await lireDossier(parClavier.reference))?.vueParAuteurLe);

await appel(`/support/tickets/${parClavier._id}/vu`, { methode: 'POST', token: utilisateur.token });
ok('son propriétaire, lui, le peut',
  Boolean((await lireDossier(parClavier.reference))?.vueParAuteurLe));

const purges = await purger();
await clientMongo.close();
const echecs = afficher();
console.log(`\n  (${purges} compte(s) de test supprimés, tickets compris)`);
process.exit(echecs > 0 ? 1 : 0);
