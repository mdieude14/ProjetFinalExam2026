import Stripe from 'stripe';
import { config } from './env.js';

/**
 * Instance du SDK Stripe.
 *
 * Comme Cloudinary, la configuration est facultative au démarrage : sans
 * clé, l'application tourne, seules les routes de paiement répondent que le
 * service est indisponible. On peut ainsi développer et tester tout le reste
 * sans compte Stripe.
 *
 * `apiVersion` est FIXÉE VOLONTAIREMENT. Sans elle, Stripe applique la
 * version associée au compte, qui peut évoluer et changer la forme des
 * réponses du jour au lendemain, sans qu'une ligne de code ait bougé.
 */
export const stripeConfigure = Boolean(config.stripe.secretKey);

/**
 * Version de l'API figée.
 *
 * Elle doit correspondre à celle pour laquelle le SDK installé a été écrit —
 * ici `stripe` v22. En pointer une plus ancienne fait remonter un
 * avertissement à chaque appel, et surtout expose à des différences de forme
 * entre ce que l'API renvoie et ce que le SDK attend.
 *
 * On la fige plutôt que de l'omettre : sans elle, Stripe applique la version
 * associée au compte, qui peut évoluer côté tableau de bord et changer les
 * réponses du jour au lendemain sans qu'une ligne de code ait bougé.
 * La mettre à jour est alors une décision explicite, à tester.
 */
const VERSION_API = '2026-07-29.dahlia';

const stripe = stripeConfigure
  ? new Stripe(config.stripe.secretKey, {
      apiVersion: VERSION_API,
      // Identifie l'application dans les journaux Stripe : précieux quand
      // plusieurs services attaquent le même compte.
      appInfo: { name: 'CoachConnect', version: '1.0.0' },
    })
  : null;

/**
 * Vérifie que la clé est valide en interrogeant l'API.
 * Appelé au démarrage : mieux vaut découvrir une clé erronée maintenant
 * qu'au premier paiement d'un utilisateur.
 */
export async function verifierStripe() {
  if (!stripeConfigure) return { actif: false };

  try {
    const compte = await stripe.accounts.retrieve();
    return {
      actif: true,
      compte: compte.id,
      // `livemode` à false garantit qu'on est bien en environnement de test.
      // Confondre les deux ferait encaisser de vrais paiements.
      test: !compte.charges_enabled || compte.id.startsWith('acct_'),
    };
  } catch (erreur) {
    console.error('[STRIPE] Clé refusée :', erreur.message);
    return { actif: false, erreur: erreur.message };
  }
}

/** Lève une erreur explicite si Stripe est appelé sans être configuré. */
export function exigerStripe() {
  if (!stripeConfigure) {
    const erreur = new Error(
      'Les paiements sont indisponibles : STRIPE_SECRET_KEY n’est pas renseignée.'
    );
    erreur.statusCode = 503;
    erreur.estOperationnelle = true;
    throw erreur;
  }
  return stripe;
}

export default stripe;
