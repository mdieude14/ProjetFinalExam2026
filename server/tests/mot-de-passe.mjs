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
import { join } from 'node:path';
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

/*
 * « RENSEIGNÉ » VEUT DIRE « PAR L'UNE OU L'AUTRE VOIE ». Ne regarder que
 * SMTP_PASS rendrait ce test faux dès qu OAuth2 est configuré seul.
 */
const smtpRenseigne = Boolean(
  lireEnv('SMTP_USER') &&
  (lireEnv('SMTP_PASS') ||
    (lireEnv('GOOGLE_OAUTH_CLIENT_ID') && lireEnv('GOOGLE_OAUTH_CLIENT_SECRET') && lireEnv('GOOGLE_OAUTH_REFRESH_TOKEN')))
);
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

/*
 * LES CINQ VARIABLES SONT EFFACÉES, pas seulement les deux anciennes :
 * avec un OAuth configuré, l'API démarrerait et ce test passerait à tort.
 */
const sansSmtp = chargerConfig({
  SMTP_USER: '', SMTP_PASS: '',
  GOOGLE_OAUTH_CLIENT_ID: '', GOOGLE_OAUTH_CLIENT_SECRET: '', GOOGLE_OAUTH_REFRESH_TOKEN: '',
});
ok('**en production, sans SMTP, l’API refuse de démarrer**',
  sansSmtp.status === 1 && /SMTP_USER/.test(sansSmtp.stderr), `code ${sansSmtp.status}`);

const avecSmtp = chargerConfig({ SMTP_USER: 'exemple@gmail.com', SMTP_PASS: 'abcdabcdabcdabcd' });
ok('avec des identifiants SMTP, elle démarre', avecSmtp.status === 0 && avecSmtp.stdout.includes('CONFIG CHARGEE'),
  `code ${avecSmtp.status}${avecSmtp.stderr ? ' — ' + avecSmtp.stderr.trim().split('\n')[0] : ''}`);

/*
 * ET AVEC OAUTH SEUL, ELLE DÉMARRE AUSSI. Sans cette vérification, retirer la
 * reconnaissance d'OAuth2 du garde-fou de production ne ferait tomber aucun
 * test — une mutation l'a démontré le 6 octobre.
 */
const avecOAuth = chargerConfig({
  SMTP_USER: 'exemple@gmail.com', SMTP_PASS: '',
  GOOGLE_OAUTH_CLIENT_ID: 'id-exemple',
  GOOGLE_OAUTH_CLIENT_SECRET: 'secret-exemple',
  GOOGLE_OAUTH_REFRESH_TOKEN: 'jeton-exemple',
});
ok('**en production, OAuth2 seul suffit à démarrer** — sans mot de passe d’application',
  avecOAuth.status === 0 && avecOAuth.stdout.includes('CONFIG CHARGEE'),
  `code ${avecOAuth.status}${avecOAuth.stderr ? ' — ' + avecOAuth.stderr.trim().split('\n')[0] : ''}`);


/* ------------------------------------------------------------------ *
 *  DEUX FAÇONS DE S'AUTHENTIFIER, ET L'ORDRE COMPTE
 *
 *  OAuth2 passe en premier : c'est la méthode recommandée par Google, et la
 *  seule ouverte à tous les comptes. La page des mots de passe d'application
 *  exige la validation en deux étapes — qu'une clé d'accès ne remplace pas —
 *  et Google la ferme sur certains comptes : le 6 octobre 2026, elle était
 *  indisponible sur la boîte dédiée du projet.
 *
 *  Chaque cas est éprouvé dans un PROCESSUS SÉPARÉ, avec son environnement :
 *  le module lit la configuration une fois, au chargement.
 * ------------------------------------------------------------------ */

const VIDE_OAUTH = { GOOGLE_OAUTH_CLIENT_ID: '', GOOGLE_OAUTH_CLIENT_SECRET: '', GOOGLE_OAUTH_REFRESH_TOKEN: '' };
const PLEIN_OAUTH = { GOOGLE_OAUTH_CLIENT_ID: 'id-exemple', GOOGLE_OAUTH_CLIENT_SECRET: 'secret-exemple', GOOGLE_OAUTH_REFRESH_TOKEN: 'jeton-exemple' };

/** Charge le service d'envoi avec un environnement donné, et rend son verdict. */
const modeAvec = (variables) => {
  const r = spawnSync(
    process.execPath,
    ['--input-type=module', '-e',
      "const m = await import('./src/services/mail.service.js');" +
      "console.log(m.modeEnvoi() + '|' + m.destinationPour('quelquun@gmail.com') + '|' + m.destinationPour('quelquun@exemple.local'));"],
    {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, NODE_ENV: 'development', SMTP_USER: 'exemple@gmail.com', ...variables },
      encoding: 'utf8',
      timeout: 20000,
    }
  );
  return (r.stdout || '').trim().split('\n').pop() || `(echec: ${r.stderr?.trim().split('\n')[0] ?? r.status})`;
};

ok('**OAuth2 seul suffit à envoyer**',
  modeAvec({ SMTP_PASS: '', ...PLEIN_OAUTH }) === 'oauth2|smtp|boite',
  modeAvec({ SMTP_PASS: '', ...PLEIN_OAUTH }));

ok('un mot de passe d’application seul fonctionne encore',
  modeAvec({ SMTP_PASS: 'abcdabcdabcdabcd', ...VIDE_OAUTH }) === 'mot de passe|smtp|boite');

ok('**les deux présents : OAuth2 l’emporte** — c’est la voie recommandée',
  modeAvec({ SMTP_PASS: 'abcdabcdabcdabcd', ...PLEIN_OAUTH }) === 'oauth2|smtp|boite');

ok('aucun des deux : dépôt local, et rien n’est tenté',
  modeAvec({ SMTP_PASS: '', ...VIDE_OAUTH }) === 'aucun|boite|boite');

/*
 * UN OAUTH INCOMPLET N'EST PAS UN OAUTH. Trois valeurs sont nécessaires :
 * avec deux, nodemailer échouerait à l'envoi, après avoir laissé croire que
 * la configuration était bonne.
 */
ok('**un OAuth incomplet est ignoré**, il ne fait pas croire que l’envoi marche',
  modeAvec({ SMTP_PASS: '', ...PLEIN_OAUTH, GOOGLE_OAUTH_REFRESH_TOKEN: '' }) === 'aucun|boite|boite');


/* ================================================================== *
 *  LA PORTÉE DE L'IDENTIFIANT D'ENVOI
 *
 *  POURQUOI CES VÉRIFICATIONS EXISTENT. L'authentification SMTP par OAuth2
 *  exige la portée `https://mail.google.com/` : l'identifiant posé dans
 *  `server/.env` POURRAIT lire la boîte et y supprimer définitivement. Le
 *  porteur du projet a choisi cette voie en connaissance de cause, le
 *  8 octobre, à condition que rien ne puisse envoyer ni supprimer sans son
 *  accord.
 *
 *  La garantie ne vient donc plus de la permission accordée par Google : elle
 *  vient du CODE. Et un code qu'aucun test ne surveille finit par dériver —
 *  c'est tout l'objet de cette section. Elle lit les sources, sans rien
 *  exécuter : elle tombe dès qu'une capacité nouvelle apparaît, même inutilisée.
 * ================================================================== */

section('La portée de l’identifiant d’envoi');

const sourcesServeur = (() => {
  const racine = fileURLToPath(new URL('../src/', import.meta.url));
  const fichiers = [];
  const parcourir = (dossier) => {
    for (const e of readdirSync(dossier, { withFileTypes: true })) {
      const chemin = join(dossier, e.name);
      if (e.isDirectory()) parcourir(chemin);
      else if (e.name.endsWith('.js')) fichiers.push({ chemin, nom: e.name, texte: readFileSync(chemin, 'utf8') });
    }
  };
  parcourir(racine);
  return fichiers;
})();

ok('condition réunie : les sources du serveur sont lisibles',
  sourcesServeur.length > 20, `${sourcesServeur.length} fichier(s)`);

/*
 * AUCUN APPEL À L'API GMAIL DEPUIS LE SERVEUR. L'envoi passe par SMTP, qui ne
 * sait que déposer un message. Un appel à l'API ouvrirait la lecture et la
 * suppression, que la portée autorise désormais.
 */
const appelsGmail = sourcesServeur.filter((f) => /gmail\.googleapis\.com|googleapis\.com\/gmail/.test(f.texte));
ok('**aucun appel à l’API Gmail dans tout le serveur**',
  appelsGmail.length === 0, appelsGmail.map((f) => f.nom).join(', ') || 'aucun');

/*
 * AUCUNE CAPACITÉ DE SUPPRESSION, même inutilisée. La mise à la corbeille
 * reste l'affaire du workflow n8n dédié, qui n'agit que sur les messages
 * étiquetés par l'exploitant lui-même.
 */
const MOTIFS_SUPPRESSION = /messages\/[^/'"`]+\/trash|batchDelete|messages\.delete|\/drafts\b/;
const capacitesSuppression = sourcesServeur.filter((f) => MOTIFS_SUPPRESSION.test(f.texte));
ok('**aucune capacité de suppression ni de brouillon Gmail dans le serveur**',
  capacitesSuppression.length === 0, capacitesSuppression.map((f) => f.nom).join(', ') || 'aucune');

/*
 * LE SERVICE D'ENVOI N'EXPORTE QUE DE QUOI ENVOYER. Une fonction de lecture,
 * même pratique pour un diagnostic, ferait de cet identifiant un outil
 * d'inspection de la boîte.
 */
const serviceEnvoi = sourcesServeur.find((f) => f.chemin.endsWith('mail.service.js'));
const exportsEnvoi = [...serviceEnvoi.texte.matchAll(/^export (?:async )?function (\w+)|^export (?:const|let) (\w+)/gm)]
  .map((m) => m[1] ?? m[2]).sort();
ok('**le service d’envoi n’expose que l’envoi et son diagnostic**',
  JSON.stringify(exportsEnvoi) === JSON.stringify(['destinationPour', 'envoyerMail', 'modeEnvoi', 'verifierSmtp']),
  exportsEnvoi.join(', '));

/*
 * LISTE BLANCHE DES ENDROITS QUI ENVOIENT.
 *
 * C'est la vérification qui compte le plus. Trois appels seulement, et chacun
 * a sa justification :
 *
 *   motDePasse.service  déclenché par l'UTILISATEUR lui-même (lien de
 *                       réinitialisation, puis alerte de modification) ;
 *                       jamais par une IA
 *   support.service     la réponse à un dossier, dans `envoyerReponse()`, qui
 *                       exige un brouillon VALIDÉ par l'exploitant
 *
 * Un quatrième appel ferait tomber ce test, et obligerait à se demander qui le
 * déclenche — et si l'exploitant doit l'autoriser.
 */
const appelants = sourcesServeur
  .filter((f) => !f.chemin.endsWith('mail.service.js') && /envoyerMail\s*\(/.test(f.texte))
  .map((f) => f.nom)
  .sort();
ok('**seuls deux services envoient un courriel**, et aucune IA n’en fait partie',
  JSON.stringify(appelants) === JSON.stringify(['motDePasse.service.js', 'support.service.js']),
  appelants.join(', '));

/*
 * ET L'ENVOI DU SUPPORT RESTE ADOSSÉ AU BROUILLON VALIDÉ. `envoyerReponse()`
 * refuse sans brouillon, et verrouille le dossier avant d'expédier : deux
 * validations ne font jamais deux courriels.
 */
const servicesSupport = sourcesServeur.find((f) => f.chemin.endsWith('support.service.js')).texte;
const corpsEnvoyerReponse = (servicesSupport.match(/export async function envoyerReponse[\s\S]*?\n}/) ?? [''])[0];
ok('**la réponse du support exige un brouillon, et verrouille avant d’expédier**',
  /brouillonReponse/.test(corpsEnvoyerReponse) &&
  /Aucun brouillon à envoyer/.test(corpsEnvoyerReponse) &&
  /reponseEnvoyeeLe: null/.test(corpsEnvoyerReponse),
  `${corpsEnvoyerReponse.split('\n').length} ligne(s) analysée(s)`);

/* ------------------------------ Fin ------------------------------ */

const { comptes, fichiers } = await purger();
await clientMongo.close();

console.log('\n============ MOT DE PASSE OUBLIÉ ============');
const echecs = afficher();
console.log(`\n  (${comptes} compte(s) et ${fichiers} e-mail(s) de test supprimés)`);
process.exit(echecs > 0 ? 1 : 0);
