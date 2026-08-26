import { Router } from 'express';
import { recevoirWebhook } from '../controllers/stripeWebhook.controller.js';

const router = Router();

/**
 * Webhooks Stripe — /api/webhooks
 *
 * CE ROUTEUR EST MONTÉ À PART, AVANT `express.json()`, avec `express.raw`.
 *
 * Stripe signe le corps BRUT de la requête. Si un parseur JSON l'a déjà
 * transformé en objet JavaScript, la reconstruction du corps pour vérifier
 * la signature ne redonne pas exactement les mêmes octets — ordre des clés,
 * espaces, échappements — et la vérification échoue systématiquement.
 *
 * C'est la raison pour laquelle l'emplacement avait été réservé dès le
 * module 1, en tête du pipeline Express.
 *
 * AUCUNE AUTHENTIFICATION ICI. Ce n'est pas un oubli : Stripe n'a pas de
 * session chez nous. L'authenticité est établie par la signature
 * cryptographique de l'en-tête `stripe-signature`, vérifiée dans le
 * contrôleur. C'est plus solide qu'un jeton, qui pourrait fuiter.
 *
 * Le limiteur de débit global est également monté APRÈS ce routeur : bloquer
 * Stripe pour cause de trop nombreuses requêtes ferait perdre des paiements.
 */
router.post('/stripe', recevoirWebhook);

export default router;
