#!/usr/bin/env node
/**
 * ===========================================================================
 *  MIGRATION DE LA BASE VERS UNE AUTRE — DOCKER LOCAL → MONGODB ATLAS
 * ===========================================================================
 *
 *   MONGO_URI_CIBLE="mongodb+srv://…/sportsocial" npm run migrer:atlas -- --essai
 *   MONGO_URI_CIBLE="mongodb+srv://…/sportsocial" npm run migrer:atlas
 *
 * ---------------------------------------------------------------------------
 *  POURQUOI PAS `mongodump | mongorestore`
 * ---------------------------------------------------------------------------
 *
 * Les deux outils existent, mais seulement DANS le conteneur — pas sur le
 * poste. Les deux voies évidentes ont chacune un défaut :
 *
 *   1. Faire passer l'archive par un tube `docker exec` : sous Git Bash, un
 *      flux BINAIRE traversant un tube Windows peut être altéré. Une archive
 *      corrompue se restaure à moitié, et le diagnostic coûte une soirée.
 *
 *   2. Appeler `mongorestore --uri=<atlas>` dans le conteneur : l'URI
 *      contient le MOT DE PASSE de la base, et un argument de commande est
 *      visible de toute la machine dans la liste des processus. C'est
 *      exactement la leçon du relais Stripe.
 *
 * D'où ce script : l'URI ne quitte jamais l'environnement de ce processus,
 * rien de binaire ne circule, et chaque étape se vérifie.
 *
 * ---------------------------------------------------------------------------
 *  CE QU'IL REFUSE DE FAIRE
 * ---------------------------------------------------------------------------
 *
 *   · écrire dans une collection cible NON VIDE, sans `--ecraser` ;
 *   · migrer vers la base dont il part (source et cible identiques) ;
 *   · se taire sur un écart de comptage : il ressort 1.
 *
 * ---------------------------------------------------------------------------
 *  ET LE PIÈGE DES INDEX, QUI N'EST PAS CELUI QU'ON CROIT
 * ---------------------------------------------------------------------------
 *
 * Copier les documents sans les index donne une base qui RÉPOND mais qui ne
 * TROUVE rien, et qui n'empêche plus deux comptes de porter le même pseudo.
 *
 * Or un index TEXTUEL ne se recopie pas tel quel. `listIndexes` le décrit
 * avec la clé interne `{ _fts: 'text', _ftsx: 1 }` et un objet `weights` à
 * côté ; renvoyer cette clé à `createIndex` échoue. Il faut RECONSTRUIRE la
 * clé depuis `weights`. Trois collections sont concernées ici : `users`,
 * `posts`, `sportevents`.
 * ===========================================================================
 */

import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const ARGS = process.argv.slice(2);
const ESSAI = ARGS.includes('--essai');
const ECRASER = ARGS.includes('--ecraser');
const EXCLUES = (ARGS.find((a) => a.startsWith('--sauf='))?.slice(7) ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const LOT = 500;

const dire = (t) => console.log(`  ${t}`);
const crier = (t) => console.error(`  ${t}`);

/** Masque tout ce qui ressemble à un identifiant dans une URI. */
const sansSecret = (uri) =>
  String(uri ?? '').replace(/\/\/[^@/]*@/, '//<identifiants masqués>@');

/* ------------------------------------------------------------------ *
 *  1 — LES DEUX ADRESSES
 * ------------------------------------------------------------------ */

const SOURCE = process.env.MONGO_URI;
const CIBLE = process.env.MONGO_URI_CIBLE;

if (!SOURCE) {
  crier('MONGO_URI est absente : la source est inconnue.');
  process.exit(1);
}

if (!CIBLE) {
  crier('MONGO_URI_CIBLE est absente.');
  crier('');
  crier('  L’URI de destination se passe par l’ENVIRONNEMENT, jamais en');
  crier('  argument : un argument de commande est visible de toute la machine');
  crier('  dans la liste des processus, et celui-ci porte un mot de passe.');
  crier('');
  crier('    MONGO_URI_CIBLE="mongodb+srv://…/sportsocial" npm run migrer:atlas -- --essai');
  process.exit(1);
}

if (SOURCE === CIBLE) {
  crier('REFUS : la source et la cible sont la même adresse.');
  process.exit(1);
}

/** Le nom de base porté par une URI, ou null. */
const baseDe = (uri) => {
  try {
    const chemin = new URL(uri.replace(/^mongodb\+srv:/, 'https:').replace(/^mongodb:/, 'http:'))
      .pathname;
    const nom = chemin.replace(/^\//, '').split('?')[0];
    return nom || null;
  } catch {
    return null;
  }
};

const baseSource = baseDe(SOURCE);
const baseCible = baseDe(CIBLE);

if (!baseCible) {
  crier('REFUS : l’URI de destination ne nomme aucune base.');
  crier('');
  crier('  C’est le piège le plus coûteux de la mise en place d’Atlas : sans');
  crier('  nom de base, le pilote écrit dans `test`, et l’application paraît');
  crier('  vide alors que tout fonctionne.');
  crier('');
  crier('  Insérez le nom AVANT le `?` :  …mongodb.net/sportsocial?retryWrites=true');
  process.exit(1);
}

console.log('');
console.log('='.repeat(76));
console.log(`  MIGRATION DE LA BASE${ESSAI ? '  —  ESSAI À BLANC, RIEN NE SERA ÉCRIT' : ''}`);
console.log('='.repeat(76));
console.log('');
dire(`source : ${sansSecret(SOURCE)}`);
dire(`cible  : ${sansSecret(CIBLE)}`);
if (EXCLUES.length) dire(`exclues : ${EXCLUES.join(', ')}`);
console.log('');

/* ------------------------------------------------------------------ *
 *  2 — LES DEUX CONNEXIONS
 * ------------------------------------------------------------------ */

const clientSource = new MongoClient(SOURCE, { serverSelectionTimeoutMS: 10000 });
const clientCible = new MongoClient(CIBLE, { serverSelectionTimeoutMS: 20000 });

try {
  await clientSource.connect();
  dire(`source joignable  (base « ${baseSource ?? 'par défaut'} »)`);
} catch (erreur) {
  crier(`La source est injoignable : ${erreur.message}`);
  process.exit(1);
}

try {
  await clientCible.connect();
  dire(`cible joignable   (base « ${baseCible} »)`);
} catch (erreur) {
  crier(`La cible est injoignable : ${erreur.message}`);
  crier('');
  if (/certificate|SSL|TLS/i.test(erreur.message)) {
    crier('  LE MESSAGE PARLE DE CERTIFICAT. Sur ce poste, l’antivirus');
    crier('  intercepte les connexions chiffrées — c’est la panne qui a');
    crier('  occupé n8n pendant deux jours. Essayez depuis un autre réseau,');
    crier('  ou désactivez temporairement l’analyse HTTPS d’Avast.');
  } else if (/timed out|ETIMEDOUT|ENOTFOUND/i.test(erreur.message)) {
    crier('  DEUX CAUSES POSSIBLES, et elles se ressemblent :');
    crier('    · l’IP de ce poste n’est pas autorisée dans « Network Access » ;');
    crier('    · le nom du cluster est mal recopié.');
  }
  await clientSource.close();
  process.exit(1);
}

const dbSource = clientSource.db(baseSource ?? undefined);
const dbCible = clientCible.db(baseCible);

/* ------------------------------------------------------------------ *
 *  3 — L'INVENTAIRE, ET LE REFUS D'ÉCRASER
 * ------------------------------------------------------------------ */

const collections = (await dbSource.listCollections().toArray())
  .map((c) => c.name)
  .filter((n) => !n.startsWith('system.'))
  .filter((n) => !EXCLUES.includes(n))
  .sort();

console.log('');
console.log('  COLLECTION                   SOURCE     CIBLE AVANT');
console.log('  ' + '-'.repeat(52));

const plan = [];
let occupees = 0;

for (const nom of collections) {
  const aSource = await dbSource.collection(nom).countDocuments();
  const aCible = await dbCible.collection(nom).countDocuments().catch(() => 0);
  if (aCible > 0) occupees += 1;
  plan.push({ nom, aSource, aCible });
  console.log(
    `  ${nom.padEnd(28)}${String(aSource).padStart(6)}${String(aCible).padStart(11)}${aCible > 0 ? '   <<< NON VIDE' : ''}`
  );
}

if (occupees > 0 && !ECRASER && !ESSAI) {
  console.log('');
  crier(`REFUS : ${occupees} collection(s) de la cible ne sont pas vides.`);
  crier('');
  crier('  Insérer par-dessus créerait des doublons, ou échouerait sur les');
  crier('  index uniques à mi-parcours — en laissant la base à moitié migrée,');
  crier('  ce qui est pire que de ne rien avoir fait.');
  crier('');
  crier('  Relancez avec `-- --ecraser` pour VIDER ces collections d’abord,');
  crier('  après avoir vérifié que la cible ne contient rien d’utile.');
  await clientSource.close();
  await clientCible.close();
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 *  4 — LA RECONSTRUCTION D'UN INDEX
 * ------------------------------------------------------------------ */

/**
 * Rend la description d'index telle que `createIndexes` l'attend.
 *
 * UN INDEX TEXTUEL NE SE RECOPIE PAS TEL QUEL : `listIndexes` le décrit avec
 * la clé interne `{ _fts: 'text', _ftsx: 1 }`, et les vrais champs vivent
 * dans `weights`. Renvoyer cette clé échoue. On la reconstruit.
 */
const indexCopiable = (index) => {
  const { v, ns, key, weights, textIndexVersion, ...reste } = index;

  if (!textIndexVersion) return { key, ...reste };

  const cleTexte = {};
  for (const champ of Object.keys(weights ?? {})) cleTexte[champ] = 'text';

  // `weights` n'est conservé que s'il n'est pas uniforme : sinon il est implicite.
  const poids = Object.values(weights ?? {});
  const uniforme = poids.every((p) => p === poids[0]);

  return uniforme ? { key: cleTexte, ...reste } : { key: cleTexte, weights, ...reste };
};

/* ------------------------------------------------------------------ *
 *  5 — LA COPIE
 * ------------------------------------------------------------------ */

if (ESSAI) {
  console.log('');
  dire('ESSAI À BLANC : rien n’a été écrit.');
  console.log('');
  dire('Les index qui seraient recréés :');
  for (const { nom } of plan) {
    const index = await dbSource.collection(nom).listIndexes().toArray();
    const utiles = index.filter((i) => i.name !== '_id_');
    if (!utiles.length) continue;
    for (const i of utiles) {
      const d = indexCopiable(i);
      const forme = Object.entries(d.key)
        .map(([c, v]) => `${c}:${v}`)
        .join(', ');
      const options = [d.unique && 'unique', d.sparse && 'sparse', d.expireAfterSeconds !== undefined && `ttl ${d.expireAfterSeconds}s`]
        .filter(Boolean)
        .join(' ');
      console.log(`      ${nom.padEnd(22)} ${i.name.padEnd(34)} { ${forme} }${options ? '  [' + options + ']' : ''}`);
    }
  }
  console.log('');
  await clientSource.close();
  await clientCible.close();
  process.exit(0);
}

console.log('');
console.log('  COLLECTION                   COPIÉS   INDEX   VÉRIFICATION');
console.log('  ' + '-'.repeat(60));

let ecarts = 0;

for (const { nom, aSource } of plan) {
  const source = dbSource.collection(nom);
  const cible = dbCible.collection(nom);

  if (ECRASER) await cible.deleteMany({});

  /* --- les documents, par lots --- */
  let copies = 0;
  if (aSource > 0) {
    const curseur = source.find({}, { noCursorTimeout: false });
    let lot = [];
    for await (const doc of curseur) {
      lot.push(doc);
      if (lot.length >= LOT) {
        await cible.insertMany(lot, { ordered: false });
        copies += lot.length;
        lot = [];
      }
    }
    if (lot.length) {
      await cible.insertMany(lot, { ordered: false });
      copies += lot.length;
    }
  }

  /* --- puis les index, et APRÈS les documents --- */
  /*
   * L'ORDRE COMPTE. Créer un index unique AVANT d'insérer ferait échouer
   * l'insertion au premier doublon légitime d'une base de développement, et
   * on s'arrêterait à mi-parcours. Après, l'index est construit sur des
   * données déjà en place : s'il refuse, c'est que la source elle-même
   * violait sa propre contrainte, et il valait mieux l'apprendre ici.
   */
  const index = (await source.listIndexes().toArray()).filter((i) => i.name !== '_id_');
  let poses = 0;
  for (const i of index) {
    try {
      await cible.createIndexes([indexCopiable(i)]);
      poses += 1;
    } catch (erreur) {
      crier(`index « ${i.name} » sur ${nom} : ${erreur.message}`);
    }
  }

  /* --- et on RELIT : écrire sans relire, c'est espérer --- */
  const apres = await cible.countDocuments();
  const conforme = apres === aSource;
  if (!conforme) ecarts += 1;

  console.log(
    `  ${nom.padEnd(28)}${String(copies).padStart(6)}${String(poses).padStart(8)}   ${
      conforme ? `${apres} = ${aSource}  OK` : `${apres} ≠ ${aSource}  ÉCART`
    }`
  );
}

/* ------------------------------------------------------------------ *
 *  6 — LE VERDICT
 * ------------------------------------------------------------------ */

const totalSource = plan.reduce((s, p) => s + p.aSource, 0);
const totalCible = await plan.reduce(
  async (acc, p) => (await acc) + (await dbCible.collection(p.nom).countDocuments()),
  Promise.resolve(0)
);

console.log('');
console.log('  ' + '-'.repeat(60));
console.log(`  ${plan.length} collection(s) · ${totalSource} document(s) à la source · ${totalCible} à la cible`);
console.log('');

if (ecarts > 0) {
  crier(`${ecarts} collection(s) présentent un écart. LA MIGRATION N’EST PAS CONFORME.`);
} else {
  dire('Migration conforme, comptages relus et égaux.');
  console.log('');
  dire('IL RESTE DEUX GESTES, et le second n’est pas optionnel :');
  dire('  1. poser cette URI dans MONGO_URI sur l’hébergeur de l’API ;');
  dire('  2. lancer `npm run verifier:deploiement` contre elle — c’est lui qui');
  dire('     éprouve que les TRANSACTIONS passent, ce qu’un comptage ne dit pas.');
}

console.log('');
await clientSource.close();
await clientCible.close();
process.exit(ecarts > 0 ? 1 : 0);
