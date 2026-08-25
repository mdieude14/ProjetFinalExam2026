import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/** Duree de vie d'une story, en heures. */
export const DUREE_STORY_HEURES = 24;

const mediaSchema = new Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    type: { type: String, enum: ['image', 'video'], required: true },
    largeur: Number,
    hauteur: Number,
    duree: Number,
    format: String,
  },
  { _id: false }
);

const storySchema = new Schema(
  {
    auteur: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    media: { type: mediaSchema, required: true },

    texte: { type: String, trim: true, maxlength: 200 },

    estPremium: { type: Boolean, default: false },

    vuesCount: { type: Number, default: 0, min: 0 },

    /**
     * Date d'expiration. L'index TTL ci-dessous supprime le document des
     * que cette date est depassee.
     */
    expireAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + DUREE_STORY_HEURES * 60 * 60 * 1000),
    },
  },
  { timestamps: true }
);

/* ------------------------------------------------------------------ *
 *  INDEX TTL — SUPPRESSION AUTOMATIQUE
 * ------------------------------------------------------------------ */

/**
 * `expireAfterSeconds: 0` signifie : supprimer le document des que la valeur
 * du champ `expireAt` est atteinte. MongoDB lance sa tache de nettoyage
 * toutes les 60 secondes ; une story peut donc survivre jusqu'a une minute
 * apres son echeance. Les lectures filtrent malgre tout sur `expireAt`, pour
 * ne jamais afficher une story techniquement perimee.
 *
 * PIEGE MAJEUR, SIGNALE DES LE CADRAGE :
 * la suppression par TTL est faite par le serveur MongoDB lui-meme. Elle NE
 * DECLENCHE AUCUN HOOK MONGOOSE — ni `pre('remove')`, ni `post('deleteOne')`.
 * Le document disparait, mais le fichier video reste chez l'hebergeur, ou il
 * continue d'occuper du quota et d'etre facture.
 *
 * D'ou `scripts/nettoyerMedias.js`, qui compare le stockage a la base et
 * efface les fichiers devenus orphelins.
 */
storySchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

// Barre de stories : « stories encore valides des comptes que je suis ».
storySchema.index({ auteur: 1, expireAt: 1, createdAt: -1 });

/* ------------------------------------------------------------------ *
 *  VIRTUELS ET METHODES
 * ------------------------------------------------------------------ */

storySchema.virtual('estExpiree').get(function () {
  return this.expireAt <= new Date();
});

storySchema.methods.versionPour = function (visiteur, accesPremium) {
  const auteur = this.populated('auteur') ? this.auteur : null;

  const base = {
    _id: this._id,
    auteur: auteur
      ? {
          _id: auteur._id,
          pseudo: auteur.pseudo,
          prenom: auteur.prenom,
          nom: auteur.nom,
          avatar: auteur.avatar,
          estCertifie: auteur.estCertifie,
        }
      : this.auteur,
    estPremium: this.estPremium,
    createdAt: this.createdAt,
    expireAt: this.expireAt,
    // Le compteur de vues n'appartient qu'a l'auteur : savoir combien de
    // personnes ont vu la story d'un tiers n'est l'affaire de personne.
    vuesCount:
      visiteur && String(visiteur._id) === String(auteur?._id || this.auteur)
        ? this.vuesCount
        : undefined,
  };

  // Meme regle que pour les posts : le media est retire, pas masque.
  if (this.estPremium && !accesPremium) {
    return { ...base, verrouille: true, media: null, texte: null };
  }

  return { ...base, verrouille: false, media: this.media, texte: this.texte };
};

export const Story = model('Story', storySchema);
export default Story;
