#!/usr/bin/env node
/**
 * ===========================================================================
 *  CONTRÔLE DE SECRETS — il COMPTE, il NOMME, il ne MONTRE jamais
 * ===========================================================================
 *
 *   npm run verifier:secrets              ce qui est indexé (avant un commit)
 *   npm run verifier:secrets -- --arbre   tous les fichiers suivis
 *   npm run verifier:secrets -- --tout    TOUT l'historique du dépôt
 *
 * Code de sortie 1 s'il trouve quelque chose. C'est ce qui en fait un garde
 * et non une décoration.
 *
 * ---------------------------------------------------------------------------
 *  POURQUOI CE SCRIPT EXISTE : DEUX FAUTES DE MÉTHODE, LES MIENNES
 * ---------------------------------------------------------------------------
 *
 * 1. LE CONTRÔLE N'EN ÉTAIT PAS UN. Je retapais un `grep` à la main avant
 *    chaque commit, puis je lisais sa sortie à l'œil — dans la MÊME commande
 *    que le `git commit`. Le 8 novembre, il a annoncé « 2 correspondances »
 *    et le commit est parti quand même.
 *
 *      UN GARDE QUI NE BLOQUE PAS EST UNE DÉCORATION. Celui-ci ressort 1.
 *
 * 2. LES MOTIFS ÉTAIENT INCOHÉRENTS. Certains exigeaient une longueur
 *    (`sk_live_[A-Za-z0-9]{6}`), deux ne l'exigeaient pas (`sk-ant-`,
 *    `ghp_`). Résultat : ils se déclenchaient sur leur propre nom, dès que
 *    j'écrivais « sk-ant- » dans le journal pour expliquer le contrôle.
 *
 *      UN MOTIF QUI S'ALARME QUAND ON PARLE DE LUI FINIT PAR N'ÊTRE PLUS LU.
 *      Tous exigent désormais une longueur réaliste.
 *
 * ---------------------------------------------------------------------------
 *  ET IL N'AFFICHE JAMAIS CE QU'IL TROUVE
 * ---------------------------------------------------------------------------
 *
 * Le 8 novembre, un `grep -rn` lancé pour vérifier qu'un secret n'était pas
 * exposé a imprimé la ligne entière du `.env`, mot de passe compris.
 *
 *   UN CONTRÔLE QUI VÉRIFIE QU'UN SECRET N'EST PAS EXPOSÉ NE DOIT JAMAIS
 *   AFFICHER CE QU'IL TROUVE. Ici : le nom du motif, le nombre, et le
 *   fichier. Jamais la ligne, jamais la valeur.
 * ===========================================================================
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/*
 * SANS CETTE LIGNE, LE TEST DÉCISIF NE S'EXÉCUTE PAS.
 *
 * Premier jet : le script lisait `process.env.MONGO_URI_CIBLE` sans avoir
 * chargé `server/.env`. La variable était donc toujours absente, le bloc des
 * identifiants réels annonçait « rien à comparer », et le contrôle rendait un
 * verdict qui ne reposait que sur les motifs génériques.
 *
 *   ENCORE UN CONTRÔLE QUI NE S'EXÉCUTE PAS, ET QUI RESSEMBLE À UN CONTRÔLE
 *   QUI PASSE. Le troisième de ce genre en deux jours.
 */
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const RACINE = fileURLToPath(new URL('../..', import.meta.url));
const ARGS = process.argv.slice(2);
const TOUT = ARGS.includes('--tout');
const ARBRE = ARGS.includes('--arbre');

const dire = (t) => console.log(`  ${t}`);
const crier = (t) => console.error(`  ${t}`);

const git = (args) => {
  try {
    return execFileSync('git', args, { cwd: RACINE, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  } catch (erreur) {
    return erreur.stdout ?? '';
  }
};

/*
 * LES MOTIFS, ET CHACUN EXIGE UNE LONGUEUR.
 *
 * Sans longueur, un motif attrape son propre nom dès qu'on l'écrit dans une
 * documentation — et le contrôle devient une alarme qu'on apprend à ignorer.
 * Les longueurs retenues sont celles des vrais jetons, moins une marge.
 */
const MOTIFS = [
  ['clé Stripe RÉELLE', /sk_live_[A-Za-z0-9]{20,}/g],
  ['clé Stripe de test', /sk_test_[A-Za-z0-9]{20,}/g],
  ['clé publiable Stripe', /pk_(?:live|test)_[A-Za-z0-9]{20,}/g],
  ['secret de webhook Stripe', /whsec_[A-Za-z0-9]{20,}/g],
  ['jeton de bot Telegram', /\b\d{9,10}:AA[A-Za-z0-9_-]{30,}/g],
  ['clé Google API', /AIza[A-Za-z0-9_-]{33,}/g],
  ['clé API Anthropic', /sk-ant-[A-Za-z0-9_-]{24,}/g],
  ['jeton GitHub', /gh[pousr]_[A-Za-z0-9]{30,}/g],
  ['jeton de rafraîchissement Google', /\b1\/\/[A-Za-z0-9_-]{40,}/g],
  ['clé privée', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g],
  ['secret JWT en clair', /JWT_(?:ACCESS|REFRESH)_SECRET\s*=\s*[A-Fa-f0-9]{48,}/g],
  ['identifiants dans une URI Mongo', /mongodb\+srv:\/\/[A-Za-z0-9._-]+:[A-Za-z0-9]{12,}@/g],
];

/*
 * ET LES IDENTIFIANTS RÉELS DE CETTE INSTALLATION.
 *
 * C'est le test qui tranche vraiment. Un motif générique attrape les exemples
 * de documentation ; chercher ce qu'on SAIT être réel ne se trompe pas.
 * Lus depuis l'environnement, jamais écrits ici.
 */
const reels = () => {
  const liste = [];
  const uri = process.env.MONGO_URI_CIBLE ?? '';

  /*
   * ON PREND LE SECOND LABEL DE L'HÔTE, PAS LE PREMIER.
   *
   * Un hôte Atlas s'écrit `<nom-du-cluster>.<identifiant>.mongodb.net`. Mon
   * premier jet extrayait `([^./]+)\.` juste après l'arobase — donc le NOM du
   * cluster, que son porteur avait appelé « coachconnect ».
   *
   *   LE CONTRÔLE A DONC ANNONCÉ 106 OCCURRENCES D'UN « IDENTIFIANT RÉEL »
   *   QUI ÉTAIT LE NOM DU PROJET. Une alarme assourdissante et entièrement
   *   fausse, née d'une extraction qui visait un label de trop à gauche.
   *
   * Le nom du cluster n'est d'ailleurs pas un secret : c'est l'identifiant
   * qui l'est à moitié, et l'hôte complet qui vaut d'être surveillé.
   */
  const m = uri.match(/\/\/([^:]+):[^@]+@([^/?]+)/);
  if (m) {
    const hote = m[2];
    const labels = hote.split('.');
    liste.push(['nom d’utilisateur de la base', m[1]]);
    liste.push(['hôte complet du cluster', hote]);
    if (labels[1] && labels[1].length >= 5) {
      liste.push(['identifiant du cluster', labels[1]]);
    }
  }
  for (const cle of ['SUPPORT_SERVICE_KEY', 'SUPPORT_AGENT_KEY', 'TELEGRAM_BOT_TOKEN']) {
    const v = process.env[cle];
    if (v && v.length >= 16) liste.push([cle, v]);
  }
  return liste;
};

/* ------------------------------------------------------------------ *
 *  LA MATIÈRE À EXAMINER
 * ------------------------------------------------------------------ */

let perimetre;
let texte;

if (TOUT) {
  perimetre = `tout l’historique (${git(['rev-list', '--all', '--count']).trim()} commits)`;
  texte = git(['log', '--all', '-p']);
} else if (ARBRE) {
  const fichiers = git(['ls-files']).split('\n').filter(Boolean);
  perimetre = `${fichiers.length} fichier(s) suivi(s)`;
  texte = fichiers.map((f) => git(['show', `HEAD:${f}`])).join('\n');
} else {
  perimetre = 'ce qui est indexé';
  texte = git(['diff', '--cached']);
  if (!texte.trim()) {
    perimetre = 'rien d’indexé — examen du diff de travail';
    texte = git(['diff']);
  }
}

console.log('');
console.log('='.repeat(74));
console.log('  CONTRÔLE DE SECRETS');
console.log('='.repeat(74));
console.log('');
dire(`périmètre : ${perimetre}`);
dire(`volume    : ${(texte.length / 1024).toFixed(0)} Kio examinés`);
console.log('');

/* ------------------------------------------------------------------ *
 *  LES MOTIFS GÉNÉRIQUES
 * ------------------------------------------------------------------ */

let trouves = 0;

/*
 * LES MARQUES DE DOCUMENTATION, ÉCARTÉES EXPLICITEMENT.
 *
 * `docs/DEPLOIEMENT.md` montre la forme d'une URI Atlas, et
 * `scripts/lib/uri-mongo.mjs` DOIT contenir des URI puisqu'il teste un
 * diagnostic d'URI. Leurs mots de passe fictifs sont assez longs pour
 * satisfaire le motif — et le contrôle s'alarmait donc sur ses propres
 * exemples.
 *
 *   UNE ALARME QUI SONNE SUR DU CODE EXEMPLAIRE FINIT PAR N'ÊTRE PLUS LUE.
 *   La liste est courte et nommée : si une vraie valeur contenait l'un de ces
 *   mots, elle serait de toute façon à changer.
 */
const MARQUES = /mot[_-]?de[_-]?passe|motdepasse|password|MOT_DE_PASSE|db_password|TON-MDP|exemple|example|utilisateur|<[^>]*>/i;

for (const [nom, motif] of MOTIFS) {
  const bruts = texte.match(motif) ?? [];
  const reels_ = bruts.filter((x) => !MARQUES.test(x));
  const ecartes = bruts.length - reels_.length;

  if (reels_.length === 0) {
    dire(
      `OK      ${nom.padEnd(40)} aucune trace${ecartes ? `   (${ecartes} marque(s) de doc écartée(s))` : ''}`
    );
  } else {
    trouves += reels_.length;
    crier(`TROUVÉ  ${nom.padEnd(40)} ${reels_.length} occurrence(s)`);
  }
}

/* ------------------------------------------------------------------ *
 *  LES IDENTIFIANTS RÉELS — LE TEST QUI TRANCHE
 * ------------------------------------------------------------------ */

const connus = reels();

console.log('');
if (connus.length === 0) {
  dire('·       aucun identifiant réel lisible dans l’environnement :');
  dire('        le test décisif n’a pas pu être fait. Lancez depuis server/.');
} else {
  for (const [nom, valeur] of connus) {
    const n = texte.split(valeur).length - 1;
    if (n === 0) {
      dire(`OK      ${nom.padEnd(40)} absent`);
    } else {
      trouves += n;
      crier(`TROUVÉ  ${nom.padEnd(40)} ${n} occurrence(s)  <<< RÉEL`);
    }
  }
}

/* ------------------------------------------------------------------ *
 *  ET LES FICHIERS QUI NE DOIVENT JAMAIS PARTIR
 * ------------------------------------------------------------------ */

console.log('');

const SENSIBLES = [
  'server/.env',
  'client/.env',
  'docker/n8n/.env',
  'docker/n8n/destinations.local.json',
];

for (const f of SENSIBLES) {
  let ignore = false;
  try {
    execFileSync('git', ['check-ignore', '-q', f], { cwd: RACINE });
    ignore = true;
  } catch {
    ignore = false;
  }
  const suivi = git(['ls-files', '--', f]).trim() !== '';
  if (suivi) {
    trouves += 1;
    crier(`TROUVÉ  ${f.padEnd(40)} EST SUIVI PAR GIT  <<<`);
  } else if (ignore) {
    dire(`OK      ${f.padEnd(40)} ignoré, non suivi`);
  } else {
    dire(`·       ${f.padEnd(40)} absent du dépôt`);
  }
}

/* ------------------------------------------------------------------ *
 *  LE VERDICT
 * ------------------------------------------------------------------ */

console.log('');
console.log('-'.repeat(74));

if (trouves === 0) {
  dire('RIEN DE SENSIBLE. Le commit peut partir.');
} else {
  crier(`${trouves} CORRESPONDANCE(S). NE PAS POUSSER avant d’avoir regardé.`);
  crier('');
  crier('  Pour localiser SANS afficher la valeur :');
  crier('      git log --all --oneline -S"<le motif>"      les commits');
  crier('      git grep -l "<le motif>" HEAD               les fichiers');
}

console.log('');
process.exit(trouves > 0 ? 1 : 0);
