import mongoose from 'mongoose';
import Follow from '../models/Follow.js';
import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * ===========================================================================
 *  SERVICE DE SUIVI (FOLLOW GRATUIT)
 * ===========================================================================
 *
 * A NE PAS CONFONDRE avec l'abonnement premium du module 7 :
 *   follow  = gratuit, donne acces au contenu public d'un profil prive
 *   premium = payant via Stripe, donne acces au contenu exclusif
 *
 * POURQUOI UN SERVICE PLUTOT QUE DU CODE DANS LE CONTROLEUR ?
 * Chaque operation touche DEUX collections : la relation elle-meme et les
 * compteurs denormalises des deux utilisateurs. Ces ecritures doivent etre
 * atomiques, sinon un « 42 abonnes » finit par ne plus correspondre a une
 * liste qui en contient 41 — un ecart impossible a rattraper sans recomptage
 * complet. Regrouper la logique ici garantit qu'aucun appelant ne peut
 * l'oublier.
 *
 * REGLE CENTRALE : LES COMPTEURS NE BOUGENT QUE POUR UN SUIVI « ACCEPTE ».
 * Une demande en attente n'est pas un abonnement. L'incrementer des la
 * demande afficherait des abonnes fantomes sur les profils prives.
 * ===========================================================================
 */

/** Compare deux identifiants Mongo, ObjectId ou chaine. */
const memeId = (a, b) => String(a) === String(b);

/**
 * Execute une fonction dans une transaction et ferme proprement la session.
 * Factorise le `try/finally` repete a chaque operation : oublier
 * `endSession()` laisse fuir des sessions cote serveur MongoDB.
 */
async function dansTransaction(operation) {
  const session = await mongoose.startSession();
  try {
    let resultat;
    await session.withTransaction(async () => {
      resultat = await operation(session);
    });
    return resultat;
  } finally {
    await session.endSession();
  }
}

/* ================================================================== *
 *  SUIVRE
 * ================================================================== */

/**
 * Suit un profil, ou envoie une demande si celui-ci est prive.
 *
 * @param {object} demandeur - req.user
 * @param {object} cible - document User vise
 * @returns {{statut: 'accepte'|'en_attente', deja: boolean}}
 */
export async function suivre(demandeur, cible) {
  if (memeId(demandeur._id, cible._id)) {
    throw ApiError.badRequest('Vous ne pouvez pas vous suivre vous-même');
  }

  if (!cible.isActive) {
    throw ApiError.notFound('Profil introuvable');
  }

  // Etat courant : re-suivre quelqu'un que l'on suit deja n'est pas une
  // erreur du point de vue de l'utilisateur, c'est juste sans effet.
  const existante = await Follow.findOne({
    follower: demandeur._id,
    following: cible._id,
  });

  if (existante) {
    return { statut: existante.statut, deja: true };
  }

  // Un profil public accepte immediatement ; un profil prive met en attente.
  const statut = cible.visibilite === 'prive' ? 'en_attente' : 'accepte';

  return dansTransaction(async (session) => {
    try {
      await Follow.create(
        [
          {
            follower: demandeur._id,
            following: cible._id,
            statut,
            dateAcceptation: statut === 'accepte' ? new Date() : undefined,
          },
        ],
        { session }
      );
    } catch (erreur) {
      // Deux clics simultanes sur « Suivre » : l'index unique a fait son
      // travail. On traite le cas comme un doublon inoffensif plutot que
      // de renvoyer une erreur serveur a l'utilisateur.
      if (erreur.code === 11000) {
        return { statut, deja: true };
      }
      throw erreur;
    }

    if (statut === 'accepte') {
      await majCompteurs(demandeur._id, cible._id, 1, session);
    }

    return { statut, deja: false };
  });
}

/* ================================================================== *
 *  ACCEPTER / REFUSER UNE DEMANDE
 * ================================================================== */

/**
 * Accepte une demande de suivi.
 * Seul le DESTINATAIRE de la demande peut l'accepter — la verification est
 * faite ici, pas dans le contrôleur, pour qu'aucun appelant ne l'omette.
 */
export async function accepter(destinataire, idDemande) {
  const demande = await Follow.findById(idDemande);

  if (!demande) throw ApiError.notFound('Demande introuvable');

  if (!memeId(demande.following, destinataire._id)) {
    throw ApiError.forbidden('Cette demande ne vous est pas adressée');
  }

  if (demande.statut === 'accepte') {
    throw ApiError.conflict('Cette demande a déjà été acceptée');
  }

  return dansTransaction(async (session) => {
    await Follow.updateOne(
      { _id: demande._id },
      { statut: 'accepte', dateAcceptation: new Date() },
      { session }
    );

    await majCompteurs(demande.follower, demande.following, 1, session);

    return { idDemande: demande._id, follower: demande.follower };
  });
}

/**
 * Refuse une demande : le document est supprime.
 *
 * On ne conserve pas un statut « refuse ». Le demandeur pourrait vouloir
 * retenter plus tard, et un refus definitif l'en empecherait. Cela evite
 * aussi d'accumuler des documents inutiles.
 */
export async function refuser(destinataire, idDemande) {
  const demande = await Follow.findById(idDemande);

  if (!demande) throw ApiError.notFound('Demande introuvable');

  if (!memeId(demande.following, destinataire._id)) {
    throw ApiError.forbidden('Cette demande ne vous est pas adressée');
  }

  if (demande.statut === 'accepte') {
    throw ApiError.conflict(
      'Cette demande est déjà acceptée. Utilisez « retirer cet abonné ».'
    );
  }

  await Follow.deleteOne({ _id: demande._id });

  // Aucun compteur a modifier : une demande en attente n'en incrementait
  // aucun.
  return { idDemande: demande._id };
}

/* ================================================================== *
 *  RETIRER
 * ================================================================== */

/**
 * Se desabonner d'un profil.
 * Fonctionne aussi pour annuler une demande encore en attente.
 */
export async function retirer(demandeur, cible) {
  const relation = await Follow.findOne({
    follower: demandeur._id,
    following: cible._id,
  });

  if (!relation) {
    throw ApiError.notFound('Vous ne suivez pas ce profil');
  }

  const etaitAccepte = relation.statut === 'accepte';

  return dansTransaction(async (session) => {
    await Follow.deleteOne({ _id: relation._id }, { session });

    // Seul un suivi accepte comptait dans les statistiques.
    if (etaitAccepte) {
      await majCompteurs(demandeur._id, cible._id, -1, session);
    }

    return { etaitAccepte };
  });
}

/**
 * Retirer quelqu'un de ses propres abonnes.
 *
 * C'est l'operation symetrique de `retirer`, vue depuis l'autre cote : sur
 * un profil prive, c'est le seul moyen de revenir sur une acceptation sans
 * bloquer la personne.
 */
export async function retirerAbonne(proprietaire, abonne) {
  const relation = await Follow.findOne({
    follower: abonne._id,
    following: proprietaire._id,
  });

  if (!relation) {
    throw ApiError.notFound('Cette personne ne vous suit pas');
  }

  const etaitAccepte = relation.statut === 'accepte';

  return dansTransaction(async (session) => {
    await Follow.deleteOne({ _id: relation._id }, { session });

    if (etaitAccepte) {
      await majCompteurs(abonne._id, proprietaire._id, -1, session);
    }

    return { etaitAccepte };
  });
}

/* ================================================================== *
 *  COMPTEURS
 * ================================================================== */

/**
 * Met a jour les deux compteurs denormalises d'un coup.
 *
 * `followingCount` du suiveur et `followersCount` du suivi evoluent
 * ensemble : une seule requete `bulkWrite`, dans la meme transaction que
 * l'ecriture de la relation.
 *
 * @param {number} delta - +1 pour un ajout, -1 pour un retrait
 */
async function majCompteurs(idFollower, idFollowing, delta, session) {
  await User.bulkWrite(
    [
      {
        updateOne: {
          filter: { _id: idFollower },
          update: { $inc: { 'stats.followingCount': delta } },
        },
      },
      {
        updateOne: {
          filter: { _id: idFollowing },
          update: { $inc: { 'stats.followersCount': delta } },
        },
      },
    ],
    { session }
  );
}

/**
 * Recalcule les compteurs d'un utilisateur a partir de la collection Follow.
 *
 * Filet de securite : si un incident (panne au mauvais moment, intervention
 * manuelle en base, import de donnees) desynchronise les compteurs, cette
 * fonction retablit la verite. Le schema borne deja les valeurs a 0 minimum,
 * mais un compteur trop haut resterait invisible sans recomptage.
 */
export async function recompter(idUtilisateur) {
  /*
   * ON COMPTE CE QUI EST AFFICHABLE, pas les documents bruts.
   *
   * Un `countDocuments` sur la collection compte aussi les relations vers des
   * comptes desactives ou supprimes — que la liste, elle, n'affiche pas. Le
   * profil annoncait alors « 25 abonnes » au-dessus d'une liste de 23, et
   * l'ecart etait impossible a comprendre depuis l'interface.
   *
   * Les deux passent desormais par `compterRelations`, donc par le meme
   * pipeline que la liste : ils ne peuvent plus diverger.
   */
  const [followers, following] = await Promise.all([
    compterRelations(idUtilisateur, 'abonnes'),
    compterRelations(idUtilisateur, 'abonnements'),
  ]);

  await User.updateOne(
    { _id: idUtilisateur },
    { 'stats.followersCount': followers, 'stats.followingCount': following }
  );

  return { followersCount: followers, followingCount: following };
}

/* ================================================================== *
 *  BASCULE DE VISIBILITE
 * ================================================================== */

/**
 * Accepte automatiquement toutes les demandes en attente.
 *
 * Appelee quand un profil passe de PRIVE A PUBLIC. Les demandes n'ont alors
 * plus d'objet : n'importe qui peut deja voir le contenu. Les laisser en
 * attente afficherait une pastille de notification que rien ne permettrait
 * de traiter utilement.
 *
 * L'operation inverse (public vers prive) ne touche a rien : on ne retire
 * pas leurs abonnes a quelqu'un qui change un reglage de confidentialite.
 */
export async function accepterDemandesEnAttente(idUtilisateur) {
  const demandes = await Follow.find({
    following: idUtilisateur,
    statut: 'en_attente',
  }).select('follower');

  if (demandes.length === 0) return { acceptees: 0 };

  return dansTransaction(async (session) => {
    await Follow.updateMany(
      { following: idUtilisateur, statut: 'en_attente' },
      { statut: 'accepte', dateAcceptation: new Date() },
      { session }
    );

    // Le profil gagne autant d'abonnes qu'il y avait de demandes ; chaque
    // demandeur gagne un abonnement.
    await User.bulkWrite(
      [
        {
          updateOne: {
            filter: { _id: idUtilisateur },
            update: { $inc: { 'stats.followersCount': demandes.length } },
          },
        },
        ...demandes.map((d) => ({
          updateOne: {
            filter: { _id: d.follower },
            update: { $inc: { 'stats.followingCount': 1 } },
          },
        })),
      ],
      { session }
    );

    return { acceptees: demandes.length };
  });
}

/* ================================================================== *
 *  SUGGESTIONS
 * ================================================================== */

/**
 * Coachs a suivre : meme ville, certifies en priorite, non deja suivis.
 *
 * Sert surtout au nouvel inscrit, dont le fil est vide et qui ne sait pas
 * par ou commencer. Un fil vide sans piste d'action est la premiere cause
 * d'abandon sur un reseau social.
 *
 * On exclut les profils deja suivis ET ceux dont la demande est en attente :
 * proposer de suivre quelqu'un a qui l'on vient d'envoyer une demande serait
 * incoherent.
 */
export async function suggestions(utilisateur, limite = 6) {
  const dejaEnRelation = await Follow.distinct('following', {
    follower: utilisateur._id,
  });

  const exclus = [...dejaEnRelation, utilisateur._id];

  const filtreBase = {
    _id: { $nin: exclus },
    type: 'coach',
    isActive: true,
    'diplome.statut': 'verifie',
  };

  // Priorite a la meme ville : la plateforme met en relation des personnes
  // qui peuvent se rencontrer physiquement.
  let coachs = [];
  if (utilisateur.ville) {
    coachs = await User.find({ ...filtreBase, ville: utilisateur.ville })
      .sort({ 'stats.followersCount': -1 })
      .limit(limite);
  }

  // Complement avec des coachs certifies d'ailleurs si la ville n'en fournit
  // pas assez — mieux vaut une suggestion lointaine qu'un ecran vide.
  if (coachs.length < limite) {
    const complement = await User.find({
      ...filtreBase,
      _id: { $nin: [...exclus, ...coachs.map((c) => c._id)] },
    })
      .sort({ 'stats.followersCount': -1 })
      .limit(limite - coachs.length);

    coachs = [...coachs, ...complement];
  }

  return coachs.map((c) => ({
    ...c.versionPublique(),
    memeVille: Boolean(utilisateur.ville) && c.ville === utilisateur.ville,
  }));
}

/* ================================================================== *
 *  LISTES D'ABONNES ET D'ABONNEMENTS
 * ================================================================== */

/**
 * Etapes communes a la liste ET au comptage.
 *
 * C'EST LA CORRECTION D'UN DEFAUT REEL, ET LA RAISON D'ETRE DE CE BLOC.
 *
 * Le code precedent paginait d'abord, puis ecartait les comptes desactives
 * avec un `.filter()` en JavaScript. Trois consequences, toutes visibles a
 * l'ecran :
 *
 *   1. UNE PAGE POUVAIT RENDRE MOINS D'ELEMENTS QUE DEMANDE. Vingt relations
 *      lues, trois vers des comptes desactives : dix-sept lignes affichees.
 *
 *   2. LE TOTAL NE CORRESPONDAIT PAS A LA LISTE. Il venait d'un
 *      `countDocuments` sur le filtre BRUT, sans le tri par compte actif :
 *      le profil annoncait « 25 abonnes » et la liste en montrait 23.
 *
 *   3. UNE RELATION ORPHELINE — dont l'utilisateur a ete supprime — passait
 *      le `countDocuments` mais disparaissait de la liste, le `populate`
 *      rendant `null`. C'est le cas le plus frequent en pratique, et le plus
 *      deroutant : rien dans l'interface ne laisse deviner que la personne
 *      n'existe plus.
 *
 * En placant le tri AVANT la pagination, dans la base, les trois disparaissent
 * ensemble. `$unwind` sans `preserveNullAndEmptyArrays` ecarte les relations
 * orphelines ; `$match` sur `isActive` ecarte les comptes desactives.
 */
function etapesRelations(idCible, sens) {
  const champLie = sens === 'abonnes' ? 'follower' : 'following';

  const filtre =
    sens === 'abonnes'
      ? { following: idCible, statut: 'accepte' }
      : { follower: idCible, statut: 'accepte' };

  return [
    { $match: filtre },
    {
      $lookup: {
        from: 'users',
        localField: champLie,
        foreignField: '_id',
        as: 'personne',
      },
    },
    // Pas de `preserveNullAndEmptyArrays` : une relation dont l'utilisateur a
    // disparu doit sortir du decompte, pas seulement de l'affichage.
    { $unwind: '$personne' },
    { $match: { 'personne.isActive': true } },
  ];
}

/**
 * Une page de relations, et le total correspondant.
 *
 * `$facet` calcule les deux DEPUIS LE MEME PIPELINE. C'est ce qui garantit
 * qu'ils ne peuvent plus diverger : le total n'est pas un second comptage
 * ecrit ailleurs, c'est le meme filtre compte au lieu d'etre pagine.
 */
export async function listerRelations(idCible, sens, { saut = 0, limite = 20 } = {}) {
  const etapes = etapesRelations(idCible, sens);

  const [resultat] = await Follow.aggregate([
    ...etapes,
    {
      $facet: {
        elements: [
          { $sort: { createdAt: -1 } },
          { $skip: saut },
          { $limit: limite },
          {
            $project: {
              createdAt: 1,
              dateAcceptation: 1,
              'personne._id': 1,
              'personne.pseudo': 1,
              'personne.nom': 1,
              'personne.prenom': 1,
              'personne.avatar': 1,
              'personne.type': 1,
              'personne.ville': 1,
              'personne.diplome': 1,
              'personne.stats': 1,
            },
          },
        ],
        total: [{ $count: 'valeur' }],
      },
    },
  ]);

  return {
    relations: resultat?.elements || [],
    total: resultat?.total?.[0]?.valeur || 0,
  };
}

/**
 * Compte les relations REELLEMENT affichables.
 *
 * Utilise la meme definition que la liste, pour la meme raison : un compteur
 * qui ne correspond pas a ce qu'on voit est pire qu'un compteur absent — il
 * fait chercher des personnes qui n'existent plus.
 */
export async function compterRelations(idCible, sens) {
  const [resultat] = await Follow.aggregate([
    ...etapesRelations(idCible, sens),
    { $count: 'valeur' },
  ]);

  return resultat?.valeur || 0;
}
