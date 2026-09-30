/**
 * ===========================================================================
 *  RATTACHEMENT D'UNE CONVERSATION TELEGRAM À UN COMPTE — module 15
 * ===========================================================================
 *
 *   npm run test:telegram
 *
 * CE QUE CETTE SUITE DÉFEND.
 *
 * Un compte Telegram ne prouve pas une identité CoachConnect. Le rattachement
 * repose donc sur un code généré DERRIÈRE LA SESSION de la personne, puis
 * présenté au bot. Tout le reste en découle, et chaque point est une porte
 * qui doit rester fermée :
 *
 *   - le code n'est jamais stocké en clair, sert une fois, expire ;
 *   - « inconnu » et « expiré » donnent la même réponse ;
 *   - un GROUPE ne se rattache jamais — ses membres verraient le compte ;
 *   - une conversation ne sert qu'un compte à la fois ;
 *   - le résumé lisible par le bot ne contient ni montant, ni adresse
 *     e-mail, ni donnée Stripe ;
 *   - un compte désactivé cesse de répondre, sans qu'il faille délier ;
 *   - la clé d'AGENT n'ouvre rien ici : seule la clé de service le fait.
 *
 * Les vérifications en gras échoueraient si l'une de ces portes s'ouvrait.
 * ===========================================================================
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const API = 'http://localhost:5000/api';
const DOM = '@telegramtest.local';
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

process.on('uncaughtException', async (e) => { afficher(e.message); await purger().catch(() => {}); process.exit(1); });
process.on('unhandledRejection', async (e) => { afficher(e?.message || e); await purger().catch(() => {}); process.exit(1); });

async function appel(chemin, { methode = 'GET', corps, token, cleService } = {}) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (cleService) h['x-service-key'] = cleService;
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
if (!CLE_SERVICE || !CLE_AGENT) {
  console.error('SUPPORT_SERVICE_KEY ou SUPPORT_AGENT_KEY absente de server/.env.');
  process.exit(1);
}

const clientMongo = new MongoClient(lireEnv('MONGO_URI'), { serverSelectionTimeoutMS: 8000 });
await clientMongo.connect();
const bdd = clientMongo.db();

const motifTest = /@telegramtest[.]local$/;

async function purger() {
  const ids = (await bdd.collection('users').find({ email: motifTest }, { projection: { _id: 1 } }).toArray())
    .map((u) => u._id);
  if (ids.length === 0) return 0;
  const evenements = (await bdd.collection('sportevents').find({ organisateur: { $in: ids } }, { projection: { _id: 1 } }).toArray())
    .map((e) => e._id);
  await bdd.collection('eventregistrations').deleteMany({ $or: [{ utilisateur: { $in: ids } }, { event: { $in: evenements } }] });
  await bdd.collection('sportevents').deleteMany({ _id: { $in: evenements } });
  await bdd.collection('subscriptions').deleteMany({ $or: [{ utilisateur: { $in: ids } }, { coach: { $in: ids } }] });
  await bdd.collection('users').deleteMany({ _id: { $in: ids } });
  return ids.length;
}

await purger();

const inscrire = async (pseudo, type = 'utilisateur') => {
  const r = await appel('/auth/register', {
    methode: 'POST',
    corps: { type, prenom: 'Test', nom: 'Telegram', pseudo, ville: 'Lyon', email: `${pseudo}${DOM}`, password: MDP },
  });
  if (r.statut !== 201) throw new Error(`${pseudo} : ${r.statut} ${r.texte.slice(0, 160)}`);
  return { token: r.json.accessToken, id: new ObjectId(r.json.utilisateur._id), pseudo };
};

/**
 * UN ADMINISTRATEUR NE SE CRÉE PAS PAR L'INSCRIPTION — le type est immuable et
 * la route publique ne le propose pas, ce qui est voulu. On l'insère donc en
 * base, comme le fait la suite du support, puis on se connecte normalement.
 */
const inscrireAdmin = async (pseudo) => {
  const { insertedId } = await bdd.collection('users').insertOne({
    type: 'admin', nom: 'Telegram', prenom: 'Admin', pseudo, email: `${pseudo}${DOM}`,
    password: bcrypt.hashSync(MDP, 12), isActive: true, createdAt: new Date(), updatedAt: new Date(),
  });
  const r = await appel('/auth/login', { methode: 'POST', corps: { identifiant: pseudo, password: MDP } });
  if (r.statut !== 200) throw new Error(`connexion ${pseudo} : ${r.statut}`);
  return { token: r.json.accessToken, id: insertedId, pseudo };
};

/*
 * Alice et Bruno sont ADMINISTRATEURS : depuis le 24 septembre, le bot Telegram
 * est la console de l'exploitant, et seul un administrateur y rattache sa
 * conversation. Ordinaire est là pour vérifier qu'on lui refuse la porte.
 */
const alice = await inscrireAdmin(`tgalice${S}`);
const bruno = await inscrireAdmin(`tgbruno${S}`);
const coach = await inscrire(`tgcoach${S}`, 'coach');
const ordinaire = await inscrire(`tgsimple${S}`);

/*
 * Jeu de données inséré directement : un abonnement payant (et un abandonné,
 * qui ne doit pas apparaître), un événement à venir et un passé. Passer par
 * l'API exigerait Stripe et le géocodage, sans rien ajouter à ce que la suite
 * vérifie — le contenu du résumé.
 */
const maintenant = Date.now();
await bdd.collection('subscriptions').insertMany([
  { utilisateur: alice.id, coach: coach.id, statut: 'actif', montant: 1990, devise: 'eur',
    periodeFin: new Date(maintenant + 20 * 86400000), annuleALaFinPeriode: false,
    stripeSubscriptionId: `sub_test_${S}`, createdAt: new Date(), updatedAt: new Date() },
  { utilisateur: alice.id, coach: coach.id, statut: 'incomplete', montant: 1990, devise: 'eur',
    createdAt: new Date(), updatedAt: new Date() },
]);
const lieu = { ville: 'Annecy', adresse: '12 rue du Lac', localisation: { type: 'Point', coordinates: [6.13, 45.9] } };
const { insertedIds: evs } = await bdd.collection('sportevents').insertMany([
  { titre: `Trail du lac ${S}`, type: 'public', statut: 'planifie', organisateur: coach.id, lieu,
    dateDebut: new Date(maintenant + 7 * 86400000), dateFin: new Date(maintenant + 7 * 86400000 + 7200000),
    capaciteMax: 30, inscritsCount: 1, createdAt: new Date(), updatedAt: new Date() },
  { titre: `Sortie passée ${S}`, type: 'public', statut: 'termine', organisateur: coach.id, lieu,
    dateDebut: new Date(maintenant - 7 * 86400000), dateFin: new Date(maintenant - 7 * 86400000 + 7200000),
    capaciteMax: 30, inscritsCount: 1, createdAt: new Date(), updatedAt: new Date() },
]);
await bdd.collection('eventregistrations').insertMany([
  { event: evs[0], utilisateur: alice.id, statut: 'inscrit', createdAt: new Date(), updatedAt: new Date() },
  { event: evs[1], utilisateur: alice.id, statut: 'inscrit', createdAt: new Date(), updatedAt: new Date() },
]);

const CONV_ALICE = '7700000001';
const CONV_AUTRE = '7700000002';
const GROUPE = '-1001234567890';

const lier = (code, conversation, cle = CLE_SERVICE) =>
  appel('/support/service/telegram/lier', { methode: 'POST', cleService: cle, corps: { code, conversation } });
const compte = (conversation, cle = CLE_SERVICE) =>
  appel(`/support/service/telegram/compte?conversation=${encodeURIComponent(conversation)}`, { cleService: cle });
const nouveauCode = async (u) => (await appel('/support/telegram/code', { methode: 'POST', token: u.token })).json;

/* ================================================================== *
 *  1 — LE CODE, CÔTÉ APPLICATION
 * ================================================================== */

section('Le rattachement est réservé à l’équipe');

ok('sans session, pas de code', (await appel('/support/telegram/code', { methode: 'POST' })).statut === 401);

/*
 * LE BOT TELEGRAM EST LA CONSOLE DE L'EXPLOITANT. Une première version ouvrait
 * ces trois routes à tout compte connecté : n'importe quel utilisateur pouvait
 * rattacher son Telegram et dialoguer avec le bot. C'était contraire à la
 * section 15.1, qui veut la zone exploitant « joignable par personne de
 * l'extérieur ».
 */
ok('**un utilisateur ordinaire ne peut pas demander de code**',
  (await appel('/support/telegram/code', { methode: 'POST', token: ordinaire.token })).statut === 403);
ok('**ni consulter l’état du rattachement**',
  (await appel('/support/telegram', { token: ordinaire.token })).statut === 403);
ok('**ni délier quoi que ce soit**',
  (await appel('/support/telegram', { methode: 'DELETE', token: ordinaire.token })).statut === 403);
ok('un coach non plus — le rôle ne suffit pas, il faut être administrateur',
  (await appel('/support/telegram/code', { methode: 'POST', token: coach.token })).statut === 403);

section('Le code — généré derrière la session d’un administrateur');

const etatInitial = await appel('/support/telegram', { token: alice.token });
ok('un compte neuf n’est rattaché à rien', etatInitial.statut === 200 && etatInitial.json.lie === false);

const gen = await appel('/support/telegram/code', { methode: 'POST', token: alice.token });
const code1 = gen.json?.code;
ok('la personne connectée obtient un code', gen.statut === 201 && typeof code1 === 'string', `statut ${gen.statut}`);
ok('huit signes, sans 0, O, 1 ni I — il se recopie à la main',
  /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(code1 ?? ''), code1);

const minutes = (new Date(gen.json?.expireLe) - Date.now()) / 60000;
ok('il expire dans dix minutes', minutes > 9 && minutes <= 10, `${minutes.toFixed(1)} min`);

const enBase = await bdd.collection('users').findOne({ _id: alice.id });
ok('**en base, seule l’empreinte du code est stockée**',
  enBase.telegram?.empreinteCode === createHash('sha256').update(code1).digest('hex') &&
  !JSON.stringify(enBase).includes(code1));

const moi = await appel('/users/me', { token: alice.token });
/*
 * ON CHERCHE LE CHAMP, PAS LE MOT. Une première version cherchait la chaîne
 * « telegram » dans la réponse — et la trouvait dans l'adresse de test
 * elle-même (`@telegramtest.local`). Un test qui échoue pour une raison
 * étrangère à ce qu'il vérifie finit ignoré ; il doit viser juste.
 */
const profil = moi.json?.profil ?? {};
ok('**le profil renvoyé à la personne ne montre ni code ni conversation**',
  moi.statut === 200 && !('telegram' in profil) &&
  !JSON.stringify(profil).includes('empreinteCode') && !JSON.stringify(profil).includes('codeExpireLe'));

const code2 = (await nouveauCode(alice)).code;
ok('**demander un nouveau code rend le précédent inutilisable**',
  (await lier(code1, CONV_ALICE)).statut === 400);

/* ================================================================== *
 *  2 — LE RATTACHEMENT, CÔTÉ BOT
 * ================================================================== */

section('Rattacher — seule la clé de service ouvre la porte');

ok('sans clé : refusé', (await appel('/support/service/telegram/lier', {
  methode: 'POST', corps: { code: code2, conversation: CONV_ALICE },
})).statut === 401);

ok('**avec la clé d’AGENT : refusé** — elle atteste une réponse, elle n’ouvre pas le rattachement',
  (await lier(code2, CONV_ALICE, CLE_AGENT)).statut === 401);

ok('avec une mauvaise clé : refusé', (await lier(code2, CONV_ALICE, 'x'.repeat(64))).statut === 401);

section('Rattacher — les refus');

const groupe = await lier(code2, GROUPE);
ok('**un GROUPE ne se rattache jamais** — tous ses membres verraient le compte',
  groupe.statut === 400, `statut ${groupe.statut}`);
ok('et le refus du groupe n’a pas consommé le code',
  (await bdd.collection('users').findOne({ _id: alice.id })).telegram?.empreinteCode !== undefined);

const inconnu = await lier('ZZZZZZZZ', CONV_ALICE);
ok('un code inconnu est refusé', inconnu.statut === 400);

const formeInvalide = await lier('abc', CONV_ALICE);
ok('un code de mauvaise forme est refusé sans chercher en base', formeInvalide.statut === 400);

// Un code expiré : on recule son échéance directement en base.
const codeExpire = (await nouveauCode(bruno)).code;
await bdd.collection('users').updateOne({ _id: bruno.id }, { $set: { 'telegram.codeExpireLe': new Date(Date.now() - 1000) } });
const expire = await lier(codeExpire, CONV_AUTRE);
ok('un code expiré est refusé', expire.statut === 400);
ok('**« inconnu » et « expiré » donnent exactement la même réponse** — sinon on saurait qu’un code a existé',
  expire.json?.message === inconnu.json?.message, expire.json?.message);

section('Rattacher — le cas nominal');

const lie = await lier(code2, CONV_ALICE);
ok('un code valide rattache la conversation', lie.statut === 200, `statut ${lie.statut}`);
ok('et le bot apprend le pseudo, pour le confirmer à la personne', lie.json?.pseudo === alice.pseudo);

ok('**le même code ne sert qu’une fois**', (await lier(code2, CONV_AUTRE)).statut === 400);

const etatLie = await appel('/support/telegram', { token: alice.token });
ok('l’application voit le rattachement', etatLie.json?.lie === true && Boolean(etatLie.json?.lieLe));
ok('**sans jamais révéler l’identifiant de la conversation**', !etatLie.texte.includes(CONV_ALICE));

const codeBruno = (await nouveauCode(bruno)).code;
const formeLibre = await lier(`${codeBruno.slice(0, 4).toLowerCase()}-${codeBruno.slice(4).toLowerCase()}`, CONV_AUTRE);
ok('un code tapé en minuscules avec un tiret est accepté', formeLibre.statut === 200);

/* ================================================================== *
 *  3 — CE QUE LE BOT PEUT LIRE
 * ================================================================== */

section('Le résumé du compte — étroit par construction');

const r = await compte(CONV_ALICE);
ok('le bot lit le résumé du compte rattaché', r.statut === 200, `statut ${r.statut}`);
ok('avec le pseudo', r.json?.compte?.pseudo === alice.pseudo);

const abos = r.json?.compte?.abonnements ?? [];
ok('l’abonnement actif apparaît, avec le pseudo du coach', abos.length === 1 && abos[0].coach === coach.pseudo,
  `${abos.length} abonnement(s)`);
ok('le paiement abandonné n’apparaît pas', !abos.some((a) => a.statut === 'incomplete'));
ok('et l’échéance, pour répondre à « jusqu’à quand ? »', Boolean(abos[0]?.periodeFin));

const evts = r.json?.compte?.evenements ?? [];
ok('l’événement à venir apparaît', evts.length === 1 && evts[0].titre.startsWith('Trail du lac'), `${evts.length} événement(s)`);
ok('le passé n’apparaît pas — il n’aide pas à répondre, et coûte à chaque question',
  !evts.some((e) => e.titre.startsWith('Sortie passée')));

const brut = r.texte;
ok('**aucun montant**', !brut.includes('1990') && !brut.includes('montant'));
ok('**aucune adresse e-mail**', !brut.includes('@') && !brut.includes('email'));
ok('**aucune donnée Stripe**', !/stripe|sub_test/i.test(brut));
ok('**aucune adresse postale** — seulement la ville', !brut.includes('12 rue du Lac') && brut.includes('Annecy'));
ok('**aucun identifiant interne**', !brut.includes(String(alice.id)) && !brut.includes(String(coach.id)));

section('Le résumé du compte — les refus');

ok('sans clé : refusé', (await appel(`/support/service/telegram/compte?conversation=${CONV_ALICE}`)).statut === 401);
ok('**avec la clé d’agent : refusé**', (await compte(CONV_ALICE, CLE_AGENT)).statut === 401);
ok('une conversation inconnue : 404', (await compte('7799999999')).statut === 404);
ok('**un identifiant de groupe : refusé d’emblée**', (await compte(GROUPE)).statut === 400);

/* ================================================================== *
 *  4 — UNE CONVERSATION, UN COMPTE
 * ================================================================== */

section('Une conversation ne sert qu’un compte');

const codeVol = (await nouveauCode(bruno)).code;
const reprise = await lier(codeVol, CONV_ALICE);
ok('rattacher la conversation à un autre compte réussit', reprise.statut === 200);
ok('**et la détache de l’ancien** — le bot ne peut plus confondre les deux',
  (await appel('/support/telegram', { token: alice.token })).json?.lie === false);
ok('le résumé parle désormais du nouveau compte', (await compte(CONV_ALICE)).json?.compte?.pseudo === bruno.pseudo);
ok('et l’ancienne conversation de ce compte est libérée', (await compte(CONV_AUTRE)).statut === 404);

section('Un code, une seule consommation — même en même temps');

const codeCourse = (await nouveauCode(alice)).code;
const course = await Promise.all([lier(codeCourse, '7700000011'), lier(codeCourse, '7700000012')]);
const reussis = course.filter((c) => c.statut === 200).length;
ok('**deux envois simultanés du même code : un seul réussit**', reussis === 1,
  course.map((c) => c.statut).join(' / '));

/* ================================================================== *
 *  5 — FIN DU RATTACHEMENT
 * ================================================================== */

section('Délier');

const convAliceActuelle = course.find((c) => c.statut === 200) === course[0] ? '7700000011' : '7700000012';
ok('avant : Alice est rattachée', (await compte(convAliceActuelle)).statut === 200);

const delierApp = await appel('/support/telegram', { methode: 'DELETE', token: alice.token });
ok('délier depuis l’application', delierApp.statut === 200 && delierApp.json?.delie === true);
ok('le bot ne lit plus rien', (await compte(convAliceActuelle)).statut === 404);

const delierBot = await appel('/support/service/telegram/delier', {
  methode: 'POST', cleService: CLE_SERVICE, corps: { conversation: CONV_ALICE },
});
ok('délier depuis Telegram (`/delier`)', delierBot.statut === 200 && delierBot.json?.delie === true);
ok('le bot ne lit plus rien non plus', (await compte(CONV_ALICE)).statut === 404);

const redelier = await appel('/support/service/telegram/delier', {
  methode: 'POST', cleService: CLE_SERVICE, corps: { conversation: CONV_ALICE },
});
ok('délier une conversation libre n’est pas une erreur', redelier.statut === 200 && redelier.json?.delie === false);

section('Un compte désactivé se tait');

const codeFerme = (await nouveauCode(alice)).code;
await lier(codeFerme, CONV_ALICE);
ok('avant : le résumé répond', (await compte(CONV_ALICE)).statut === 200);
await bdd.collection('users').updateOne({ _id: alice.id }, { $set: { isActive: false } });
ok('**compte désactivé par la modération : le bot ne lit plus rien**, sans qu’il faille délier',
  (await compte(CONV_ALICE)).statut === 404);

await bdd.collection('users').updateOne({ _id: alice.id }, { $set: { isActive: true } });
const codeDesactive = (await nouveauCode(bruno)).code;
await bdd.collection('users').updateOne({ _id: bruno.id }, { $set: { isActive: false } });
ok('**et un compte désactivé ne peut pas se rattacher**', (await lier(codeDesactive, '7700000099')).statut === 400);

const purges = await purger();
await clientMongo.close();
const echecs = afficher();
console.log(`\n  (${purges} compte(s) de test supprimés, abonnements et inscriptions compris)`);
process.exit(echecs > 0 ? 1 : 0);
