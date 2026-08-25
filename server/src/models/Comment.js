import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Commentaire sur une publication.
 *
 * COLLECTION SEPAREE, PAS UN TABLEAU DANS Post.
 * C'est l'une des huit corrections apportees au modele initial. Trois raisons :
 *   - un post tres commente ferait grossir son document sans limite, jusqu'au
 *     plafond de 16 Mo impose par MongoDB ;
 *   - impossible de paginer un tableau embarque proprement : il faudrait
 *     charger tout le post pour n'afficher que dix commentaires ;
 *   - deux personnes commentant en meme temps ecriraient le meme document,
 *     avec un risque d'ecrasement.
 */
const commentSchema = new Schema(
  {
    post: {
      type: Schema.Types.ObjectId,
      ref: 'Post',
      required: true,
      index: true,
    },

    auteur: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    texte: {
      type: String,
      required: [true, 'Le commentaire ne peut pas être vide'],
      trim: true,
      maxlength: [1000, 'Un commentaire ne peut depasser 1000 caractères'],
    },

    /**
     * Reponse a un autre commentaire. `null` pour un commentaire de premier
     * niveau.
     *
     * On garde une hierarchie a UN seul niveau : les reponses aux reponses
     * sont rattachees au commentaire racine. Au-dela, l'affichage devient
     * illisible sur mobile, et c'est ce que font Instagram et YouTube.
     */
    parent: {
      type: Schema.Types.ObjectId,
      ref: 'Comment',
      default: null,
    },

    reponsesCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

/* ------------------------------------------------------------------ *
 *  INDEX
 * ------------------------------------------------------------------ */

// Commentaires de premier niveau d'un post, du plus recent au plus ancien.
commentSchema.index({ post: 1, parent: 1, createdAt: -1 });

// Reponses a un commentaire donne, dans l'ordre chronologique : une
// conversation se lit de haut en bas.
commentSchema.index({ parent: 1, createdAt: 1 });

/* ------------------------------------------------------------------ *
 *  METHODES
 * ------------------------------------------------------------------ */

commentSchema.methods.versionPublique = function () {
  const auteur = this.populated('auteur') ? this.auteur : null;

  return {
    _id: this._id,
    post: this.post,
    parent: this.parent,
    texte: this.texte,
    reponsesCount: this.reponsesCount,
    createdAt: this.createdAt,
    auteur: auteur
      ? {
          _id: auteur._id,
          pseudo: auteur.pseudo,
          nom: auteur.nom,
          prenom: auteur.prenom,
          avatar: auteur.avatar,
          estCertifie: auteur.estCertifie,
        }
      : this.auteur,
  };
};

export const Comment = model('Comment', commentSchema);
export default Comment;
