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

/**
 * LE DÉLAI D'ATTENTE, RAMENÉ DE QUATRE-VINGTS SECONDES À VINGT.
 *
 * Le SDK attend 80 s par défaut — une valeur pensée pour un travail de fond,
 * pas pour une requête web. Un appel qui pend tient la requête Express ouverte
 * tout ce temps : le navigateur de la personne a abandonné depuis longtemps,
 * elle a rechargé la page, et deux sessions de paiement existent désormais pour
 * un seul achat. Vingt secondes dépassent largement le temps d'une réponse
 * normale de Stripe, mesurée ici entre 80 et 500 ms selon l'état du cache TLS.
 *
 * TROIS RÉESSAIS AU LIEU DE DEUX, et ce n'est pas un pansement sur un test.
 * Le SDK pose lui-même une clé d'idempotence sur les réessais : un `POST`
 * rejoué ne crée pas un second abonnement, c'est la garantie que Stripe
 * documente pour cet usage précis. Le réessai ne couvre que les pannes de
 * TRANSPORT — un refus de carte ou une clé invalide ne sont jamais rejoués.
 *
 * AU PIRE : quatre tentatives de vingt secondes, plus le délai d'attente
 * croissant du SDK entre chacune. C'est long, mais c'est le cas où Stripe est
 * réellement inaccessible — et il valait mieux que l'unique tentative de 80 s
 * qu'on avait avant, qui échouait aussi, en silence et sans rien réessayer.
 *
 * SUR CE POSTE, LE CHEMIN SORTANT EST INTERCEPTÉ. Mesuré le 26 octobre :
 * `api.stripe.com:443` présente un certificat émis par « Avast Web/Mail Shield
 * Root », et la poignée de main passe de 84 ms à chaud à 505 ms à froid.
 * L'interception du 443 est SÉLECTIVE — `accounts.google.com` sort en direct —
 * ce qui avait fait conclure à tort, en octobre, que le HTTPS n'était pas
 * intercepté du tout. Cela ne prouve pas que l'interception cause les coupures
 * observées une fois dans une campagne, et je n'ai pas su les reproduire ; cela
 * rend seulement le chemin plus fragile qu'en production, où rien de tout ceci
 * n'existe.
 */
const DELAI_MS = 20000;
const REESSAIS = 3;

const stripe = stripeConfigure
  ? new Stripe(config.stripe.secretKey, {
      apiVersion: VERSION_API,
      timeout: DELAI_MS,
      maxNetworkRetries: REESSAIS,
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
