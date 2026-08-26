import mongoose from 'mongoose';

import SportEvent from '../models/SportEvent.js';
import EventRegistration from '../models/EventRegistration.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * ===========================================================================
 *  ÉVÉNEMENTS SPORTIFS — LOGIQUE MÉTIER
 * ===========================================================================
 */

/* ================================================================== *
 *  INSCRIPTION — LE POINT CRITIQUE DU MODULE
 * ================================================================== */

/**
 * Inscrit un utilisateur, en garantissant qu'aucune place n'est vendue deux
 * fois.
 *
 * LE SCÉNARIO CONTRE LEQUEL CE CODE EST ÉCRIT.
 * Il reste une place. Deux personnes cliquent dans la même milliseconde. Une
 * implémentation naïve — lire le compteur, comparer, écrire — laisse les deux
 * requêtes lire « 9 sur 10 », conclure toutes les deux qu'il reste de la
 * place, et s'inscrire. L'événement est en surréservation, et personne ne le
 * voit avant le jour J.
 *
 * DEUX PROTECTIONS SUPERPOSÉES, ET ELLES NE COUVRENT PAS LA MÊME CHOSE :
 *
 *   1. L'INDEX UNIQUE { event, utilisateur } empêche la même personne de
 *      prendre deux places. C'est la base qui refuse, pas notre code : aucun
 *      appelant ne peut contourner la règle, même par erreur.
 *
 *   2. LA TRANSACTION empêche deux personnes DIFFÉRENTES de prendre la même
 *      dernière place. L'incrément conditionnel `$inc` avec filtre sur la
 *      capacité est atomique : la seconde requête ne trouve plus de document
 *      correspondant au filtre et repart les mains vides.
 *
 * L'ORDRE DES OPÉRATIONS COMPTE. On réserve la place AVANT de créer
 * l'inscription. L'inverse laisserait une inscription orpheline si la place
 * venait à manquer — un document en base pour quelqu'un qui n'a rien obtenu.
 *
 * @param {string} idEvenement
 * @param {object} utilisateur document Mongoose
 * @param {string} [message]
 * @returns {Promise<object>} l'inscription créée ou réactivée
 */
export async function inscrire(idEvenement, utilisateur, message) {
  const session = await mongoose.startSession();

  try {
    let inscription;

    await session.withTransaction(async () => {
      const evenement = await SportEvent.findById(idEvenement).session(session);

      if (!evenement) throw ApiError.notFound('Evenement introuvable');

      /* ---------- Règles métier, dans l'ordre du plus explicite ---------- */

      if (String(evenement.organisateur) === String(utilisateur._id)) {
        throw ApiError.badRequest(
          'Vous organisez cet événement : vous y êtes déjà attendu'
        );
      }

      if (evenement.statut === 'annule') {
        throw ApiError.badRequest('Cet événement a été annulé');
      }

      // On se fie à `dateFin` : une sortie de 9 h à 17 h est encore en cours
      // à midi, la refuser dès 9 h 01 serait faux.
      if (evenement.dateFin < new Date()) {
        throw ApiError.badRequest('Cet événement est terminé');
      }

      /* ---------- Le cas du retour après désistement ---------- */

      const existante = await EventRegistration.findOne({
        event: idEvenement,
        utilisateur: utilisateur._id,
      }).session(session);

      if (existante && existante.statut === 'inscrit') {
        throw ApiError.conflict('Vous êtes déjà inscrit à cet événement');
      }

      /* ---------- Réservation atomique de la place ---------- */

      /*
       * `$inc` SOUS CONDITION DE CAPACITÉ.
       *
       * Le filtre et l'incrément forment UNE SEULE opération, indivisible :
       * MongoDB ne peut pas être interrompu entre les deux. Deux requêtes
       * concurrentes sont donc sérialisées, et la seconde ne trouve plus de
       * document satisfaisant `inscritsCount < capaciteMax`.
       *
       * `$expr` est nécessaire pour comparer deux CHAMPS du même document —
       * une requête ordinaire ne sait comparer un champ qu'à une constante.
       * Le `$or` traite le cas sans limite, où `capaciteMax` vaut `null`.
       */
      const reservation = await SportEvent.updateOne(
        {
          _id: idEvenement,
          $or: [
            { capaciteMax: null },
            { $expr: { $lt: ['$inscritsCount', '$capaciteMax'] } },
          ],
        },
        { $inc: { inscritsCount: 1 } },
        { session }
      );

      if (reservation.modifiedCount === 0) {
        throw ApiError.conflict('Cet événement est complet');
      }

      /* ---------- L'inscription elle-même ---------- */

      if (existante) {
        // Retour après désistement : on réactive plutôt que de créer un
        // second document, ce que l'index unique refuserait de toute façon.
        existante.statut = 'inscrit';
        existante.message = message ?? existante.message;
        existante.dateAnnulation = undefined;
        await existante.save({ session });
        inscription = existante;
      } else {
        const [creee] = await EventRegistration.create(
          [{ event: idEvenement, utilisateur: utilisateur._id, message }],
          { session }
        );
        inscription = creee;
      }
    });

    return inscription;
  } catch (erreur) {
    /*
     * Le double clic est un accident d'interface, pas une tentative de
     * fraude : deux requêtes identiques partent avant que la première ait
     * répondu. L'index unique les intercepte (code 11000) ; on traduit en
     * message métier plutôt que de laisser fuiter une erreur de base.
     */
    if (erreur?.code === 11000) {
      throw ApiError.conflict('Vous êtes déjà inscrit à cet événement');
    }
    throw erreur;
  } finally {
    await session.endSession();
  }
}

/**
 * Désinscrit un utilisateur et libère sa place.
 *
 * ON NE SUPPRIME PAS LE DOCUMENT, on le bascule en `annule`. L'organisateur
 * garde ainsi la trace des désistements — utile pour comprendre un taux de
 * remplissage —, et un retour ultérieur réactive la même inscription au lieu
 * d'en créer une nouvelle.
 *
 * Le décrément vit dans la MÊME transaction que le changement de statut :
 * séparés, un incident entre les deux laisserait une place fantôme,
 * comptée mais occupée par personne.
 */
export async function desinscrire(idEvenement, utilisateur) {
  const session = await mongoose.startSession();

  try {
    let inscription;

    await session.withTransaction(async () => {
      inscription = await EventRegistration.findOne({
        event: idEvenement,
        utilisateur: utilisateur._id,
      }).session(session);

      if (!inscription) {
        throw ApiError.notFound('Vous n’êtes pas inscrit à cet événement');
      }

      // Se désinscrire deux fois ne doit pas décrémenter deux fois : ce
      // serait un compteur négatif, donc des places qui n'existent pas.
      if (inscription.statut !== 'inscrit') {
        throw ApiError.conflict('Votre inscription est déjà annulée');
      }

      inscription.statut = 'annule';
      inscription.dateAnnulation = new Date();
      await inscription.save({ session });

      // Le filtre `inscritsCount > 0` est une ceinture de sécurité : même en
      // cas d'incohérence antérieure, le compteur ne peut pas passer sous zéro.
      await SportEvent.updateOne(
        { _id: idEvenement, inscritsCount: { $gt: 0 } },
        { $inc: { inscritsCount: -1 } },
        { session }
      );
    });

    return inscription;
  } finally {
    await session.endSession();
  }
}

/**
 * Recompte les inscrits d'un événement depuis la source de vérité.
 *
 * Filet de sécurité, à l'image de `recompter()` du module 6. Les transactions
 * rendent la dérive très improbable, mais un import de données ou une
 * intervention manuelle en base peuvent toujours désynchroniser le compteur.
 */
export async function recompter(idEvenement) {
  const total = await EventRegistration.countDocuments({
    event: idEvenement,
    statut: 'inscrit',
  });

  await SportEvent.updateOne({ _id: idEvenement }, { inscritsCount: total });
  return total;
}

/* ================================================================== *
 *  LECTURE
 * ================================================================== */

/**
 * Événements à venir, du plus proche au plus lointain.
 *
 * ON FILTRE SUR `dateFin` ET NON `dateDebut` : un événement commencé ce matin
 * et courant jusqu'à ce soir est encore d'actualité à midi. Trier sur
 * `dateDebut` reste juste — c'est la date qu'affiche l'interface.
 *
 * Les événements `annule` restent dans la liste : les masquer priverait les
 * inscrits de l'information qui les concerne le plus.
 */
export async function listeAVenir({
  ville,
  sport,
  type,
  organisateur,
  page = 1,
  limite = 20,
} = {}) {
  const filtre = { dateFin: { $gte: new Date() } };

  if (ville) filtre['lieu.ville'] = new RegExp(`^${echapper(ville)}$`, 'i');
  if (sport) filtre.sport = sport;
  if (type) filtre.type = type;
  if (organisateur) filtre.organisateur = organisateur;

  const saut = (page - 1) * limite;

  const [evenements, total] = await Promise.all([
    SportEvent.find(filtre)
      .sort({ dateDebut: 1 })
      .skip(saut)
      .limit(limite)
      .populate('organisateur', 'pseudo nom prenom avatar type diplome premium'),
    SportEvent.countDocuments(filtre),
  ]);

  return { evenements, total };
}

/**
 * Événements autour d'un point.
 *
 * Même mécanique que la carte des coachs (module 8) : `$geoNear` en premier
 * étage, filtre appliqué avant le tri, distance renvoyée par le moteur.
 *
 * Une différence importante avec les coachs : ICI, LA POSITION N'EST PAS
 * FLOUTÉE. Un lieu d'événement est une information publique — c'est
 * l'adresse d'un rendez-vous collectif, pas le domicile de quelqu'un. Le seul
 * arbitrage porte sur les événements `prive`, dont l'adresse exacte reste
 * réservée aux abonnés ; `versionPour()` s'en charge.
 */
export async function evenementsAutourDe({
  centre,
  rayonM = 25000,
  sport,
  limite = 50,
} = {}) {
  const filtre = {
    dateFin: { $gte: new Date() },
    statut: 'planifie',
    'lieu.localisation.coordinates': { $exists: true },
  };

  if (sport) filtre.sport = sport;

  const resultats = await SportEvent.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: centre },
        distanceField: 'distanceM',
        maxDistance: Math.min(Math.max(rayonM, 1000), 100000),
        query: filtre,
        spherical: true,
        // Même précaution qu'au module 8 : désigner l'index évite une panne
        // si un second index géographique apparaissait un jour.
        key: 'lieu.localisation',
      },
    },
    { $limit: Math.min(Math.max(limite, 1), 100) },
  ]);

  // `aggregate()` renvoie des objets bruts : on les réhydrate pour disposer
  // des virtuels et de `versionPour()`.
  return resultats.map((brut) => ({
    document: SportEvent.hydrate(brut),
    distanceM: Math.round(brut.distanceM),
  }));
}

/** Échappe les caractères spéciaux avant construction d'une expression. */
function echapper(texte) {
  return String(texte).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
