#!/usr/bin/env node
/**
 * ===========================================================================
 *  AUDIT DES ATTENTES À DURÉE FIXE DANS LES SUITES NAVIGATEUR
 * ===========================================================================
 *
 *   npm run auditer:attentes            depuis client/
 *
 * ---------------------------------------------------------------------------
 *  CE QU'IL CHERCHE, ET POURQUOI CE N'EST PAS « waitForTimeout »
 * ---------------------------------------------------------------------------
 *
 * `page.waitForTimeout()` n'est pas un défaut. Attendre une animation, un
 * anti-rebond ou la stabilisation d'un redimensionnement est parfaitement
 * légitime : aucun événement ne les annonce.
 *
 * LE DÉFAUT EST AILLEURS — c'est une attente à durée fixe qui se trouve être
 * le SEUL repère entre une action et un verdict. Là, le test ne mesure plus
 * le code : il mesure la machine. Il passe quand la suite tourne seule, et
 * tombe en vingt-septième position d'une campagne.
 *
 * Trois fois dans ce projet, un rouge a été imputé au code alors qu'il
 * venait de là :
 *
 *   2 octobre    « le message vide » — 2 s d'attente, 27e rang d'une campagne
 *   27 octobre   « supprimer retire la ligne » — lu « 0 → 2 », donc 0 avant
 *   7 novembre   « l'onglet Événements » — la capture prise pendant le
 *                chargement, l'assertion accusant le filtrage
 *
 * ---------------------------------------------------------------------------
 *  ⚠️ CE NOMBRE N'EST PAS UN NOMBRE DE DÉFAUTS
 * ---------------------------------------------------------------------------
 *
 * CE SCRIPT NE SAIT PAS DISTINGUER « attendre un état » de « observer une
 * durée », et la seconde forme est légitime.
 *
 * `telegram.mjs` en donne l'exemple le plus net : deux attentes de NEUF
 * SECONDES, qui comptent les appels d'un sondage sur une fenêtre de temps.
 * On ne peut pas ancrer cela sur un événement — il faut observer la durée.
 * Et la seconde assertion y ancre bien son absence sur une présence
 * (`appelsAvant >= 1` est vérifié d'abord). Le motif y est irréprochable.
 *
 * Une heuristique écarte donc les verdicts qui comparent un COMPTEUR plutôt
 * que de lire le DOM. Elle réduit le bruit ; elle ne le supprime pas.
 *
 *   LA SORTIE EST UNE LISTE À EXAMINER, PAS UNE LISTE À CORRIGER.
 *   Réécrire sans comprendre chaque cas casserait des suites qui passent.
 * ===========================================================================
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const DOSSIER = fileURLToPath(new URL('../tests', import.meta.url));

if (!existsSync(DOSSIER)) {
  console.error(`Dossier introuvable : ${DOSSIER}`);
  process.exit(1);
}

/*
 * LES ANCRES : ce qui, entre l'attente et le verdict, rend l'attente
 * inoffensive. Si l'une apparaît, le test attend un ÉTAT et non une durée.
 */
const ANCRES =
  /waitFor\(|waitForResponse|waitForFunction|waitForURL|waitForSelector|waitForLoadState|rendu\(|visible\(|toBeVisible|toHaveText/;

/*
 * `visible(` ET `rendu(` SONT LES DEUX HELPERS MAISON, ET LES OUBLIER A COÛTÉ
 * QUATRE FAUX POSITIFS.
 *
 * `parcours.mjs` définit `visible(loc, t = 8000)` qui fait un
 * `waitFor({ state: 'visible' })` tolérant et rend un booléen ; `rendu()` fait
 * de même dans cinq autres suites. Un verdict qui les appelle EST ancré, même
 * si une attente à durée fixe le précède — celle-ci n'est alors que du temps
 * perdu, pas un pari.
 *
 *   TROISIÈME CLASSE DE FAUX POSITIFS DE CET OUTIL, après « observer une
 *   durée » et « l'ancre est dans le verdict ». Un outil d'audit qui dénonce
 *   du code exemplaire fait perdre plus de temps qu'il n'en gagne.
 */

/*
 * LES VERDICTS : ce qui consulte l'écran et peut donc être pris trop tôt.
 */
const VERDICTS = /\bok\(|page\.content\(\)|\.innerText|getByText\(|\.textContent/;

/*
 * ET L'EXCEPTION : un verdict qui compare un COMPTEUR à un nombre observe une
 * durée. `appelsApres === 0`, `appels >= 1`, `vues > 2` — l'attente EST la
 * mesure, elle n'est pas un pari sur un rendu.
 */
const COMPTEUR = /\b[a-zA-Zéèà_$][\w$]*\s*(===|!==|>=|<=|>|<)\s*\d+/;

const SEUIL_LONG = 1500;

const fichiers = readdirSync(DOSSIER)
  .filter((f) => f.endsWith('.mjs'))
  .sort();

const trouves = [];
let totalAttentes = 0;

for (const nom of fichiers) {
  const lignes = readFileSync(join(DOSSIER, nom), 'utf8').split(/\r?\n/);

  for (let i = 0; i < lignes.length; i += 1) {
    const m = lignes[i].match(/waitForTimeout\((\d+)\)/);
    if (!m) continue;
    totalAttentes += 1;

    let verdict = null;
    let texteVerdict = '';
    let ancre = false;

    for (let k = 1; k <= 4 && i + k < lignes.length; k += 1) {
      const brut = lignes[i + k];
      const nu = brut.trim();
      if (!nu || nu.startsWith('*') || nu.startsWith('//') || nu.startsWith('/*')) continue;
      if (ANCRES.test(brut)) {
        ancre = true;
        break;
      }
      if (VERDICTS.test(brut)) {
        verdict = i + k + 1;
        /*
         * ON RASSEMBLE TOUT L'APPEL, ET PAS SEULEMENT SA PREMIÈRE LIGNE.
         *
         * Un `ok(...)` de ce projet tient couramment sur trois ou quatre
         * lignes, et L'ANCRE EST SOUVENT DEDANS :
         *
         *     ok('un bouton « Voir plus » est proposé',
         *       (await rendu(voirPlus)) && (await voirPlus.count()) === 1);
         *                 ^^^^^ l'attente ancrée est ICI
         *
         * Ne lire que la ligne du `ok(` faisait signaler ces cas comme
         * dépourvus d'ancre — alors qu'ils sont exemplaires. Deuxième classe
         * de faux positifs de cet outil, trouvée en examinant `relations.mjs`.
         */
        texteVerdict = lignes.slice(i + k, i + k + 5).join(' ');
        break;
      }
    }

    if (!verdict || ancre) continue;
    if (ANCRES.test(texteVerdict)) continue; // l'ancre est DANS le verdict
    if (COMPTEUR.test(texteVerdict)) continue; // observation de durée : légitime

    trouves.push({ fichier: nom, ligne: i + 1, delai: Number(m[1]), verdict });
  }
}

/* ------------------------------------------------------------------ *
 *  LE RAPPORT
 * ------------------------------------------------------------------ */

const longues = trouves.filter((t) => t.delai >= SEUIL_LONG);

console.log('');
console.log('='.repeat(76));
console.log('  ATTENTES À DURÉE FIXE QUI SONT LE SEUL REPÈRE AVANT UN VERDICT');
console.log('='.repeat(76));

let courant = '';
for (const t of trouves) {
  if (t.fichier !== courant) {
    courant = t.fichier;
    console.log(`\n  ${t.fichier}`);
  }
  const marque = t.delai >= SEUIL_LONG ? ' <<<' : '';
  console.log(
    `      ligne ${String(t.ligne).padStart(4)}   ${String(t.delai).padStart(5)} ms   -> verdict ligne ${t.verdict}${marque}`
  );
}

console.log('');
console.log('-'.repeat(76));
console.log(`  ${totalAttentes} attente(s) à durée fixe en tout, dans ${fichiers.length} suite(s).`);
console.log(`  ${trouves.length} sans aucune ancre avant le verdict.`);
console.log(`  ${longues.length} marquée(s) « <<< » : au moins ${SEUIL_LONG} ms.`);
console.log('');
console.log('  UNE ATTENTE LONGUE EST UN AVEU : on n’attend pas une animation');
console.log('  pendant deux secondes, on attend un aller-retour serveur. Ce sont');
console.log('  celles-là qui tombent sous la charge d’une campagne.');
console.log('');
console.log('  ⚠️  CETTE LISTE EST À EXAMINER, PAS À CORRIGER EN BLOC.');
console.log('      Le script ne distingue pas « attendre un état » de « observer');
console.log('      une durée » — voir l’en-tête du fichier, et le cas de');
console.log('      telegram.mjs, dont les attentes de 9 s sont irréprochables.');
console.log('');
