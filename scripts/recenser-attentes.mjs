/**
 * ===========================================================================
 *  RECENSER LES ATTENTES À DÉLAI FIXE QUI PRÉCÈDENT UNE MESURE
 * ===========================================================================
 *
 *   node scripts/recenser-attentes.mjs
 *
 * POURQUOI CET OUTIL EXISTE.
 *
 * Trois campagnes de suite, le 28 octobre 2026, sont tombées sur le même
 * motif, et chaque fois une occurrence DIFFÉRENTE. Corriger celle qui vient de
 * tomber ne mène nulle part : il faut le recensement complet. Celui-là a rendu
 * **54 occurrences dans 10 suites**, et c'est ce chiffre qui a permis de
 * décider d'un périmètre au lieu de bricoler.
 *
 * CE QU'IL CHERCHE, ET CE QU'IL NE CHERCHE PAS.
 *
 * Pas « tout `waitForTimeout` » : beaucoup sont légitimes — une pause avant un
 * redimensionnement, une mesure à mi-course d'une animation. Le motif fautif
 * est un **délai fixe suivi d'une LECTURE INSTANTANÉE** (`count()`,
 * `content()`, `textContent()`, `inputValue()`, `allInnerTexts()`) sans action
 * ni attente conditionnelle entre les deux. Ces lectures ne réessaient jamais,
 * contrairement à un clic ou à `waitForURL` : elles mesurent le DOM à un
 * instant arbitraire.
 *
 * LE CLASSEMENT PAR DANGER EST L'APPORT PRINCIPAL.
 *
 *   ABSENCE   la mesure conclut qu'une chose N'EST PAS là (`=== 0`,
 *             `!…includes`, `.length === 0`). Lue sur un écran encore vide,
 *             elle PASSE : rien ne s'y trouve, donc l'élément interdit non
 *             plus. FAUX VERT, invisible — et plusieurs de ces assertions
 *             gardent une autorisation ou de la confidentialité.
 *
 *   PRESENCE  la mesure conclut qu'une chose EST là. Lue trop tôt, elle
 *             ÉCHOUE. Faux rouge : agaçant, coûteux en relances, mais jamais
 *             trompeur.
 *
 * Les neuf ABSENCE du 28 octobre ont été ancrées sur une présence préalable.
 * Les quarante-cinq PRESENCE sont restées en l'état, documentées : elles ne
 * mentent pas. Relancer cet outil dit où en est le chantier.
 *
 * SORTIE : code 0 toujours. Ce n'est pas un test, c'est un inventaire — on ne
 * casse pas une campagne parce qu'un chantier connu n'est pas terminé.
 * ===========================================================================
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const DOSSIER = join(RACINE, 'client', 'tests');

const LECTURES = /\.(count|content|textContent|inputValue|allInnerTexts)\(\)/;
const ACTIONS =
  /\.(click|fill|press|pressSequentially|goto|reload|waitFor|waitForURL|waitForFunction|waitForSelector|setViewportSize|evaluate)\(/;

/** Combien de lignes on regarde après le délai, avant d'abandonner. */
const PORTEE = 10;

if (!existsSync(DOSSIER)) {
  console.error(`Dossier introuvable : ${DOSSIER}`);
  process.exit(0);
}

const absence = [];
const presence = [];

for (const fichier of readdirSync(DOSSIER).filter((n) => n.endsWith('.mjs'))) {
  const lignes = readFileSync(join(DOSSIER, fichier), 'utf8').split(/\r?\n/);

  lignes.forEach((ligne, i) => {
    if (!/waitForTimeout\(/.test(ligne)) return;

    for (let j = i + 1; j < Math.min(i + 1 + PORTEE, lignes.length); j += 1) {
      const suivante = lignes[j];

      if (LECTURES.test(suivante)) {
        /*
         * ON LIT DEUX LIGNES, pas une : la comparaison tombe souvent sur la
         * ligne d'après, à cause du retour à la ligne des longues assertions.
         */
        const bloc = `${suivante} ${lignes[j + 1] ?? ''}`;
        const estAbsence =
          /\)\)\s*===\s*0/.test(bloc) ||
          /\.length\s*===\s*0/.test(bloc) ||
          /!\s*\(?await/.test(bloc) ||
          /!\w+\.includes/.test(bloc) ||
          /!\/.*\/\.test/.test(bloc);

        (estAbsence ? absence : presence).push(
          `${fichier}:${j + 1}  ${suivante.trim().slice(0, 72)}`
        );
        break;
      }

      // Une action ou une attente conditionnelle : le délai ne précédait pas
      // une mesure. Rien à signaler ici.
      if (ACTIONS.test(suivante)) break;
    }
  });
}

console.log(`\n=== ABSENCE — faux VERT possible : ${absence.length} ===`);
if (absence.length === 0) console.log('  (aucune : chacune est ancrée sur une présence)');
for (const a of absence) console.log(`  ${a}`);

console.log(`\n=== PRESENCE — faux ROUGE possible : ${presence.length} ===`);
for (const p of presence) console.log(`  ${p}`);

console.log(`\ntotal : ${absence.length + presence.length} occurrence(s) du motif`);
console.log('référence du 28 octobre 2026 : 54 au total, dont 9 en ABSENCE\n');
