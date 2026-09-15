import mongoose from 'mongoose';
import Post from '../models/Post.js';
import Comment from '../models/Comment.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { relationAvec, peutVoirContenu } from '../services/access.service.js';
import { abonnementsPremiumActifs, aAccesPremium } from '../services/feed.service.js';
import { lirePagination, reponsePaginee } from '../utils/pagination.js';
import * as notifications from '../services/notification.service.js';
import { commentaireEnAttente } from '../services/moderation.service.js';

/**
 * Verifie que le visiteur a le droit d'interagir avec une publication.
 * Factorisee ici parce que la regle vaut pour lire les commentaires comme
 * pour en ecrire : commenter un contenu premium sans y avoir acces
 * permettrait d'en deviner la teneur par les reactions des autres.
 */
async function chargerPostAccessible(visiteur, idPost) {
  const post = await Post.findById(idPost).populate(
    'auteur',
    'visibilite type diplome isActive'
  );

  if (!post || !post.auteur?.isActive) throw ApiError.notFound('Publication introuvable');

  const relation = await relationAvec(visiteur, post.auteur);
  if (!peutVoirContenu(relation, post.auteur)) {
    throw ApiError.forbidden('Ce compte est privé');
  }

  if (post.estPremium) {
    const abonnements = await abonnementsPremiumActifs(visiteur?._id);
    if (!aAccesPremium(visiteur, post.auteur._id, abonnements)) {
      throw ApiError.forbidden('Contenu réservé aux abonnés premium');
    }
  }

  return post;
}

/* ================================================================== *
 *  POST /api/posts/:id/comments
 * ================================================================== */

/**
 * Ajout d'un commentaire, ou d'une reponse a un commentaire existant.
 *
 * L'ecriture du commentaire et l'incrementation du compteur du post sont
 * regroupees dans une TRANSACTION. Sans elle, une panne entre les deux
 * afficherait « 12 commentaires » sous une liste qui n'en contient que 11 —
 * une incoherence visible et impossible a corriger sans recomptage complet.
 */
export const ajouterCommentaire = asyncHandler(async (req, res) => {
  const { texte, parent } = req.body;

  const post = await chargerPostAccessible(req.user, req.params.id);

  // Une reponse doit viser un commentaire du MEME post : sans ce controle,
  // on pourrait rattacher une reponse a une discussion etrangere.
  let commentaireParent = null;
  if (parent) {
    commentaireParent = await Comment.findById(parent);
    if (!commentaireParent || String(commentaireParent.post) !== String(post._id)) {
      throw ApiError.badRequest('Commentaire parent introuvable pour cette publication');
    }
    // Hierarchie limitee a un niveau : une reponse a une reponse est
    // rattachee au commentaire racine.
    if (commentaireParent.parent) {
      commentaireParent = await Comment.findById(commentaireParent.parent);
    }
  }

  /*
   * LE COMMENTAIRE D'UNE PERSONNE RESTREINTE N'EST PAS REFUSE : IL ATTEND.
   *
   * Le refuser produirait une erreur visible, et la restriction cesserait
   * d'etre silencieuse au premier commentaire. Il est donc ecrit
   * normalement — l'auteur le voit s'afficher, croit avoir publie — mais
   * personne d'autre ne le lit tant que l'auteur du post n'a pas tranche.
   *
   * L'ETAT EST FIGE ICI, A L'ECRITURE, et non recalcule a la lecture. Lever
   * la restriction ne doit pas publier d'un coup des mois de commentaires
   * que personne n'a jamais approuves (voir l'en-tete du modele Comment).
   */
  const enAttente = await commentaireEnAttente(
    req.user._id,
    post.auteur?._id || post.auteur
  );

  let commentaire;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const crees = await Comment.create(
        [
          {
            post: post._id,
            auteur: req.user._id,
            texte,
            parent: commentaireParent?._id || null,
            enAttenteApprobation: enAttente,
          },
        ],
        { session }
      );
      commentaire = crees[0];

      /*
       * LES COMPTEURS NE BOUGENT PAS TANT QUE LE COMMENTAIRE EST EN ATTENTE.
       *
       * C'est exactement l'incoherence que la transaction ci-dessus sert a
       * eviter, prise par l'autre bout : afficher « 12 commentaires » sous
       * une liste qui n'en montre que 11. Pire, le compteur trahirait la
       * restriction — le commentateur verrait le total grimper alors que son
       * texte n'apparait chez personne.
       *
       * L'increment est reporte a l'approbation, ou il a lieu dans la meme
       * transaction que le changement d'etat.
       */
      if (!enAttente) {
        await Post.updateOne(
          { _id: post._id },
          { $inc: { commentsCount: 1 } },
          { session }
        );

        if (commentaireParent) {
          await Comment.updateOne(
            { _id: commentaireParent._id },
            { $inc: { reponsesCount: 1 } },
            { session }
          );
        }
      }
    });
  } finally {
    await session.endSession();
  }

  await commentaire.populate('auteur', 'pseudo nom prenom avatar type diplome');

  /*
   * `creer` et non `creerOuRegrouper` : deux commentaires successifs sont
   * deux contributions reelles, pas une hesitation. Les regrouper ferait
   * disparaitre le second de la liste.
   *
   * ET AUCUNE NOTIFICATION DU TOUT POUR UN COMMENTAIRE EN ATTENTE — ni
   * maintenant, ni plus tard a l'approbation.
   *
   * Maintenant : une pastille « X a commente » sous un commentaire que
   * personne ne voit encore annulerait le benefice de la restriction.
   *
   * A l'approbation non plus, et c'est le point moins evident : l'auteur du
   * post vient lui-meme d'approuver, il sait. Le prevenir de ce qu'il vient
   * de faire serait du bruit. Le commentaire lui est signale la ou il compte
   * — en place, sous sa publication, marque « en attente ».
   */
  if (!enAttente) {
    await notifications.creer({
      destinataire: post.auteur?._id || post.auteur,
      emetteur: req.user._id,
      type: 'commentaire',
      cibleType: 'Post',
      cible: post._id,
    });
  }

  return res.status(201).json({
    succes: true,
    message: 'Commentaire ajoute',
    commentaire: commentaire.versionPublique(),
  });
});

/* ================================================================== *
 *  GET /api/posts/:id/comments
 * ================================================================== */

/**
 * Commentaires de premier niveau, du plus recent au plus ancien.
 * Les reponses se chargent a la demande via `?parent=<id>` : les afficher
 * toutes d'emblee alourdirait la reponse pour un contenu que la plupart des
 * lecteurs ne deplieront jamais.
 */
export const listerCommentaires = asyncHandler(async (req, res) => {
  const post = await chargerPostAccessible(req.user, req.params.id);

  const { page, limite, saut } = lirePagination(req);

  const parent = req.query.parent && mongoose.isValidObjectId(req.query.parent)
    ? req.query.parent
    : null;

  const filtre = { post: req.params.id, parent };

  /*
   * UN COMMENTAIRE EN ATTENTE N'EST VISIBLE QUE DE DEUX PERSONNES.
   *
   *   SON AUTEUR          — qui ne doit se douter de rien. Il relit son
   *                         commentaire a sa place habituelle et croit
   *                         l'avoir publie. C'est toute la restriction.
   *
   *   L'AUTEUR DU POST    — qui doit trancher. Il le voit marque « en
   *                         attente » (le drapeau est expose par
   *                         versionPublique) et decide.
   *
   * LE FILTRE EST POSE EN BASE, PAS APRES COUP. Retirer les commentaires
   * apres lecture fausserait `total` et donc la pagination : une page
   * annoncerait dix elements et en afficherait huit — le defaut corrige au
   * module 6. Et surtout, le texte serait deja parti dans la reponse HTTP,
   * ou il suffit d'ouvrir l'inspecteur pour le lire.
   *
   * `$ne: true` ET NON `false` : les commentaires ecrits avant l'ajout du
   * champ n'ont pas d'attribut `enAttenteApprobation` du tout, et une
   * egalite stricte a `false` les exclurait tous.
   */
  const estAuteurPost =
    req.user && String(post.auteur?._id || post.auteur) === String(req.user._id);

  if (!estAuteurPost) {
    filtre.$or = [
      { enAttenteApprobation: { $ne: true } },
      ...(req.user ? [{ auteur: req.user._id }] : []),
    ];
  }

  const [commentaires, total] = await Promise.all([
    Comment.find(filtre)
      // Les reponses se lisent dans l'ordre chronologique — c'est une
      // conversation. Les commentaires racines, du plus recent d'abord.
      .sort(parent ? { createdAt: 1 } : { createdAt: -1 })
      .skip(saut)
      .limit(limite)
      .populate('auteur', 'pseudo nom prenom avatar type diplome'),
    Comment.countDocuments(filtre),
  ]);

  return res.json(
    reponsePaginee(
      commentaires.map((c) => c.versionPublique()),
      total,
      { page, limite }
    )
  );
});

/* ================================================================== *
 *  PATCH /api/comments/:id/approbation
 * ================================================================== */

/**
 * Approuve ou rejette un commentaire laisse par une personne restreinte.
 *
 * RESERVE A L'AUTEUR DE LA PUBLICATION (et a l'administration). C'est lui
 * qui a pose la restriction, c'est lui qui modere sa propre section — le
 * commentateur ne doit meme pas savoir que cette route existe.
 *
 * PAS DE NOUVELLE ROUTE POUR REJETER : rejeter, c'est supprimer, et la
 * suppression a deja ses regles ici. Mais elle passe par cette route-ci
 * parce que les compteurs n'ont PAS le meme traitement — un commentaire en
 * attente n'a jamais ete compte, le decrementer le ferait passer sous zero.
 */
export const approuverCommentaire = asyncHandler(async (req, res) => {
  const commentaire = await Comment.findById(req.params.id);
  if (!commentaire) throw ApiError.notFound('Commentaire introuvable');

  const post = await Post.findById(commentaire.post).select('auteur');

  const estAuteurPost = post && String(post.auteur) === String(req.user._id);
  if (!estAuteurPost && req.user.type !== 'admin') {
    throw ApiError.forbidden('Vous ne pouvez pas moderer ce commentaire');
  }

  if (!commentaire.enAttenteApprobation) {
    throw ApiError.badRequest("Ce commentaire n'attend pas d'approbation");
  }

  const approuve = req.body.action === 'approuver';

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (approuve) {
        await Comment.updateOne(
          { _id: commentaire._id },
          { $set: { enAttenteApprobation: false } },
          { session }
        );

        /*
         * L'INCREMENT REPORTE DEPUIS L'ECRITURE A LIEU MAINTENANT, dans la
         * meme transaction que le changement d'etat. Les separer laisserait,
         * en cas de panne entre les deux, un commentaire publie que le
         * compteur ignore.
         */
        await Post.updateOne(
          { _id: commentaire.post },
          { $inc: { commentsCount: 1 } },
          { session }
        );

        if (commentaire.parent) {
          await Comment.updateOne(
            { _id: commentaire.parent },
            { $inc: { reponsesCount: 1 } },
            { session }
          );
        }
      } else {
        /*
         * AUCUN COMPTEUR A DECREMENTER : ce commentaire n'a jamais ete
         * compte. C'est la raison d'etre de cette route plutot qu'un simple
         * DELETE, qui retirerait une unite jamais ajoutee et ferait
         * descendre le total du post d'un cran a chaque rejet.
         */
        await Comment.deleteOne({ _id: commentaire._id }, { session });
      }
    });
  } finally {
    await session.endSession();
  }

  if (!approuve) {
    return res.json({ succes: true, message: 'Commentaire rejete', approuve: false });
  }

  await commentaire.populate('auteur', 'pseudo nom prenom avatar type diplome');
  commentaire.enAttenteApprobation = false;

  return res.json({
    succes: true,
    message: 'Commentaire approuve',
    approuve: true,
    commentaire: commentaire.versionPublique(),
  });
});

/* ================================================================== *
 *  DELETE /api/comments/:id
 * ================================================================== */

/**
 * Suppression d'un commentaire.
 *
 * TROIS PERSONNES ONT LE DROIT :
 *   - l'auteur du commentaire, qui se retracte ;
 *   - l'auteur de la publication, qui modere sa propre section ;
 *   - un administrateur.
 *
 * Le deuxieme cas est facilement oublie, et pourtant essentiel : sans lui,
 * un coach ne pourrait pas retirer un commentaire insultant sous son post.
 */
export const supprimerCommentaire = asyncHandler(async (req, res) => {
  const commentaire = await Comment.findById(req.params.id);
  if (!commentaire) throw ApiError.notFound('Commentaire introuvable');

  const post = await Post.findById(commentaire.post).select('auteur');

  const estAuteurCommentaire = String(commentaire.auteur) === req.user._id.toString();
  const estAuteurPost = post && String(post.auteur) === req.user._id.toString();
  const estAdmin = req.user.type === 'admin';

  if (!estAuteurCommentaire && !estAuteurPost && !estAdmin) {
    throw ApiError.forbidden('Vous ne pouvez pas supprimer ce commentaire');
  }

  // Supprimer un commentaire racine emporte ses reponses : les laisser
  // orphelines les rendrait invisibles tout en gonflant le compteur.
  const reponses = commentaire.parent
    ? 0
    : await Comment.countDocuments({ parent: commentaire._id });

  /*
   * ON NE DECREMENTE QUE CE QUI A ETE COMPTE.
   *
   * Effet de bord introduit par l'approbation : un commentaire en attente
   * n'a jamais incremente `commentsCount`. Or son auteur — qui ignore qu'il
   * est restreint — peut parfaitement le supprimer lui-meme par cette route.
   * Sans cette distinction, chaque suppression de ce genre ferait descendre
   * le total du post d'une unite jamais ajoutee, jusqu'a passer sous zero.
   *
   * Le meme raisonnement vaut pour les reponses emportees : on ne compte que
   * celles qui etaient publiees.
   */
  const reponsesComptees = commentaire.parent
    ? 0
    : await Comment.countDocuments({
        parent: commentaire._id,
        enAttenteApprobation: { $ne: true },
      });

  const etaitCompte = !commentaire.enAttenteApprobation;
  const decrement = (etaitCompte ? 1 : 0) + reponsesComptees;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (!commentaire.parent && reponses > 0) {
        await Comment.deleteMany({ parent: commentaire._id }, { session });
      }

      await Comment.deleteOne({ _id: commentaire._id }, { session });

      if (decrement > 0) {
        await Post.updateOne(
          { _id: commentaire.post },
          { $inc: { commentsCount: -decrement } },
          { session }
        );
      }

      // Meme regle sur le compteur de reponses du parent : une reponse en
      // attente ne l'avait pas incremente.
      if (commentaire.parent && etaitCompte) {
        await Comment.updateOne(
          { _id: commentaire.parent },
          { $inc: { reponsesCount: -1 } },
          { session }
        );
      }
    });
  } finally {
    await session.endSession();
  }

  return res.json({
    succes: true,
    message: 'Commentaire supprimé',
    supprimes: 1 + reponses,
  });
});
