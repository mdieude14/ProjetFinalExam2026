#!/usr/bin/env node
/**
 * ===========================================================================
 *  RÉSIDUS D'ESSAI — les trouver, les mesurer, puis seulement les retirer
 * ===========================================================================
 *
 *   npm run nettoyer:residus                   ESSAI À BLANC (par défaut)
 *   npm run nettoyer:residus -- --cible        sur la base de MONGO_URI_CIBLE
 *   npm run nettoyer:residus -- --supprimer    agit pour de bon
 *
 * ---------------------------------------------------------------------------
 *  POURQUOI L'ESSAI À BLANC EST LE DÉFAUT, ET NON L'OPTION
 * ---------------------------------------------------------------------------
 *
 * Ce script supprime des COMPTES et tout ce qui leur est rattaché. Le défaut
 * d'un outil destructeur doit être de ne rien détruire : il faut une
 * intention explicite — `--supprimer` — pour qu'il agisse.
 *
 * ---------------------------------------------------------------------------
 *  COMMENT IL RECONNAÎT UN RÉSIDU, ET POURQUOI PAS PAR LE PSEUDO
 * ---------------------------------------------------------------------------
 *
 * Un premier contrôle, écrit le 8 novembre, cherchait des PRÉFIXES de pseudo
 * devinés — `front`, `test`, `e2e`, `zumba`, `gina`, `hugo`. Il a annoncé
 * « 0 résidu » alors que la base en portait DIX-NEUF.
 *
 *   IL NE CONNAISSAIT PAS `probe`, NI `dbga`, NI `diagtls`, NI `epreuvetg`.
 *   Et il ne pouvait pas les connaître : la liste s'allonge à chaque séance
 *   de diagnostic, et personne ne pense à la tenir à jour.
 *
 * LE DOMAINE DU COURRIEL, LUI, NE MENT PAS. Un compte d'essai porte toujours
 * un domaine inventé — `.local`, `exemple.`, `invalid` — parce qu'aucun
 * script ne veut envoyer de vrai courriel. On classe donc par le domaine, et
 * non par le nom.
 *
 *   Avec DEUX exceptions explicites, et elles sont nommées :
 *     · les comptes d'INFRASTRUCTURE attendus (`admin`, `coachdemo`) portent
 *       un domaine inventé et doivent rester ;
 *     · un compte d'essai peut porter un VRAI domaine, lorsqu'un script a
 *       besoin de recevoir le courriel — c'est le cas de `epreuvetg`, qui
 *       emploie l'adresse du porteur du projet avec un suffixe `+`.
 *
 * ---------------------------------------------------------------------------
 *  ET LA CASCADE N'EST PAS UN DÉTAIL
 * ---------------------------------------------------------------------------
 *
 * Supprimer un compte sans ce qui lui est rattaché laisse des PUBLICATIONS
 * sans auteur, des notifications sans émetteur, des conversations avec un
 * participant disparu. L'application les affiche alors avec un auteur vide,
 * ou tombe.
 *
 * La cascade employée ici est celle des suites de tests
 * (`tests/moderation.mjs`), étendue aux collections des modules 11 et 15.
 * ===========================================================================
 */

import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const ARGS = process.argv.slice(2);
const SUPPRIMER = ARGS.includes('--supprimer');
const SUR_LA_CIBLE = ARGS.includes('--cible');
const CLE = SUR_LA_CIBLE ? 'MONGO_URI_CIBLE' : 'MONGO_URI';

const dire = (t) => console.log(`  ${t}`);
const crier = (t) => console.error(`  ${t}`);

/** Domaines de vrais fournisseurs : un compte qui en porte un est présumé réel. */
const DOMAINES_REELS =
  /@(gmail|outlook|hotmail|live|msn|yahoo|free|orange|sfr|laposte|wanadoo|icloud|me|protonmail|proton|gmx)\./i;

/** Comptes d'infrastructure attendus, créés par `creer-admin` et `coach-demo`. */
const ATTENDUS = ['admin', 'coachdemo'];

/**
 * Marques d'essai qui peuvent porter un VRAI domaine.
 * `epreuvetg` vient de `scripts/preparer-epreuve-telegram.mjs`, où
 * `const MARQUE = 'epreuvetg'` : le script a besoin de recevoir le courriel,
 * il emploie donc l'adresse du porteur du projet avec un suffixe `+`.
 */
const MARQUES_SUR_VRAI_DOMAINE = [/^epreuvetg/i];

const uri = process.env[CLE];

if (!uri) {
  crier(`${CLE} est absente.`);
  process.exit(1);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });

try {
  await client.connect();
} catch (erreur) {
  crier(`Base injoignable : ${erreur.message}`);
  process.exit(1);
}

const db = client.db();

console.log('');
console.log('='.repeat(78));
console.log(`  RÉSIDUS D'ESSAI${SUPPRIMER ? '  —  SUPPRESSION DEMANDÉE' : '  —  ESSAI À BLANC, RIEN NE SERA SUPPRIMÉ'}`);
console.log('='.repeat(78));
console.log('');
dire(`base : ${db.databaseName}   (${CLE})`);
console.log('');

/* ------------------------------------------------------------------ *
 *  LE CLASSEMENT
 * ------------------------------------------------------------------ */

const tous = await db
  .collection('users')
  .find({})
  .project({ pseudo: 1, email: 1, type: 1, createdAt: 1 })
  .sort({ createdAt: 1 })
  .toArray();

const residus = [];
const gardes = [];

for (const u of tous) {
  const courriel = String(u.email ?? '');
  const attendu = ATTENDUS.includes(u.pseudo);
  const marque = MARQUES_SUR_VRAI_DOMAINE.some((r) => r.test(u.pseudo));
  const vraiDomaine = DOMAINES_REELS.test(courriel);

  if (attendu) gardes.push({ ...u, motif: 'infrastructure attendue' });
  else if (marque) residus.push({ ...u, motif: 'marque d’essai connue' });
  else if (vraiDomaine) gardes.push({ ...u, motif: 'domaine de vrai fournisseur' });
  else residus.push({ ...u, motif: 'domaine inventé' });
}

console.log('  GARDÉS');
console.log('  ' + '-'.repeat(74));
for (const g of gardes) {
  console.log(
    `    ${String(g.pseudo).padEnd(24)} ${String(g.email ?? '').split('@')[1]?.padEnd(22) ?? ''} ${g.motif}`
  );
}

console.log('');
console.log('  RÉSIDUS');
console.log('  ' + '-'.repeat(74));

if (residus.length === 0) {
  dire('  aucun.');
}

const ids = residus.map((r) => r._id);

/* ------------------------------------------------------------------ *
 *  CE QUE CHAQUE RÉSIDU ENTRAÎNE
 * ------------------------------------------------------------------ */

const idsPosts = ids.length
  ? (await db.collection('posts').find({ auteur: { $in: ids } }, { projection: { _id: 1 } }).toArray()).map((p) => p._id)
  : [];

/*
 * LA CASCADE, COLLECTION PAR COLLECTION.
 * Reprise de `tests/moderation.mjs`, étendue aux modules 11 et 15. Chaque
 * entrée dit QUEL champ rattache le document au compte — l'oublier laisserait
 * un orphelin que l'application afficherait avec un auteur vide.
 */
const CASCADE = [
  ['posts', { auteur: { $in: ids } }],
  ['comments', { $or: [{ auteur: { $in: ids } }, { post: { $in: idsPosts } }] }],
  ['follows', { $or: [{ follower: { $in: ids } }, { following: { $in: ids } }] }],
  ['relations', { $or: [{ source: { $in: ids } }, { cible: { $in: ids } }] }],
  ['signalements', { $or: [{ signaleur: { $in: ids } }, { cible: { $in: ids } }] }],
  ['conversations', { participants: { $in: ids } }],
  ['messages', { $or: [{ expediteur: { $in: ids } }, { destinataire: { $in: ids } }] }],
  ['notifications', { $or: [{ destinataire: { $in: ids } }, { emetteur: { $in: ids } }] }],
  ['sportevents', { organisateur: { $in: ids } }],
  ['eventregistrations', { participant: { $in: ids } }],
  ['stories', { auteur: { $in: ids } }],
  ['storyviews', { spectateur: { $in: ids } }],
  ['subscriptions', { $or: [{ utilisateur: { $in: ids } }, { coach: { $in: ids } }] }],
  ['tickets', { auteur: { $in: ids } }],
];

for (const r of residus) {
  const quoi = [];
  for (const [col, filtre] of CASCADE) {
    // Le filtre global porte TOUS les ids : on le recompose pour ce seul compte.
    const n = await db.collection(col).countDocuments(reconstruire(filtre, r._id)).catch(() => 0);
    if (n > 0) quoi.push(`${col} ${n}`);
  }
  console.log(
    `    ${String(r.pseudo).padEnd(24)} ${String(r.email ?? '').split('@')[1]?.padEnd(22) ?? ''} ${r.motif}`
  );
  if (quoi.length) console.log(`        entraîne : ${quoi.join(' · ')}`);
}

/** Remplace les `$in: [tous les ids]` par `$in: [un seul id]`. */
function reconstruire(filtre, id) {
  const copie = JSON.parse(JSON.stringify(filtre, (cle, val) => (cle === '$in' ? ['@ID@'] : val)));
  const remettre = (o) => {
    for (const [k, v] of Object.entries(o)) {
      if (k === '$in') o[k] = [id];
      else if (Array.isArray(v)) v.forEach((x) => typeof x === 'object' && x && remettre(x));
      else if (v && typeof v === 'object') remettre(v);
    }
    return o;
  };
  return remettre(copie);
}

/* ------------------------------------------------------------------ *
 *  LE TOTAL, PUIS L'ACTION
 * ------------------------------------------------------------------ */

console.log('');
console.log('  ' + '-'.repeat(74));

const totaux = [];
for (const [col, filtre] of CASCADE) {
  if (!ids.length) break;
  const n = await db.collection(col).countDocuments(filtre).catch(() => 0);
  if (n > 0) totaux.push([col, n]);
}

const totalRattaches = totaux.reduce((s, [, n]) => s + n, 0);

dire(`${gardes.length} compte(s) gardé(s) · ${residus.length} résidu(s) · ${totalRattaches} document(s) rattaché(s)`);

if (totaux.length) {
  console.log('');
  for (const [col, n] of totaux) console.log(`      ${col.padEnd(24)} ${n}`);
}

if (!residus.length) {
  console.log('');
  await client.close();
  process.exit(0);
}

if (!SUPPRIMER) {
  console.log('');
  dire('ESSAI À BLANC : rien n’a été supprimé.');
  dire('Pour agir :   npm run nettoyer:residus --' + (SUR_LA_CIBLE ? ' --cible' : '') + ' --supprimer');
  console.log('');
  await client.close();
  process.exit(0);
}

/* --- La suppression, et le compte de ce qui part --- */

console.log('');
dire('SUPPRESSION EN COURS');
console.log('');

let retires = 0;
for (const [col, filtre] of CASCADE) {
  const r = await db.collection(col).deleteMany(filtre).catch(() => ({ deletedCount: 0 }));
  if (r.deletedCount > 0) {
    console.log(`      ${col.padEnd(24)} ${r.deletedCount} retiré(s)`);
    retires += r.deletedCount;
  }
}

const comptes = await db.collection('users').deleteMany({ _id: { $in: ids } });

console.log('');
dire(`${comptes.deletedCount} compte(s) et ${retires} document(s) rattaché(s) retirés.`);

/* --- ET ON RELIT : écrire sans relire, c'est espérer --- */
const restants = await db.collection('users').countDocuments();
const encoreResidus = await db
  .collection('users')
  .countDocuments({ _id: { $in: ids } });

console.log('');
if (encoreResidus === 0) {
  dire(`Relu : ${restants} compte(s) en base, aucun résidu restant.`);
} else {
  crier(`Relu : ${encoreResidus} résidu(s) SUBSISTENT. La suppression est incomplète.`);
}

console.log('');
await client.close();
process.exit(encoreResidus === 0 ? 0 : 1);
