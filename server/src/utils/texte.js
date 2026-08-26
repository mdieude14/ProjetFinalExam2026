/**
 * ===========================================================================
 *  NORMALISATION DU TEXTE POUR LA RECHERCHE
 * ===========================================================================
 *
 * POURQUOI CE FICHIER EXISTE — LA DÉCISION CENTRALE DU MODULE 10.
 *
 * Une barre de recherche doit répondre dès la troisième lettre. Or l'index
 * texte de MongoDB (`$text`) travaille sur des MOTS ENTIERS, après
 * segmentation et désuffixation : chercher « mar » ne trouve jamais
 * « Martin ». L'autocomplétion demande donc autre chose — une recherche par
 * PRÉFIXE.
 *
 * Le préfixe s'écrit avec une expression rationnelle ancrée : `/^mar/`.
 * L'ancrage n'est pas cosmétique — c'est lui qui permet à MongoDB de se
 * servir de l'index. Sans le `^`, chaque frappe déclenche un parcours complet
 * de la collection.
 *
 * MAIS UNE EXPRESSION ANCRÉE N'UTILISE L'INDEX QUE SI ELLE EST SENSIBLE À LA
 * CASSE. Ajouter `$options: 'i'` annule le bénéfice, et une collation
 * insensible à la casse ne sauve pas non plus la mise : MongoDB refuse
 * d'utiliser l'index pour une expression rationnelle dès que la collation
 * n'est pas simple. Chercher « martin » ne trouverait donc pas « Martin »,
 * et « eloise » pas « Éloïse ».
 *
 * D'OÙ LA SOLUTION RETENUE : on stocke, à côté des vrais champs, une liste de
 * termes déjà NORMALISÉS — minuscules, sans accents. La recherche par
 * préfixe s'y fait en casse exacte, donc en utilisant l'index, et se trouve
 * néanmoins insensible à la casse et aux accents puisque les deux côtés ont
 * subi le même traitement.
 *
 * Le coût est une dénormalisation à tenir à jour ; le bénéfice est une
 * autocomplétion qui reste rapide quand la table grossit. C'est le même
 * arbitrage que les compteurs dénormalisés des modules 6 et 9.
 * ===========================================================================
 */

/**
 * Minuscules, sans accents, espaces réduits.
 *
 * `normalize('NFD')` décompose « é » en « e » + accent aigu ; la suppression
 * des marques diacritiques ne laisse que la lettre de base. Procéder par
 * table de correspondance (« é » -> « e », « è » -> « e »…) obligerait à
 * énumérer chaque cas, et l'on en oublierait — « ÿ », « ñ », « ø ».
 */
export function normaliser(texte) {
  if (!texte) return '';

  return String(texte)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Découpe une suite de champs en termes de recherche normalisés, sans doublon.
 *
 * ON INDEXE LES MOTS, PAS LA CHAÎNE ENTIÈRE. Un préfixe ne matche que par le
 * début : sur la chaîne « martin dupont », chercher « dup » ne donnerait
 * rien. Découpée en deux termes, la même donnée répond aux deux préfixes.
 *
 * Les termes d'une lettre sont écartés : ils ne discriminent rien et
 * gonfleraient l'index d'entrées inutiles.
 *
 * @param {...(string|string[]|undefined)} champs
 * @returns {string[]}
 */
export function termesDe(...champs) {
  const termes = new Set();

  for (const champ of champs.flat()) {
    const normalise = normaliser(champ);
    if (!normalise) continue;

    // Le champ entier, puis chacun de ses mots : « jean-marc » doit répondre
    // aussi bien à « jea » qu'à « mar ».
    for (const morceau of [normalise, ...normalise.split(/[\s._-]+/)]) {
      if (morceau.length >= 2) termes.add(morceau);
    }
  }

  return [...termes];
}

/**
 * Échappe les caractères spéciaux avant d'insérer une saisie utilisateur dans
 * une expression rationnelle.
 *
 * SANS CETTE PRÉCAUTION, LA BARRE DE RECHERCHE EST UNE FAILLE. Une saisie
 * comme `(((((a)))))` ou `(a+)+$` construit une expression au coût
 * exponentiel : le serveur part en calcul pour plusieurs secondes sur une
 * seule requête. C'est une attaque connue — ReDoS — et elle ne demande aucun
 * outil, juste un champ de saisie.
 */
export function echapperRegex(texte) {
  return String(texte).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Construit le motif de recherche par préfixe, ancré et échappé.
 *
 * Renvoie `null` si la saisie normalisée est trop courte : une seule lettre
 * ramènerait une part énorme de la collection pour un résultat inexploitable.
 */
export function motifPrefixe(saisie, longueurMin = 2) {
  const normalise = normaliser(saisie);
  if (normalise.length < longueurMin) return null;

  return new RegExp('^' + echapperRegex(normalise));
}
