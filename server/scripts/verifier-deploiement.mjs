#!/usr/bin/env node
/**
 * ===========================================================================
 *  CONTRÔLE D'AVANT-DÉPLOIEMENT — ce qui casserait en silence
 * ===========================================================================
 *
 *   npm run verifier:deploiement            depuis server/
 *
 * ---------------------------------------------------------------------------
 *  POURQUOI CE SCRIPT EXISTE ALORS QUE `env.js` GARDE DÉJÀ LE DÉMARRAGE
 * ---------------------------------------------------------------------------
 *
 * `config/env.js` fait bien son travail : il refuse de démarrer sur des
 * secrets faibles, sur une adresse publique locale, sans envoi d'e-mails en
 * production. Mais il le fait AU PREMIER PROBLÈME RENCONTRÉ, et c'est le bon
 * comportement pour un serveur — pas pour une veille de déploiement.
 *
 *   UN SERVEUR DOIT S'ARRÊTER AU PREMIER DÉFAUT. UN CONTRÔLE D'AVANT-VOL DOIT
 *   LES MONTRER TOUS. Corriger une variable, relancer, découvrir la suivante,
 *   recommencer — six fois — est exactement ce qu'on ne veut pas faire sur un
 *   hébergement distant où chaque essai coûte un redéploiement.
 *
 * Ce script lit donc `process.env` DIRECTEMENT, sans importer `env.js`, pour
 * ne pas hériter de ses `process.exit`. Il rend un rapport complet.
 *
 * Et il vérifie trois choses qu'aucune garde de démarrage ne peut voir :
 *
 *   1. QUE LES TRANSACTIONS PASSENT RÉELLEMENT. Pas que l'URI « ressemble »
 *      à un jeu de répliques : on en ouvre une et on l'annule. Vingt usages
 *      dans sept modules en dépendent.
 *   2. QUE LES DEUX SECRETS JWT DIFFÈRENT. Toute la séparation des deux
 *      jetons repose sur cet invariant, écrit en commentaire dans
 *      `auth.service.js`, et rien ne l'applique.
 *   3. QUE L'ADRESSE PUBLIQUE EST AUTORISÉE PAR CORS. Déployer un client que
 *      l'API refuse est l'erreur qu'on ne voit qu'au premier appel.
 *
 * ---------------------------------------------------------------------------
 *  CE QU'IL N'AFFICHE JAMAIS
 * ---------------------------------------------------------------------------
 *
 * Aucune valeur de secret. Longueurs, préfixes et verdicts seulement — ce
 * rapport est fait pour être collé dans une conversation ou un journal.
 * ===========================================================================
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const PRODUCTION = process.env.NODE_ENV === 'production';

/* ------------------------------------------------------------------ *
 *  LE PETIT BANC
 * ------------------------------------------------------------------ */

const resultats = [];

/** Un contrôle réussi ou échoué. `consequence` ne sert qu'en cas d'échec. */
const verifier = (libelle, condition, detail = '', consequence = '') => {
  resultats.push({ libelle, etat: condition ? 'OK' : 'ECHEC', detail, consequence });
};

/** Un contrôle qui ne s'applique qu'en production. */
const enProduction = (libelle, condition, detail = '', consequence = '') => {
  if (!PRODUCTION) {
    resultats.push({ libelle, etat: 'SANS OBJET', detail: 'contrôlé en production', consequence: '' });
    return;
  }
  verifier(libelle, condition, detail, consequence);
};

/** Une remarque qui n'est ni un succès ni un échec. */
const remarque = (libelle, detail) => {
  resultats.push({ libelle, etat: 'NOTE', detail, consequence: '' });
};

const estLocale = (url) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(String(url ?? ''));

/* ================================================================== *
 *  1 — LES VARIABLES SANS LESQUELLES RIEN NE DÉMARRE
 * ================================================================== */

for (const cle of ['MONGO_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
  verifier(
    `${cle} renseignée`,
    Boolean(process.env[cle]),
    process.env[cle] ? `${process.env[cle].length} caractères` : 'absente',
    'le serveur refuse de démarrer'
  );
}

/* ================================================================== *
 *  2 — LES DEUX SECRETS JWT, ET L'INVARIANT QUE PERSONNE N'APPLIQUE
 * ================================================================== */

/*
 * `auth.service.js` écrit noir sur blanc : « Il est signé avec un secret
 * DIFFÉRENT de l'access token. Ainsi, si le secret d'accès fuite, un attaquant
 * ne peut pas forger de refresh token, et inversement. »
 *
 * TOUTE LA VALEUR DE CETTE PHRASE TIENT À UNE ÉGALITÉ QUE RIEN NE VÉRIFIE.
 *
 * Mesuré avant d'alerter, plutôt que supposé : l'impact immédiat est LIMITÉ,
 * parce que le middleware recharge l'utilisateur depuis la base — le rôle ne
 * vient donc pas du jeton, et il n'y a pas de montée en privilège — et parce
 * que la route de renouvellement compare `charge.v` à `refreshTokenVersion`,
 * ce qui y fait refuser un jeton d'accès.
 *
 *   MAIS LA PROTECTION CONTRE LA FUITE D'UN SEUL DES DEUX SECRETS, ELLE,
 *   DISPARAÎT ENTIÈREMENT. C'est un invariant documenté : on le fait
 *   respecter ici, là où il ne coûte rien.
 */
const acces = process.env.JWT_ACCESS_SECRET ?? '';
const rafraichissement = process.env.JWT_REFRESH_SECRET ?? '';

verifier(
  'les deux secrets JWT DIFFÈRENT',
  Boolean(acces) && Boolean(rafraichissement) && acces !== rafraichissement,
  acces && acces === rafraichissement ? 'IDENTIQUES' : 'distincts',
  'la séparation des deux jetons ne protège plus de la fuite d’un seul secret'
);

enProduction(
  'secrets JWT assez longs et non laissés en exemple',
  [acces, rafraichissement].every((s) => s.length >= 32 && !s.startsWith('remplacer')),
  `${acces.length} et ${rafraichissement.length} caractères`,
  'une clé JWT faible rend toute l’authentification contournable'
);

/* ================================================================== *
 *  3 — LES DEUX CLÉS DU SUPPORT
 * ================================================================== */

const cleService = process.env.SUPPORT_SERVICE_KEY ?? '';
const cleAgent = process.env.SUPPORT_AGENT_KEY ?? '';

if (cleService && cleAgent) {
  verifier(
    'les deux clés du support DIFFÈRENT',
    cleService !== cleAgent,
    cleService === cleAgent ? 'IDENTIQUES' : 'distinctes',
    'l’agent du widget, exposé à du contenu non fiable, obtiendrait la file de l’exploitant'
  );
} else {
  remarque('clés du support', 'support automatisé non configuré — les routes de relève restent fermées');
}

/* ================================================================== *
 *  4 — LES DEUX ADRESSES, ET LE PIÈGE DE L'ORDRE
 * ================================================================== */

const origines = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);

const urlPublique = (process.env.PUBLIC_URL || '').trim() || origines[0] || 'http://localhost:5173';

remarque('adresse publique calculée', urlPublique);
remarque('origines autorisées', `${origines.length} : ${origines.join(' | ')}`);

enProduction(
  'l’adresse publique n’est pas locale',
  !estLocale(urlPublique),
  urlPublique,
  'retours Stripe, onboarding Connect et liens de réinitialisation pointeraient en local, CHEZ L’UTILISATEUR'
);

/*
 * ET L'ADRESSE PUBLIQUE DOIT ÊTRE AUTORISÉE PAR CORS.
 *
 * Aucune garde de démarrage ne peut le voir, parce que les deux variables
 * sont valides séparément. Déployer un client sur un domaine absent de
 * `CLIENT_URL` donne une application qui s'affiche et dont CHAQUE appel
 * échoue — et le message du navigateur parle de CORS, pas de configuration.
 */
const origineDe = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

const originePublique = origineDe(urlPublique);
enProduction(
  'l’adresse publique figure dans les origines autorisées',
  Boolean(originePublique) && origines.some((o) => origineDe(o) === originePublique),
  originePublique ?? 'adresse illisible',
  'le client s’afficherait et chacun de ses appels serait bloqué par CORS'
);

/* ================================================================== *
 *  5 — LE STOCKAGE DES FICHIERS
 * ================================================================== */

/*
 * SANS CLOUDINARY, `storage.service.js` RETOMBE SUR LE DISQUE LOCAL.
 * Son propre commentaire le dit : « le disque local ne survit pas à un
 * redéploiement ». Sur un hébergement, chaque mise en ligne effacerait donc
 * les photos de profil et les publications, sans un mot d'erreur.
 */
const cloudinaryComplet = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
);

enProduction(
  'Cloudinary entièrement configuré',
  cloudinaryComplet,
  cloudinaryComplet ? 'les trois variables sont présentes' : 'incomplet — stockage sur disque LOCAL',
  'chaque redéploiement effacerait les fichiers déjà téléversés, sans erreur'
);

if (!PRODUCTION) {
  remarque(
    'mode de stockage en développement',
    cloudinaryComplet ? 'cloudinary' : 'disque local (Cloudinary non configuré)'
  );
}

/* ================================================================== *
 *  6 — STRIPE : LA COHÉRENCE QUI ÉVITE DE VRAIS DÉBITS
 * ================================================================== */

const cleStripe = process.env.STRIPE_SECRET_KEY ?? '';
const estCleReelle = cleStripe.startsWith('sk_live');
const estCleTest = cleStripe.startsWith('sk_test');

if (!cleStripe) {
  remarque('Stripe', 'STRIPE_SECRET_KEY absente — les paiements sont hors service');
} else {
  /*
   * LE SENS DANGEREUX N'EST PAS CELUI QU'ON CROIT.
   *
   * `sk_test` en production : les paiements n'encaissent rien. Embarrassant,
   * mais réversible, et visible au premier essai.
   *
   * `sk_live` HORS production : `test:paiement` DÉBITERAIT UNE VRAIE CARTE.
   * Celui-là ne se répare pas — d'où un échec, et non une remarque.
   */
  verifier(
    'aucune clé Stripe RÉELLE hors production',
    !(estCleReelle && !PRODUCTION),
    estCleReelle ? 'sk_live' : estCleTest ? 'sk_test' : 'préfixe inattendu',
    'test:paiement débiterait une VRAIE carte'
  );

  enProduction(
    'clé Stripe en mode réel',
    estCleReelle,
    estCleTest ? 'sk_test — aucun paiement n’encaisserait' : 'sk_live',
    'les paiements aboutiraient sans jamais encaisser'
  );

  verifier(
    'secret de signature du webhook présent',
    Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    process.env.STRIPE_WEBHOOK_SECRET ? 'présent' : 'absent',
    'chaque événement Stripe serait refusé, et aucun abonnement ne serait créé'
  );
}

/* ================================================================== *
 *  7 — L'ENVOI D'E-MAILS
 * ================================================================== */

const parOAuth = Boolean(
  process.env.SMTP_USER &&
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN
);
const parMotDePasse = Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);

enProduction(
  'envoi d’e-mails configuré',
  parOAuth || parMotDePasse,
  parOAuth ? 'OAuth2' : parMotDePasse ? 'mot de passe d’application' : 'aucun',
  '« mot de passe oublié » répondrait normalement et aucun e-mail ne partirait jamais'
);

/* ================================================================== *
 *  8 — LA BASE, ET LA SONDE QUI DÉCIDE VRAIMENT
 * ================================================================== */

const uri = process.env.MONGO_URI ?? '';

enProduction(
  'la base n’est pas locale',
  !/localhost|127\.0\.0\.1/i.test(uri),
  /localhost|127\.0\.0\.1/i.test(uri) ? 'URI LOCALE' : 'URI distante',
  'l’API ne trouverait aucune base depuis son hébergeur'
);

let connectee = false;

if (uri) {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 2 });
    connectee = true;
    verifier('connexion à la base', true, mongoose.connection.name);
  } catch (erreur) {
    verifier('connexion à la base', false, erreur.message, 'l’API s’arrête au démarrage');
  }
}

if (connectee) {
  /*
   * ON OUVRE UNE VRAIE TRANSACTION, ET ON L'ANNULE.
   *
   * Déduire la réponse de la forme de l'URI ou du type de topologie annoncé
   * par le pilote ne suffit pas : une connexion directe à un membre d'un jeu
   * de répliques est annoncée « Single » alors que les transactions y
   * fonctionnent, et un `mongod` seul est annoncé « Single » alors qu'elles
   * y échouent. LES DEUX CAS SE RESSEMBLENT ET SE COMPORTENT À L'INVERSE.
   *
   * `startTransaction()` seul ne prouve rien non plus : il est purement local
   * au pilote, et ne touche le serveur qu'à la première opération. Il faut
   * donc LIRE quelque chose à l'intérieur.
   */
  const session = await mongoose.startSession();
  let verdict = { ok: false, message: '' };
  try {
    await session.withTransaction(async () => {
      await mongoose.connection.db
        .collection('__sonde_transactions')
        .findOne({ _id: 'sonde' }, { session });
    });
    verdict = { ok: true, message: 'une transaction s’ouvre et se referme' };
  } catch (erreur) {
    verdict = { ok: false, message: erreur?.message ?? String(erreur) };
  } finally {
    await session.endSession();
  }

  verifier(
    'LES TRANSACTIONS PASSENT (20 usages, 7 modules)',
    verdict.ok,
    verdict.message,
    'commentaires, publications, stories, événements, abonnements, messagerie et modération tomberaient'
  );

  await mongoose.connection.close();
}

/* ================================================================== *
 *  9 — LES NEUF ÉVÉNEMENTS À DÉCLARER CHEZ STRIPE
 * ================================================================== */

/*
 * CE N'EST PAS UN CONTRÔLE : aucune API ne dit depuis ici ce qui est coché
 * dans le tableau de bord Stripe. C'est un pense-bête, extrait du code
 * lui-même — `stripeWebhook.controller.js` — pour qu'il ne se périme pas
 * si un événement est ajouté.
 */
const EVENEMENTS = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'account.updated',
  'v2.core.account.updated',
  'capability.updated',
  'account.external_account.created',
];

/* ================================================================== *
 *  LE RAPPORT
 * ================================================================== */

const LARGEUR = 56;
const symbole = { OK: '  OK   ', ECHEC: ' ECHEC ', 'SANS OBJET': '  ---  ', NOTE: '  ·    ' };

console.log('');
console.log('='.repeat(78));
console.log(`  CONTRÔLE D'AVANT-DÉPLOIEMENT — NODE_ENV = ${process.env.NODE_ENV || 'development'}`);
console.log('='.repeat(78));
console.log('');

for (const r of resultats) {
  console.log(`${symbole[r.etat]} ${r.libelle.padEnd(LARGEUR)} ${r.detail}`);
  if (r.etat === 'ECHEC' && r.consequence) {
    console.log(`        └─ ${r.consequence}`);
  }
}

const echecs = resultats.filter((r) => r.etat === 'ECHEC').length;
const reussis = resultats.filter((r) => r.etat === 'OK').length;
const reportes = resultats.filter((r) => r.etat === 'SANS OBJET').length;

console.log('');
console.log('-'.repeat(78));
console.log(`  ${reussis} contrôle(s) au vert · ${echecs} en échec · ${reportes} réservé(s) à la production`);

if (!PRODUCTION) {
  console.log('');
  console.log('  Les contrôles « --- » ne se jugent qu’avec NODE_ENV=production.');
  console.log('  Pour les éprouver sans rien installer :');
  console.log('      NODE_ENV=production npm run verifier:deploiement');
}

console.log('');
console.log('  À COCHER DANS LE TABLEAU DE BORD STRIPE — les neuf événements');
console.log('  que le code traite. Il en manque un, et la moitié d’un parcours');
console.log('  ne se termine jamais :');
console.log('');
for (const e of EVENEMENTS) console.log(`      ${e}`);
console.log('');

process.exit(echecs > 0 ? 1 : 0);
