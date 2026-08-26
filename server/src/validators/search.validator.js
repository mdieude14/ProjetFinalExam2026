import { query } from 'express-validator';

/**
 * Validation de la recherche.
 *
 * LA BORNE BASSE N'EST PAS UN CONFORT, C'EST UNE PROTECTION.
 * Une requête d'un seul caractère ramènerait une fraction énorme de la base
 * pour un résultat inexploitable — et le ferait à chaque frappe, sur chaque
 * session ouverte. On refuse donc en amont, avec un message qui explique la
 * règle plutôt qu'une liste vide qui laisserait croire à une panne.
 *
 * LA BORNE HAUTE PROTÈGE AUTREMENT. Une saisie de plusieurs kilo-octets
 * envoyée à `$text` fait travailler le moteur pour rien ; envoyée à une
 * expression rationnelle, elle ouvre la porte à des motifs coûteux. Le
 * caractère spécial est déjà échappé côté service, mais la longueur reste
 * une limite utile.
 */

const LONGUEUR_MIN = 2;
const LONGUEUR_MAX = 80;

const saisie = query('q')
  .exists()
  .withMessage('Le terme de recherche est requis')
  .bail()
  .trim()
  .isLength({ min: LONGUEUR_MIN })
  .withMessage(`Saisissez au moins ${LONGUEUR_MIN} caractères`)
  .bail()
  .isLength({ max: LONGUEUR_MAX })
  .withMessage(`La recherche ne peut dépasser ${LONGUEUR_MAX} caractères`);

/*
 * PAS DE `.escape()` ICI, ET C'EST DÉLIBÉRÉ — contrairement au reste du
 * projet. `.escape()` transforme les apostrophes en `&#x27;` : chercher
 * « l'entraînement » n'aurait alors plus aucune chance d'aboutir, puisque la
 * base contient le texte, pas son échappement. Le terme ne sert qu'à
 * INTERROGER, il n'est jamais réécrit en base ni renvoyé dans une page ; le
 * risque d'injection est traité là où il se pose vraiment : `echapperRegex()`
 * neutralise les métacaractères avant toute expression rationnelle.
 */
export const reglesRecherche = [
  saisie,
  query('limite').optional().isInt({ min: 1, max: 50 }).toInt(),
];

export const reglesRechercheUtilisateurs = [
  ...reglesRecherche,
  query('type').optional().isIn(['utilisateur', 'coach']),
  query('ville').optional().trim().isLength({ max: 100 }),
];

export const reglesSuggestions = [
  saisie,
  query('limite').optional().isInt({ min: 1, max: 20 }).toInt(),
];
