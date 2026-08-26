import { Schema, model } from 'mongoose';

/**
 * ===========================================================================
 *  INSCRIPTION À UN ÉVÉNEMENT
 * ===========================================================================
 *
 * POURQUOI UNE COLLECTION SÉPARÉE PLUTÔT QU'UN TABLEAU `inscrits` DANS
 * L'ÉVÉNEMENT. C'est LA décision structurante du module 9, et elle tient
 * entièrement à la concurrence.
 *
 * Avec un tableau, s'inscrire s'écrit forcément « lire l'événement, vérifier
 * qu'il reste de la place, ajouter l'utilisateur, réécrire ». Entre la
 * lecture et l'écriture s'ouvre une fenêtre de quelques millisecondes. Deux
 * personnes qui cliquent en même temps sur le dernier dossard lisent toutes
 * les deux « 9 sur 10 », concluent toutes les deux qu'il reste une place, et
 * s'ajoutent toutes les deux. L'événement se retrouve en surréservation, et
 * personne ne s'en aperçoit avant le jour J.
 *
 * En collection séparée, la place se prend par une INSERTION, et l'index
 * unique `{ event, utilisateur }` fait rejeter le doublon par la base
 * elle-même — pas par du code applicatif qui pourrait être contourné ou
 * oublié. Le contrôle de capacité, lui, se fait dans une transaction avec
 * l'incrément du compteur : la seconde requête relit le compteur déjà
 * incrémenté par la première et se voit refuser la place.
 *
 * Bénéfice secondaire, mais réel : l'historique est conservé. Une inscription
 * annulée reste en base avec `statut: 'annule'`, alors qu'un retrait de
 * tableau ne laisse aucune trace de ce qui s'est passé.
 */

const eventRegistrationSchema = new Schema(
  {
    event: {
      type: Schema.Types.ObjectId,
      ref: 'SportEvent',
      required: true,
    },

    utilisateur: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    /**
     * `inscrit`     place confirmée
     * `annule`      l'utilisateur s'est désisté — la place est libérée
     * `en_attente`  liste d'attente (prévu, pas encore exploité)
     */
    statut: {
      type: String,
      enum: ['inscrit', 'annule', 'en_attente'],
      default: 'inscrit',
      index: true,
    },

    /** Mot laissé à l'organisateur au moment de l'inscription. */
    message: { type: String, trim: true, maxlength: 300 },

    dateAnnulation: Date,
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

/* ------------------------------------------------------------------ *
 *  INDEX
 * ------------------------------------------------------------------ */

/**
 * UNE SEULE INSCRIPTION PAR PERSONNE ET PAR ÉVÉNEMENT — garanti par la base.
 *
 * L'index n'est volontairement PAS partiel, contrairement à celui des
 * abonnements premium (module 7). Là-bas, un abonnement résilié devait
 * pouvoir être suivi d'un nouveau, d'où un filtre sur `statut: 'actif'`.
 * Ici c'est l'inverse : quelqu'un qui se désiste puis revient doit
 * RÉACTIVER son inscription existante, pas en créer une seconde. Un unique
 * document par couple garde l'historique lisible — on voit qu'il a hésité,
 * pas qu'il s'est inscrit deux fois.
 */
eventRegistrationSchema.index({ event: 1, utilisateur: 1 }, { unique: true });

// Liste des participants d'un événement, pour l'organisateur.
eventRegistrationSchema.index({ event: 1, statut: 1 });

// « Mes inscriptions », de la plus récente à la plus ancienne.
eventRegistrationSchema.index({ utilisateur: 1, createdAt: -1 });

/* ------------------------------------------------------------------ *
 *  VUE
 * ------------------------------------------------------------------ */

eventRegistrationSchema.methods.versionPublique = function () {
  const apercu = (u) =>
    u && typeof u === 'object' && u.pseudo
      ? {
          _id: u._id,
          pseudo: u.pseudo,
          nom: u.nom,
          prenom: u.prenom,
          avatar: u.avatar,
          estCertifie: u.estCertifie,
        }
      : u;

  return {
    _id: this._id,
    statut: this.statut,
    message: this.message,
    event: this.event,
    utilisateur: apercu(this.utilisateur),
    createdAt: this.createdAt,
    dateAnnulation: this.dateAnnulation,
  };
};

export const EventRegistration = model('EventRegistration', eventRegistrationSchema);
export default EventRegistration;
