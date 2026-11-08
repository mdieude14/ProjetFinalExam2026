#!/usr/bin/env node
/**
 * ===========================================================================
 *  PRÉ-VOL ATLAS — joignabilité du cluster, SANS AUCUN IDENTIFIANT
 * ===========================================================================
 *
 *   npm run verifier:atlas -- --hote=grappe.abcde.mongodb.net
 *   MONGO_URI_CIBLE="mongodb+srv://…" npm run verifier:atlas
 *
 * ---------------------------------------------------------------------------
 *  POURQUOI CE SCRIPT EXISTE : IL SÉPARE DEUX PANNES QU'ON CONFOND
 * ---------------------------------------------------------------------------
 *
 * Quand une connexion Atlas échoue, deux familles de causes se ressemblent et
 * ne se corrigent pas au même endroit :
 *
 *   A. LE CHEMIN RÉSEAU         DNS du poste, pare-feu, antivirus, FAI
 *   B. L'AUTORISATION           mot de passe, ou IP absente de « Network Access »
 *
 * Le message du pilote ne tranche pas : un `ETIMEDOUT` peut venir des deux, et
 * c'est l'erreur la plus courante de la mise en place d'Atlas.
 *
 *   CE SCRIPT NE TESTE QUE LA FAMILLE A, et il le fait SANS IDENTIFIANT :
 *   résolution DNS SRV, puis une simple ouverture de connexion TCP vers chaque
 *   nœud. Rien n'est authentifié, rien n'est lu.
 *
 *     s'il PASSE et que la connexion échoue quand même → c'est la famille B ;
 *     s'il ÉCHOUE → inutile de chercher du côté du mot de passe.
 *
 * ---------------------------------------------------------------------------
 *  ET IL MESURE LA LATENCE, CE QUI RÉPOND À UNE QUESTION QU'ON SE POSE TROP TARD
 * ---------------------------------------------------------------------------
 *
 * La région du cluster se choisit à sa création et ne se change plus : il faut
 * en recréer un. Or une région lointaine ne provoque aucune erreur — elle
 * ajoute seulement ~100 ms à CHAQUE appel, et une page qui en fait dix devient
 * lente sans qu'aucune mesure du code ne l'explique.
 *
 *   La mesure se fait ici en quelques secondes, AVANT de migrer quoi que ce
 *   soit. Après, elle coûte de recommencer.
 *
 * ⚠️ LA PREMIÈRE OUVERTURE EST TOUJOURS LENTE — elle inclut la résolution DNS.
 * Mesurée seule, elle a rendu 1 130 ms là où la médiane des suivantes était de
 * 27 ms. On écarte donc la première, et on prend la MÉDIANE : une moyenne
 * laisserait un à-coup peser sur le verdict.
 * ===========================================================================
 */

import dotenv from 'dotenv';
import { resolveSrv, resolveTxt } from 'node:dns/promises';
import { Socket } from 'node:net';

dotenv.config();

const ARGS = process.argv.slice(2);
const ECHANTILLONS = 6; // la première est écartée

const dire = (t) => console.log(`  ${t}`);
const crier = (t) => console.error(`  ${t}`);

/* ------------------------------------------------------------------ *
 *  1 — L'HÔTE, ET IL N'EST JAMAIS UN SECRET
 * ------------------------------------------------------------------ */

/*
 * UN NOM DE CLUSTER N'EST PAS UN IDENTIFIANT. Il se résout par DNS public, et
 * y accéder demande un mot de passe ET une IP autorisée. On peut donc
 * l'afficher, contrairement à l'URI complète — dont ce script n'extrait que
 * l'hôte, précisément pour ne jamais manipuler le reste.
 */
const hoteDe = (uri) => {
  const sansSchema = String(uri ?? '').replace(/^mongodb(\+srv)?:\/\//, '');
  const apresArobase = sansSchema.includes('@')
    ? sansSchema.slice(sansSchema.lastIndexOf('@') + 1)
    : sansSchema;
  return apresArobase.split(/[/?,]/)[0].replace(/:\d+$/, '');
};

const argHote = ARGS.find((a) => a.startsWith('--hote='))?.slice(7);
const hote = argHote || hoteDe(process.env.MONGO_URI_CIBLE || process.env.MONGO_URI || '');

if (!hote) {
  crier('Aucun hôte à vérifier.');
  crier('');
  crier('    npm run verifier:atlas -- --hote=grappe.abcde.mongodb.net');
  crier('  ou MONGO_URI_CIBLE="mongodb+srv://…" npm run verifier:atlas');
  process.exit(1);
}

if (/localhost|127\.0\.0\.1/i.test(hote)) {
  crier(`« ${hote} » est une adresse locale : ce script vérifie un cluster Atlas.`);
  process.exit(1);
}

console.log('');
console.log('='.repeat(74));
console.log('  PRÉ-VOL ATLAS — aucun identifiant n’est employé');
console.log('='.repeat(74));
console.log('');
dire(`cluster : ${hote}`);
console.log('');

let echecs = 0;

/* ------------------------------------------------------------------ *
 *  2 — LA RÉSOLUTION DNS SRV
 * ------------------------------------------------------------------ */

let noeuds = [];

try {
  noeuds = await resolveSrv(`_mongodb._tcp.${hote}`);
  dire(`OK     DNS SRV résolu           ${noeuds.length} nœud(s)`);

  /*
   * TROIS NŒUDS, C'EST LA SIGNATURE D'UN JEU DE RÉPLIQUES — et c'est la
   * propriété dont dépendent les 20 transactions de l'application. Un seul
   * nœud annoncé mériterait qu'on s'y arrête avant de migrer.
   */
  if (noeuds.length >= 3) {
    dire(`       → trois nœuds ou plus : jeu de répliques, les transactions passeront`);
  } else {
    dire(`       → ATTENTION : ${noeuds.length} nœud(s) seulement. Un jeu de répliques en annonce trois.`);
  }
} catch (erreur) {
  echecs += 1;
  crier(`ECHEC  DNS SRV                  ${erreur.code ?? erreur.message}`);
  crier('');
  crier('  DEUX CAUSES, ET ELLES NE SE CORRIGENT PAS AU MÊME ENDROIT :');
  crier('    · le nom du cluster est mal recopié — le plus fréquent ;');
  crier('    · le DNS de ce poste ne répond pas. Ce projet en a déjà fait');
  crier('      l’expérience : un ENOTFOUND vient du poste, pas du code.');
  crier('');
  crier('  Rien ne sert de vérifier le mot de passe tant que ceci échoue.');
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 *  3 — LES OPTIONS ANNONCÉES PAR LE CLUSTER
 * ------------------------------------------------------------------ */

try {
  const txt = (await resolveTxt(hote)).flat().join('');
  if (txt) dire(`OK     options annoncées       ${txt}`);
} catch {
  /* Pas d'enregistrement TXT : Atlas n'en pose pas toujours, ce n'est pas une faute. */
}

/* ------------------------------------------------------------------ *
 *  4 — LE CHEMIN RÉSEAU VERS CHAQUE NŒUD
 * ------------------------------------------------------------------ */

const ouvrir = (nom, port, delai = 8000) =>
  new Promise((res) => {
    const t0 = Date.now();
    const s = new Socket();
    s.setTimeout(delai);
    s.on('connect', () => {
      res(Date.now() - t0);
      s.destroy();
    });
    s.on('timeout', () => {
      res(null);
      s.destroy();
    });
    s.on('error', () => res(null));
    s.connect(port, nom);
  });

console.log('');

let joignables = 0;

for (const n of noeuds) {
  const ms = await ouvrir(n.name, n.port);
  if (ms === null) {
    echecs += 1;
    crier(`ECHEC  ${n.name}:${n.port}  injoignable`);
  } else {
    joignables += 1;
    dire(`OK     ${n.name}:${n.port}  (${ms} ms)`);
  }
}

if (joignables === 0) {
  console.log('');
  crier('AUCUN nœud n’est joignable sur le port MongoDB.');
  crier('');
  crier('  Ce n’est PAS une question d’identifiants ni de liste d’IP : la');
  crier('  connexion n’arrive même pas jusqu’au serveur.');
  crier('    · un pare-feu ou l’antivirus bloque le port sortant ;');
  crier('    · un réseau d’entreprise ou public filtre les ports non usuels.');
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 *  5 — LA LATENCE, ET CE QU'ELLE DIT DE LA RÉGION
 * ------------------------------------------------------------------ */

const cible = noeuds[0];
const mesures = [];

for (let i = 0; i < ECHANTILLONS; i += 1) {
  const ms = await ouvrir(cible.name, cible.port, 5000);
  if (ms !== null) mesures.push(ms);
}

// On écarte la première : elle porte la résolution DNS.
const utiles = mesures.slice(1).sort((a, b) => a - b);

console.log('');

if (utiles.length === 0) {
  dire('Latence non mesurable (une seule ouverture a abouti).');
} else {
  const mediane = utiles[Math.floor(utiles.length / 2)];
  dire(`médiane de ${utiles.length} ouvertures : ${mediane} ms   [${utiles.join(', ')}]`);

  const lecture =
    mediane < 60
      ? 'EUROPE — le cluster est bien placé'
      : mediane < 110
        ? 'Europe lointaine, ou réseau chargé — acceptable'
        : 'VRAISEMBLABLEMENT HORS EUROPE — à vérifier dans Atlas AVANT de migrer';

  dire(`lecture : ${lecture}`);

  if (mediane >= 110) {
    console.log('');
    crier('  La région se choisit à la création et ne se change plus : il faut');
    crier('  recréer le cluster. ~100 ms s’ajoutent à CHAQUE appel, sans qu’aucune');
    crier('  erreur ne le signale — seulement des pages lentes.');
  }
}

/* ------------------------------------------------------------------ *
 *  6 — LE VERDICT, ET CE QU'IL NE DIT PAS
 * ------------------------------------------------------------------ */

console.log('');
console.log('-'.repeat(74));

if (echecs === 0) {
  dire('LE CHEMIN RÉSEAU EST DÉGAGÉ.');
  console.log('');
  dire('Ce que ce résultat NE prouve PAS, et il faut le dire :');
  dire('  · ni que le mot de passe est bon ;');
  dire('  · ni que l’IP de ce poste figure dans « Network Access ».');
  console.log('');
  dire('Si une connexion échoue maintenant, c’est l’une de ces deux-là —');
  dire('et non le réseau. C’est tout l’intérêt d’avoir séparé les deux.');
} else {
  crier(`${echecs} contrôle(s) en échec.`);
}

console.log('');
process.exit(echecs > 0 ? 1 : 0);
