import { Schema, model } from 'mongoose';

/**
 * ===========================================================================
 *  TICKET DE SUPPORT — le journal de l'agent
 * ===========================================================================
 *
 * POURQUOI UNE COLLECTION À PART, ET NON UN `Signalement`.
 * Les deux ont un cycle de vie et un statut, et la ressemblance s'arrête là.
 * Un signalement vise UN AUTRE COMPTE et relève de la modération : il porte
 * une cible, et la personne signalée ne doit jamais savoir qui l'a signalée.
 * Un ticket ne vise personne — c'est une question sur son propre usage du
 * produit, et son auteur doit au contraire pouvoir le relire.
 *
 * Les confondre obligerait à laisser vide le champ `cible` sur la moitié des
 * documents, et à faire cohabiter deux règles de visibilité opposées dans la
 * même collection.
 *
 * POURQUOI CE JOURNAL EXISTE.
 * Un agent qui répond sans laisser de trace est une boîte noire. On doit
 * pouvoir répondre à trois questions, des semaines plus tard : qu'a-t-on
 * demandé, qu'a consulté l'agent pour répondre, et qu'a-t-il répondu. Sans
 * ces réponses, on ne peut ni corriger une erreur, ni prouver qu'il n'y en a
 * pas eu.
 *
 * C'EST AUSSI LA BOÎTE AUX LETTRES ENTRE LES DEUX ZONES DE CONFIANCE. La zone
 * utilisateur — joignable depuis le widget — n'écrit que des tickets. La zone
 * exploitant les relève. Aucun agent n'appelle directement un autre agent :
 * le lien est asynchrone, et il ne passe que par cette collection.
 * ===========================================================================
 */

/**
 * INTENTIONS FERMÉES, ET NON UN CHAMP LIBRE.
 *
 * C'est l'aiguillage du workflow, pas une étiquette décorative : la valeur
 * décide de ce qui se passe ensuite. Une liste bornée la rend vérifiable —
 * un test peut affirmer qu'une demande de remboursement part bien en
 * escalade, ce qu'une phrase libre ne permettrait pas.
 */
export const INTENTIONS = [
  'usage', //       « comment publier une story ? » — base de connaissances seule
  'contextuel', //  « pourquoi ce contenu est-il verrouillé ? » — outils en lecture
  'decision', //    « je veux être remboursé » — escalade humaine obligatoire
  'hors_sujet', //  ce qui ne concerne pas le produit
];

/** Le ticket est ouvert, tranché par l'agent, ou remonté à un humain. */
export const STATUTS = ['ouvert', 'resolu', 'escalade', 'clos'];

/**
 * Trace d'un outil appelé par l'agent pendant sa réponse.
 *
 * ON ENREGISTRE L'APPEL, JAMAIS SA RÉPONSE. Le contenu renvoyé par
 * `/users/me` ou `/stripe/premium/revenus` est une donnée personnelle : la
 * recopier ici la dupliquerait hors de son modèle d'origine, et hors des
 * quatre vues de sérialisation qui la protègent. Savoir QUE l'agent a
 * consulté le statut du diplôme suffit à l'audit ; savoir CE QU'IL A LU
 * créerait une seconde source de vérité à protéger.
 */
const appelOutilSchema = new Schema(
  {
    outil: { type: String, required: true, trim: true, maxlength: 80 },
    statut: { type: Number }, // code HTTP rendu par l'API
    dureeMs: { type: Number, min: 0 },
  },
  { _id: false }
);

const ticketSchema = new Schema(
  {
    /**
     * PAR OÙ LA DEMANDE EST ARRIVÉE, et c'est ce qui décide si elle a un compte.
     *
     * `widget` : tapée dans l'application, derrière un jeton. L'auteur est donc
     * toujours un compte connu, et les règles ci-dessous l'exigent.
     *
     * `courriel` : écrite à la boîte de support par quelqu'un qui n'a peut-être
     * aucun compte — un prospect, un partenaire, ou un utilisateur qui écrit
     * depuis une autre adresse que la sienne. Exiger un compte fermerait la
     * porte à ces gens, ou obligerait à leur en inventer un.
     */
    canal: {
      type: String,
      enum: ['widget', 'courriel'],
      default: 'widget',
      index: true,
    },

    /**
     * L'ADRESSE QUI A ÉCRIT, pour le canal `courriel` uniquement.
     *
     * C'est à elle que repart la réponse. On ne cherche volontairement PAS à
     * la rattacher à un compte existant : il suffirait de falsifier un en-tête
     * `From` pour ouvrir un dossier au nom d'autrui. Répondre à l'adresse qui
     * a écrit est le comportement le moins surprenant, et le seul sûr.
     */
    courrielAuteur: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: [254, 'Adresse trop longue'], // RFC 5321
    },

    /*
     * L'IDENTIFIANT DU MESSAGE GMAIL, ET IL SERT DE CLÉ D'IDEMPOTENCE.
     *
     * POURQUOI ICI PLUTÔT QU'UN LIBELLÉ DANS GMAIL. Marquer le courriel traité
     * côté Gmail demande quatre opérations réseau — créer le libellé, lire la
     * liste, résoudre son identifiant, l'appliquer — et chacune peut échouer. Si
     * la dernière échoue, le courriel reste éligible : la relève le reprend au
     * passage suivant, crée un second dossier et rappelle le modèle. Toutes les
     * dix minutes, en silence.
     *
     * UN INDEX UNIQUE, LUI, NE PEUT PAS « ÉCHOUER À S'APPLIQUER » : soit
     * l'insertion passe, soit elle est refusée. La garantie est structurelle et
     * non procédurale, et elle tient même si la recherche Gmail rend trop de
     * résultats — ce qui arrivera le jour où la fenêtre sera élargie. C'est
     * l'idiome que ce projet emploie déjà pour les événements Stripe
     * (`ProcessedWebhook`) : un seul idiome d'idempotence, pas deux.
     */
    messageCourriel: {
      type: String,
      trim: true,
      maxlength: [200, 'Identifiant de message trop long'],
    },

    /**
     * L'AUTEUR EST DÉDUIT DU JETON, JAMAIS DU CORPS DE LA REQUÊTE.
     * Le contrôleur pose `req.user._id`. Accepter un identifiant envoyé par
     * l'appelant laisserait n'importe qui écrire un ticket au nom d'un autre.
     *
     * CET INVARIANT RESTE ENTIER POUR LE WIDGET. Seul le canal `courriel`,
     * derrière la clé de service, se passe de compte — et il n'accepte alors
     * qu'une adresse, jamais un identifiant d'utilisateur.
     */
    auteur: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: function () {
        return this.canal !== 'courriel';
      },
      index: true,
    },

    /** Le rôle au moment de la demande : un coach et un sportif n'ont pas les mêmes questions. */
    roleAuteur: {
      type: String,
      enum: ['utilisateur', 'coach', 'admin'],
      required: function () {
        return this.canal !== 'courriel';
      },
    },

    question: {
      type: String,
      required: [true, 'La question est requise'],
      trim: true,
      maxlength: [2000, 'La question ne peut dépasser 2000 caractères'],
    },

    /**
     * L'écran d'où la question part. La même phrase n'appelle pas la même
     * réponse selon qu'elle est tapée depuis « Mon diplôme » ou depuis le fil.
     */
    origine: { type: String, trim: true, maxlength: 120 },

    intention: { type: String, enum: INTENTIONS, index: true },

    reponse: { type: String, trim: true, maxlength: 4000 },

    /** Ce que l'agent a consulté pour répondre — voir `appelOutilSchema`. */
    outils: { type: [appelOutilSchema], default: [] },

    /**
     * L'AGENT A-T-IL ÉCRIT CE TICKET ? Vrai seulement si la clé d'agent a été
     * présentée. Faux, `reponse` et `outils` sont vides par construction :
     * le back-office peut alors afficher « réponse de l'agent » sans mentir.
     */
    ecritParAgent: { type: Boolean, default: false },

    statut: {
      type: String,
      enum: STATUTS,
      default: 'ouvert',
      index: true,
    },

    /* ---------------------- Escalade vers un humain ---------------------- */

    /**
     * POURQUOI UN MOTIF D'ESCALADE SÉPARÉ DE L'INTENTION.
     * Une demande de remboursement s'escalade par nature. Mais une question
     * contextuelle peut s'escalader aussi — quand l'agent ne sait pas, ou
     * quand l'utilisateur insiste. L'intention dit ce qui a été demandé ; ce
     * champ dit pourquoi un humain a été appelé.
     */
    motifEscalade: { type: String, trim: true, maxlength: 300 },
    escaladeLe: { type: Date },

    /** L'administrateur qui a repris le dossier. */
    traitePar: { type: Schema.Types.ObjectId, ref: 'User' },
    traiteLe: { type: Date },
    decision: { type: String, trim: true, maxlength: 2000 },

    /**
     * LA RÉPONSE ÉCRITE À LA PERSONNE, EN DEUX TEMPS.
     *
     * `decision` est une note interne, lisible dans le back-office. Ce qui suit
     * est destiné à l'utilisateur, et suit un chemin délibérément en deux
     * étapes : l'agent RÉDIGE un brouillon à partir des mots de l'exploitant,
     * puis l'exploitant le VALIDE. Rien ne part sans cette validation.
     *
     * POURQUOI DEUX CHAMPS ET NON UN SEUL, passé de « brouillon » à « envoyé ».
     * Un seul champ ne dirait pas si le texte parti est bien celui qui a été
     * relu : une reformulation arrivée entre-temps l'écraserait sans trace.
     * Le brouillon se réécrit autant qu'on veut ; `reponseExploitant` n'est
     * écrit qu'une fois, au moment de l'envoi, et ne change plus.
     */
    brouillonReponse: { type: String, trim: true, maxlength: 4000 },
    brouillonLe: { type: Date },

    /**
     * QUI A ÉCRIT LE BROUILLON QUI EST ACTUELLEMENT EN BASE.
     *
     * `ecritParAgent` NE RÉPOND PAS À CETTE QUESTION : il dit qui a écrit la
     * RÉPONSE automatique, au moment de la création du dossier, et ne change
     * jamais ensuite. Un brouillon, lui, se réécrit — par l'agent d'abord, puis
     * par l'exploitant au clavier ou en dictant au bot.
     *
     * POURQUOI L'EXPLOITANT A BESOIN DE LE SAVOIR. Un texte proposé par un
     * modèle de langage se relit ; un texte qu'on a écrit soi-même se relit
     * moins. Sans cette distinction, les deux ont exactement la même apparence
     * dans le champ — et le jour où l'on revient sur un dossier ouvert la
     * veille, plus rien ne dit si ces mots sont les siens.
     *
     * TROIS ÉCRITURES, DEUX VALEURS : `true` à la création par l'agent (widget
     * et courriel), `false` dès que `enregistrerBrouillon` passe par là, quelle
     * que soit la voie — back-office ou Telegram, c'est un humain dans les deux
     * cas.
     */
    brouillonParAgent: { type: Boolean, default: false },

    reponseExploitant: { type: String, trim: true, maxlength: 4000 },
    reponseEnvoyeeLe: { type: Date },

    /**
     * Par où la réponse est réellement partie : `smtp` vers la boîte de la
     * personne, `boite` vers le dossier de dépôt local quand SMTP n'est pas
     * configuré. On l'enregistre pour ne pas annoncer un envoi qui n'a pas eu
     * lieu — l'écart se voit, au lieu de se deviner.
     */
    reponseCanal: { type: String, enum: ['smtp', 'boite'] },

    /** Quand l'auteur a vu, dans le widget, qu'une réponse lui était partie. */
    vueParAuteurLe: { type: Date },

    /** Passe à vrai quand l'assistant personnel a signalé le ticket sur Telegram. */
    notifieExploitant: { type: Boolean, default: false },
  },
  { timestamps: true }
);

/* ------------------------------------------------------------------ *
 *  INDEX
 * ------------------------------------------------------------------ */

/** « Mes tickets », du plus récent au plus ancien. */
ticketSchema.index({ auteur: 1, createdAt: -1 });

/**
 * La file de l'exploitant : les tickets escaladés, les plus anciens d'abord.
 *
 * INDEX PARTIEL, comme la file de modération du module 14. Un ticket résolu
 * par l'agent n'a aucune raison d'alourdir l'index de la file d'attente, et
 * ils seront de loin les plus nombreux.
 */
ticketSchema.index(
  { statut: 1, createdAt: 1 },
  { partialFilterExpression: { statut: 'escalade' } }
);

/**
 * Ce que l'assistant personnel doit relever : escaladé et pas encore annoncé.
 *
 * C'est la requête que la zone exploitant lancera en boucle ; sans cet index
 * elle balaierait toute la collection à chaque passage.
 */
ticketSchema.index(
  { notifieExploitant: 1, createdAt: 1 },
  { partialFilterExpression: { statut: 'escalade', notifieExploitant: false } }
);

/**
 * L'IDEMPOTENCE DE LA RELÈVE DU COURRIEL : un message Gmail, un dossier.
 *
 * PARTIEL, ET C'EST INDISPENSABLE. Un index unique ordinaire traiterait tous les
 * documents sans `messageCourriel` comme portant la même valeur — `null` — et
 * refuserait le second. Autrement dit : il interdirait d'avoir plus d'UN dossier
 * du widget dans toute la base. Le filtre partiel ne contraint que les documents
 * qui portent effectivement le champ.
 *
 * `$exists: true` ET NON `{ $ne: null }`, parce que Mongoose n'écrit pas un
 * champ laissé à `undefined` : les dossiers du widget n'ont pas la clé du tout,
 * et c'est exactement ce que ce filtre doit laisser passer.
 */
ticketSchema.index(
  { messageCourriel: 1 },
  { unique: true, partialFilterExpression: { messageCourriel: { $exists: true } } }
);

/* ------------------------------------------------------------------ *
 *  MÉTHODES
 * ------------------------------------------------------------------ */

/**
 * Vue rendue à l'auteur du ticket.
 *
 * Elle omet délibérément `traitePar` : savoir QUEL administrateur a traité
 * son dossier n'apporte rien à l'utilisateur et expose une identité interne.
 * La décision, elle, lui revient de droit.
 */
/**
 * RÉFÉRENCE COURTE D'UN DOSSIER — les huit derniers signes de l'identifiant.
 *
 * Elle sert à retrouver un ticket depuis un message Telegram : l'exploitant
 * répond au message d'escalade, et c'est cette référence, lue dans le texte
 * cité, qui dit de quel dossier il s'agit.
 *
 * LES HUIT DERNIERS, ET NON LES HUIT PREMIERS. Un identifiant MongoDB commence
 * par l'horodatage : deux tickets créés la même seconde partageraient leurs
 * premiers signes. La fin porte un compteur et de l'aléa — elle distingue.
 */
export const referenceDe = (id) => String(id).slice(-8);

ticketSchema.methods.versionAuteur = function () {
  return {
    _id: this._id,
    reference: referenceDe(this._id),
    question: this.question,
    origine: this.origine,
    intention: this.intention,
    reponse: this.reponse,
    statut: this.statut,
    decision: this.decision,
    createdAt: this.createdAt,
    traiteLe: this.traiteLe,
    /*
     * L'AUTEUR APPREND QU'UNE RÉPONSE LUI EST PARTIE, PAS SON CONTENU. Le texte
     * voyage par courriel, dans sa boîte ; le widget n'en est que l'avis. Le
     * recopier ici ferait deux exemplaires à tenir cohérents pour rien.
     */
    reponseEnvoyeeLe: this.reponseEnvoyeeLe,
    vueParAuteurLe: this.vueParAuteurLe,
  };
};

/**
 * Vue destinée à l'exploitant — back-office et assistant personnel.
 *
 * Elle ajoute l'auteur, les outils consultés et le motif d'escalade : de quoi
 * instruire un dossier sans avoir à interroger la base à côté.
 */
ticketSchema.methods.versionExploitant = function () {
  /*
   * UN COMPTE SUPPRIMÉ NE DOIT PAS FAIRE TOMBER LA FILE. Si la personne
   * référencée n'existe plus, Mongoose laisse le champ peuplé à `null` tout
   * en le déclarant peuplé : lire `._id` dessus lèverait une erreur, et c'est
   * la file entière qui ne s'afficherait plus pour un seul ticket.
   */
  const auteur = this.populated('auteur') && this.auteur
    ? {
        _id: this.auteur._id,
        pseudo: this.auteur.pseudo,
        nom: this.auteur.nom,
        prenom: this.auteur.prenom,
        type: this.auteur.type,
        avatar: this.auteur.avatar,
        /*
         * L'ADRESSE N'APPARAÎT QUE DANS LA VUE EXPLOITANT. C'est à elle que
         * part la réponse, et c'est elle qui permet de reconnaître la personne
         * quand deux pseudos se ressemblent. Elle ne figure ni dans la vue de
         * l'auteur, ni dans aucune vue publique.
         */
        email: this.auteur.email,
      }
    : this.auteur;

  const traitePar = this.populated('traitePar') && this.traitePar
    ? { _id: this.traitePar._id, pseudo: this.traitePar.pseudo }
    : this.traitePar;

  return {
    _id: this._id,
    reference: referenceDe(this._id),
    auteur,
    roleAuteur: this.roleAuteur,
    /*
     * LE CANAL ET L'ADRESSE VONT ENSEMBLE. Sur `courriel`, `auteur` est vide
     * par construction : sans ces deux champs, le back-office afficherait un
     * dossier sans savoir à qui il répond, et l'exploitant devrait deviner.
     */
    canal: this.canal,
    courrielAuteur: this.courrielAuteur,
    question: this.question,
    origine: this.origine,
    intention: this.intention,
    reponse: this.reponse,
    outils: this.outils,
    ecritParAgent: this.ecritParAgent,
    statut: this.statut,
    motifEscalade: this.motifEscalade,
    escaladeLe: this.escaladeLe,
    traitePar,
    traiteLe: this.traiteLe,
    decision: this.decision,
    brouillonReponse: this.brouillonReponse,
    brouillonLe: this.brouillonLe,
    brouillonParAgent: this.brouillonParAgent,
    reponseExploitant: this.reponseExploitant,
    reponseEnvoyeeLe: this.reponseEnvoyeeLe,
    reponseCanal: this.reponseCanal,
    notifieExploitant: this.notifieExploitant,
    createdAt: this.createdAt,
  };
};

export const Ticket = model('Ticket', ticketSchema);
export default Ticket;
