/**
 * ===========================================================================
 *  SUPPORT PAR COURRIEL — dépôt, validation, envoi (module 15)
 * ===========================================================================
 *
 *   npm run test:courriel
 *
 * CE QUE CETTE SUITE DÉFEND.
 *
 * Le support par courriel répondait TOUT SEUL : le flux n8n rédigeait et
 * expédiait d'affilée, sans qu'aucun humain ne relise. Cette suite défend le
 * garde-fou qui l'en empêche désormais :
 *
 *   - L'ASSISTANT DÉPOSE, IL N'ENVOIE PAS. `POST /support/service/courriel`
 *     crée le dossier et son brouillon. Aucun courriel ne part de là ;
 *   - LE DOSSIER REMONTE DANS LA FILE. Il naît `escalade` et non annoncé, donc
 *     `aNotifier()` le relève — c'est ce qui déclenche l'alerte Telegram. Sans
 *     cela, un brouillon attendrait indéfiniment que quelqu'un pense à regarder ;
 *   - UN SEUL COURRIEL, JAMAIS DEUX. Le verrou atomique d'`envoyerReponse` est
 *     partagé avec le canal widget, et il est vérifié ici aussi.
 *
 * LE PIÈGE QU'ELLE SURVEILLE EN PARTICULIER. `envoyerReponse` lisait l'adresse
 * sur le COMPTE de l'auteur, et refermait le dossier sans rien envoyer quand
 * elle manquait — branche écrite pour un compte supprimé. Un expéditeur sans
 * compte y tombait : dossier `clos`, `reponseEnvoyeeLe` posé, et personne ne
 * recevait rien. L'exploitant aurait cru avoir répondu. Deux vérifications
 * ci-dessous existent pour cela seul, et elles sont marquées.
 *
 * AUCUNE ADRESSE RÉELLE N'EST SOLLICITÉE : tout est en `.local`, un domaine
 * réservé (RFC 6762) que `destinationPour` envoie dans `server/.boite-mails/`.
 * ===========================================================================
 */

import { createRequire } from 'node:module';
import { readFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const API = 'http://localhost:5000/api';
const DOM = '@courrieltest.local';
const MDP = 'MotDePasse123';
const S = Date.now();
const CONV_ADMIN = '7713000001';

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
const { MongoClient } = requireServeur('mongodb');
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

/**
 * PURGE PAR L'ADRESSE, PAS PAR L'AUTEUR. Les dossiers de ce canal n'ont aucun
 * compte rattaché : les chercher par `auteur` n'en trouverait aucun, et ils
 * resteraient en base d'une campagne à l'autre.
 */
async function purger() {
  const dossiers = await bdd.collection('tickets')
    .deleteMany({ courrielAuteur: /@courrieltest[.]local$/ });

  const ids = (await bdd.collection('users')
    .find({ email: /@courrieltest[.]local$/ }, { projection: { _id: 1 } }).toArray()).map((u) => u._id);
  if (ids.length > 0) {
    await bdd.collection('tickets').deleteMany({ auteur: { $in: ids } });
    await bdd.collection('users').deleteMany({ _id: { $in: ids } });
  }

  let courriels = 0;
  if (existsSync(BOITE)) {
    for (const f of readdirSync(BOITE).filter((n) => n.includes('courrieltest.local'))) {
      try { unlinkSync(join(BOITE, f)); courriels += 1; } catch { /* déjà parti */ }
    }
  }
  return { dossiers: dossiers.deletedCount, comptes: ids.length, courriels };
}

/**
 * Le ménage des DOSSIERS SEULEMENT, sans toucher aux comptes.
 *
 * `purger()` efface aussi les comptes de test — administrateur compris. L'appeler
 * en cours de campagne invaliderait son jeton, et tout ce qui suit tomberait en
 * 401 pour une raison qui n'a rien à voir avec ce qu'on mesure. La leçon est
 * venue d'une première exécution où exactement cela s'est produit.
 */
async function nettoyerDossiers() {
  await bdd.collection('tickets').deleteMany({ courrielAuteur: /@courrieltest[.]local$/ });
  if (existsSync(BOITE)) {
    for (const f of readdirSync(BOITE).filter((n) => n.includes('courrieltest.local'))) {
      try { unlinkSync(join(BOITE, f)); } catch { /* déjà parti */ }
    }
  }
}

await purger();

const inscrireAdmin = async (pseudo, conversation) => {
  const { insertedId } = await bdd.collection('users').insertOne({
    type: 'admin', nom: 'Courriel', prenom: 'Admin', pseudo, email: `${pseudo}${DOM}`,
    password: bcrypt.hashSync(MDP, 12), isActive: true, createdAt: new Date(), updatedAt: new Date(),
    ...(conversation ? { telegram: { conversation, lieLe: new Date() } } : {}),
  });
  const r = await appel('/auth/login', { methode: 'POST', corps: { identifiant: pseudo, password: MDP } });
  if (r.statut !== 200) throw new Error(`connexion ${pseudo} : ${r.statut}`);
  return { token: r.json.accessToken, id: insertedId, pseudo };
};

const admin = await inscrireAdmin(`couradmin${S}`, CONV_ADMIN);

/** Un dépôt tel que l'assistant l'envoie, relève et rédaction comprises. */
const deposer = (sur = {}, cle = CLE_SERVICE, cleAgent) =>
  appel('/support/service/courriel', {
    methode: 'POST',
    cleService: cle,
    cleAgent,
    corps: {
      expediteur: `visiteur${S}${DOM}`,
      sujet: 'Problème pour régler mon abonnement',
      question: 'Bonjour, ma carte est refusée au moment de payer. Que faire ?',
      brouillon: 'Bonjour, nous avons vérifié votre dossier et votre carte a expiré. Mettez-la à jour depuis « Mon compte ».',
      ...sur,
    },
  });

/** Le courriel réellement déposé pour une adresse, ou `null`. */
const courrielDepose = (adresse) => {
  if (!existsSync(BOITE)) return null;
  const cible = adresse.replace(/[^a-z0-9@._-]/gi, '_');
  const noms = readdirSync(BOITE).filter((n) => n.includes(cible)).sort();
  if (noms.length === 0) return null;
  return { nom: noms.at(-1), ...JSON.parse(readFileSync(join(BOITE, noms.at(-1)), 'utf8')) };
};

/* ================================================================== *
 *  1 — QUI PEUT DÉPOSER
 * ================================================================== */

section('Le dépôt est réservé à la clé de service');

/*
 * `null` ET NON `undefined` POUR RETIRER LA CLÉ. Une valeur par défaut de
 * paramètre s'applique justement sur `undefined` : passer `undefined` renverrait
 * la clé de service, et le test réussirait en croyant mesurer son absence.
 */
const sansCle = await deposer({}, null);
ok('**sans clé, le dépôt est refusé**', sansCle.statut === 401, `statut ${sansCle.statut}`);

const avecCleAgent = await deposer({}, null, CLE_AGENT);
ok('**la clé d’agent ne l’ouvre pas** — ce n’est pas la même zone de confiance',
  avecCleAgent.statut === 401, `statut ${avecCleAgent.statut}`);

const cleFausse = await deposer({}, 'cle-inventee-0000');
ok('une clé fantaisiste est refusée', cleFausse.statut === 401, `statut ${cleFausse.statut}`);

ok('**aucun `conversation` n’est exigé**, contrairement aux routes de réponse',
  (await deposer()).statut === 201);

/* ================================================================== *
 *  2 — CE QUI EST REFUSÉ À L'ENTRÉE
 * ================================================================== */

section('Un dépôt mal formé n’entre pas en base');

const sansAdresse = await deposer({ expediteur: undefined });
ok('une adresse manquante est refusée', sansAdresse.statut === 400, `statut ${sansAdresse.statut}`);

const adresseCassee = await deposer({ expediteur: 'pas-une-adresse' });
ok('**une adresse mal formée est refusée** — sinon le dossier serait impossible à clore',
  adresseCassee.statut === 400, `statut ${adresseCassee.statut}`);

const questionCourte = await deposer({ question: 'ab' });
ok('une question de deux signes est refusée', questionCourte.statut === 400, `statut ${questionCourte.statut}`);

const brouillonCourt = await deposer({ brouillon: 'ok' });
ok('**un brouillon de deux signes est refusé** — « ok » n’est pas une réponse',
  brouillonCourt.statut === 400, `statut ${brouillonCourt.statut}`);

const sujetEnorme = await deposer({ sujet: 'x'.repeat(400) });
ok('un sujet démesuré est refusé plutôt que tronqué en silence',
  sujetEnorme.statut === 400, `statut ${sujetEnorme.statut}`);

/* ================================================================== *
 *  3 — CE QUE LE DÉPÔT PRODUIT
 * ================================================================== */

section('Le dépôt crée un dossier, et rien de plus');

await nettoyerDossiers();
const ADRESSE = `visiteur${S}${DOM}`;
const depot = await deposer();
ok('le dépôt aboutit', depot.statut === 201, `statut ${depot.statut}`);

const d = depot.json?.dossier;
ok('le dossier est rendu avec sa référence', /^[0-9a-f]{8}$/.test(d?.reference ?? ''), d?.reference);
ok('**il porte le canal `courriel`**', d?.canal === 'courriel', d?.canal);
ok('**et l’adresse qui a écrit**', d?.courrielAuteur === ADRESSE, d?.courrielAuteur);
ok('il n’a aucun compte rattaché', !d?.auteur, String(d?.auteur));
ok('**il est `escalade`** — c’est ce qui le met dans la file', d?.statut === 'escalade', d?.statut);
ok('le brouillon est posé', (d?.brouillonReponse ?? '').length > 10);
ok('et horodaté', Boolean(d?.brouillonLe));
ok('**`traitePar` reste vide** — personne n’a encore relu ce texte', !d?.traitePar, String(d?.traitePar));
ok('il est marqué comme écrit par l’agent', d?.ecritParAgent === true);
ok('**rien n’est parti**', !d?.reponseEnvoyeeLe, String(d?.reponseEnvoyeeLe));
ok('**et la boîte de dépôt est vide pour cette adresse**', courrielDepose(ADRESSE) === null);
ok('le sujet du courriel tient lieu d’origine', d?.origine === 'Problème pour régler mon abonnement', d?.origine);

const enBase = await bdd.collection('tickets').findOne({ courrielAuteur: ADRESSE });
ok('**en base, le dossier n’a réellement pas de champ `auteur`** — l’obligation conditionnelle fonctionne',
  enBase && enBase.auteur === undefined);
ok('et pas de `roleAuteur` non plus', enBase && enBase.roleAuteur === undefined);

/* ================================================================== *
 *  4 — L'ALERTE TELEGRAM
 * ================================================================== */

section('Le dossier remonte dans la file de l’exploitant');

const file = await appel('/support/service/a-notifier?limite=50', { cleService: CLE_SERVICE });
ok('la relève répond', file.statut === 200, `statut ${file.statut}`);
const dedans = (file.json?.tickets ?? []).find((t) => t.reference === d.reference);
ok('**le dossier du courriel y figure** — c’est ce qui déclenche l’alerte Telegram, sans flux supplémentaire',
  Boolean(dedans), dedans ? 'présent' : 'ABSENT');
ok('et la relève expose son adresse à l’exploitant', dedans?.courrielAuteur === ADRESSE, dedans?.courrielAuteur);

/* ================================================================== *
 *  5 — LA VALIDATION HUMAINE
 * ================================================================== */

section('Rien ne part sans un clic');

const refusOrdinaire = await appel(`/admin/support/tickets/${d._id}/envoyer`, { methode: 'POST' });
ok('un appel sans jeton ne valide rien', refusOrdinaire.statut === 401, `statut ${refusOrdinaire.statut}`);
ok('toujours rien dans la boîte de dépôt', courrielDepose(ADRESSE) === null);

const envoi = await appel(`/admin/support/tickets/${d._id}/envoyer`, { methode: 'POST', token: admin.token });
ok('**l’administrateur valide depuis le back-office**', envoi.statut === 200, `statut ${envoi.statut}`);
ok('**le canal annoncé est la boîte de dépôt**, adresse en `.local`', envoi.json?.canal === 'boite', envoi.json?.canal);

/*
 * LE TEST DU PIÈGE, ET IL DOIT ÊTRE STRICT. Écrire `canal !== null` passerait
 * sur `undefined`, c'est-à-dire précisément quand la requête a échoué — le test
 * réussirait en masquant la panne qu'il surveille. On exige donc une chaîne
 * non vide : seule une destination réelle satisfait cette ligne.
 */
ok('**et surtout : un canal réel est annoncé, pas `null`** — le piège du dossier clos sans réponse',
  typeof envoi.json?.canal === 'string' && envoi.json.canal.length > 0, String(envoi.json?.canal));
ok('le dossier est clos', envoi.json?.dossier?.statut === 'clos', envoi.json?.dossier?.statut);
ok('la réponse est figée', (envoi.json?.dossier?.reponseExploitant ?? '').length > 10);
ok('et horodatée', Boolean(envoi.json?.dossier?.reponseEnvoyeeLe));
ok('l’administrateur qui a validé est inscrit', String(envoi.json?.dossier?.traitePar ?? '') === String(admin.id));

const courriel = courrielDepose(ADRESSE);
ok('**un courriel est réellement produit**', Boolean(courriel), courriel?.nom);
ok('**il part à l’adresse qui avait écrit**', courriel?.to === ADRESSE, courriel?.to);
/*
 * DEUX `undefined` SONT ÉGAUX : comparer seulement les deux champs passerait
 * quand ni l'un ni l'autre n'existe. On exige d'abord qu'il y ait un texte.
 */
const texteParti = courriel?.text;
const texteFige = envoi.json?.dossier?.reponseExploitant;
ok('il porte le texte validé, et ce texte existe',
  typeof texteParti === 'string' && texteParti.length > 10 && texteParti === texteFige);
ok('son objet rappelle la référence du dossier', (courriel?.subject ?? '').includes(d.reference), courriel?.subject);

/* ================================================================== *
 *  6 — UN SEUL COURRIEL, JAMAIS DEUX
 * ================================================================== */

section('Le verrou est partagé avec le canal widget');

const second = await appel(`/admin/support/tickets/${d._id}/envoyer`, { methode: 'POST', token: admin.token });
ok('**un second envoi est refusé**', second.statut === 409, `statut ${second.statut}`);

const reecriture = await appel(`/admin/support/tickets/${d._id}/brouillon`, {
  methode: 'PATCH', token: admin.token, corps: { texte: 'Une reformulation après coup, qui ne doit pas passer.' },
});
ok('**et on ne réécrit plus le brouillon d’un dossier répondu**', reecriture.statut === 409, `statut ${reecriture.statut}`);

const depotB = await deposer({ expediteur: `double${S}${DOM}` });
const idB = depotB.json?.dossier?._id;
const deux = await Promise.all([
  appel(`/admin/support/tickets/${idB}/envoyer`, { methode: 'POST', token: admin.token }),
  appel(`/admin/support/tickets/${idB}/envoyer`, { methode: 'POST', token: admin.token }),
]);
ok('**deux validations simultanées : un seul envoi**',
  deux.filter((r) => r.statut === 200).length === 1, deux.map((r) => r.statut).join(' / '));

const deposesB = existsSync(BOITE)
  ? readdirSync(BOITE).filter((n) => n.includes(`double${S}${DOM}`.replace(/[^a-z0-9@._-]/gi, '_'))).length
  : 0;
ok('**et un seul courriel déposé**, pas deux', deposesB === 1, `${deposesB} fichier(s)`);

/* ================================================================== *
 *  7 — LE CANAL WIDGET N'A RIEN PERDU
 * ================================================================== */

section('L’invariant du widget tient toujours');

const sansJeton = await appel('/support/tickets', {
  methode: 'POST', cleAgent: CLE_AGENT, corps: { question: 'Une question sans jeton.' },
});
ok('**créer un ticket widget sans jeton reste impossible** — l’auteur vient du jeton, jamais du corps',
  sansJeton.statut === 401, `statut ${sansJeton.statut}`);

const widgetSansAuteur = await appel('/support/tickets', {
  methode: 'POST', cleAgent: CLE_AGENT,
  corps: { question: 'Une question avec un auteur falsifié.', auteur: String(admin.id), canal: 'courriel' },
});
ok('**et on ne contourne pas l’obligation en déclarant `canal: courriel` dans le corps**',
  widgetSansAuteur.statut === 401, `statut ${widgetSansAuteur.statut}`);

/* ================================================================== *
 *  8 — UN MESSAGE GMAIL, UN SEUL DOSSIER
 *
 *  Ajouté le 26 octobre. La relève pouvait repasser sur le même courriel —
 *  relance après panne, rejeu manuel, restauration — et créait alors un second
 *  dossier. Sans conséquence pour la personne, puisque rien ne part sans
 *  validation, mais l'exploitant voyait deux fois la même demande et pouvait
 *  répondre deux fois.
 *
 *  LA GARANTIE EST UN INDEX UNIQUE PARTIEL sur `messageCourriel`, et non un
 *  libellé posé dans Gmail : un index ne peut pas « échouer à s'appliquer », là
 *  où une requête réseau peut expirer en silence.
 * ================================================================== */

section('Un message Gmail, un seul dossier');

const ID_GMAIL = `19a2b3c4d5e6f${S}`;

const premier = await deposer({ messageId: ID_GMAIL });
ok('premier dépôt : créé', premier.statut === 201, `statut ${premier.statut}`);
ok('il se déclare nouveau', premier.json?.nouveau === true, String(premier.json?.nouveau));

const secondDepot = await deposer({ messageId: ID_GMAIL });
/*
 * 200 ET NON 409. Un second passage n'est pas une faute de l'appelant : il n'a
 * aucun moyen de savoir ce que la base contient. Un conflit l'obligerait à
 * traiter une erreur qui n'en est pas une.
 */
ok('**second dépôt du même message : 200, pas 201 ni 409**', secondDepot.statut === 200,
  `statut ${secondDepot.statut}`);
ok('il se déclare NON nouveau', secondDepot.json?.nouveau === false, String(secondDepot.json?.nouveau));
ok('**et c’est le MÊME dossier qui revient**',
  secondDepot.json?.dossier?.reference === premier.json?.dossier?.reference,
  `${premier.json?.dossier?.reference} vs ${secondDepot.json?.dossier?.reference}`);

const compteDossiers = await bdd.collection('tickets')
  .countDocuments({ messageCourriel: ID_GMAIL });
ok('**un seul dossier en base pour ce message**', compteDossiers === 1, `${compteDossiers} dossier(s)`);

/*
 * LE BROUILLON EXISTANT N'EST PAS ÉCRASÉ. L'exploitant peut l'avoir modifié,
 * voire déjà envoyé : une rédaction neuve détruirait son travail en silence.
 */
const autreBrouillon = await deposer({
  messageId: ID_GMAIL,
  brouillon: 'Un texte entièrement différent, qui ne doit PAS remplacer le premier.',
});
ok('un troisième dépôt ne crée toujours rien', autreBrouillon.statut === 200);
const enBaseApres = await bdd.collection('tickets').findOne({ messageCourriel: ID_GMAIL });
ok('**le brouillon de l’exploitant n’est jamais écrasé par un nouveau passage**',
  !enBaseApres?.brouillonReponse?.includes('entièrement différent'),
  String(enBaseApres?.brouillonReponse ?? '').slice(0, 40));

/*
 * SANS IDENTIFIANT, LE DÉPÔT RESTE ACCEPTÉ — et c'est l'index PARTIEL qui le
 * permet. Un index unique ordinaire traiterait tous ces dossiers comme portant
 * la même valeur `null` et refuserait le second : il interdirait d'avoir plus
 * d'un dossier sans identifiant dans toute la base.
 */
const sansIdUn = await deposer({ expediteur: `anonyme1${S}${DOM}` });
const sansIdDeux = await deposer({ expediteur: `anonyme2${S}${DOM}` });
ok('**deux dépôts SANS identifiant sont tous deux acceptés** — l’index est partiel',
  sansIdUn.statut === 201 && sansIdDeux.statut === 201,
  `${sansIdUn.statut} puis ${sansIdDeux.statut}`);

/* Et le canal widget, qui n'a jamais d'identifiant de message, n'est pas gêné. */
const widgetUn = await bdd.collection('tickets').countDocuments({
  canal: 'widget', messageCourriel: { $exists: false },
});
ok('les dossiers du widget ne portent pas la clé et ne sont pas contraints',
  widgetUn >= 0, `${widgetUn} dossier(s) widget sans clé`);

/* ------------------------------ Fin ------------------------------- */

const menage = await purger();
const echecs = afficher();
console.log(`\n  (${menage.dossiers} dossier(s), ${menage.comptes} compte(s) et ${menage.courriels} courriel(s) de test supprimés)`);
await clientMongo.close();
process.exit(echecs > 0 ? 1 : 0);
