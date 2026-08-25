import mongoose from 'mongoose';
import Post from '../models/Post.js';
import Comment from '../models/Comment.js';
import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { televerserPlusieurs, supprimerPlusieurs } from '../services/storage.service.js';
import {
  construireFeed,
  postsDeUtilisateur,
  abonnementsPremiumActifs,
  aAccesPremium,
} from '../services/feed.service.js';
import { relationAvec, peutVoirContenu } from '../services/access.service.js';

/* ================================================================== *
 *  POST /api/posts
 * ================================================================== */

/**
 * Publication d'un post avec ses medias.
 *
 * ORDRE DES OPERATIONS : on televerse d'abord, on ecrit en base ensuite.
 * L'inverse creerait des publications pointant vers des fichiers inexistants
 * si le stockage tombait en panne. Ici, un echec de televersement fait
 * echouer la requete avant qu'aucun document ne soit cree.
 *
 * En cas d'echec de l'ecriture en base APRES un televersement reussi, on
 * rattrape en supprimant les fichiers deja envoyes : sans cela, ils
 * resteraient orphelins et factures.
 */
export const creerPost = asyncHandler(async (req, res) => {
  const { titre, description } = req.body;
  const estPremium = req.body.estPremium === 'true' || req.body.estPremium === true;

  /**
   * Le contenu premium exige les TROIS conditions du module 4 : diplome
   * verifie, compte Stripe en capacite d'encaisser, tarif publie.
   * Le virtuel `peutMonetiser` les evalue en une fois.
   *
   * Sans ce controle, n'importe qui pourrait marquer ses posts comme premium
   * et faire croire a du contenu payant qu'il n'a pas le droit de vendre.
   */
  if (estPremium && !req.user.peutMonetiser) {
    throw ApiError.forbidden(
      'Le contenu premium requiert un diplôme vérifié, un compte Stripe actif et un tarif défini'
    );
  }

  const medias = await televerserPlusieurs(req.files, 'posts');

  try {
    const post = await Post.create({
      auteur: req.user._id,
      titre,
      description,
      estPremium,
      medias,
    });

    // Compteur denormalise du profil.
    await User.updateOne({ _id: req.user._id }, { $inc: { 'stats.postsCount': 1 } });

    await post.populate('auteur', 'pseudo nom prenom avatar type diplome');

    return res.status(201).json({
      succes: true,
      message: 'Publication créée',
      post: post.versionPour(req.user, true), // l'auteur voit toujours son contenu
    });
  } catch (erreur) {
    // Rattrapage : les fichiers sont deja chez l'hebergeur, le document non.
    await supprimerPlusieurs(medias);
    throw erreur;
  }
});

/* ================================================================== *
 *  GET /api/posts/feed
 * ================================================================== */

export const feed = asyncHandler(async (req, res) => {
  const limite = Math.min(30, Math.max(1, Number(req.query.limite) || 10));
  const curseur = mongoose.isValidObjectId(req.query.curseur) ? req.query.curseur : null;

  const resultat = await construireFeed(req.user, { curseur, limite });

  return res.json({ succes: true, ...resultat });
});

/* ================================================================== *
 *  GET /api/posts/utilisateur/:identifiant
 * ================================================================== */

export const postsUtilisateur = asyncHandler(async (req, res) => {
  const { identifiant } = req.params;

  const critere = mongoose.isValidObjectId(identifiant)
    ? { _id: identifiant }
    : { pseudo: String(identifiant).toLowerCase() };

  const cible = await User.findOne(critere);
  if (!cible || !cible.isActive) throw ApiError.notFound('Profil introuvable');

  const limite = Math.min(30, Math.max(1, Number(req.query.limite) || 12));
  const curseur = mongoose.isValidObjectId(req.query.curseur) ? req.query.curseur : null;

  const resultat = await postsDeUtilisateur(req.user, cible, { curseur, limite });

  return res.json({ succes: true, ...resultat });
});

/* ================================================================== *
 *  GET /api/posts/:id
 * ================================================================== */

export const unPost = asyncHandler(async (req, res) => {
  const post = await Post.findById(req.params.id).populate(
    'auteur',
    'pseudo nom prenom avatar type diplome visibilite isActive'
  );

  if (!post || !post.auteur?.isActive) throw ApiError.notFound('Publication introuvable');

  // Regle de visibilite du profil, puis regle premium : les deux se cumulent.
  const relation = await relationAvec(req.user, post.auteur);
  if (!peutVoirContenu(relation, post.auteur)) {
    throw ApiError.forbidden('Ce compte est privé');
  }

  const abonnements = await abonnementsPremiumActifs(req.user?._id);

  return res.json({
    succes: true,
    post: post.versionPour(req.user, aAccesPremium(req.user, post.auteur._id, abonnements)),
  });
});

/* ================================================================== *
 *  DELETE /api/posts/:id
 * ================================================================== */

/**
 * Suppression d'une publication par son auteur ou par un administrateur.
 *
 * Trois effets a enchainer : le document, ses commentaires, ses fichiers.
 * Les deux premiers sont regroupes dans une TRANSACTION — le replica set mis
 * en place au module 1 la rend possible. Sans elle, une panne entre les deux
 * laisserait des commentaires rattaches a un post disparu, invisibles et
 * impossibles a nettoyer.
 *
 * Les fichiers sont supprimes APRES la transaction : le stockage externe
 * n'en fait pas partie, et l'on ne peut pas annuler un effacement chez
 * Cloudinary si la transaction echouait ensuite.
 */
export const supprimerPost = asyncHandler(async (req, res) => {
  const post = await Post.findById(req.params.id);
  if (!post) throw ApiError.notFound('Publication introuvable');

  const estAuteur = String(post.auteur) === req.user._id.toString();
  if (!estAuteur && req.user.type !== 'admin') {
    throw ApiError.forbidden('Vous ne pouvez supprimer que vos propres publications');
  }

  const medias = [...post.medias];

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Comment.deleteMany({ post: post._id }, { session });
      await Post.deleteOne({ _id: post._id }, { session });
      await User.updateOne(
        { _id: post.auteur },
        { $inc: { 'stats.postsCount': -1 } },
        { session }
      );
    });
  } finally {
    await session.endSession();
  }

  await supprimerPlusieurs(medias);

  return res.json({ succes: true, message: 'Publication supprimée' });
});

/* ================================================================== *
 *  POST /api/posts/:id/like
 * ================================================================== */

/**
 * Bascule like / unlike.
 *
 * `$addToSet` et `$pull` sont ATOMIQUES cote base : deux clics simultanes ne
 * peuvent pas inserer deux fois le meme identifiant. Charger le tableau, le
 * modifier en JavaScript puis le reecrire ouvrirait une fenetre pendant
 * laquelle deux requetes se marcheraient dessus.
 *
 * On lit d'abord l'etat pour savoir quelle operation appliquer, mais c'est
 * l'operateur atomique qui fait foi : meme si l'etat a change entre-temps,
 * `$addToSet` reste sans effet sur un like deja present.
 */
export const basculerLike = asyncHandler(async (req, res) => {
  const post = await Post.findById(req.params.id).populate(
    'auteur',
    'visibilite type diplome isActive'
  );

  if (!post || !post.auteur?.isActive) throw ApiError.notFound('Publication introuvable');

  // On ne peut pas aimer ce que l'on n'a pas le droit de voir.
  const relation = await relationAvec(req.user, post.auteur);
  if (!peutVoirContenu(relation, post.auteur)) {
    throw ApiError.forbidden('Ce compte est privé');
  }

  if (post.estPremium) {
    const abonnements = await abonnementsPremiumActifs(req.user._id);
    if (!aAccesPremium(req.user, post.auteur._id, abonnements)) {
      throw ApiError.forbidden('Contenu réservé aux abonnés premium');
    }
  }

  const dejaLike = post.likes.some((id) => String(id) === req.user._id.toString());

  const majour = await Post.findByIdAndUpdate(
    post._id,
    dejaLike
      ? { $pull: { likes: req.user._id } }
      : { $addToSet: { likes: req.user._id } },
    { new: true, select: 'likes' }
  );

  // A brancher au module 12 : notifier l'auteur d'un nouveau like.

  return res.json({
    succes: true,
    aLike: !dejaLike,
    likesCount: majour.likes.length,
  });
});
