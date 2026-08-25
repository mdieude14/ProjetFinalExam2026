import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * ===========================================================================
 *  ABONNEMENT PREMIUM
 * ===========================================================================
 *
 * À NE PAS CONFONDRE AVEC LE FOLLOW (modèle Follow, module 6) :
 *
 *   Follow        gratuit · accès au contenu public d'un profil privé
 *   Subscription  payant  · accès au contenu marqué `estPremium`
 *
 * Les deux sont indépendants : on peut payer l'abonnement d'un coach sans
 * le suivre, et le suivre sans payer. C'est la distinction demandée au
 * cahier des charges, et la raison d'être de deux collections séparées.
 *
 * SOURCE DE VÉRITÉ
 * Cette collection reflète l'état réel chez Stripe, tenu à jour par les
 * webhooks. On ne décide jamais localement qu'un abonnement est actif :
 * c'est Stripe qui encaisse, donc Stripe qui tranche. Le champ
 * `abonnesPremiumCount` de User n'est qu'un compteur d'affichage.
 * ===========================================================================
 */

const subscriptionSchema = new Schema(
  {
    /** Celui qui paie. */
    utilisateur: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /** Le coach dont on achète le contenu exclusif. */
    coach: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /**
     * Statuts calqués sur ceux de Stripe, pour que la synchronisation par
     * webhook soit une simple correspondance et non une interprétation.
     *
     *   incomplete  session de paiement ouverte, non finalisée
     *   actif       payé, accès accordé
     *   impaye      prélèvement échoué — accès RETIRÉ jusqu'à régularisation
     *   annule      résilié ; l'accès court jusqu'à `periodeFin`
     *   expire      période terminée, plus d'accès
     */
    statut: {
      type: String,
      enum: ['incomplete', 'actif', 'impaye', 'annule', 'expire'],
      default: 'incomplete',
      required: true,
      index: true,
    },

    dateDebut: { type: Date, default: Date.now },

    /**
     * Fin de la période payée.
     *
     * Sert au cas le plus délicat du module : une résiliation ne coupe pas
     * l'accès sur-le-champ. L'utilisateur a payé jusqu'à cette date, il en
     * garde le bénéfice. Le statut passe à `annule`, mais l'accès reste
     * accordé tant que cette date n'est pas dépassée.
     */
    periodeFin: Date,

    /** Résiliation demandée, effet à la fin de la période en cours. */
    annuleALaFinPeriode: { type: Boolean, default: false },

    dateAnnulation: Date,

    /* --- Références Stripe ------------------------------------------- */
    stripeCustomerId: String,
    stripeSubscriptionId: { type: String, index: true },
    stripePriceId: String,
    stripeCheckoutSessionId: String,

    /** Montant en CENTIMES, comme chez Stripe : jamais de flottant. */
    montant: Number,
    devise: { type: String, default: 'eur' },

    /** Commission prélevée par la plateforme, en pourcentage. */
    commissionPct: Number,

    /** Dernier échec de paiement, pour informer l'utilisateur. */
    dernierEchec: {
      date: Date,
      motif: String,
    },
  },
  { timestamps: true }
);

/* ------------------------------------------------------------------ *
 *  INDEX
 * ------------------------------------------------------------------ */

/**
 * INDEX UNIQUE PARTIEL : un seul abonnement ACTIF par couple.
 *
 * L'option `partialFilterExpression` limite la contrainte aux documents
 * actifs. Sans elle, un utilisateur ayant résilié puis voulant se réabonner
 * se heurterait à son ancien abonnement annulé — alors qu'un historique de
 * plusieurs abonnements successifs est parfaitement normal.
 *
 * C'est la base de données qui garantit la règle, pas le code : deux clics
 * simultanés sur « S'abonner » ne peuvent pas créer deux abonnements.
 */
subscriptionSchema.index(
  { utilisateur: 1, coach: 1 },
  { unique: true, partialFilterExpression: { statut: 'actif' } }
);

// Un identifiant Stripe ne peut correspondre qu'à un seul document.
// `sparse` parce qu'il est absent tant que la session n'est pas finalisée.
subscriptionSchema.index({ stripeSubscriptionId: 1 }, { unique: true, sparse: true });

// « Qui sont mes abonnés payants ? » et « à qui suis-je abonné ? »
subscriptionSchema.index({ coach: 1, statut: 1, createdAt: -1 });
subscriptionSchema.index({ utilisateur: 1, statut: 1, createdAt: -1 });

/* ------------------------------------------------------------------ *
 *  VIRTUELS ET MÉTHODES
 * ------------------------------------------------------------------ */

/**
 * L'abonnement donne-t-il accès au contenu premium À CET INSTANT ?
 *
 * C'est la seule question qui compte pour le déverrouillage, et elle ne se
 * réduit pas à `statut === 'actif'` : un abonnement résilié reste valable
 * jusqu'à la fin de la période déjà payée.
 */
subscriptionSchema.virtual('donneAcces').get(function () {
  if (this.statut === 'actif') return true;

  // Résilié mais période en cours : l'accès est dû.
  if (this.statut === 'annule' && this.periodeFin && this.periodeFin > new Date()) {
    return true;
  }

  // `impaye` retire l'accès immédiatement : le prélèvement a échoué, il n'y
  // a pas de période payée à honorer.
  return false;
});

subscriptionSchema.methods.versionPublique = function () {
  const coach = this.populated('coach') ? this.coach : null;
  const utilisateur = this.populated('utilisateur') ? this.utilisateur : null;

  const apercu = (u) =>
    u && typeof u === 'object' && u.pseudo
      ? {
          _id: u._id, pseudo: u.pseudo, nom: u.nom, prenom: u.prenom,
          avatar: u.avatar, estCertifie: u.estCertifie,
        }
      : u;

  return {
    _id: this._id,
    statut: this.statut,
    donneAcces: this.donneAcces,
    dateDebut: this.dateDebut,
    periodeFin: this.periodeFin,
    annuleALaFinPeriode: this.annuleALaFinPeriode,
    montant: this.montant,
    devise: this.devise,
    dernierEchec: this.dernierEchec,
    coach: apercu(coach || this.coach),
    utilisateur: apercu(utilisateur || this.utilisateur),
    createdAt: this.createdAt,
  };
};

/**
 * Identifiants des coachs auxquels un utilisateur a réellement accès.
 * Appelée par le service de fil d'actualité pour déverrouiller le contenu.
 *
 * Le filtre couvre les deux cas donnant accès — actif, ou annulé mais encore
 * dans la période payée — en une seule requête plutôt qu'en filtrant en
 * JavaScript après coup.
 */
subscriptionSchema.statics.coachsAccessibles = async function (idUtilisateur) {
  if (!idUtilisateur) return [];

  return this.distinct('coach', {
    utilisateur: idUtilisateur,
    $or: [
      { statut: 'actif' },
      { statut: 'annule', periodeFin: { $gt: new Date() } },
    ],
  });
};

export const Subscription = model('Subscription', subscriptionSchema);
export default Subscription;
