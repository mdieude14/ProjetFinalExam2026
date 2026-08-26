import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * ===========================================================================
 *  CONVERSATION — un fil entre exactement deux personnes
 * ===========================================================================
 *
 * LES MESSAGES NE SONT PAS DANS CE DOCUMENT, et c'est la décision la plus
 * importante du module. Un tableau `messages` imbriqué paraît naturel : une
 * conversation « contient » ses messages. Mais une conversation vit des mois
 * et peut en accumuler des dizaines de milliers, alors qu'un document MongoDB
 * plafonne à 16 Mo. Le jour où la limite est atteinte, l'échange devient
 * impossible à poursuivre ET impossible à réparer sans migration.
 *
 * Plus immédiatement : charger la liste des conversations chargerait
 * l'intégralité des messages de chacune, pour n'afficher qu'un extrait.
 * C'est le même raisonnement qu'aux modules 5 (commentaires) et 9
 * (inscriptions), en plus tranchant.
 */

/**
 * Extrait du dernier message, dénormalisé.
 *
 * La liste des conversations affiche « qui, quand, quoi » pour chacune.
 * Sans cet extrait, il faudrait une requête `findOne().sort()` par
 * conversation — vingt requêtes pour afficher vingt lignes. On paie une
 * écriture supplémentaire à chaque message pour économiser N lectures à
 * chaque ouverture de l'écran.
 */
const extraitSchema = new Schema(
  {
    texte: { type: String, maxlength: 200 },
    expediteur: { type: Schema.Types.ObjectId, ref: 'User' },
    date: Date,
    /** Un message sans texte (média seul) doit tout de même s'annoncer. */
    avecMedia: { type: Boolean, default: false },

    /**
     * Le dernier message a-t-il été supprimé ?
     *
     * SANS CE DRAPEAU, SUPPRIMER NE SUPPRIME PAS VRAIMENT. L'extrait est une
     * COPIE du texte : effacer le message d'origine le laisse intact ici, et
     * la phrase que l'on vient de retirer continue de s'afficher dans la
     * liste des conversations — visible des deux côtés, et présente dans la
     * réponse HTTP. La dénormalisation a ce prix : toute écriture qui touche
     * un message doit toucher l'extrait.
     */
    supprime: { type: Boolean, default: false },
  },
  { _id: false }
);

const conversationSchema = new Schema(
  {
    /**
     * Exactement deux participants, TOUJOURS TRIÉS par identifiant.
     *
     * LE TRI EST CE QUI REND L'UNICITÉ POSSIBLE. Sans lui, une conversation
     * entre A et B peut être stockée `[A, B]` ou `[B, A]` selon qui écrit le
     * premier : deux documents pour un même échange, deux fils qui
     * s'ignorent, et des messages qui semblent disparaître selon la personne
     * qui regarde. L'index unique plus bas ne peut rien contre cela — il ne
     * voit que deux tableaux différents.
     *
     * Le tri est appliqué dans un crochet `pre('validate')`, donc quel que
     * soit l'appelant.
     */
    participants: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      required: true,
      validate: {
        validator: (liste) =>
          Array.isArray(liste) &&
          liste.length === 2 &&
          String(liste[0]) !== String(liste[1]),
        message: 'Une conversation réunit exactement deux personnes distinctes',
      },
    },

    /**
     * Clé canonique de la paire — « <idA>_<idB> », identifiants triés.
     *
     * POURQUOI CE CHAMP EXISTE, ALORS QUE `participants` CONTIENT DÉJÀ TOUT.
     * C'est le piège le plus coûteux du module, et il ne se voit pas à la
     * lecture. L'intuition — `index({ participants: 1 }, { unique: true })` —
     * paraît exprimer « une seule conversation par paire ». Elle exprime tout
     * autre chose.
     *
     * Un index sur un TABLEAU est MULTICLÉ : MongoDB en indexe chaque
     * élément séparément. Assorti de `unique`, il interdit alors que la même
     * valeur apparaisse dans deux documents — c'est-à-dire qu'une personne
     * participe à plus D'UNE conversation, pour toute sa vie. La première
     * conversation d'Alice passe ; la seconde échoue en 11000, avec un
     * message d'erreur qui parle de doublon sur `participants` et laisse
     * croire à un bogue dans le code appelant.
     *
     * L'unicité d'une PAIRE demande donc une valeur scalaire, dérivée des
     * deux identifiants et calculée à chaque validation.
     */
    cle: { type: String, required: true },

    /**
     * `en_attente` demande de chat non encore acceptée
     * `accepte`    échange ouvert
     * `refuse`     la cible a décliné : plus aucun message n'est accepté
     *
     * POURQUOI UN SAS D'ENTRÉE. Sans lui, n'importe qui écrit à n'importe
     * qui, autant de fois qu'il le souhaite : c'est la définition même du
     * harcèlement par messagerie. La règle retenue laisse passer UN message —
     * il faut bien pouvoir se présenter — puis attend un accord.
     */
    statut: {
      type: String,
      enum: ['en_attente', 'accepte', 'refuse'],
      default: 'en_attente',
      index: true,
    },

    /** Qui a pris l'initiative. C'est l'AUTRE qui accepte ou refuse. */
    demandeur: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    dernierMessage: { type: extraitSchema, default: undefined },

    /**
     * Messages non lus, par participant.
     *
     * UNE `Map` PLUTÔT QUE DEUX CHAMPS NOMMÉS. `{ nonLusA, nonLusB }`
     * obligerait à savoir en permanence qui est « A » — donc à recalculer
     * l'ordre des participants à chaque lecture, et à se tromper une fois.
     * La clé est l'identifiant, la question ne se pose plus.
     *
     * Le compteur est incrémenté DANS LA MÊME TRANSACTION que la création du
     * message : séparés, un incident laisserait une pastille qui ne
     * correspond à rien.
     */
    nonLus: {
      type: Map,
      of: Number,
      default: () => new Map(),
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

/* ------------------------------------------------------------------ *
 *  NORMALISATION
 * ------------------------------------------------------------------ */

conversationSchema.pre('validate', function (suite) {
  if (Array.isArray(this.participants) && this.participants.length === 2) {
    // Tri lexicographique sur la représentation hexadécimale : stable, et
    // indépendant de l'ordre dans lequel les identifiants sont arrivés.
    this.participants.sort((a, b) => String(a).localeCompare(String(b)));

    // La clé se déduit de la paire triée : deux ouvertures simultanées, quel
    // que soit l'ordre des identifiants, produisent exactement la même chaîne.
    this.cle = this.participants.map(String).join('_');
  }
  suite();
});

/** Clé canonique d'une paire, utilisable avant toute création de document. */
conversationSchema.statics.cleDe = function (idA, idB) {
  return [String(idA), String(idB)].sort((a, b) => a.localeCompare(b)).join('_');
};

/* ------------------------------------------------------------------ *
 *  INDEX
 * ------------------------------------------------------------------ */

/*
 * Unicité de la paire — SUR LA CLÉ SCALAIRE, jamais sur le tableau.
 *
 * Cet index rend LA BASE responsable de l'unicité. Deux requêtes simultanées
 * « ouvrir une conversation avec X » ne peuvent pas créer deux fils : la
 * seconde échoue en 11000, et le service la rattrape en relisant la
 * conversation existante. Le contrôle applicatif seul — « chercher, puis
 * créer si absent » — laisse précisément entre les deux la fenêtre où l'autre
 * requête passe.
 *
 * `unique` sur `participants` aurait produit un index multiclé, et interdit
 * à chacun d'avoir plus d'une conversation. Voir le champ `cle` plus haut.
 */
conversationSchema.index({ cle: 1 }, { unique: true });

// Recherche « mes conversations » : non unique, celui-ci, et c'est justement
// ce qui le rend correct sur un tableau.
conversationSchema.index({ participants: 1 });

// Liste des conversations : les plus récemment actives en tête.
conversationSchema.index({ 'dernierMessage.date': -1 });

// « Mes conversations », filtrées par statut.
conversationSchema.index({ participants: 1, statut: 1, updatedAt: -1 });

/* ------------------------------------------------------------------ *
 *  MÉTHODES
 * ------------------------------------------------------------------ */

/** L'autre participant, vu depuis un utilisateur donné. */
conversationSchema.methods.interlocuteurDe = function (idUtilisateur) {
  return this.participants.find(
    (p) => String(p?._id || p) !== String(idUtilisateur)
  );
};

/** Cet utilisateur fait-il partie de la conversation ? */
conversationSchema.methods.contient = function (idUtilisateur) {
  return this.participants.some(
    (p) => String(p?._id || p) === String(idUtilisateur)
  );
};

/**
 * Vue adaptée à un participant.
 *
 * ON NE RENVOIE JAMAIS LA `Map` BRUTE des non-lus : elle contient le compteur
 * de l'autre, c'est-à-dire l'information « cette personne ne vous a pas
 * lu ». Ce n'est pas une donnée sensible, mais elle n'a aucun usage côté
 * client et alourdirait chaque ligne de la liste. On expose le seul compteur
 * qui concerne le lecteur.
 */
conversationSchema.methods.versionPour = function (idUtilisateur) {
  const interlocuteur = this.interlocuteurDe(idUtilisateur);

  return {
    _id: this._id,
    interlocuteur,
    statut: this.statut,
    demandeur: this.demandeur,
    // Le front doit savoir s'il attend une réponse ou s'il doit en donner
    // une : les deux situations n'affichent pas du tout la même chose.
    estDemandeur: String(this.demandeur) === String(idUtilisateur),
    dernierMessage: this.dernierMessage,
    nonLus: this.nonLus?.get?.(String(idUtilisateur)) || 0,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const Conversation = model('Conversation', conversationSchema);
export default Conversation;
