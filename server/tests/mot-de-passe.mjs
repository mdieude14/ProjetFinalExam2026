/**
 * ===========================================================================
 *  MOT DE PASSE OUBLIÉ — complément des modules 2 et 3
 * ===========================================================================
 *
 *   npm run test:mot-de-passe
 *
 * CE QUE CETTE SUITE DÉFEND. Qu'une personne retrouve l'accès à son compte,
 * mais surtout que la fonction ne devienne pas une porte d'entrée :
 *
 *   - la demande ne révèle pas si une adresse a un compte ;
 *   - le lien est imprévisible, court, et ne sert qu'une fois ;
 *   - la base ne contient jamais un lien utilisable ;
 *   - réinitialiser révoque toutes les sessions ouvertes.
 *
 * Les comptes sont en `@mdptest.local` : leurs e-mails ne partent jamais,
 * ils sont déposés dans `server/.boite-mails/`, où la suite les lit.
 * ===========================================================================
 */

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const API = process.env.API_URL || 'http://localhost:5000/api';
const DOM = '@mdptest.local';
const MDP = 'AncienMdp123';
const NOUVEAU = 'NouveauMdp456';
const S = Date.now();

const BOITE = fileURLToPath(new URL('../.boite-mails/', import.meta.url));

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

/** Appel HTTP ; `cookie` rejoue un cookie de session, `setCookie` le renvoie. */
async function appel(chemin, { methode = 'GET', corps, token, cookie } = {}) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (cookie) h.Cookie = cookie;
  if (corps) h['Content-Type'] = 'application/json';
  const debut = performance.now();
  const r = await fetch(API + chemin, {
    method: methode,
    headers: h,
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const duree = performance.now() - debut;
  const texte = await r.text();
  return {
    statut: r.status,
    duree,
    setCookie: r.headers.get('set-cookie'),
    json: (() => { try { return JSON.parse(texte); } catch { return null; } })(),
  };
}

/* ------------------------------ Base ------------------------------ */

const requireServeur = createRequire(new URL('../package.json', import.meta.url));
const { MongoClient } = requireServeur('mongodb');
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const lireEnv = (cle) => {
  const ligne = env.split(/\r?\n/).find((l) => l.startsWith(`${cle}=`));
  return ligne ? ligne.slice(cle.length + 1).trim().replace(/^["']|["']$/g, '') : '';
};

const clientMongo = new MongoClient(lireEnv('MONGO_URI'), { serverSelectionTimeoutMS: 8000 });
await clientMongo.connect();
const bdd = clientMongo.db();

/* -------------------------- Boîte de dépôt -------------------------- */

const fichiersPour = (adresse) =>
  existsSync(BOITE) ? readdirSync(BOITE).filter((f) => f.endsWith(`-${adresse}.json`)).sort() : [];

const mailsPour = (adresse) =>
  fichiersPour(adresse).map((f) => JSON.parse(readFileSync(BOITE + f, 'utf8')));

/**
 * Attend qu'un e-mail de plus arrive pour cette adresse. L'envoi part APRÈS
 * la réponse HTTP — c'est voulu (voir le contrôleur) : il faut donc attendre.
 */
async function attendreMail(adresse, dejaVus, delaiMs = 8000) {
  const limite = Date.now() + delaiMs;
  while (Date.now() < limite) {
    const mails = mailsPour(adresse);
    if (mails.length > dejaVus) return mails[mails.length - 1];
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

const jetonDe = (mail) => mail?.text?.match(/jeton=([a-f0-9]{64})/)?.[1] ?? null;

async function purger() {
  const comptes = await bdd.collection('users').find({ email: /@mdptest[.]local$/ }).toArray();
  await bdd.collection('users').deleteMany({ email: /@mdptest[.]local$/ });
  let fichiers = 0;
  if (existsSync(BOITE)) {
    for (const f of readdirSync(BOITE).filter((n) => n.includes('@mdptest.local'))) {
      unlinkSync(BOITE + f);
      fichiers += 1;
    }
  }
  return { comptes: comptes.length, fichiers };
}

await purger();

/* --------------------------- Jeu de comptes --------------------------- */

async function inscrire(prefixe) {
  const pseudo = `${prefixe}${S}`;
  const r = await appel('/auth/register', {
    methode: 'POST',
    corps: { type: 'utilisateur', prenom: 'Zoé', nom: 'Test', pseudo, email: `${pseudo}${DOM}`,
             password: MDP, ville: 'Lyon' },
  });
  if (r.statut !== 201) throw new Error(`inscription de ${pseudo} : ${r.statut}`);
  return {
    pseudo,
    email: `${pseudo}${DOM}`,
    token: r.json.accessToken,
    cookie: r.setCookie?.split(';')[0],
  };
}

const alice = await inscrire('alicemdp');
const bruno = await inscrire('brunomdp');
await bdd.collection('users').updateOne({ email: bruno.email }, { $set: { isActive: false } });

const demander = (email) => appel('/auth/mot-de-passe-oublie', { methode: 'POST', corps: { email } });
const reinitialiser = (jeton, nouveauPassword) =>
  appel('/auth/reinitialiser-mot-de-passe', { methode: 'POST', corps: { jeton, nouveauPassword } });

/* ================================================================== *
 *  1 — LA DEMANDE NE RÉVÈLE RIEN
 * ================================================================== */

section('La demande ne révèle pas si un compte existe');

const inconnue = `personne${S}${DOM}`;
const pourAlice = await demander(alice.email);
const pourInconnu = await demander(inconnue);

ok('demande pour un compte existant : 200', pourAlice.statut === 200, `statut ${pourAlice.statut}`);
ok('demande pour une adresse inconnue : 200', pourInconnu.statut === 200, `statut ${pourInconnu.statut}`);
ok('**exactement le même message dans les deux cas**',
  pourAlice.json?.message && pourAlice.json.message === pourInconnu.json?.message);

/*
 * LE TEMPS DE RÉPONSE NE DOIT PAS TRAHIR NON PLUS. La réponse part avant tout
 * accès à la base : les deux demandes répondent en quelques millisecondes. On
 * vérifie un plafond plutôt qu'un écart, pour ne pas dépendre de la charge de
 * la machine — un accès base + envoi dépasserait largement ce plafond.
 */
ok('**les deux réponses partent avant tout traitement** (moins de 150 ms)',
  pourAlice.duree < 150 && pourInconnu.duree < 150,
  `${Math.round(pourAlice.duree)} ms et ${Math.round(pourInconnu.duree)} ms`);

const mailAlice = await attendreMail(alice.email, 0);
ok('le compte existant reçoit un e-mail', Boolean(mailAlice), mailAlice?.subject);
await new Promise((r) => setTimeout(r, 800));
ok('l’adresse inconnue n’en reçoit aucun', fichiersPour(inconnue).length === 0);

const pourBruno = await demander(bruno.email);
ok('compte désactivé : même réponse', pourBruno.json?.message === pourAlice.json?.message);
await new Promise((r) => setTimeout(r, 800));
ok('**mais aucun lien envoyé** — réinitialiser ne réactive pas un compte',
  fichiersPour(bruno.email).length === 0);

const adresseInvalide = await demander('pas-une-adresse');
ok('une adresse mal formée est refusée', adresseInvalide.statut === 400, `statut ${adresseInvalide.statut}`);

/* ================================================================== *
 *  2 — LE LIEN
 * ================================================================== */

section('Le lien et ce que la base en garde');

const jeton1 = jetonDe(mailAlice);
ok('l’e-mail contient un lien vers la page de réinitialisation',
  /\/reinitialiser-mot-de-passe\?jeton=[a-f0-9]{64}/.test(mailAlice?.text ?? ''));
ok('le jeton fait 256 bits (64 caractères hexadécimaux)', /^[a-f0-9]{64}$/.test(jeton1 ?? ''));
ok('l’e-mail existe en texte ET en HTML', Boolean(mailAlice?.text) && /<a href="http/.test(mailAlice?.html ?? ''));
ok('le prénom n’est pas doublement échappé', mailAlice?.text?.startsWith('Bonjour Zoé,'));

const enBase = await bdd.collection('users').findOne({ email: alice.email });
ok('**la base ne contient pas le jeton**', !JSON.stringify(enBase).includes(jeton1));
ok('**mais son empreinte SHA-256**',
  enBase?.reinitialisation?.empreinte === createHash('sha256').update(jeton1).digest('hex'));

const minutes = (new Date(enBase?.reinitialisation?.expireLe) - Date.now()) / 60000;
ok('le lien expire dans 30 minutes', minutes > 29 && minutes <= 30, `${minutes.toFixed(1)} min`);

const moi = await appel('/users/me', { token: alice.token });
ok('**le profil ne laisse rien paraître d’une réinitialisation en cours**',
  moi.statut === 200 && !JSON.stringify(moi.json).includes('reinitialisation'));

/* ================================================================== *
 *  3 — RÉINITIALISATION
 * ================================================================== */

section('Réinitialisation');

const faible = await reinitialiser(jeton1, 'faible');
ok('un mot de passe faible est refusé', faible.statut === 400, `statut ${faible.statut}`);
const apresFaible = await bdd.collection('users').findOne({ email: alice.email });
ok('et le lien reste utilisable — la validation passe avant', Boolean(apresFaible?.reinitialisation?.empreinte));

const malForme = await reinitialiser('abc', NOUVEAU);
ok('un jeton mal formé est refusé sans interroger la base', malForme.statut === 400, `statut ${malForme.statut}`);

const inventé = await reinitialiser('0'.repeat(64), NOUVEAU);
ok('un jeton bien formé mais inventé est refusé', inventé.statut === 400, `statut ${inventé.statut}`);

const reussie = await reinitialiser(jeton1, NOUVEAU);
ok('**le lien valide réinitialise le mot de passe**', reussie.statut === 200, `statut ${reussie.statut}`);
ok('aucune session n’est ouverte par le lien', !reussie.json?.accessToken && !reussie.setCookie);

const apres = await bdd.collection('users').findOne({ email: alice.email });
ok('le lien est effacé de la base', !apres?.reinitialisation?.empreinte);

const ancien = await appel('/auth/login', { methode: 'POST', corps: { identifiant: alice.pseudo, password: MDP } });
ok('**l’ancien mot de passe ne fonctionne plus**', ancien.statut === 401, `statut ${ancien.statut}`);
const parEmail = await appel('/auth/login', { methode: 'POST', corps: { identifiant: alice.email, password: NOUVEAU } });
ok('**le nouveau fonctionne, avec l’e-mail**', parEmail.statut === 200, `statut ${parEmail.statut}`);
const parPseudo = await appel('/auth/login', { methode: 'POST', corps: { identifiant: alice.pseudo, password: NOUVEAU } });
ok('et avec le pseudo', parPseudo.statut === 200, `statut ${parPseudo.statut}`);

const ancienneSession = await appel('/auth/refresh', { methode: 'POST', cookie: alice.cookie });
ok('**la session ouverte avant la réinitialisation est révoquée**', ancienneSession.statut === 401,
  `statut ${ancienneSession.statut}`);

const deuxiemeFois = await reinitialiser(jeton1, 'EncoreUnMdp789');
ok('**le même lien ne sert pas deux fois**', deuxiemeFois.statut === 400, `statut ${deuxiemeFois.statut}`);

const confirmation = await attendreMail(alice.email, 1);
ok('un e-mail confirme le changement', /a été modifié/.test(confirmation?.subject ?? ''), confirmation?.subject);
ok('**sans lien d’action** — une alerte qui invite à cliquer ressemble à de l’hameçonnage',
  confirmation && !/href=/.test(confirmation.html ?? '') && !/https?:\/\//.test(confirmation.text ?? ''));

/* ================================================================== *
 *  4 — REMPLACEMENT, EXPIRATION, SIMULTANÉITÉ
 * ================================================================== */

section('Un seul lien valide, et pas au-delà de 30 minutes');

const vus = mailsPour(alice.email).length;
await demander(alice.email);
const jetonA = jetonDe(await attendreMail(alice.email, vus));
await demander(alice.email);
const jetonB = jetonDe(await attendreMail(alice.email, vus + 1));

ok('deux demandes produisent deux liens différents', jetonA && jetonB && jetonA !== jetonB);
const parAncienLien = await reinitialiser(jetonA, 'MdpRemplace111');
ok('**une nouvelle demande rend le lien précédent inutilisable**', parAncienLien.statut === 400,
  `statut ${parAncienLien.statut}`);

await bdd.collection('users').updateOne(
  { email: alice.email },
  { $set: { 'reinitialisation.expireLe': new Date(Date.now() - 1000) } }
);
const expire = await reinitialiser(jetonB, 'MdpExpire222');
ok('**un lien expiré est refusé**', expire.statut === 400, `statut ${expire.statut}`);

section('Deux réinitialisations simultanées avec le même lien');

const vus2 = mailsPour(alice.email).length;
await demander(alice.email);
const jetonC = jetonDe(await attendreMail(alice.email, vus2));

const [premiere, seconde] = await Promise.all([
  reinitialiser(jetonC, 'MdpPremier333'),
  reinitialiser(jetonC, 'MdpSecond444'),
]);
const statuts = [premiere.statut, seconde.statut].sort();
ok('**une seule aboutit**', statuts[0] === 200 && statuts[1] === 400, `statuts ${statuts.join(' et ')}`);

const gagnant = premiere.statut === 200 ? 'MdpPremier333' : 'MdpSecond444';
const perdant = premiere.statut === 200 ? 'MdpSecond444' : 'MdpPremier333';
const cxGagnant = await appel('/auth/login', { methode: 'POST', corps: { identifiant: alice.pseudo, password: gagnant } });
const cxPerdant = await appel('/auth/login', { methode: 'POST', corps: { identifiant: alice.pseudo, password: perdant } });
ok('et c’est bien son mot de passe qui est enregistré',
  cxGagnant.statut === 200 && cxPerdant.statut === 401,
  `${cxGagnant.statut} / ${cxPerdant.statut}`);

/* ================================================================== *
 *  5 — CONFIGURATION DE L'ENVOI
 * ================================================================== */

section('Configuration de l’envoi');

const mail = await import('../src/services/mail.service.js');
ok('**une adresse en .local n’est jamais envoyée par SMTP** hors production',
  mail.destinationPour(`quelquun${DOM}`) === 'boite');

const smtpRenseigne = Boolean(lireEnv('SMTP_USER') && lireEnv('SMTP_PASS'));
ok(`adresse réelle : ${smtpRenseigne ? 'envoyée par SMTP (identifiants renseignés)' : 'déposée (SMTP non configuré)'}`,
  mail.destinationPour('quelquun@gmail.com') === (smtpRenseigne ? 'smtp' : 'boite'));

const chargerConfig = (variables) => spawnSync(
  process.execPath,
  ['--input-type=module', '-e', "await import('./src/config/env.js'); console.log('CONFIG CHARGEE');"],
  {
    cwd: new URL('..', import.meta.url),
    // Secrets JWT longs : sans eux, la production refuserait de démarrer pour
    // une AUTRE raison, et la vérification passerait à tort.
    env: { ...process.env, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'a'.repeat(48),
           JWT_REFRESH_SECRET: 'b'.repeat(48), ...variables },
    encoding: 'utf8',
    timeout: 20000,
  }
);

const sansSmtp = chargerConfig({ SMTP_USER: '', SMTP_PASS: '' });
ok('**en production, sans SMTP, l’API refuse de démarrer**',
  sansSmtp.status === 1 && /SMTP_USER/.test(sansSmtp.stderr), `code ${sansSmtp.status}`);

const avecSmtp = chargerConfig({ SMTP_USER: 'exemple@gmail.com', SMTP_PASS: 'abcdabcdabcdabcd' });
ok('avec des identifiants SMTP, elle démarre', avecSmtp.status === 0 && avecSmtp.stdout.includes('CONFIG CHARGEE'),
  `code ${avecSmtp.status}${avecSmtp.stderr ? ' — ' + avecSmtp.stderr.trim().split('\n')[0] : ''}`);

/* ------------------------------ Fin ------------------------------ */

const { comptes, fichiers } = await purger();
await clientMongo.close();

console.log('\n============ MOT DE PASSE OUBLIÉ ============');
const echecs = afficher();
console.log(`\n  (${comptes} compte(s) et ${fichiers} e-mail(s) de test supprimés)`);
process.exit(echecs > 0 ? 1 : 0);
