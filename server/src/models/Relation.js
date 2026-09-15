import { Schema, model } from 'mongoose';

/**
 * ===========================================================================
 *  RELATIONS DE MODÉRATION PERSONNELLE — blocage et restriction
 * ===========================================================================
 *
 * UNE SEULE COLLECTION POUR DEUX ACTIONS, ET C'EST DÉLIBÉRÉ.
 * Bloquer et restreindre décrivent la même chose : un lien ORIENTÉ entre deux
 * comptes, posé par l'un contre l'autre. Seul l'effet diffère. Deux
 * collections dupliqueraient les index, les requêtes de lecture et les purges,
 * pour une différence qui tient dans un champ.
 *
 * LES DEUX ACTIONS NE SONT PAS DES DEGRÉS D'UNE MÊME ÉCHELLE :
 *
 *   BLOCAGE      réciproque dans ses effets, et visible.
 *                La personne bloquée ne voit plus le contenu, ne peut plus
 *                suivre, écrire, aimer ni commenter — et symétriquement, celui
 *                qui bloque ne voit plus la bloquée. Les relations de suivi
 *                existantes sont rompues DANS LES DEUX SENS.
 *
 *   RESTRICTION  unilatérale, et SILENCIEUSE.
 *                La personne restreinte continue de tout voir et ne se rend
 *                compte de rien. Mais ses messages arrivent en demande au lieu
 *                du fil, ses commentaires attendent une approbation, et elle
 *                ne voit plus les accusés de lecture.
 *
 * LE SENS DE LA RELATION EST PORTEUR : `source` subit la gêne et agit,
 * `cible` est celle contre qui l'action est posée. Inverser les deux inverse
 * l'effet — d'où l'index unique sur le TRIPLET, et non sur la paire.
 * ===========================================================================
 */

const relationSchema = new Schema(
  {
    /** Celui qui pose l'action. */
    source: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /** Celui qui la subit. */
    cible: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ['blocage', 'restriction'],
      required: true,
    },
  },
  { timestamps: true }
);

/* ------------------------------------------------------------------ *
 *  INDEX
 * ------------------------------------------------------------------ */

/**
 * UNICITÉ SUR LE TRIPLET, PAS SUR LA PAIRE.
 *
 * Une même personne peut à la fois bloquer et restreindre — c'est rare mais
 * légitime, et surtout l'inverse n'aurait aucun sens : poser l'unicité sur
 * `{ source, cible }` interdirait de restreindre quelqu'un qu'on a déjà
 * bloqué, et le second appel échouerait sur une erreur de doublon
 * incompréhensible.
 *
 * L'unicité est ce qui rend l'action IDEMPOTENTE : bloquer deux fois de suite
 * ne crée pas deux documents, et le contrôleur n'a pas à vérifier avant
 * d'écrire — c'est la base qui refuse.
 */
relationSchema.index({ source: 1, cible: 1, type: 1 }, { unique: true });

/**
 * « Qui m'a bloqué ? » se pose aussi souvent que « qui ai-je bloqué ? ».
 * Le blocage étant réciproque dans ses effets, chaque contrôle d'accès
 * interroge les DEUX sens : sans cet index, la seconde moitié de la question
 * balaierait la collection.
 */
relationSchema.index({ cible: 1, type: 1 });

/* ------------------------------------------------------------------ *
 *  MÉTHODES STATIQUES
 * ------------------------------------------------------------------ */

/**
 * Existe-t-il un blocage entre ces deux comptes, DANS UN SENS OU DANS L'AUTRE ?
 *
 * C'est la question que pose le contrôle d'accès, et elle est symétrique :
 * que j'aie bloqué quelqu'un ou qu'il m'ait bloqué, aucun des deux ne doit
 * voir le contenu de l'autre. Ne tester qu'un sens laisserait la moitié du
 * verrou ouverte — et ce serait la moitié la plus grave, celle où la personne
 * bloquée continue de tout voir.
 */
relationSchema.statics.blocageEntre = async function (a, b) {
  if (!a || !b) return false;

  const trouve = await this.exists({
    type: 'blocage',
    $or: [
      { source: a, cible: b },
      { source: b, cible: a },
    ],
  });

  return Boolean(trouve);
};

/**
 * `cible` est-elle restreinte par `source` ?
 *
 * Contrairement au blocage, la question est ORIENTÉE : la restriction ne
 * produit aucun effet dans l'autre sens. Celui qui restreint continue de voir
 * normalement les contenus de la personne restreinte.
 */
relationSchema.statics.estRestreintPar = async function (source, cible) {
  if (!source || !cible) return false;
  return Boolean(await this.exists({ type: 'restriction', source, cible }));
};

/**
 * Identifiants de tous les comptes en blocage avec celui-ci, les deux sens
 * confondus.
 *
 * Sert aux requêtes de LISTE — recherche, carte, fil — où l'on doit écarter
 * les comptes bloqués EN AMONT plutôt que de les filtrer après coup. Filtrer
 * après coup obligerait à charger des documents pour les jeter, et fausserait
 * le compte de résultats : c'est exactement le défaut corrigé au module 6.
 */
relationSchema.statics.idsBloquesAvec = async function (idUtilisateur) {
  if (!idUtilisateur) return [];

  const liens = await this.find(
    {
      type: 'blocage',
      $or: [{ source: idUtilisateur }, { cible: idUtilisateur }],
    },
    { source: 1, cible: 1 }
  );

  const autres = liens.map((l) =>
    String(l.source) === String(idUtilisateur) ? l.cible : l.source
  );

  // Un même compte peut apparaître deux fois si chacun a bloqué l'autre.
  return [...new Set(autres.map(String))];
};

export const Relation = model('Relation', relationSchema);
export default Relation;
