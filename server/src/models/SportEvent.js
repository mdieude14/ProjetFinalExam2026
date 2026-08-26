import { Schema, model } from 'mongoose';

/**
 * ===========================================================================
 *  ÉVÉNEMENT SPORTIF
 * ===========================================================================
 *
 * Une séance collective organisée par un coach : sortie course, cours en
 * plein air, stage. Les participants s'inscrivent via `EventRegistration`,
 * une collection SÉPARÉE — la raison est expliquée en tête de ce fichier-là,
 * et c'est la décision structurante du module.
 */

/**
 * Point GeoJSON — sous-schema a part, et `default: undefined` plus bas.
 *
 * LE PIEGE EST LE MEME QU'AU MODULE 1, et il coute une heure a qui l'ignore.
 * Declare en ligne dans le schema du lieu, Mongoose fabrique pour CHAQUE
 * evenement un `{ type: 'Point' }` sans coordonnees — un point degenere. Le
 * validateur le refuse, et toute creation d'evenement echoue sur un message
 * parlant de coordonnees alors qu'aucune n'a ete fournie.
 *
 * En sous-schema avec `default: undefined`, le champ n'existe tout
 * simplement pas tant qu'on ne le renseigne pas. C'est aussi ce qui permet a
 * l'index 2dsphere de se construire : il ignore les documents sans point,
 * mais bute sur un point incomplet.
 */
const pointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: {
      type: [Number], // [longitude, latitude] — ordre GeoJSON
      required: true,
      validate: {
        validator: (c) =>
          Array.isArray(c) &&
          c.length === 2 &&
          c[0] >= -180 && c[0] <= 180 &&
          c[1] >= -90 && c[1] <= 90,
        message: 'Coordonnees invalides : attendu [longitude, latitude]',
      },
    },
  },
  { _id: false }
);

/**
 * Lieu de l'événement.
 *
 * L'ADRESSE EXACTE N'EST PAS TOUJOURS PUBLIQUE, contrairement à la ville.
 * Sur un événement réservé aux abonnés premium, l'adresse ne part qu'à ceux
 * qui y ont droit : sans quoi il suffirait de lire la fiche pour se présenter
 * sur place sans avoir payé. Le tri est fait dans `versionPour()`, jamais
 * dans un contrôleur.
 */
const lieuSchema = new Schema(
  {
    adresse: { type: String, trim: true, maxlength: 200 },
    ville: { type: String, trim: true, maxlength: 100, required: true },
    codePostal: { type: String, trim: true, maxlength: 10 },

    // Facultatif : un evenement peut n'avoir qu'une ville.
    localisation: { type: pointSchema, default: undefined },
  },
  { _id: false }
);

const sportEventSchema = new Schema(
  {
    organisateur: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /**
     * `public`  visible de tous
     * `prive`   réservé aux abonnés premium de l'organisateur
     *
     * Le nom reprend celui de la visibilité des profils (module 4) : même
     * mot, même idée, pour éviter d'avoir à retenir deux vocabulaires.
     */
    type: {
      type: String,
      enum: ['public', 'prive'],
      default: 'public',
      index: true,
    },

    titre: {
      type: String,
      required: [true, 'Le titre est requis'],
      trim: true,
      minlength: [3, 'Le titre doit faire au moins 3 caracteres'],
      maxlength: [120, 'Le titre ne peut depasser 120 caracteres'],
    },

    description: { type: String, trim: true, maxlength: 2000 },

    /** Discipline concernée — alimente les filtres. */
    sport: { type: String, trim: true, maxlength: 50, index: true },

    dateDebut: { type: Date, required: [true, 'La date de debut est requise'] },
    dateFin: { type: Date, required: [true, 'La date de fin est requise'] },

    lieu: { type: lieuSchema, required: true },

    /**
     * Nombre de places. `null` signifie « sans limite ».
     *
     * ON DISTINGUE `null` DE `0`. Zéro place serait un événement auquel
     * personne ne peut s'inscrire — absurde, donc refusé par le minimum.
     * L'absence de limite se dit par `null`, pas par une valeur sentinelle
     * comme 999999 qu'un jour quelqu'un finirait par atteindre.
     */
    capaciteMax: {
      type: Number,
      default: null,
      min: [1, 'La capacite doit valoir au moins 1'],
      max: [10000, 'La capacite ne peut depasser 10000'],
    },

    /**
     * Compteur d'inscrits, tenu à jour DANS LA MÊME TRANSACTION que les
     * inscriptions elles-mêmes.
     *
     * C'est une dénormalisation assumée : compter les documents
     * `EventRegistration` à chaque affichage de liste coûterait une requête
     * par événement. Le prix à payer est la rigueur — toute écriture qui
     * touche une inscription doit toucher ce compteur, sous transaction.
     */
    inscritsCount: { type: Number, default: 0, min: 0 },

    image: {
      url: String,
      publicId: String,
      largeur: Number,
      hauteur: Number,
    },

    /**
     * `planifie` en cours · `annule` par l'organisateur · `termine` passé
     *
     * ANNULER N'EST PAS SUPPRIMER. Les inscrits doivent pouvoir constater
     * l'annulation : effacer l'événement les laisserait sans explication,
     * avec une date bloquée dans leur agenda et aucun moyen de comprendre.
     */
    statut: {
      type: String,
      enum: ['planifie', 'annule', 'termine'],
      default: 'planifie',
      index: true,
    },

    /** Motif d'annulation, affiché aux inscrits. */
    motifAnnulation: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

/* ------------------------------------------------------------------ *
 *  VALIDATION
 * ------------------------------------------------------------------ */

/**
 * `dateFin` doit suivre `dateDebut`.
 *
 * Au niveau du SCHÉMA et pas seulement du validateur HTTP : un script, un
 * import de données ou une future route d'administration passeraient à côté
 * d'une règle qui ne vivrait que dans `express-validator`.
 */
sportEventSchema.pre('validate', function (suite) {
  if (this.dateDebut && this.dateFin && this.dateFin <= this.dateDebut) {
    this.invalidate('dateFin', 'La date de fin doit suivre la date de debut');
  }
  suite();
});

/* ------------------------------------------------------------------ *
 *  INDEX
 * ------------------------------------------------------------------ */

// Recherche par proximité — même mécanique que la carte des coachs.
sportEventSchema.index({ 'lieu.localisation': '2dsphere' });

// Liste des événements à venir : le tri par date est la requête la plus
// fréquente de tout le module.
sportEventSchema.index({ dateDebut: 1 });

// Agenda d'un organisateur, du plus récent au plus ancien.
sportEventSchema.index({ organisateur: 1, dateDebut: -1 });

// Liste publique filtrée : statut + date, l'ordre suit la sélectivité.
sportEventSchema.index({ statut: 1, type: 1, dateDebut: 1 });

/*
 * Recherche textuelle (module 10).
 *
 * Le sport pèse autant que le titre : « natation » est très souvent ce que
 * l'on cherche, alors que le titre dira « Séance du samedi » sans nommer la
 * discipline. Les deux méritent donc le même poids.
 */
sportEventSchema.index(
  { titre: 'text', sport: 'text', description: 'text' },
  { weights: { titre: 8, sport: 8, description: 2 }, name: 'recherche_evenements' }
);

/* ------------------------------------------------------------------ *
 *  VIRTUELS
 * ------------------------------------------------------------------ */

/** Toutes les places sont-elles prises ? Toujours faux sans capacité. */
sportEventSchema.virtual('estComplet').get(function () {
  if (this.capaciteMax === null || this.capaciteMax === undefined) return false;
  return this.inscritsCount >= this.capaciteMax;
});

/** Places encore disponibles, ou `null` si l'événement est sans limite. */
sportEventSchema.virtual('placesRestantes').get(function () {
  if (this.capaciteMax === null || this.capaciteMax === undefined) return null;
  return Math.max(0, this.capaciteMax - this.inscritsCount);
});

/**
 * L'événement est-il derrière nous ?
 *
 * On se fie à `dateFin` et non à `dateDebut` : une sortie commencée à 9 h et
 * finissant à 17 h est encore en cours à midi. S'inscrire pendant qu'elle se
 * déroule reste discutable, mais la refuser dès 9 h 01 serait faux.
 */
sportEventSchema.virtual('estPasse').get(function () {
  return this.dateFin < new Date();
});

/** Accepte-t-il encore des inscriptions ? */
sportEventSchema.virtual('inscriptionOuverte').get(function () {
  return this.statut === 'planifie' && !this.estPasse && !this.estComplet;
});

/* ------------------------------------------------------------------ *
 *  VUES
 * ------------------------------------------------------------------ */

/**
 * Vue adaptée au visiteur.
 *
 * L'ADRESSE EXACTE EST LE SEUL CHAMP RÉELLEMENT SENSIBLE ICI.
 * Sur un événement `prive`, elle n'est envoyée qu'à ceux qui y ont droit :
 * abonnés premium, organisateur, administrateur. Le reste — titre, ville,
 * date, places — demeure visible : c'est ce qui permet à un non-abonné de
 * savoir que l'événement existe, donc de vouloir s'abonner. Le masquer
 * entièrement supprimerait l'argument commercial en même temps que la fuite.
 *
 * Même logique que le contenu premium du module 7 : on retire le champ de la
 * RÉPONSE HTTP, on ne se contente pas de le masquer à l'écran.
 *
 * @param {object|null} visiteur
 * @param {boolean} aAcces abonné premium de l'organisateur
 */
sportEventSchema.methods.versionPour = function (visiteur, aAcces = false) {
  const organisateurId = this.organisateur?._id || this.organisateur;
  const estOrganisateur =
    visiteur && String(visiteur._id) === String(organisateurId);
  const estAdmin = visiteur?.type === 'admin';

  const detailsAutorises = this.type === 'public' || aAcces || estOrganisateur || estAdmin;

  const vue = {
    _id: this._id,
    organisateur: this.organisateur,
    type: this.type,
    titre: this.titre,
    description: this.description,
    sport: this.sport,
    dateDebut: this.dateDebut,
    dateFin: this.dateFin,
    capaciteMax: this.capaciteMax,
    inscritsCount: this.inscritsCount,
    placesRestantes: this.placesRestantes,
    estComplet: this.estComplet,
    estPasse: this.estPasse,
    inscriptionOuverte: this.inscriptionOuverte,
    image: this.image,
    statut: this.statut,
    motifAnnulation: this.motifAnnulation,
    createdAt: this.createdAt,

    lieu: {
      ville: this.lieu?.ville,
      codePostal: this.lieu?.codePostal,
    },

    // Signalé explicitement, pour que l'interface puisse expliquer ce qui
    // manque au lieu d'afficher un vide inexpliqué.
    detailsVerrouilles: !detailsAutorises,
  };

  if (detailsAutorises) {
    vue.lieu.adresse = this.lieu?.adresse;
    vue.lieu.localisation = this.lieu?.localisation;
  }

  return vue;
};

export const SportEvent = model('SportEvent', sportEventSchema);
export default SportEvent;
