import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * ===========================================================================
 *  MESSAGE
 * ===========================================================================
 *
 * Collection séparée de `Conversation` — la raison est expliquée en tête de
 * ce fichier-là, et c'est la décision structurante du module.
 */

const mediaSchema = new Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    type: { type: String, enum: ['image', 'video'], required: true },
    largeur: Number,
    hauteur: Number,
  },
  { _id: false }
);

const messageSchema = new Schema(
  {
    conversation: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },

    expediteur: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /**
     * Le texte est facultatif — mais pas en même temps que le média.
     *
     * Un message entièrement vide n'a aucun sens : il occuperait une ligne
     * dans le fil, remonterait en « dernier message », incrémenterait un
     * compteur de non-lus, et n'apprendrait rien à personne. La règle est
     * portée par le schéma, donc valable pour tout appelant.
     */
    contenu: { type: String, trim: true, maxlength: 2000 },

    media: { type: mediaSchema, default: undefined },

    /**
     * Personnes ayant aimé ce message, comme pour une publication.
     *
     * ON STOCKE LA LISTE, PAS UN COMPTEUR. Un compteur seul ne saurait pas
     * dire si MOI j'ai déjà aimé, et deux clics rapides le feraient dériver.
     * `$addToSet` garantit l'unicité côté base : le contrôle applicatif ne
     * fait qu'éviter un aller-retour, il ne porte pas la garantie.
     *
     * Une conversation n'a que deux participants : la liste ne peut donc pas
     * dépasser deux entrées. C'est ce qui rend ce choix tenable ici, là où il
     * demanderait réflexion sur une publication très suivie.
     */
    likes: [{ type: Schema.Types.ObjectId, ref: 'User' }],

    /**
     * `lu` porte sur LE MESSAGE, le compteur `nonLus` de la conversation
     * porte sur le FIL. Les deux existent parce qu'ils répondent à deux
     * questions différentes : « dois-je afficher une double coche sur cette
     * bulle ? » et « quel nombre mettre sur la pastille de la liste ? ».
     *
     * Recalculer le second à partir du premier imposerait un `countDocuments`
     * par conversation à chaque ouverture de l'écran.
     */
    lu: { type: Boolean, default: false },

    /**
     * Suppression douce.
     *
     * ON NE RETIRE PAS LE DOCUMENT. Le supprimer laisserait un trou dans un
     * fil que l'autre personne a déjà lu, et rendrait incohérents les
     * compteurs déjà incrémentés. Le message reste, son contenu est remplacé
     * à l'affichage par « message supprimé » — ce que font toutes les
     * messageries, et pour cette raison.
     */
    supprime: { type: Boolean, default: false },
  },
  { timestamps: true }
);

/* ------------------------------------------------------------------ *
 *  VALIDATION
 * ------------------------------------------------------------------ */

messageSchema.pre('validate', function (suite) {
  /*
   * UN MESSAGE SUPPRIMÉ EST LÉGITIMEMENT VIDE — et l'oublier bloque la
   * suppression elle-même.
   *
   * La règle « du texte ou un média » vaut à la CRÉATION. La suppression
   * douce vide précisément ces deux champs, puis enregistre : sans cette
   * exemption, `save()` échoue en validation et l'on obtient un 400
   * « un message doit contenir du texte ou un média » **en réponse à une
   * demande de suppression**. Le message accuse le contenu ; la cause est
   * l'ordre des règles.
   */
  if (this.supprime) return suite();

  const texteVide = !this.contenu || this.contenu.trim().length === 0;

  if (texteVide && !this.media) {
    this.invalidate('contenu', 'Un message doit contenir du texte ou un média');
  }

  suite();
});

/* ------------------------------------------------------------------ *
 *  INDEX
 * ------------------------------------------------------------------ */

/*
 * Le fil d'une conversation, du plus récent au plus ancien.
 *
 * L'ORDRE DES CLÉS SUIT L'USAGE : égalité sur `conversation`, puis tri sur
 * `createdAt`. Inversé, l'index ne servirait qu'au tri global et MongoDB
 * devrait filtrer après coup.
 */
messageSchema.index({ conversation: 1, createdAt: -1 });

// Marquage en masse « tout lire » : on ne veut toucher que les messages reçus.
messageSchema.index({ conversation: 1, expediteur: 1, lu: 1 });

/* ------------------------------------------------------------------ *
 *  VUES
 * ------------------------------------------------------------------ */

/**
 * Vue envoyée au client.
 *
 * Un message supprimé sort AMPUTÉ de son contenu et de son média — retirés de
 * la RÉPONSE HTTP, pas seulement masqués à l'écran. Même règle qu'au module 7
 * pour le contenu premium : une URL laissée dans la charge utile est lisible
 * dans l'onglet réseau, et « supprimé » ne voudrait alors plus rien dire.
 */
/**
 * @param {object} [visiteur] Sert uniquement à calculer `aLike`. Sans lui, le
 *   nombre reste juste et `aLike` vaut `false` — un appelant qui l'oublie
 *   affiche donc un cœur vide, jamais une donnée fausse sur quelqu'un d'autre.
 */
messageSchema.methods.versionPublique = function (visiteur) {
  const auteur = this.populated('expediteur') ? this.expediteur : null;

  const base = {
    _id: this._id,
    conversation: this.conversation,
    expediteur: auteur
      ? {
          _id: auteur._id,
          pseudo: auteur.pseudo,
          nom: auteur.nom,
          prenom: auteur.prenom,
          avatar: auteur.avatar,
        }
      : this.expediteur,
    lu: this.lu,
    supprime: this.supprime,
    createdAt: this.createdAt,

    /*
     * LE NOMBRE ET MON PROPRE ÉTAT, JAMAIS LA LISTE.
     * Renvoyer les identifiants de ceux qui ont aimé n'apporterait rien à
     * l'affichage et exposerait une information de plus. Même règle qu'au
     * module 5 pour les publications.
     */
    likesCount: this.likes?.length || 0,
    aLike: visiteur
      ? (this.likes || []).some((id) => String(id) === String(visiteur._id))
      : false,
  };

  if (this.supprime) {
    /*
     * UN MESSAGE SUPPRIMÉ PERD AUSSI SES LIKES À L'AFFICHAGE.
     * Laisser « 1 ❤ » sous « Message supprimé » ferait subsister une trace de
     * ce qu'il contenait, et l'on ne peut plus aimer ce qu'on ne voit pas.
     */
    return { ...base, contenu: null, media: null, likesCount: 0, aLike: false };
  }

  return { ...base, contenu: this.contenu, media: this.media };
};

export const Message = model('Message', messageSchema);
export default Message;
