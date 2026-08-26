/**
 * Formatage des montants.
 *
 * TOUS LES MONTANTS RECUS DU SERVEUR SONT EN CENTIMES, comme chez Stripe.
 * Stocker des entiers evite les erreurs d'arrondi du flottant : en
 * JavaScript, 0.1 + 0.2 vaut 0.30000000000000004, ce qui est inacceptable
 * pour de l'argent. La conversion en euros n'a lieu qu'a l'affichage, ici.
 *
 * SEULE EXCEPTION, ET ELLE EST PIEGEUSE : le coach SAISIT son tarif en
 * euros, et l'API `PUT /stripe/premium/tarif` l'attend donc en euros (entre
 * 5 et 500). C'est le serveur qui convertit en centimes avant de le
 * transmettre a Stripe. On envoie des euros, on relit des centimes.
 */

/**
 * Formate un montant en centimes vers une chaine affichable.
 * @param {number|null|undefined} centimes montant en centimes
 * @param {string} devise code ISO, « eur » par defaut
 * @returns {string} par exemple « 19,90 € » — ou « — » si le montant manque
 */
export function formaterPrix(centimes, devise = 'eur') {
  if (centimes === null || centimes === undefined || Number.isNaN(centimes)) {
    return '—';
  }

  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: devise.toUpperCase(),
  }).format(centimes / 100);
}

/** Convertit des centimes en euros, pour pre-remplir un champ de saisie. */
export function centimesVersEuros(centimes) {
  if (centimes === null || centimes === undefined) return '';
  return (centimes / 100).toFixed(2);
}

/** Date longue en francais, ou « — » si absente. */
export function formaterDate(valeur) {
  if (!valeur) return '—';
  return new Date(valeur).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default formaterPrix;
