import { Schema, model } from 'mongoose';

/**
 * ===========================================================================
 *  SIGNALEMENT D'UN COMPTE
 * ===========================================================================
 *
 * POURQUOI UNE COLLECTION À PART, ET NON UN TYPE DE `Relation`.
 * Un blocage est un état binaire : il existe ou non. Un signalement a un
 * CYCLE DE VIE — il est déposé, instruit, puis tranché — et porte un motif,
 * un commentaire, une décision et son auteur. Le ranger avec les blocages
 * obligerait à laisser vides quatre champs sur cinq pour ces derniers.
 *
 * UN SIGNALEMENT NE CHANGE RIEN À LA RELATION. C'est une décision de
 * conception, et elle est volontaire : signaler n'est pas bloquer. Quelqu'un
 * peut signaler un contenu qu'il veut continuer de voir — c'est même le cas
 * ordinaire d'un abonné qui alerte sur une dérive. Les deux actions sont
 * proposées côte à côte dans l'interface, et rien n'empêche de faire les deux.
 * ===========================================================================
 */

/**
 * MOTIFS FERMÉS, ET NON UN CHAMP LIBRE.
 *
 * Une liste bornée rend les signalements comparables et triables dans le
 * back-office : « combien de comptes signalés pour usurpation ce mois-ci »
 * n'a de réponse que si le motif est une valeur, pas une phrase. Le champ
 * libre existe à côté, pour le détail que la liste ne prévoit pas.
 */
export const MOTIFS = [
  'spam',
  'harcelement',
  'contenu_inapproprie',
  'usurpation',
  'fausse_qualification',
  'autre',
];

const signalementSchema = new Schema(
  {
    signaleur: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    cible: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    motif: { type: String, enum: MOTIFS, required: true },

    /**
     * Détail facultatif. Borné à 500 caractères : un signalement est une
     * alerte, pas un dossier — l'instruction se fait dans le back-office, au
     * vu du compte lui-même.
     */
    commentaire: { type: String, trim: true, maxlength: 500 },

    statut: {
      type: String,
      enum: ['ouvert', 'traite', 'rejete'],
      default: 'ouvert',
      index: true,
    },

    /* ---- Instruction, remplie par l'administration ---- */
    traitePar: { type: Schema.Types.ObjectId, ref: 'User' },
    traiteLe: Date,
    decision: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

/* ------------------------------------------------------------------ *
 *  INDEX
 * ------------------------------------------------------------------ */

/**
 * UN SEUL SIGNALEMENT OUVERT PAR PERSONNE ET PAR CIBLE.
 *
 * L'index est PARTIEL : il ne porte que sur les signalements `ouvert`. Sans
 * cette condition, on ne pourrait jamais signaler deux fois le même compte,
 * même des mois après qu'un premier signalement a été tranché — or une
 * récidive est précisément ce qu'il faut pouvoir remonter.
 *
 * Il empêche en revanche le clic répété d'inonder la file de modération avec
 * dix fois la même alerte.
 */
signalementSchema.index(
  { signaleur: 1, cible: 1 },
  { unique: true, partialFilterExpression: { statut: 'ouvert' } }
);

/** File de modération : les dossiers ouverts, les plus anciens d'abord. */
signalementSchema.index({ statut: 1, createdAt: 1 });

/**
 * Un compte signalé par dix personnes mérite plus d'attention qu'un compte
 * signalé une fois. Cet index sert le regroupement par cible.
 */
signalementSchema.index({ cible: 1, statut: 1 });

/* ------------------------------------------------------------------ *
 *  MÉTHODES
 * ------------------------------------------------------------------ */

/**
 * Vue destinée à l'administration.
 *
 * ELLE N'EST JAMAIS RENVOYÉE AU SIGNALEUR NI À LA CIBLE. La personne signalée
 * ne doit pas apprendre qui l'a signalée : ce serait la porte ouverte aux
 * représailles, et cela dissuaderait de signaler.
 */
signalementSchema.methods.versionAdmin = function () {
  const peuple = (champ) =>
    this.populated(champ)
      ? {
          _id: this[champ]._id,
          pseudo: this[champ].pseudo,
          nom: this[champ].nom,
          prenom: this[champ].prenom,
          avatar: this[champ].avatar,
          type: this[champ].type,
        }
      : this[champ];

  return {
    _id: this._id,
    signaleur: peuple('signaleur'),
    cible: peuple('cible'),
    motif: this.motif,
    commentaire: this.commentaire,
    statut: this.statut,
    traitePar: this.traitePar,
    traiteLe: this.traiteLe,
    decision: this.decision,
    createdAt: this.createdAt,
  };
};

export const Signalement = model('Signalement', signalementSchema);
export default Signalement;
