import mongoose from 'mongoose';

import User from '../models/User.js';
import Follow from '../models/Follow.js';
import Relation from '../models/Relation.js';
import Signalement from '../models/Signalement.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * ===========================================================================
 *  MODÉRATION PERSONNELLE — bloquer, restreindre, signaler
 * ===========================================================================
 *
 * TROIS ACTIONS QUI NE SONT PAS DES DEGRÉS D'UNE MÊME ÉCHELLE.
 *
 *   BLOQUER      coupe l'accès dans les deux sens, rompt les suivis existants,
 *                et se voit. C'est l'action forte.
 *
 *   RESTREINDRE  ne coupe rien et ne se voit pas. Les messages de la personne
 *                arrivent en demande, ses commentaires attendent approbation.
 *                C'est la sortie discrète, quand bloquer serait un esclandre.
 *
 *   SIGNALER     ne change RIEN à la relation : cela ouvre un dossier pour
 *                l'administration. On peut signaler quelqu'un qu'on continue
 *                de suivre — c'est même le cas ordinaire.
 *
 * POURQUOI CE SERVICE EXISTE. Les règles ci-dessous seront invoquées par le
 * profil, la messagerie, les commentaires et le back-office. Écrites dans
 * chaque contrôleur, il suffirait d'un oubli pour qu'un blocage laisse passer
 * un message — et ce serait le cas le plus grave, celui où la personne bloquée
 * continue d'atteindre celle qui l'a bloquée.
 * ===========================================================================
 */

const memeId = (a, b) => String(a) === String(b);

/**
 * Exécute une opération dans une transaction et ferme la session.
 * Même motif qu'au module 6 : oublier `endSession()` laisse fuir des sessions
 * côté serveur MongoDB.
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

/**
 * Contrôles communs aux trois actions.
 *
 * ON REFUSE DE VISER UN ADMINISTRATEUR. Bloquer le compte qui instruit les
 * signalements permettrait à un compte problématique de se soustraire à la
 * modération : il lui suffirait de bloquer l'administration pour devenir
 * intouchable. C'est le genre de contournement qu'on ne découvre qu'une fois
 * exploité.
 */
async function chargerCible(auteur, idCible, verbe) {
  if (!mongoose.isValidObjectId(idCible)) {
    throw ApiError.badRequest('Identifiant invalide');
  }

  if (memeId(auteur._id, idCible)) {
    throw ApiError.badRequest(`Vous ne pouvez pas vous ${verbe} vous-même`);
  }

  const cible = await User.findById(idCible);
  if (!cible || !cible.isActive) throw ApiError.notFound('Utilisateur introuvable');

  if (cible.type === 'admin') {
    throw ApiError.forbidden("Ce compte relève de l'administration du site");
  }

  return cible;
}

/* ================================================================== *
 *  BLOQUER
 * ================================================================== */

/**
 * Bloque un compte, et rompt les liens de suivi dans les deux sens.
 *
 * TOUT SE FAIT DANS UNE TRANSACTION, et ce n'est pas décoratif : le blocage
 * touche trois collections. Un incident entre l'écriture de la relation et la
 * suppression des suivis laisserait quelqu'un « bloqué mais toujours abonné »,
 * avec des compteurs faux que plus rien ne corrigerait.
 *
 * LES COMPTEURS NE SE DÉCRÉMENTENT QUE POUR LES SUIVIS ACCEPTÉS. Une demande
 * en attente n'a jamais été comptée (voir `follow.service.js`) : la décrémenter
 * ferait passer un compteur sous zéro sur un profil privé.
 */
export async function bloquer(auteur, idCible) {
  const cible = await chargerCible(auteur, idCible, 'bloquer');

  return dansTransaction(async (session) => {
    try {
      await Relation.create(
        [{ source: auteur._id, cible: cible._id, type: 'blocage' }],
        { session }
      );
    } catch (erreur) {
      /*
       * Déjà bloqué : l'index unique a fait son travail. On traite le cas
       * comme un doublon inoffensif — bloquer deux fois doit rester sans
       * effet, pas produire une erreur serveur sur un double clic.
       */
      if (erreur.code === 11000) return { deja: true, suivisRompus: 0 };
      throw erreur;
    }

    /* Les deux sens de la relation de suivi, s'ils existent. */
    const liens = await Follow.find(
      {
        $or: [
          { follower: auteur._id, following: cible._id },
          { follower: cible._id, following: auteur._id },
        ],
      },
      null,
      { session }
    );

    if (liens.length > 0) {
      await Follow.deleteMany(
        { _id: { $in: liens.map((l) => l._id) } },
        { session }
      );

      const operations = [];
      for (const lien of liens) {
        if (lien.statut !== 'accepte') continue;
        operations.push(
          {
            updateOne: {
              filter: { _id: lien.follower },
              update: { $inc: { 'stats.followingCount': -1 } },
            },
          },
          {
            updateOne: {
              filter: { _id: lien.following },
              update: { $inc: { 'stats.followersCount': -1 } },
            },
          }
        );
      }

      if (operations.length > 0) await User.bulkWrite(operations, { session });
    }

    return { deja: false, suivisRompus: liens.length };
  });
}

/**
 * Lève un blocage.
 *
 * LES SUIVIS NE SONT PAS RÉTABLIS, et c'est volontaire. Débloquer rend le
 * contenu de nouveau accessible ; il n'y a aucune raison de présumer que l'on
 * souhaite se réabonner à quelqu'un qu'on a bloqué. Chacun peut suivre de
 * nouveau s'il le veut — c'est aussi ce que fait Instagram.
 */
export async function debloquer(auteur, idCible) {
  if (!mongoose.isValidObjectId(idCible)) {
    throw ApiError.badRequest('Identifiant invalide');
  }

  const resultat = await Relation.deleteOne({
    source: auteur._id,
    cible: idCible,
    type: 'blocage',
  });

  // Débloquer quelqu'un qui ne l'était pas n'est pas une erreur : le résultat
  // voulu est atteint. On le signale seulement dans la réponse.
  return { existait: resultat.deletedCount > 0 };
}

/* ================================================================== *
 *  RESTREINDRE
 * ================================================================== */

/**
 * Restreint un compte, en silence.
 *
 * AUCUNE NOTIFICATION, AUCUNE TRACE VISIBLE. C'est la raison d'être de la
 * restriction : elle protège sans provoquer. Prévenir la personne — même
 * indirectement, par un compteur qui bouge ou un accès qui change — la
 * viderait de son sens et vaudrait mieux un blocage franc.
 *
 * ELLE NE ROMPT AUCUN SUIVI. La personne reste abonnée et continue de voir le
 * contenu : seuls ses messages et ses commentaires sont mis à l'écart.
 */
export async function restreindre(auteur, idCible) {
  const cible = await chargerCible(auteur, idCible, 'restreindre');

  try {
    await Relation.create({
      source: auteur._id,
      cible: cible._id,
      type: 'restriction',
    });
    return { deja: false };
  } catch (erreur) {
    if (erreur.code === 11000) return { deja: true };
    throw erreur;
  }
}

/**
 * Lève une restriction.
 *
 * LES COMMENTAIRES DÉJÀ EN ATTENTE LE RESTENT. Ils ont été écrits pendant la
 * restriction et n'ont jamais été vus ; les publier d'un coup ferait
 * apparaître, sans prévenir, des commentaires que l'auteur n'a jamais
 * approuvés. Ils restent dans la file, à trancher un par un.
 */
export async function leverRestriction(auteur, idCible) {
  if (!mongoose.isValidObjectId(idCible)) {
    throw ApiError.badRequest('Identifiant invalide');
  }

  const resultat = await Relation.deleteOne({
    source: auteur._id,
    cible: idCible,
    type: 'restriction',
  });

  return { existait: resultat.deletedCount > 0 };
}

/**
 * Le commentaire de `idCommentateur` sous une publication de `idAuteurPost`
 * doit-il attendre une approbation ?
 *
 * FONCTION NOMMÉE PLUTÔT QU'APPEL DIRECT À `Relation.estRestreintPar`.
 * L'ordre des deux arguments y est facile à inverser, et l'inverser
 * silencieusement produirait le pire résultat possible : les commentaires de
 * l'auteur du post mis en attente sous ses propres publications, ceux de la
 * personne restreinte publiés normalement. Le nom rend l'erreur visible à la
 * relecture.
 *
 * MÊME FORME QUE `messagesMisALEcart` côté messagerie — les deux répondent à
 * la même question posée sur deux surfaces différentes.
 */
export async function commentaireEnAttente(idCommentateur, idAuteurPost) {
  if (!idCommentateur || !idAuteurPost) return false;
  return Relation.estRestreintPar(idAuteurPost, idCommentateur);
}

/* ================================================================== *
 *  SIGNALER
 * ================================================================== */

/**
 * Signale un compte à l'administration.
 *
 * LE SIGNALEMENT NE CHANGE RIEN À LA RELATION — voir l'en-tête du modèle.
 * L'interface propose bloquer et signaler côte à côte ; rien n'empêche de
 * faire les deux, et c'est fréquent.
 */
export async function signaler(signaleur, idCible, { motif, commentaire } = {}) {
  const cible = await chargerCible(signaleur, idCible, 'signaler');

  try {
    const signalement = await Signalement.create({
      signaleur: signaleur._id,
      cible: cible._id,
      motif,
      commentaire,
    });
    return { signalement, deja: false };
  } catch (erreur) {
    /*
     * Un signalement ouvert existe déjà pour cette paire. On répond comme
     * d'un succès : la personne a signalé, son alerte est enregistrée. Lui
     * dire « vous avez déjà signalé » n'apporte rien et invite à insister.
     */
    if (erreur.code === 11000) return { signalement: null, deja: true };
    throw erreur;
  }
}

/* ================================================================== *
 *  LECTURE
 * ================================================================== */

/** Comptes que cette personne a bloqués — pour l'écran « Comptes bloqués ». */
export async function listeBloques(utilisateur) {
  const liens = await Relation.find({ source: utilisateur._id, type: 'blocage' })
    .sort({ createdAt: -1 })
    .populate('cible', 'pseudo nom prenom avatar type diplome');

  return liens
    .filter((l) => l.cible)
    .map((l) => ({
      _id: l.cible._id,
      pseudo: l.cible.pseudo,
      nom: l.cible.nom,
      prenom: l.cible.prenom,
      avatar: l.cible.avatar,
      type: l.cible.type,
      bloqueLe: l.createdAt,
    }));
}

/** Comptes restreints — même écran, second onglet. */
export async function listeRestreints(utilisateur) {
  const liens = await Relation.find({ source: utilisateur._id, type: 'restriction' })
    .sort({ createdAt: -1 })
    .populate('cible', 'pseudo nom prenom avatar type diplome');

  return liens
    .filter((l) => l.cible)
    .map((l) => ({
      _id: l.cible._id,
      pseudo: l.cible.pseudo,
      nom: l.cible.nom,
      prenom: l.cible.prenom,
      avatar: l.cible.avatar,
      type: l.cible.type,
      restreintLe: l.createdAt,
    }));
}

/**
 * État des trois actions vis-à-vis d'un compte, pour alimenter le menu « ⋯ ».
 *
 * UNE SEULE REQUÊTE POUR LES DEUX RELATIONS. Le menu doit savoir quoi
 * proposer — « Bloquer » ou « Débloquer » — avant son premier affichage ;
 * trois appels séparés le feraient clignoter.
 *
 * `aSignale` porte sur les signalements OUVERTS seulement : un dossier tranché
 * il y a six mois ne doit pas empêcher de signaler une récidive.
 */
export async function etatModeration(auteur, idCible) {
  if (!auteur || !mongoose.isValidObjectId(idCible)) {
    return { bloque: false, restreint: false, aSignale: false };
  }

  const [relations, signalement] = await Promise.all([
    Relation.find({ source: auteur._id, cible: idCible }, { type: 1 }),
    Signalement.exists({ signaleur: auteur._id, cible: idCible, statut: 'ouvert' }),
  ]);

  const types = relations.map((r) => r.type);

  return {
    bloque: types.includes('blocage'),
    restreint: types.includes('restriction'),
    aSignale: Boolean(signalement),
  };
}
