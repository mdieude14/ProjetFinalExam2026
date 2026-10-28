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
 * Pas « tout `waitForTimeout` » : beaucoup sont légitimes. Le motif fautif est
 * un **délai fixe suivi d'une LECTURE INSTANTANÉE** (`count()`, `content()`,
 * `textContent()`, `inputValue()`, `allInnerTexts()`) sans action ni attente
 * conditionnelle entre les deux. Ces lectures ne réessaient jamais,
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
 * ---------------------------------------------------------------------------
 * CE QUE LA VERSION 1 NE VOYAIT PAS, ET QUI A COÛTÉ UN FAUX VERT VIVANT.
 * ---------------------------------------------------------------------------
 *
 * La première version cherchait l'absence dans la ligne de lecture elle-même,
 * sous la forme `)) === 0`. Elle ratait donc la forme la plus courante :
 *
 *     const filCarolChezBob = await pageBob.getByText('fil de Carol').count();
 *     ok('le fil de Carol n apparait pas chez Bob', filCarolChezBob === 0);
 *
 * La lecture est sur une ligne, le verdict sur la suivante, et la comparaison
 * porte sur un NOM DE VARIABLE. Classée « présence » à tort, cette assertion a
 * survécu au balayage du 28 octobre : elle gardait le cloisonnement des
 * conversations et passait sur un écran vide. Trouvée le 28 octobre au soir, en
 * relisant à la main ce que l'outil déclarait sans danger.
 *
 *   LEÇON : un outil de recensement qui se trompe de classement est PIRE
 *   qu'une absence d'outil, parce qu'il délivre un certificat de bonne santé.
 *   Ce qu'il range dans les cases sûres doit être relu au moins une fois à la
 *   main.
 *
 * La version 2 corrige trois angles morts :
 *
 *   1. ELLE SUIT LA VARIABLE. Lecture affectée à un nom, verdict cherché dans
 *      les quatre lignes suivantes, sur ce nom.
 *   2. ELLE NE S ARRÊTE PLUS À LA PREMIÈRE LECTURE. Une absence vient souvent
 *      après une présence dans le même bloc ; s arrêter la cachait.
 *   3. ELLE RECONNAÎT DEUX MOTIFS LÉGITIMES, et cesse de les compter :
 *      - BOUCLE : le délai est le pas d une scrutation (`for`/`while` avec une
 *        sortie). C est une attente conditionnelle écrite à la main, donc
 *        exactement ce qu on veut.
 *      - DÉCLARÉE : un commentaire `mesure-instantanee :` au-dessus annonce
 *        que l instant de lecture EST le sujet du test. Mesurer un état
 *        transitoire — « la liste précédente disparaît pendant le chargement »
 *        — exige un délai fixe ; une attente conditionnelle masquerait le
 *        défaut qu on cherche.
 *
 * ET UNE PRÉSENCE ANCRE CE QUI SUIT. Une absence précédée, dans le même bloc,
 * d une présence sur le même écran ne peut plus mentir en silence : si l écran
 * est vide, la présence tombe en rouge et on le voit. Ces absences sont
 * comptées ANCRÉES, pas dangereuses.
 *
 * SORTIE : code 0 toujours. Ce n est pas un test, c est un inventaire — on ne
 * casse pas une campagne parce qu un chantier connu n est pas terminé.
 * ===========================================================================
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const DOSSIER = join(RACINE, 'client', 'tests');

const LECTURES = /\.(count|content|textContent|inputValue|allInnerTexts)\(\)/;
const ACTIONS =
  /\.(click|fill|press|pressSequentially|goto|reload|waitFor|waitForURL|waitForFunction|waitForSelector|setViewportSize|evaluate|check|setInputFiles|selectOption|screenshot|keyboard)\(/;

/*
 * LES ATTENTES CONDITIONNELLES MAISON. Les suites n'appellent presque jamais
 * `waitFor` directement : elles passent par `rendu()`, qui attend la visibilité
 * et rend un booléen. Un recenseur qui ignore l'idiome de la maison déclare
 * fautif tout le travail de correction — c'est ce qui est arrivé au premier
 * passage, où les trente-six lignes « restantes » étaient en fait les lignes
 * déjà corrigées.
 */
const ATTENTES_MAISON = /\b(rendu|navRendue|pastilleAttendue)\s*\(/;

/*
 * UNE FRONTIÈRE DE FONCTION ARRÊTE LE BALAYAGE. Sans elle, un délai suivi
 * d'une fonction définie juste après se voyait attribuer une lecture qui
 * s'exécute ailleurs, à un autre moment — `paiement-e2e.mjs` en donnait
 * l'exemple avec un sondeur de sélecteurs.
 */
const FRONTIERE = /(=>\s*\{|^\s*function\s|^\s*(const|let|var)\s+\w+\s*=\s*(async\s*)?\()/;

/** Combien de lignes on regarde après le délai, avant d'abandonner. */
const PORTEE = 10;
/** Combien de lignes après la lecture on cherche le verdict qui la juge. */
const VERDICT = 4;

/**
 * Le délai est-il le pas d'une boucle de scrutation ? On remonte quelques
 * lignes : un `for` ou un `while` juste au-dessus, et le délai cesse d'être
 * fixe — il se répète jusqu'à ce que la condition cède.
 */
const dansUneBoucle = (lignes, i) => {
  for (let k = i - 1; k >= Math.max(0, i - 4); k -= 1) {
    if (/^\s*(for|while)\s*\(/.test(lignes[k])) return true;
  }
  return false;
};

/** Un commentaire `mesure-instantanee` au-dessus déclare l'instant voulu. */
const declaree = (lignes, i) => {
  for (let k = i - 1; k >= Math.max(0, i - 14); k -= 1) {
    if (/mesure-instantanee/i.test(lignes[k])) return true;
    // On ne traverse pas une ligne de code : la déclaration doit coiffer le délai.
    if (/\S/.test(lignes[k]) && !/^\s*(\/\/|\*|\/\*)/.test(lignes[k])) return false;
  }
  return false;
};

/**
 * Le verdict porté sur cette lecture conclut-il à une ABSENCE ? On regarde la
 * ligne elle-même, puis les suivantes si la lecture a été rangée dans une
 * variable — c'est l'angle mort qui a coûté un faux vert.
 */
const conclutAbsence = (lignes, j) => {
  const nom = (lignes[j].match(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/) || [])[1];
  const fenetre = lignes.slice(j, j + 1 + VERDICT).join('\n');
  const deuxLignes = `${lignes[j]} ${lignes[j + 1] ?? ''}`;

  if (/\)\)\s*===\s*0/.test(deuxLignes)) return true;
  if (/\.length\s*===\s*0/.test(fenetre)) return true;
  if (/!\s*\(?await/.test(fenetre)) return true;
  if (/!\w+\.includes/.test(fenetre)) return true;
  if (/!\/.*\/\.test/.test(fenetre)) return true;

  if (nom) {
    const motif = new RegExp(`\\b${nom}\\b\\s*===\\s*0|!\\s*${nom}\\b|!${nom}\\.includes`);
    if (motif.test(fenetre)) return true;
  }
  return false;
};

if (!existsSync(DOSSIER)) {
  console.error(`Dossier introuvable : ${DOSSIER}`);
  process.exit(0);
}

const absence = [];
const ancree = [];
const presence = [];
const gardee = [];
const boucle = [];
const voulue = [];

for (const fichier of readdirSync(DOSSIER).filter((n) => n.endsWith('.mjs'))) {
  const lignes = readFileSync(join(DOSSIER, fichier), 'utf8').split(/\r?\n/);

  lignes.forEach((ligne, i) => {
    if (!/waitForTimeout\(/.test(ligne)) return;

    const situer = (j) => `${fichier}:${j + 1}  ${lignes[j].trim().slice(0, 72)}`;

    /** La première lecture du bloc, pour les cas qu'on classe sans les juger. */
    const premiereLecture = () => {
      for (let j = i + 1; j < Math.min(i + 1 + PORTEE, lignes.length); j += 1) {
        if (LECTURES.test(lignes[j])) return j;
        if (ACTIONS.test(lignes[j])) return -1;
      }
      return -1;
    };

    if (dansUneBoucle(lignes, i)) {
      const j = premiereLecture();
      if (j >= 0) boucle.push(situer(j));
      return;
    }

    if (declaree(lignes, i)) {
      const j = premiereLecture();
      if (j >= 0) voulue.push(situer(j));
      return;
    }

    /*
     * ON NE S'ARRÊTE PLUS À LA PREMIÈRE LECTURE. Une présence qui précède ancre
     * les absences du même bloc : si l'écran est vide, elle tombe en rouge et
     * l'ambiguïté est levée. C'est tout l'objet du balayage du 28 octobre.
     */
    let ancre = false;
    for (let j = i + 1; j < Math.min(i + 1 + PORTEE, lignes.length); j += 1) {
      /*
       * Une attente maison ancre le bloc, et garde au passage la lecture
       * posée sur la MÊME ligne : `(await rendu(x)) && (await x.count())`
       * ne lit le compte que si l'attente a cédé.
       */
      if (ATTENTES_MAISON.test(lignes[j])) {
        ancre = true;
        continue;
      }
      if (ACTIONS.test(lignes[j])) break;
      if (FRONTIERE.test(lignes[j])) break;
      if (!LECTURES.test(lignes[j])) continue;

      if (conclutAbsence(lignes, j)) (ancre ? ancree : absence).push(situer(j));
      else {
        /*
         * UNE PRÉSENCE DÉJÀ ANCRÉE NE PEUT PLUS DONNER DE FAUX ROUGE : la
         * lecture ne s'exécute qu'après qu'une attente conditionnelle a cédé
         * sur le même écran. C'est le cas de toutes les lectures qui suivent
         * la première dans un bloc corrigé — les compter comme une dette
         * ferait croire que rien n'a avancé.
         */
        (ancre ? gardee : presence).push(situer(j));
        ancre = true;
      }
    }
  });
}

const bloc = (titre, liste, vide) => {
  console.log(`\n=== ${titre} : ${liste.length} ===`);
  if (liste.length === 0 && vide) console.log(`  (${vide})`);
  for (const e of liste) console.log(`  ${e}`);
};

bloc('ABSENCE — faux VERT possible', absence, 'aucune : chacune est ancrée sur une présence');
bloc('PRESENCE — faux ROUGE possible', presence, 'aucune : chacune attend avant de lire');
bloc('GARDÉE — lecture précédée d’une attente conditionnelle', gardee);
bloc('ANCRÉE — absence précédée d’une présence, sans danger', ancree);
bloc('BOUCLE — attente conditionnelle écrite à la main, correcte', boucle);
bloc('DÉCLARÉE — l’instant de lecture EST le sujet du test', voulue);

const risque = absence.length + presence.length;
const sures = gardee.length + ancree.length + boucle.length + voulue.length;
console.log(`\nà traiter : ${risque}   sans danger : ${sures}`);
console.log('référence du 28 octobre 2026 : 54 au total, dont 9 en ABSENCE');
console.log(
  'un zéro ici ne vaut rien sans une campagne verte : cet outil lit le texte,\n' +
    'pas le navigateur. La preuve est dans `npm test`.\n'
);
