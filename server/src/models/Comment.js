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

    /**
     * Commentaire laissé par un compte RESTREINT par l'auteur de la
     * publication : il attend son approbation.
     *
     * TANT QU'IL EST EN ATTENTE, IL N'EST VISIBLE QUE DE DEUX PERSONNES :
     * celui qui l'a écrit — qui ne doit se douter de rien, c'est tout l'objet
     * de la restriction — et l'auteur de la publication, qui décide.
     *
     * LE CHAMP EST PORTÉ PAR LE COMMENTAIRE, ET NON DÉDUIT À LA LECTURE.
     * On pourrait recalculer « l'auteur restreint-il ce commentateur ? » à
     * chaque affichage, mais lever une restriction rendrait alors visibles,
     * d'un coup, tous les anciens commentaires — y compris ceux que l'auteur
     * n'a jamais vus. L'état est donc figé au moment de l'écriture, et ne
     * change que par une décision explicite.
     *
     * `false` par défaut : l'immense majorité des commentaires ne passe par
     * aucune approbation, et l'index partiel plus bas ne coûte donc rien.
     */
    enAttenteApprobation: { type: Boolean, default: false },
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

/**
 * File d'approbation d'un auteur : « qu'ai-je à approuver sur ce post ? ».
 *
 * INDEX PARTIEL, sur les seuls commentaires en attente. Ils sont une infime
 * minorite : indexer les autres ferait grossir l'index de plusieurs ordres de
 * grandeur pour une requete qui ne les regarde jamais.
 */
commentSchema.index(
  { post: 1, enAttenteApprobation: 1 },
  { partialFilterExpression: { enAttenteApprobation: true } }
);

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

    /*
     * L'ÉTAT EST EXPOSÉ, MAIS IL NE DIT PAS LA MÊME CHOSE AUX DEUX CÔTÉS.
     * Le contrôleur ne renvoie ce commentaire qu'à son auteur et à celui de
     * la publication ; l'interface s'en sert pour afficher « en attente
     * d'approbation » au second, et rien du tout au premier — qui ne doit se
     * douter de rien.
     */
    enAttenteApprobation: this.enAttenteApprobation,
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
