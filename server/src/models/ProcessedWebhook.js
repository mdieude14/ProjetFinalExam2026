import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * ===========================================================================
 *  JOURNAL DES WEBHOOKS TRAITÉS — IDEMPOTENCE
 * ===========================================================================
 *
 * POURQUOI CETTE COLLECTION EXISTE.
 * Stripe garantit de livrer chaque événement « au moins une fois », jamais
 * « exactement une fois ». Un même événement arrive donc parfois deux fois :
 * si notre réponse tarde, si le réseau coupe entre l'accusé de réception et
 * sa remise, ou si Stripe rejoue l'événement après une panne.
 *
 * Sans garde-fou, un `invoice.payment_succeeded` reçu deux fois prolongerait
 * l'abonnement de deux mois pour un seul paiement. C'est exactement le type
 * d'erreur qu'un jury cherche, et qui coûte cher en production.
 *
 * LA PARADE : on enregistre l'identifiant de chaque événement AVANT de le
 * traiter. L'index unique fait échouer la seconde insertion, et l'on répond
 * 200 sans rien refaire. Répondre 200 est important : un code d'erreur
 * ferait rejouer l'événement indéfiniment par Stripe.
 * ===========================================================================
 */

const processedWebhookSchema = new Schema(
  {
    /** Identifiant Stripe de l'événement (« evt_… »). */
    stripeEventId: {
      type: String,
      required: true,
      unique: true,
    },

    /** Type d'événement, pour le diagnostic. */
    type: { type: String, required: true },

    /** Résultat du traitement, utile en cas d'investigation. */
    resultat: {
      type: String,
      enum: ['traite', 'ignore', 'erreur'],
      default: 'traite',
    },

    message: String,

    /**
     * Purge automatique au bout de 30 jours.
     *
     * Stripe ne rejoue jamais un événement aussi ancien ; conserver ces
     * documents indéfiniment ferait grossir la collection sans usage. La
     * durée reste assez longue pour couvrir toute investigation.
     */
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 60 * 60 * 24 * 30,
    },
  },
  { timestamps: false }
);

export const ProcessedWebhook = model('ProcessedWebhook', processedWebhookSchema);
export default ProcessedWebhook;
