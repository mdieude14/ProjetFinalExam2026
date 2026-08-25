/**
 * Traduit une erreur d'API en messages exploitables par un formulaire.
 *
 * Le back-end renvoie, en cas d'echec de validation :
 *   {
 *     succes: false,
 *     message: "Donnees invalides",
 *     details: [ { champ: "email", message: "Adresse email invalide" } ]
 *   }
 *
 * Cette fonction separe :
 *   - `parChamp` : { email: "Adresse email invalide" } a passer aux Input
 *   - `global`   : le message d'ensemble, a afficher dans une Alert
 *
 * Deux cas particuliers sont traites :
 *
 *  - PLUSIEURS ERREURS SUR UN MEME CHAMP. Un mot de passe faible en genere
 *    trois d'un coup (minuscule, majuscule, chiffre). On ne garde que la
 *    premiere : empiler trois lignes rouges sous un champ decourage plus
 *    qu'il n'aide.
 *
 *  - CHAMPS IMBRIQUES. express-validator renvoie « diplome.intitule ».
 *    On conserve la cle telle quelle, les formulaires y accedent par cette
 *    meme chaine.
 */
export function traiterErreurApi(erreur) {
  const parChamp = {};

  if (Array.isArray(erreur?.details)) {
    for (const detail of erreur.details) {
      if (detail.champ && !parChamp[detail.champ]) {
        parChamp[detail.champ] = detail.message;
      }
    }
  }

  // Si toutes les erreurs sont rattachees a des champs, le message global
  // (« Donnees invalides ») ferait double emploi : on ne l'affiche pas.
  const aDesErreursChamps = Object.keys(parChamp).length > 0;

  return {
    parChamp,
    global: aDesErreursChamps ? null : erreur?.message || 'Une erreur est survenue',
  };
}

/**
 * Evalue la robustesse d'un mot de passe selon les memes criteres que le
 * back-end, pour un retour visuel immediat pendant la saisie.
 *
 * Cette verification est purement indicative : le serveur revalide tout.
 */
export function evaluerMotDePasse(motDePasse = '') {
  const criteres = [
    { libelle: '8 caracteres minimum', valide: motDePasse.length >= 8 },
    { libelle: 'une minuscule', valide: /[a-z]/.test(motDePasse) },
    { libelle: 'une majuscule', valide: /[A-Z]/.test(motDePasse) },
    { libelle: 'un chiffre', valide: /\d/.test(motDePasse) },
  ];

  const valides = criteres.filter((c) => c.valide).length;

  return {
    criteres,
    score: valides,
    total: criteres.length,
    estValide: valides === criteres.length,
  };
}
