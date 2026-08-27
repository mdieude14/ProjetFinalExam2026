import mongoose from 'mongoose';
import User from '../models/User.js';
import Follow from '../models/Follow.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { lirePagination, reponsePaginee } from '../utils/pagination.js';
import { relationAvec, peutVoirContenu } from '../services/access.service.js';
import * as followService from '../services/follow.service.js';
import * as notifications from '../services/notification.service.js';

/**
 * Resout un identifiant d'URL — ObjectId ou pseudo — en document User.
 * Meme convention que pour les profils : les URL lisibles sont attendues sur
 * un reseau social, mais les liens internes disposent souvent de l'ObjectId.
 */
async function resoudreUtilisateur(identifiant) {
  const critere = mongoose.isValidObjectId(identifiant)
    ? { _id: identifiant }
    : { pseudo: String(identifiant).toLowerCase() };

  const utilisateur = await User.findOne(critere);
  if (!utilisateur || !utilisateur.isActive) {
    throw ApiError.notFound('Profil introuvable');
  }
  return utilisateur;
}

/* ================================================================== *
 *  POST /api/follows/:identifiant
 * ================================================================== */

/**
 * Suivre un profil, ou envoyer une demande s'il est prive.
 *
 * La reponse distingue les deux cas pour que le front affiche « Abonne » ou
 * « Demande envoyee » sans avoir a recharger le profil.
 */
export const suivre = asyncHandler(async (req, res) => {
  const cible = await resoudreUtilisateur(req.params.identifiant);

  const resultat = await followService.suivre(req.user, cible);

  /*
   * Deux types distincts, parce que deux actions distinctes sont attendues.
   * « X vous suit » ne demande rien ; « X demande a vous suivre » appelle une
   * decision. Les confondre sous un seul libelle laisserait des demandes en
   * attente indefiniment, faute d'avoir compris qu'il fallait repondre.
   *
   * `creerOuRegrouper` plutot que `creer` : suivre puis se desabonner puis
   * resuivre est un geste d'hesitation, pas trois evenements.
   */
  await notifications.creerOuRegrouper({
    destinataire: cible._id,
    emetteur: req.user._id,
    type: resultat.statut === 'accepte' ? 'follow' : 'demande_follow',
    cibleType: 'User',
    cible: req.user._id,
  });

  const messages = {
    accepte: resultat.deja
      ? `Vous suivez déjà ${cible.pseudo}`
      : `Vous suivez désormais ${cible.pseudo}`,
    en_attente: resultat.deja
      ? 'Votre demande est déjà en attente'
      : `Demande envoyee a ${cible.pseudo}`,
  };

  return res.status(resultat.deja ? 200 : 201).json({
    succes: true,
    message: messages[resultat.statut],
    statut: resultat.statut,
    relation: resultat.statut === 'accepte' ? 'abonne' : 'en_attente',
  });
});

/* ================================================================== *
 *  DELETE /api/follows/:identifiant
 * ================================================================== */

/** Se desabonner, ou annuler une demande encore en attente. */
export const nePlusSuivre = asyncHandler(async (req, res) => {
  const cible = await resoudreUtilisateur(req.params.identifiant);

  const resultat = await followService.retirer(req.user, cible);

  return res.json({
    succes: true,
    message: resultat.etaitAccepte
      ? `Vous ne suivez plus ${cible.pseudo}`
      : 'Demande annulee',
    relation: 'aucune',
  });
});

/* ================================================================== *
 *  GET /api/follows/demandes
 * ================================================================== */

/**
 * Demandes de suivi recues, en attente de decision.
 * Les plus anciennes d'abord : quelqu'un qui attend depuis trois jours passe
 * avant celui qui vient de demander.
 */
export const demandesRecues = asyncHandler(async (req, res) => {
  const { page, limite, saut } = lirePagination(req);

  const filtre = { following: req.user._id, statut: 'en_attente' };

  const [demandes, total] = await Promise.all([
    Follow.find(filtre)
      .sort({ createdAt: 1 })
      .skip(saut)
      .limit(limite)
      .populate('follower', 'pseudo nom prenom avatar type ville diplome stats'),
    Follow.countDocuments(filtre),
  ]);

  const elements = demandes
    // Une demande dont l'auteur a supprime son compte entre-temps ne doit pas
    // faire planter l'affichage : on l'ecarte silencieusement.
    .filter((d) => d.follower)
    .map((d) => ({
      _id: d._id,
      date: d.createdAt,
      utilisateur: {
        _id: d.follower._id,
        pseudo: d.follower.pseudo,
        nom: d.follower.nom,
        prenom: d.follower.prenom,
        avatar: d.follower.avatar,
        type: d.follower.type,
        ville: d.follower.ville,
        estCertifie: d.follower.estCertifie,
        stats: d.follower.stats,
      },
    }));

  return res.json(reponsePaginee(elements, total, { page, limite }));
});

/* ================================================================== *
 *  GET /api/follows/demandes/nombre
 * ================================================================== */

/**
 * Nombre de demandes en attente, pour la pastille de la barre de navigation.
 *
 * Endpoint dedie plutot que de reutiliser la liste : la navigation
 * l'interroge a chaque changement de page, et transporter jusqu'a vingt
 * profils complets pour n'afficher qu'un chiffre serait du gaspillage.
 */
export const nombreDemandes = asyncHandler(async (req, res) => {
  const nombre = await Follow.countDocuments({
    following: req.user._id,
    statut: 'en_attente',
  });

  return res.json({ succes: true, nombre });
});

/* ================================================================== *
 *  POST /api/follows/demandes/:id/accepter
 * ================================================================== */

export const accepterDemande = asyncHandler(async (req, res) => {
  const resultat = await followService.accepter(req.user, req.params.id);

  /*
   * ON NOTIFIE LE DEMANDEUR, pas celui qui accepte : c'est lui qui attendait
   * une reponse. Se notifier soi-meme de sa propre acceptation n'apprendrait
   * rien — et le service l'ecarterait de toute facon.
   */
  await notifications.creer({
    destinataire: resultat.follower,
    emetteur: req.user._id,
    type: 'follow',
    cibleType: 'User',
    cible: req.user._id,
  });

  return res.json({
    succes: true,
    message: 'Demande acceptee',
    idDemande: resultat.idDemande,
  });
});

/* ================================================================== *
 *  POST /api/follows/demandes/:id/refuser
 * ================================================================== */

export const refuserDemande = asyncHandler(async (req, res) => {
  const resultat = await followService.refuser(req.user, req.params.id);

  // Pas de notification en cas de refus : prevenir quelqu'un qu'il a ete
  // refuse serait humiliant sans etre utile. C'est le comportement des
  // reseaux sociaux existants.

  return res.json({
    succes: true,
    message: 'Demande refusée',
    idDemande: resultat.idDemande,
  });
});

/* ================================================================== *
 *  DELETE /api/follows/abonnes/:identifiant
 * ================================================================== */

/** Retirer quelqu'un de ses propres abonnes. */
export const retirerAbonne = asyncHandler(async (req, res) => {
  const abonne = await resoudreUtilisateur(req.params.identifiant);

  await followService.retirerAbonne(req.user, abonne);

  return res.json({
    succes: true,
    message: `${abonne.pseudo} ne vous suit plus`,
  });
});

/* ================================================================== *
 *  GET /api/follows/:identifiant/abonnes  et  /abonnements
 * ================================================================== */

/**
 * Liste des abonnes ou des abonnements d'un profil.
 *
 * SOUMISE AUX REGLES DE VISIBILITE DU MODULE 4. Sur un compte prive, la
 * liste d'abonnes est un contenu comme un autre : la laisser accessible
 * permettrait de cartographier l'entourage de quelqu'un qui a justement
 * choisi de se proteger.
 *
 * @param {'abonnes'|'abonnements'} sens
 */
function listerRelations(sens) {
  return asyncHandler(async (req, res) => {
    const cible = await resoudreUtilisateur(req.params.identifiant);

    const relation = await relationAvec(req.user, cible);
    if (!peutVoirContenu(relation, cible)) {
      throw ApiError.forbidden('Ce compte est privé');
    }

    const { page, limite, saut } = lirePagination(req);

    /*
     * LE TRI DES COMPTES INACCESSIBLES SE FAIT DANS LA BASE, pas ici.
     *
     * La version precedente paginait puis ecartait en JavaScript les comptes
     * desactives et les relations orphelines. Une page de vingt pouvait alors
     * rendre dix-sept lignes, et le total — issu d'un comptage separe — ne
     * correspondait plus a ce qui s'affichait.
     *
     * `listerRelations` du service calcule la page ET le total depuis le meme
     * pipeline : ils ne peuvent plus diverger.
     */
    const { relations, total } = await followService.listerRelations(
      cible._id,
      sens,
      { saut, limite }
    );

    // Etat de MA relation avec chaque personne listee, pour afficher le bon
    // libelle de bouton sans une requete par ligne.
    const idsListes = relations.map((r) => r.personne._id);

    const mesRelations = req.user
      ? await Follow.find({ follower: req.user._id, following: { $in: idsListes } })
          .select('following statut')
          .lean()
      : [];

    const carte = new Map(mesRelations.map((r) => [String(r.following), r.statut]));

    const elements = relations.map((r) => {
      const u = r.personne;

      return {
        _id: u._id,
        pseudo: u.pseudo,
        nom: u.nom,
        prenom: u.prenom,
        avatar: u.avatar,
        type: u.type,
        ville: u.ville,
        // L'agregation ne construit pas les virtuels de Mongoose : on
        // reconstitue `estCertifie` a partir des memes champs que le modele.
        estCertifie: u.type === 'coach' && u.diplome?.statut === 'verifie',
        stats: u.stats,
        depuis: r.dateAcceptation || r.createdAt,
        maRelation: req.user
          ? memeUtilisateur(req.user._id, u._id)
            ? 'soi'
            : carte.get(String(u._id)) || 'aucune'
          : 'aucune',
      };
    });

    /*
     * RECALAGE OPPORTUNISTE DU COMPTEUR AFFICHÉ.
     *
     * LE PROBLÈME QUE CELA RÉSOUT, ET POURQUOI IL N'A PAS DE SOLUTION SIMPLE.
     * `stats.followersCount` est dénormalisé : il s'incrémente à chaque
     * relation créée. Mais quand un compte est DÉSACTIVÉ ou SUPPRIMÉ, toutes
     * les personnes qui le suivaient — ou qu'il suivait — voient leur compteur
     * devenir faux. Les recalculer sur-le-champ voudrait dire parcourir des
     * milliers de profils pour une seule désactivation : un travail non borné,
     * déclenché par une action anodine.
     *
     * On répare donc AU MOMENT OÙ L'ÉCART DEVIENT VISIBLE. Le total vient
     * d'être calculé pour cette réponse ; s'il diffère du compteur stocké,
     * c'est ce dernier qui a tort — la liste est la source de vérité. Ouvrir
     * la liste suffit alors à remettre le profil d'aplomb.
     *
     * L'écriture ne bloque pas la réponse : l'utilisateur a déjà sa liste
     * juste, et un échec de recalage n'a aucune conséquence — la prochaine
     * ouverture réessaiera.
     */
    const champCompteur = sens === 'abonnes' ? 'followersCount' : 'followingCount';

    if (cible.stats?.[champCompteur] !== total) {
      User.updateOne(
        { _id: cible._id },
        { $set: { [`stats.${champCompteur}`]: total } }
      ).catch((erreur) => {
        console.error('[FOLLOW] Recalage du compteur impossible :', erreur.message);
      });
    }

    return res.json(reponsePaginee(elements, total, { page, limite }));
  });
}

const memeUtilisateur = (a, b) => String(a) === String(b);

export const listerAbonnes = listerRelations('abonnes');
export const listerAbonnements = listerRelations('abonnements');

/* ================================================================== *
 *  GET /api/follows/suggestions
 * ================================================================== */

export const listerSuggestions = asyncHandler(async (req, res) => {
  const limite = Math.min(12, Math.max(1, Number(req.query.limite) || 6));

  const coachs = await followService.suggestions(req.user, limite);

  return res.json({ succes: true, suggestions: coachs });
});
