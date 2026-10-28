/**
 * ===========================================================================
 *  AUCUN TIRET CADRATIN DANS CE QUE LIT L'UTILISATEUR — contrôle général
 * ===========================================================================
 *
 * Demandé par le porteur du projet. La règle existait déjà, mais appliquée au
 * seul texte que Claude PRODUIT (`sansCadratin()` dans les flux n8n) et, depuis
 * le 27 octobre 2026, aux deux textes de présentation du widget. Elle ne
 * couvrait pas le reste de l'application.
 *
 * ───────────────────────────────────────────────────────────────────────────
 *  POURQUOI ON LIT LE PAQUET DE PRODUCTION, ET NON LES SOURCES
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Les sources du projet contiennent **939 cadratins répartis sur 171 fichiers
 * sur 197** : le projet documente abondamment, en français, avec des cadratins.
 * Le paquet de production, lui, en contient **21**. L'écart n'est pas une
 * approximation : le bundler retire les commentaires, donc tout ce qui reste
 * est du texte qui PART CHEZ L'UTILISATEUR.
 *
 * Un contrôle sur les sources devrait donc trier 939 brins pour trouver 21
 * aiguilles, et distinguer commentaire et code. Or c'est précisément là qu'un
 * classement naïf échoue : un premier essai a pris pour du code deux
 * commentaires JSX `{/* ... *\/}` dans `WidgetSupport.jsx`. Le bundler, lui,
 * tranche avec un vrai analyseur syntaxique. On lui laisse ce travail.
 *
 * Limite assumée, et comblée ailleurs : ce contrôle ne voit pas un texte qui
 * viendrait de l'API ou d'un modèle. Pour ceux-là, `sansCadratin()` filtre la
 * sortie des agents, et `tests/support.mjs` lit le texte RENDU du widget.
 *
 * ───────────────────────────────────────────────────────────────────────────
 *  LA RÈGLE N'EST PAS « AUCUN CADRATIN ». TROIS USAGES, UN SEUL FAUTIF.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Mesuré sur le paquet avant correction : 21 occurrences, trois familles.
 *
 *   MARQUEUR    le tiret EST toute la chaîne — `'—'`. Dans un tableau du
 *               back-office, il annonce « aucune valeur ». Le retirer
 *               laisserait une cellule vide, ce qui est PIRE : le lecteur ne
 *               saurait plus si la donnée manque ou si l'écran a échoué.
 *               10 occurrences, toutes légitimes.
 *
 *   PLAGE       un DEMI-cadratin entre deux valeurs — « 14 h – 16 h ». C'est
 *               la typographie correcte d'un intervalle, et elle se distingue
 *               du cas suivant par le caractère lui-même. 1 occurrence.
 *
 *   PROSE       un cadratin séparateur à l'intérieur d'une phrase —
 *               « Position approchée — plusieurs coachs dans ce secteur ».
 *               C'EST LE SEUL CAS FAUTIF, et le seul que ce contrôle refuse.
 *               10 occurrences, toutes corrigées le 28 octobre 2026 selon la
 *               règle de `sansCadratin()` : virgule pour une incise,
 *               deux-points entre un titre et son détail.
 *
 * Refuser les trois familles aurait donné un contrôle qui crie au loup dix
 * fois sur vingt-et-une — donc un contrôle qu'on finit par désactiver.
 *
 * ───────────────────────────────────────────────────────────────────────────
 *  LE SCANNER S'ÉPROUVE LUI-MÊME, ET CE N'EST PAS DÉCORATIF
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Un scanner qui rend « zéro problème » parce qu'il n'a rien su lire est le
 * faux vert archétypal — exactement le défaut trouvé le 28 octobre dans huit
 * assertions d'absence. La première section plante donc des cas connus et
 * vérifie que le classement les range bien, AVANT de regarder le vrai paquet.
 *
 *   cd client && npm run test:cadratins
 *
 * Aucun navigateur, aucune base, aucun compte : le contrôle est statique. Il
 * reconstruit le paquet si besoin — une seconde — parce qu'un paquet périmé
 * dirait la vérité d'hier.
 * ===========================================================================
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const CLIENT = fileURLToPath(new URL('..', import.meta.url));
const ASSETS = join(CLIENT, 'dist', 'assets');

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

/* ================================================================== *
 *  LE CLASSEMENT
 * ================================================================== */

const CADRATIN = '—';
const DEMI = '–';

/**
 * Range chaque tiret d'un texte dans l'une des trois familles.
 *
 * LE TEST DU MARQUEUR PORTE SUR LES CARACTÈRES VOISINS, et c'est ce qui le
 * rend fiable sans analyser la syntaxe : après passage du bundler, une chaîne
 * qui ne contient QUE le tiret s'écrit `` `—` ``, `'—'` ou `"—"`. Le tiret y
 * est donc encadré par deux délimiteurs de chaîne. Un séparateur de prose,
 * lui, a du texte d'au moins un côté.
 */
export function classer(texte) {
  const trouve = { marqueur: [], plage: [], prose: [] };

  for (const m of texte.matchAll(/[—–]/g)) {
    const i = m.index;
    const avant = texte[i - 1];
    const apres = texte[i + 1];
    const delimiteur = (c) => c === '`' || c === "'" || c === '"';
    const extrait = texte.slice(Math.max(0, i - 55), i + 55).replace(/\s+/g, ' ');

    if (delimiteur(avant) && delimiteur(apres)) trouve.marqueur.push(extrait);
    else if (m[0] === DEMI) trouve.plage.push(extrait);
    else trouve.prose.push(extrait);
  }

  return trouve;
}

/* ================================================================== *
 *  1. LE SCANNER S'ÉPROUVE LUI-MÊME
 * ================================================================== */

section('Le scanner s’éprouve lui-même');

const planté = classer('const vide=`' + CADRATIN + '`,x=1');
ok('**un tiret SEUL est reconnu comme marqueur**, pas comme faute',
  planté.marqueur.length === 1 && planté.prose.length === 0,
  `${planté.marqueur.length} marqueur(s), ${planté.prose.length} prose`);

const prose = classer('children:`Position approchée ' + CADRATIN + ' plusieurs coachs`');
ok('**un séparateur de prose est DÉTECTÉ** — sinon ce contrôle ne sert à rien',
  prose.prose.length === 1,
  prose.prose.length ? prose.prose[0].slice(0, 60) : 'RIEN DÉTECTÉ');

const plage = classer('`${a} ' + DEMI + ' ${b}`');
ok('un demi-cadratin entre deux valeurs est rangé en plage',
  plage.plage.length === 1 && plage.prose.length === 0,
  `${plage.plage.length} plage(s)`);

const rien = classer('const x = `aucun tiret ici`;');
ok('un texte sans tiret ne déclenche rien', classer('').prose.length === 0 && rien.prose.length === 0);

/*
 * LE CAS QUI A PIÉGÉ LA PREMIÈRE VERSION. Un commentaire JSX ne doit JAMAIS
 * atteindre ce scanner : le bundler l'a retiré. On vérifie donc l'inverse de
 * ce qu'on pourrait croire — que le scanner, lui, ne sait pas distinguer un
 * commentaire, et que c'est bien pour cela qu'on ne lui donne pas les sources.
 */
const commentaire = classer('{/* une incise ' + CADRATIN + ' comme celle-ci */}');
ok('**le scanner ne sait PAS lire un commentaire** — d’où la lecture du paquet, pas des sources',
  commentaire.prose.length === 1,
  'confirme le choix de conception');

/* ================================================================== *
 *  2. LE PAQUET DE PRODUCTION
 * ================================================================== */

section('Le paquet de production');

/*
 * UN PAQUET PÉRIMÉ DIRAIT LA VÉRITÉ D'HIER. On le reconstruit s'il manque, ou
 * si un fichier source est plus récent que lui. La construction prend environ
 * une seconde — moins que le temps qu'on perdrait à diagnostiquer un échec
 * provoqué par un paquet du mois dernier.
 */
let construit = false;
const plusRecentDes = (dossier) => {
  let max = 0;
  const parcourir = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      const s = statSync(p);
      if (s.isDirectory()) parcourir(p);
      else if (/\.(jsx?|css)$/.test(e)) max = Math.max(max, s.mtimeMs);
    }
  };
  parcourir(dossier);
  return max;
};

const paquetPresent = existsSync(ASSETS);
const paquetDate = paquetPresent
  ? Math.max(...readdirSync(ASSETS).map((f) => statSync(join(ASSETS, f)).mtimeMs))
  : 0;

if (!paquetPresent || plusRecentDes(join(CLIENT, 'src')) > paquetDate) {
  execFileSync('npm', ['run', 'build'], { cwd: CLIENT, stdio: 'pipe', shell: true });
  construit = true;
}

ok('le paquet de production est à jour',
  existsSync(ASSETS),
  construit ? 'reconstruit à l’instant' : 'déjà plus récent que les sources');

const fichiers = readdirSync(ASSETS).filter((f) => f.endsWith('.js'));
ok('des fragments JavaScript sont présents à analyser',
  fichiers.length > 0, `${fichiers.length} fragment(s)`);

const total = { marqueur: 0, plage: 0, prose: 0 };
const fautifs = [];

for (const f of fichiers) {
  const t = classer(readFileSync(join(ASSETS, f), 'utf8'));
  total.marqueur += t.marqueur.length;
  total.plage += t.plage.length;
  total.prose += t.prose.length;
  for (const extrait of t.prose) fautifs.push(`${f} : …${extrait}…`);
}

/*
 * LE CONTRÔLE QUI COMPTE. On affiche CHAQUE fautif, et non leur nombre : un
 * échec qui montre le texte en contexte se corrige sans enquête, comme les
 * garde-fous du widget l'ont montré à la mutation du 28 octobre.
 */
section('Aucun séparateur de prose');

ok('**aucun tiret cadratin séparateur dans le texte livré à l’utilisateur**',
  total.prose === 0,
  total.prose === 0 ? `0 sur ${total.marqueur + total.plage + total.prose} tiret(s) analysé(s)` : `${total.prose} FAUTIF(S)`);

for (const ligne of fautifs) console.log(`       ${ligne}`);

/*
 * ON VÉRIFIE AUSSI QUE LES USAGES LÉGITIMES SONT TOUJOURS LÀ. Sans cela, un
 * remplacement trop zélé — tous les tirets effacés, marqueurs compris — rendrait
 * ce contrôle vert en ayant vidé les cellules du back-office.
 */
ok('les marqueurs « aucune valeur » du back-office sont préservés',
  total.marqueur > 0, `${total.marqueur} marqueur(s)`);

console.log('\n========= TIRETS CADRATINS — TEXTE LIVRÉ À L’UTILISATEUR =========');
const echecs = afficher();
console.log(
  `\n  (marqueurs : ${total.marqueur} · plages : ${total.plage} · prose : ${total.prose})`
);
process.exit(echecs > 0 ? 1 : 0);
