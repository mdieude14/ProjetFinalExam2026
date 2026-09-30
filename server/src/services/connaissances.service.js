import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { ApiError } from '../utils/ApiError.js';
import { normaliser } from '../utils/texte.js';

/**
 * ===========================================================================
 *  BASE DE CONNAISSANCES — les fiches d'usage de l'agent de support
 * ===========================================================================
 *
 * DES FICHIERS MARKDOWN DANS LE DÉPÔT, PAS UNE COLLECTION. Une fiche qui
 * décrit mal un écran est un défaut au même titre qu'un bouton mal câblé :
 * elle doit se relire, se corriger et se versionner comme du code, dans la
 * même revue que l'écran qu'elle décrit. Une base éditable à part dériverait
 * en silence du produit.
 *
 * UNE RECHERCHE PAR MOTS-CLÉS, PAS PAR EMBEDDINGS. Pour une vingtaine de
 * fiches, une recherche sémantique exigerait un service externe payant, une
 * clé de plus à protéger et un index à recalculer à chaque correction — pour
 * départager des documents qu'un score de mots-clés sépare déjà. Surtout, ce
 * score est VÉRIFIABLE : un test peut affirmer que « comment résilier » ramène
 * la fiche de résiliation en tête, ce qu'un modèle opaque ne garantit pas
 * d'une version à l'autre. Le passage aux embeddings se justifiera quand le
 * banc d'essai de la suite échouera, pas avant.
 *
 * LES FICHES SONT CHARGÉES UNE FOIS, AU DÉMARRAGE. Elles ne changent qu'avec
 * le code ; les relire à chaque question serait un accès disque sans raison.
 * ===========================================================================
 */

const DOSSIER_FICHES = fileURLToPath(new URL('../connaissances/fiches/', import.meta.url));

/** À qui une fiche s'adresse. `tous` couvre les deux profils. */
export const PUBLICS = ['tous', 'sportif', 'coach'];

/**
 * CE QU'UN COMPTE PEUT LIRE. Un sportif ne reçoit pas les fiches réservées
 * aux coachs : lui expliquer comment encaisser via Stripe le ferait chercher
 * un écran qu'il n'a pas. L'administration voit tout, pour vérifier les
 * fiches elles-mêmes.
 */
const PUBLICS_AUTORISES = {
  utilisateur: ['tous', 'sportif'],
  coach: ['tous', 'coach'],
  admin: PUBLICS,
};

/**
 * Mots trop fréquents pour départager deux fiches. « comment », « pourquoi »
 * ouvrent presque toutes les questions : les compter ferait gagner la fiche
 * la plus longue, pas la plus pertinente.
 */
const MOTS_VIDES = new Set([
  'a', 'au', 'aux', 'avec', 'ce', 'ces', 'cette', 'comment', 'dans', 'de', 'des', 'du', 'elle',
  'en', 'est', 'et', 'faire', 'fait', 'il', 'je', 'j', 'l', 'la', 'le', 'les', 'leur', 'ma',
  'me', 'mes', 'mon', 'ne', 'n', 'on', 'ou', 'par', 'pas', 'peut', 'peux', 'plus', 'pour',
  'pourquoi', 'puis', 'qu', 'que', 'quel', 'quelle', 'qui', 'quoi', 's', 'sa', 'se', 'ses',
  'son', 'sur', 'ta', 'te', 'tes', 'ton', 'tu', 'un', 'une', 'vos', 'votre', 'vous', 'y',
  'c', 'd', 'm', 't', 'est-ce', 'suis', 'ai', 'as', 'avez', 'etre', 'avoir', 'veux', 'voudrais',
  // « moi » ET NON « mois » : une fois le pluriel retiré, « ce mois-ci » devenait
  // « moi » et ramenait la fiche « autour de moi » à une question de revenus.
  'moi', 'toi',
]);

/**
 * RACINE GROSSIÈRE : LES CINQ PREMIÈRES LETTRES.
 *
 * Ce n'est pas un racinisateur, et c'est volontaire. Il suffit à faire se
 * rencontrer « résilier » et « résiliation », « abonné » et « abonnement »,
 * « vérifier » et « vérification » — les variations qui séparent une question
 * de la fiche qui y répond. Un vrai racinisateur français serait une
 * dépendance de plus pour un gain que le banc d'essai ne réclame pas. Les
 * synonymes sans racine commune (« payer », « paiement ») passent par les
 * mots-clés de chaque fiche.
 */
const LONGUEUR_RACINE = 5;

function racine(mot) {
  // Le pluriel d'abord : « stories » doit rencontrer « story », et « posts »
  // rencontrer « post » — sans quoi la troncature à cinq lettres les sépare.
  let singulier = mot;
  if (singulier.endsWith('ies')) singulier = `${singulier.slice(0, -3)}y`;
  else if (singulier.length > 3 && singulier.endsWith('s')) singulier = singulier.slice(0, -1);
  return singulier.slice(0, LONGUEUR_RACINE);
}

/** Texte → racines des mots significatifs. */
export function jetons(texte) {
  return normaliser(texte)
    .replace(/[’']/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((mot) => mot.length > 1 && !MOTS_VIDES.has(mot))
    .map(racine);
}

/* ================================================================== *
 *  CHARGEMENT
 * ================================================================== */

/**
 * Lit l'en-tête d'une fiche : `cle: valeur`, une par ligne, entre deux `---`.
 * Pas de dépendance YAML — l'en-tête n'a que quatre champs plats.
 */
function analyser(nomFichier, contenu) {
  const correspondance = contenu.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!correspondance) throw new Error('en-tête `---` absent');

  const entete = Object.fromEntries(
    correspondance[1]
      .split(/\r?\n/)
      .map((ligne) => ligne.match(/^([a-z-]+):\s*(.*)$/))
      .filter(Boolean)
      .map(([, cle, valeur]) => [cle, valeur.trim()])
  );

  const liste = (valeur) => (valeur || '').split(',').map((v) => v.trim()).filter(Boolean);
  const corps = correspondance[2].trim();

  if (!entete.titre) throw new Error('titre absent');
  if (!PUBLICS.includes(entete.public)) {
    throw new Error(`public « ${entete.public} » invalide (attendu : ${PUBLICS.join(', ')})`);
  }
  if (!corps) throw new Error('corps vide');

  const fiche = {
    slug: nomFichier.replace(/\.md$/, ''),
    titre: entete.titre,
    public: entete.public,
    ecrans: liste(entete.ecrans),
    motsCles: liste(entete['mots-cles']),
    corps,
  };

  // Index précalculé : les racines du titre et des mots-clés, et le nombre
  // d'occurrences de chaque racine dans le corps.
  fiche.index = {
    titre: new Set(jetons(fiche.titre)),
    motsCles: new Set(fiche.motsCles.flatMap(jetons)),
    corps: jetons(corps).reduce((compte, j) => compte.set(j, (compte.get(j) || 0) + 1), new Map()),
  };

  return fiche;
}

/**
 * UNE FICHE MAL FORMÉE EST ÉCARTÉE, ELLE NE FAIT PAS TOMBER L'API. Une faute
 * de frappe dans un en-tête Markdown ne doit pas rendre le site inaccessible.
 * Mais elle n'est pas pour autant silencieuse : elle est journalisée, et la
 * suite de tests échoue tant que `fichesRejetees` n'est pas vide.
 */
export const fichesRejetees = [];

function charger() {
  const fiches = [];
  for (const nomFichier of readdirSync(DOSSIER_FICHES).filter((f) => f.endsWith('.md')).sort()) {
    try {
      fiches.push(analyser(nomFichier, readFileSync(join(DOSSIER_FICHES, nomFichier), 'utf8')));
    } catch (erreur) {
      fichesRejetees.push({ fichier: nomFichier, raison: erreur.message });
      console.error(`[CONNAISSANCES] Fiche écartée — ${nomFichier} : ${erreur.message}`);
    }
  }
  return fiches;
}

const FICHES = charger();

/**
 * LA RARETÉ D'UN MOT PÈSE DANS LE SCORE (IDF).
 *
 * Premier banc d'essai, sans elle : « quelqu'un me harcèle en message »
 * ramenait la fiche Messagerie avant celle du blocage. « message » figure
 * dans cinq fiches, « harcèle » dans une seule — et c'est lui qui dit de
 * quoi il s'agit. Un mot présent partout ne départage rien ; un mot présent
 * dans une seule fiche la désigne.
 *
 * Pondération `ln(1 + N / df)` : jamais nulle, pour qu'un mot très courant
 * compte encore un peu, et d'autant plus forte que le mot est rare.
 */
const POIDS_RARETE = (() => {
  const presences = new Map();
  for (const fiche of FICHES) {
    const racines = new Set([
      ...fiche.index.titre,
      ...fiche.index.motsCles,
      ...fiche.index.corps.keys(),
    ]);
    for (const r of racines) presences.set(r, (presences.get(r) || 0) + 1);
  }
  return new Map(
    [...presences].map(([r, df]) => [r, Math.log(1 + FICHES.length / df)])
  );
})();

/* ================================================================== *
 *  LECTURE
 * ================================================================== */

const autorisees = (role) => {
  const publics = PUBLICS_AUTORISES[role] || PUBLICS_AUTORISES.utilisateur;
  return FICHES.filter((fiche) => publics.includes(fiche.public));
};

/** Premier paragraphe, borné : de quoi juger si la fiche est la bonne. */
function extrait(corps, longueur = 280) {
  const paragraphe = corps.split(/\r?\n\s*\r?\n/)[0].replace(/\s+/g, ' ').trim();
  return paragraphe.length > longueur ? `${paragraphe.slice(0, longueur - 1)}…` : paragraphe;
}

/** Les titres accessibles à ce rôle — ce que l'agent peut proposer. */
export function catalogue(role) {
  return autorisees(role).map(({ slug, titre, public: pour, ecrans }) => ({
    slug,
    titre,
    public: pour,
    ecrans,
  }));
}

/**
 * Les fiches les plus pertinentes pour une question.
 *
 * LE SCORE PÈSE L'ENDROIT OÙ LE MOT APPARAÎT, ET SA RARETÉ. Un mot du titre
 * dit de quoi parle la fiche ; un mot-clé, ce qu'elle couvre ; un mot du
 * corps peut n'y figurer qu'en passant. La présence dans le corps est
 * plafonnée à trois occurrences : sans plafond, la fiche la plus bavarde
 * gagnerait. Le tout est multiplié par la rareté du mot (voir POIDS_RARETE).
 *
 * Une question sans aucun mot commun ne renvoie RIEN plutôt que la « moins
 * mauvaise » fiche : c'est à l'agent de dire qu'il ne sait pas, pas à la
 * recherche de lui fournir de quoi inventer.
 */
export function rechercher(question, role, { limite = 3 } = {}) {
  const termes = [...new Set(jetons(question))];
  if (termes.length === 0) return [];

  return autorisees(role)
    .map((fiche) => {
      const score = termes.reduce(
        (total, terme) =>
          total +
          (POIDS_RARETE.get(terme) || 0) *
            ((fiche.index.titre.has(terme) ? 6 : 0) +
              (fiche.index.motsCles.has(terme) ? 4 : 0) +
              Math.min(fiche.index.corps.get(terme) || 0, 3)),
        0
      );
      return { fiche, score: Math.round(score * 10) / 10 };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.fiche.slug.localeCompare(b.fiche.slug))
    .slice(0, limite)
    .map(({ fiche, score }) => ({
      slug: fiche.slug,
      titre: fiche.titre,
      ecrans: fiche.ecrans,
      score,
      extrait: extrait(fiche.corps),
    }));
}

/**
 * Une fiche entière.
 *
 * Une fiche réservée à un autre public répond 404, comme une fiche
 * inexistante : il n'y a rien de secret dans une fiche coach, mais une seule
 * réponse pour « pas pour vous » et « n'existe pas » évite à l'agent de
 * servir à un sportif les étapes d'un écran qu'il n'a pas.
 */
export function lire(slug, role) {
  const fiche = autorisees(role).find((f) => f.slug === slug);
  if (!fiche) throw ApiError.notFound('Fiche introuvable');

  const { slug: s, titre, public: pour, ecrans, corps } = fiche;
  return { slug: s, titre, public: pour, ecrans, corps };
}
