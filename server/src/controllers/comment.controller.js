import mongoose from 'mongoose';
import Post from '../models/Post.js';
import Comment from '../models/Comment.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { relationAvec, peutVoirContenu } from '../services/access.service.js';
import { abonnementsPremiumActifs, aAccesPremium } from '../services/feed.service.js';
import { lirePagination, reponsePaginee } from '../utils/pagination.js';

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
          },
        ],
        { session }
      );
      commentaire = crees[0];

      await Post.updateOne({ _id: post._id }, { $inc: { commentsCount: 1 } }, { session });

      if (commentaireParent) {
        await Comment.updateOne(
          { _id: commentaireParent._id },
          { $inc: { reponsesCount: 1 } },
          { session }
        );
      }
    });
  } finally {
    await session.endSession();
  }

  await commentaire.populate('auteur', 'pseudo nom prenom avatar type diplome');

  // A brancher au module 12 : notifier l'auteur du post.

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
  await chargerPostAccessible(req.user, req.params.id);

  const { page, limite, saut } = lirePagination(req);

  const parent = req.query.parent && mongoose.isValidObjectId(req.query.parent)
    ? req.query.parent
    : null;

  const filtre = { post: req.params.id, parent };

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

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (!commentaire.parent && reponses > 0) {
        await Comment.deleteMany({ parent: commentaire._id }, { session });
      }

      await Comment.deleteOne({ _id: commentaire._id }, { session });

      await Post.updateOne(
        { _id: commentaire.post },
        { $inc: { commentsCount: -(1 + reponses) } },
        { session }
      );

      if (commentaire.parent) {
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
