import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Media attache a une publication.
 *
 * `publicId` est indispensable meme si l'on a deja l'URL : c'est lui qui
 * permet de supprimer reellement le fichier chez l'hebergeur quand le post
 * est efface. Sans lui, chaque suppression laisserait un fichier orphelin,
 * facture et inaccessible.
 *
 * Les dimensions sont conservees pour reserver la place de l'image AVANT
 * son chargement : sans elles, le fil d'actualite « saute » a mesure que les
 * images arrivent, et l'on clique sur autre chose que ce que l'on visait.
 */
const mediaSchema = new Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    type: { type: String, enum: ['image', 'video'], required: true },
    largeur: Number,
    hauteur: Number,
    duree: Number, // secondes, pour les videos
    format: String, // jpg, png, mp4...
    taille: Number, // octets
  },
  { _id: false }
);

const postSchema = new Schema(
  {
    auteur: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    titre: { type: String, trim: true, maxlength: 150 },

    description: { type: String, trim: true, maxlength: 2000 },

    /**
     * Plusieurs medias par publication, comme un carrousel Instagram.
     * Le plafond de 10 est aussi une protection : sans borne, une requete
     * pourrait attacher des milliers d'entrees a un seul document.
     */
    medias: {
      type: [mediaSchema],
      validate: {
        validator: (arr) => arr.length > 0 && arr.length <= 10,
        message: 'Une publication doit contenir entre 1 et 10 medias',
      },
    },

    /**
     * Contenu exclusif reserve aux abonnes premium du coach.
     * Seul un coach pouvant monetiser peut passer ce champ a true — la
     * regle est appliquee dans le controleur, pas ici : le schema ne connait
     * pas l'etat du compte Stripe de l'auteur.
     */
    estPremium: { type: Boolean, default: false, index: true },

    /**
     * Tableau plutot que collection dediee : a cette echelle, le test
     * d'appartenance (« ai-je deja like ? ») se fait sans jointure, et
     * `$addToSet` garantit l'unicite cote base.
     */
    likes: [{ type: Schema.Types.ObjectId, ref: 'User' }],

    /**
     * Compteur denormalise. Les commentaires vivent dans leur propre
     * collection ; sans ce champ, afficher « 42 commentaires » sur chaque
     * post du fil imposerait un countDocuments par publication.
     * Tenu a jour dans la meme transaction que l'ajout ou la suppression.
     */
    commentsCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

/* ------------------------------------------------------------------ *
 *  INDEX
 * ------------------------------------------------------------------ */

// Publications d'un profil, de la plus recente a la plus ancienne.
postSchema.index({ auteur: 1, createdAt: -1 });

// Fil d'actualite : « posts des comptes que je suis, par date ».
// L'ordre des cles compte — l'egalite (auteur) avant le tri (createdAt).
postSchema.index({ createdAt: -1 });

/* ------------------------------------------------------------------ *
 *  VIRTUELS
 * ------------------------------------------------------------------ */

postSchema.virtual('likesCount').get(function () {
  return this.likes?.length || 0;
});

/* ------------------------------------------------------------------ *
 *  METHODES
 * ------------------------------------------------------------------ */

/**
 * Version renvoyee au client, adaptee a ses droits.
 *
 * POINT CRITIQUE DU PROJET.
 * Quand l'acces au premium n'est pas accorde, on ne se contente pas de
 * signaler « verrouille » : les URL des medias sont RETIREES de la reponse.
 *
 * Masquer le contenu en CSS ou l'ignorer cote React ne protegerait rien —
 * l'URL resterait lisible dans l'onglet reseau des outils de developpement,
 * et le contenu pour lequel des gens ont paye serait accessible a tous en
 * deux clics.
 *
 * @param {object|null} visiteur - req.user
 * @param {boolean} accesPremium - resultat du service d'acces
 */
postSchema.methods.versionPour = function (visiteur, accesPremium) {
  const auteur = this.populated('auteur') ? this.auteur : null;

  const base = {
    _id: this._id,
    auteur: auteur
      ? {
          _id: auteur._id,
          pseudo: auteur.pseudo,
          nom: auteur.nom,
          prenom: auteur.prenom,
          avatar: auteur.avatar,
          type: auteur.type,
          estCertifie: auteur.estCertifie,
        }
      : this.auteur,
    titre: this.titre,
    estPremium: this.estPremium,
    likesCount: this.likes?.length || 0,
    commentsCount: this.commentsCount,
    createdAt: this.createdAt,
    // Le front colore le coeur sans avoir a telecharger la liste complete
    // des personnes ayant like — qui peut compter des milliers d'entrees.
    aLike: visiteur
      ? this.likes.some((id) => String(id) === String(visiteur._id))
      : false,
  };

  if (this.estPremium && !accesPremium) {
    return {
      ...base,
      verrouille: true,
      // Ni description ni medias : rien qui puisse etre reconstitue.
      description: null,
      medias: [],
      // On conserve tout de meme de quoi afficher un apercu flou credible.
      nombreMedias: this.medias?.length || 0,
      apercu: {
        type: this.medias?.[0]?.type || 'image',
        largeur: this.medias?.[0]?.largeur,
        hauteur: this.medias?.[0]?.hauteur,
      },
    };
  }

  return { ...base, verrouille: false, description: this.description, medias: this.medias };
};

export const Post = model('Post', postSchema);
export default Post;
