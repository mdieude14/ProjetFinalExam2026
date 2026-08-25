import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { config } from '../config/env.js';

const { Schema, model } = mongoose;

/* ------------------------------------------------------------------ *
 *  SOUS-SCHEMAS
 * ------------------------------------------------------------------ */

/**
 * Point GeoJSON — format impose par MongoDB pour l'index 2dsphere.
 *
 * PIEGE CLASSIQUE : l'ordre est [longitude, latitude], l'inverse de ce que
 * renvoie l'API de geolocalisation du navigateur (coords.latitude d'abord).
 * Une inversion place l'utilisateur dans l'ocean Indien sans lever d'erreur.
 */
const pointSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point',
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true,
      validate: {
        validator: (coords) =>
          Array.isArray(coords) &&
          coords.length === 2 &&
          coords[0] >= -180 && coords[0] <= 180 && // longitude
          coords[1] >= -90 && coords[1] <= 90, //    latitude
        message: 'Coordonnees invalides : attendu [longitude, latitude]',
      },
    },
  },
  { _id: false }
);

/**
 * Media stocke sur Cloudinary.
 * On conserve `publicId` en plus de l'URL : c'est lui qui permet de supprimer
 * reellement le fichier chez Cloudinary quand l'utilisateur change d'avatar.
 * Sans cela, chaque changement laisserait un fichier orphelin facture.
 */
const mediaSchema = new Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
  },
  { _id: false }
);

/**
 * Diplome du coach et son cycle de verification par un administrateur.
 * Tant que `statut` n'est pas « verifie », le coach ne peut ni afficher le
 * badge « certifie » ni monetiser du contenu.
 */
const diplomeSchema = new Schema(
  {
    intitule: { type: String, trim: true, maxlength: 150 },
    organisme: { type: String, trim: true, maxlength: 150 },
    url: String, // justificatif (PDF ou image) sur Cloudinary
    publicId: String,
    statut: {
      type: String,
      enum: ['non_soumis', 'en_attente', 'verifie', 'refuse'],
      default: 'non_soumis',
    },
    motifRefus: { type: String, maxlength: 500 },
    dateSoumission: Date,
    dateVerification: Date,
    verifiePar: { type: Schema.Types.ObjectId, ref: 'User' }, // l'admin
  },
  { _id: false }
);

/**
 * Offre premium du coach (contenu exclusif payant).
 * `prixMensuel` est stocke EN CENTIMES, comme le fait Stripe : manipuler des
 * entiers evite les erreurs d'arrondi des nombres a virgule flottante
 * (0.1 + 0.2 !== 0.3 en JavaScript).
 */
const premiumSchema = new Schema(
  {
    actif: { type: Boolean, default: false },
    prixMensuel: {
      type: Number,
      min: [500, 'Le prix minimum est de 5,00 EUR'],
      max: [50000, 'Le prix maximum est de 500,00 EUR'],
    },
    devise: { type: String, default: 'eur' },
    description: { type: String, maxlength: 500 }, // ce que l'abonnement inclut
    stripeProductId: String,
    stripePriceId: String,
  },
  { _id: false }
);

/**
 * Compte Stripe Connect du coach (celui qui encaisse).
 * `chargesEnabled` passe a true seulement une fois le KYC valide par Stripe :
 * c'est cette valeur, et non la simple existence du compte, qui autorise
 * la creation d'abonnements.
 */
const stripeAccountSchema = new Schema(
  {
    id: String, // acct_xxx
    statut: {
      type: String,
      enum: ['non_cree', 'en_attente', 'actif', 'restreint'],
      default: 'non_cree',
    },
    chargesEnabled: { type: Boolean, default: false }, // peut encaisser
    payoutsEnabled: { type: Boolean, default: false }, // peut etre vire
    dateOnboarding: Date,
  },
  { _id: false }
);

/* ------------------------------------------------------------------ *
 *  SCHEMA PRINCIPAL
 * ------------------------------------------------------------------ */

const userSchema = new Schema(
  {
    // --- Identite -------------------------------------------------------
    type: {
      type: String,
      enum: ['utilisateur', 'coach', 'admin'],
      default: 'utilisateur',
      required: true,
      immutable: true, // un utilisateur ne peut pas s'auto-promouvoir coach ou admin
    },

    nom: {
      type: String,
      required: [true, 'Le nom est obligatoire'],
      trim: true,
      maxlength: [50, 'Le nom ne peut dépasser 50 caractères'],
    },

    prenom: {
      type: String,
      required: [true, 'Le prénom est obligatoire'],
      trim: true,
      maxlength: [50, 'Le prénom ne peut dépasser 50 caractères'],
    },

    pseudo: {
      type: String,
      required: [true, 'Le pseudo est obligatoire'],
      unique: true,
      trim: true,
      lowercase: true,
      minlength: [3, 'Le pseudo doit faire au moins 3 caractères'],
      maxlength: [30, 'Le pseudo ne peut dépasser 30 caractères'],
      match: [
        /^[a-z0-9._-]+$/,
        'Le pseudo ne peut contenir que des lettres, chiffres, point, tiret et underscore',
      ],
    },

    email: {
      type: String,
      required: [true, 'L\'email est obligatoire'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Adresse email invalide'],
    },

    password: {
      type: String,
      required: [true, 'Le mot de passe est obligatoire'],
      minlength: [8, 'Le mot de passe doit faire au moins 8 caractères'],
      // `select: false` exclut le hash de TOUTES les requetes par defaut.
      // Pour le lire volontairement (connexion) : .select('+password')
      select: false,
    },

    // --- Profil ---------------------------------------------------------
    avatar: mediaSchema,

    bio: {
      type: String,
      trim: true,
      maxlength: [300, 'La bio ne peut dépasser 300 caractères'],
      default: '',
    },

    sports: {
      type: [String],
      default: [],
      validate: {
        validator: (arr) => arr.length <= 10,
        message: 'Maximum 10 sports',
      },
    },

    ville: { type: String, trim: true, maxlength: 100 },

    // `default: undefined` est ESSENTIEL : sans lui, Mongoose creerait
    // { type: 'Point' } sans coordonnees pour chaque utilisateur, ce qui fait
    // echouer la construction de l'index 2dsphere.
    localisation: { type: pointSchema, default: undefined },

    visibilite: {
      type: String,
      enum: ['public', 'prive'],
      default: 'public',
    },

    // --- Specifique coach ----------------------------------------------
    diplome: { type: diplomeSchema, default: () => ({}) },
    premium: { type: premiumSchema, default: () => ({}) },
    stripeAccount: { type: stripeAccountSchema, default: () => ({}) },

    // --- Specifique payeur ---------------------------------------------
    // Identifiant client Stripe : un utilisateur qui s'abonne a plusieurs
    // coachs reutilise le meme customer, avec ses moyens de paiement enregistres.
    stripeCustomerId: String,

    // --- Compteurs denormalises ----------------------------------------
    // Ces valeurs sont derivees des collections Follow / Subscription / Post.
    // On les duplique ici pour afficher un profil sans lancer quatre `countDocuments`
    // a chaque visite. Elles sont mises a jour par les services concernes.
    stats: {
      followersCount: { type: Number, default: 0, min: 0 },
      followingCount: { type: Number, default: 0, min: 0 },
      postsCount: { type: Number, default: 0, min: 0 },
      abonnesPremiumCount: { type: Number, default: 0, min: 0 },
    },

    // --- Securite / cycle de vie ---------------------------------------
    // Incremente a chaque deconnexion globale ou changement de mot de passe.
    // Un refresh token emis avant l'increment devient automatiquement invalide,
    // ce qui permet de revoquer les sessions sans stocker de liste noire.
    refreshTokenVersion: { type: Number, default: 0 },

    isActive: { type: Boolean, default: true },
    derniereConnexion: Date,
  },
  {
    timestamps: true, // ajoute createdAt et updatedAt
    toObject: { virtuals: true },
    // La configuration toJSON est definie plus bas (section SERIALISATION),
    // car elle a besoin d'un transform et pas seulement des virtuels.
  }
);

/* ------------------------------------------------------------------ *
 *  INDEX
 * ------------------------------------------------------------------ */

// Recherche geographique : « quels coachs autour de moi ? » via $near / $geoWithin.
// Sans cet index, MongoDB refuse purement et simplement les requetes $near.
userSchema.index({ localisation: '2dsphere' });

// Recherche textuelle (module 10). Un seul index texte est autorise par
// collection ; les poids privilegient le pseudo sur le nom de famille.
userSchema.index(
  { pseudo: 'text', nom: 'text', prenom: 'text' },
  { weights: { pseudo: 10, prenom: 3, nom: 3 }, name: 'recherche_utilisateurs' }
);

// Listing des coachs d'une ville (page Maps, filtres).
userSchema.index({ type: 1, ville: 1 });

// File d'attente de moderation : les diplomes a verifier par l'admin.
userSchema.index({ 'diplome.statut': 1, 'diplome.dateSoumission': 1 });

/* ------------------------------------------------------------------ *
 *  VIRTUELS
 * ------------------------------------------------------------------ */

userSchema.virtual('nomComplet').get(function () {
  return `${this.prenom} ${this.nom}`;
});

/** Le coach affiche-t-il le badge « certifie » ? */
userSchema.virtual('estCertifie').get(function () {
  return this.type === 'coach' && this.diplome?.statut === 'verifie';
});

/**
 * Le coach peut-il vendre du contenu premium ?
 * Les trois conditions doivent etre reunies : diplome verifie, compte Stripe
 * en capacite d'encaisser, et tarif publie.
 */
userSchema.virtual('peutMonetiser').get(function () {
  return (
    this.type === 'coach' &&
    this.diplome?.statut === 'verifie' &&
    this.stripeAccount?.chargesEnabled === true &&
    Boolean(this.premium?.stripePriceId)
  );
});

/* ------------------------------------------------------------------ *
 *  HOOKS
 * ------------------------------------------------------------------ */

/**
 * Hachage du mot de passe avant chaque sauvegarde.
 *
 * On le place dans le modele plutot que dans le controleur : c'est le seul
 * endroit par lequel passent obligatoirement TOUTES les ecritures (inscription,
 * reinitialisation, script de seed). Impossible d'oublier de hacher.
 *
 * Le test `isModified` evite de re-hacher un hash deja calcule lors d'une
 * mise a jour du profil, ce qui rendrait le mot de passe inutilisable.
 */
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  this.password = await bcrypt.hash(this.password, config.bcryptSaltRounds);

  // Changement de mot de passe sur un compte existant : on invalide
  // les sessions ouvertes ailleurs.
  if (!this.isNew) {
    this.refreshTokenVersion += 1;
  }

  next();
});

/* ------------------------------------------------------------------ *
 *  METHODES D'INSTANCE
 * ------------------------------------------------------------------ */

/**
 * Compare un mot de passe en clair au hash stocke.
 * Necessite que le document ait ete charge avec .select('+password').
 *
 * bcrypt.compare fait une comparaison a temps constant : le temps de reponse
 * ne depend pas du nombre de caracteres corrects, ce qui bloque les attaques
 * temporelles.
 */
userSchema.methods.comparePassword = function (motDePasseEnClair) {
  return bcrypt.compare(motDePasseEnClair, this.password);
};

/* ------------------------------------------------------------------ *
 *  TROIS NIVEAUX DE VISIBILITE DES DONNEES
 * ------------------------------------------------------------------
 *  versionPublique()  ce que voit n'importe quel visiteur
 *  versionPrivee()    ce que voit le proprietaire du compte
 *  versionAdmin()     ce que voit un moderateur
 *
 * Chaque controleur choisit explicitement le niveau qu'il renvoie. C'est
 * plus verbeux qu'un unique toJSON, mais cela rend la decision visible a la
 * lecture : impossible d'exposer une adresse email par simple distraction.
 * ------------------------------------------------------------------ */

/**
 * Profil public — resultats de recherche, apercus sur la carte, visiteurs.
 *
 * NE CONTIENT NI EMAIL NI DONNEES DE PAIEMENT. Le tarif premium d'un coach
 * y figure en revanche : c'est une information commerciale, destinee a etre
 * vue par les abonnes potentiels.
 */
userSchema.methods.versionPublique = function () {
  const publique = {
    _id: this._id,
    type: this.type,
    pseudo: this.pseudo,
    nom: this.nom,
    prenom: this.prenom,
    avatar: this.avatar,
    bio: this.bio,
    ville: this.ville,
    sports: this.sports,
    visibilite: this.visibilite,
    estCertifie: this.estCertifie,
    stats: this.stats,
    createdAt: this.createdAt,
  };

  // Offre commerciale du coach, visible de tous pour permettre l'abonnement.
  if (this.type === 'coach') {
    publique.diplome = {
      intitule: this.diplome?.intitule,
      organisme: this.diplome?.organisme,
      statut: this.diplome?.statut,
      // Le justificatif lui-meme reste confidentiel.
    };

    if (this.peutMonetiser) {
      publique.premium = {
        actif: this.premium.actif,
        prixMensuel: this.premium.prixMensuel,
        devise: this.premium.devise,
        description: this.premium.description,
      };
    }
  }

  return publique;
};

/**
 * Profil prive — ce que le proprietaire voit de son propre compte.
 *
 * Ajoute a la version publique : email, position exacte, justificatif de
 * diplome et motif de refus, etat du compte Stripe.
 *
 * C'EST LA CORRECTION ANNONCEE AU MODULE 2 : le transform de toJSON masquait
 * `diplome.url` a tout le monde, y compris au coach qui l'avait televerse.
 * Il ne pouvait donc pas verifier ce qu'il avait envoye ni comprendre un
 * refus. On part ici de toObject(), non filtre, et l'on retire explicitement
 * ce qui ne doit jamais sortir.
 */
userSchema.methods.versionPrivee = function () {
  const privee = this.toObject({ virtuals: true });

  // Ne sortent jamais, meme pour le proprietaire : sans interet pour lui,
  // et une fuite en cas de capture d'ecran ou de journalisation.
  delete privee.password;
  delete privee.__v;
  delete privee.refreshTokenVersion;
  delete privee.stripeCustomerId;

  // L'identifiant technique du compte Connect ne regarde que le serveur ;
  // le proprietaire a besoin des statuts, pas de la reference « acct_xxx ».
  if (privee.stripeAccount) delete privee.stripeAccount.id;

  return privee;
};

/**
 * Profil complet pour la moderation.
 * L'administrateur doit acceder au justificatif de diplome et a l'email
 * pour instruire un dossier. Le hash du mot de passe reste exclu : aucun
 * usage legitime, et sa presence dans une reponse serait une faute.
 */
userSchema.methods.versionAdmin = function () {
  const complet = this.toObject({ virtuals: true });
  delete complet.password;
  delete complet.__v;
  return complet;
};

/* ------------------------------------------------------------------ *
 *  SERIALISATION
 * ------------------------------------------------------------------ */

/**
 * Filet de securite a la serialisation JSON.
 *
 * `select: false` protege deja le mot de passe, mais si un developpeur ecrit
 * un jour `.select('+password')` puis renvoie le document tel quel, le hash
 * partirait au client. Ce transform le supprime dans tous les cas, ainsi que
 * les identifiants Stripe et le justificatif de diplome, qui ne regardent
 * que leur proprietaire et l'administrateur.
 */
userSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    delete ret.password;
    delete ret.__v;
    delete ret.refreshTokenVersion;
    delete ret.stripeCustomerId;
    if (ret.stripeAccount) delete ret.stripeAccount.id;
    if (ret.diplome) delete ret.diplome.url; // justificatif confidentiel
    return ret;
  },
});

export const User = model('User', userSchema);
export default User;
