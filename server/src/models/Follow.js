import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Relation de suivi entre deux utilisateurs — le « follow » gratuit.
 *
 * A NE PAS CONFONDRE avec l'abonnement premium (modele Subscription) :
 *   follow  = gratuit, donne acces au contenu public
 *   premium = payant via Stripe, donne acces au contenu exclusif
 * Un utilisateur peut suivre un coach sans lui etre abonne, et inversement.
 *
 * POURQUOI UNE COLLECTION PLUTOT QUE DEUX TABLEAUX DANS User ?
 * Le cahier des charges impose des demandes de suivi pour les profils prives.
 * Un tableau `followers: [ObjectId]` ne peut pas porter d'etat : il faut un
 * document par relation pour stocker `statut` et la date. Une collection
 * evite aussi les ecritures concurrentes sur un meme document utilisateur,
 * et ne se heurte pas au plafond de 16 Mo sur les comptes tres suivis.
 *
 * CE MODULE N'EN DEFINIT QUE LE SCHEMA. Les routes de suivi (demander,
 * accepter, refuser, retirer) arrivent au module 6. Il est cree des
 * maintenant parce que les regles de visibilite des profils prives ont
 * besoin de l'interroger.
 */
const followSchema = new Schema(
  {
    /** Celui qui suit. */
    follower: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /** Celui qui est suivi. */
    following: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /**
     * Profil public  -> « accepte » immediatement
     * Profil prive   -> « en_attente » jusqu'a acceptation du destinataire
     */
    statut: {
      type: String,
      enum: ['en_attente', 'accepte'],
      default: 'accepte',
      required: true,
    },

    /** Date d'acceptation, distincte de la date de demande (createdAt). */
    dateAcceptation: Date,
  },
  { timestamps: true }
);

/* ------------------------------------------------------------------ *
 *  INDEX
 * ------------------------------------------------------------------ */

// Anti-doublon : une seule relation possible dans un sens donne.
// C'est la base de donnees qui garantit la regle, pas le code applicatif :
// deux clics simultanes sur « suivre » ne peuvent pas creer deux documents.
followSchema.index({ follower: 1, following: 1 }, { unique: true });

// « Qui me suit ? » et « quelles demandes dois-je traiter ? »
followSchema.index({ following: 1, statut: 1, createdAt: -1 });

// « Qui est-ce que je suis ? » — sert aussi a construire le fil d'actualite.
followSchema.index({ follower: 1, statut: 1, createdAt: -1 });

/* ------------------------------------------------------------------ *
 *  METHODES STATIQUES
 * ------------------------------------------------------------------ */

/**
 * Le visiteur suit-il la cible, avec une demande acceptee ?
 * Utilisee par le service de controle d'acces pour les profils prives.
 *
 * `.lean()` renvoie un objet JavaScript brut au lieu d'un document Mongoose :
 * on ne veut qu'un booleen, inutile de payer l'instanciation complete.
 */
followSchema.statics.suitDeja = async function (idFollower, idFollowing) {
  if (!idFollower || !idFollowing) return false;

  const relation = await this.findOne({
    follower: idFollower,
    following: idFollowing,
    statut: 'accepte',
  }).lean();

  return Boolean(relation);
};

/**
 * Etat de la relation, pour l'affichage du bouton de suivi cote front :
 * « Suivre », « Demande envoyee » ou « Abonne ».
 */
followSchema.statics.statutRelation = async function (idFollower, idFollowing) {
  if (!idFollower || !idFollowing) return 'aucune';

  const relation = await this.findOne({
    follower: idFollower,
    following: idFollowing,
  }).lean();

  return relation ? relation.statut : 'aucune';
};

export const Follow = model('Follow', followSchema);
export default Follow;
