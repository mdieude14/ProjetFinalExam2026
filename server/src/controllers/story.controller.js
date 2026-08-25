import mongoose from 'mongoose';
import Story, { DUREE_STORY_HEURES } from '../models/Story.js';
import StoryView from '../models/StoryView.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { televerser, supprimer } from '../services/storage.service.js';
import { idsSuivis, abonnementsPremiumActifs, aAccesPremium } from '../services/feed.service.js';
import { relationAvec, peutVoirContenu } from '../services/access.service.js';
import User from '../models/User.js';

/* ================================================================== *
 *  POST /api/stories
 * ================================================================== */

export const creerStory = asyncHandler(async (req, res) => {
  const estPremium = req.body.estPremium === 'true' || req.body.estPremium === true;

  if (estPremium && !req.user.peutMonetiser) {
    throw ApiError.forbidden(
      'Le contenu premium requiert un diplôme vérifié, un compte Stripe actif et un tarif défini'
    );
  }

  const media = await televerser(req.file, 'stories');

  try {
    const story = await Story.create({
      auteur: req.user._id,
      media,
      texte: req.body.texte,
      estPremium,
      expireAt: new Date(Date.now() + DUREE_STORY_HEURES * 60 * 60 * 1000),
    });

    await story.populate('auteur', 'pseudo nom prenom avatar type diplome');

    return res.status(201).json({
      succes: true,
      message: `Story publiee, visible pendant ${DUREE_STORY_HEURES} h`,
      story: story.versionPour(req.user, true),
    });
  } catch (erreur) {
    // Le fichier est deja chez l'hebergeur mais le document n'existe pas :
    // on efface pour ne pas laisser d'orphelin.
    await supprimer(media.publicId, media.type);
    throw erreur;
  }
});

/* ================================================================== *
 *  GET /api/stories
 * ================================================================== */

/**
 * Barre de stories : les stories encore valides des comptes suivis, plus les
 * siennes, regroupees par auteur.
 *
 * LE FILTRE SUR `expireAt` EST INDISPENSABLE malgre l'index TTL. MongoDB ne
 * lance sa tache de nettoyage qu'une fois par minute : sans ce filtre, une
 * story perimee depuis 40 secondes serait encore servie.
 *
 * Le regroupement par auteur reproduit le fonctionnement d'Instagram : une
 * pastille par personne, et non une pastille par story.
 */
export const barreStories = asyncHandler(async (req, res) => {
  const suivis = await idsSuivis(req.user._id);
  const auteurs = [...suivis, req.user._id];

  const stories = await Story.find({
    auteur: { $in: auteurs },
    expireAt: { $gt: new Date() },
  })
    .sort({ createdAt: 1 })
    .populate('auteur', 'pseudo nom prenom avatar type diplome');

  // Stories deja vues par ce visiteur, pour distinguer les pastilles
  // colorees (non vues) des grises (vues).
  const vues = await StoryView.distinct('story', { spectateur: req.user._id });
  const ensembleVues = new Set(vues.map(String));

  const abonnements = await abonnementsPremiumActifs(req.user._id);

  // Regroupement par auteur, en preservant l'ordre d'apparition.
  const parAuteur = new Map();

  for (const story of stories) {
    const idAuteur = String(story.auteur._id);

    if (!parAuteur.has(idAuteur)) {
      parAuteur.set(idAuteur, {
        auteur: {
          _id: story.auteur._id,
          pseudo: story.auteur.pseudo,
          prenom: story.auteur.prenom,
          nom: story.auteur.nom,
          avatar: story.auteur.avatar,
          estCertifie: story.auteur.estCertifie,
        },
        estMoi: idAuteur === req.user._id.toString(),
        stories: [],
        toutesVues: true,
      });
    }

    const groupe = parAuteur.get(idAuteur);
    const vue = ensembleVues.has(String(story._id));
    if (!vue) groupe.toutesVues = false;

    groupe.stories.push({
      ...story.versionPour(req.user, aAccesPremium(req.user, story.auteur._id, abonnements)),
      vue,
    });
  }

  // Ses propres stories en tete, puis les comptes ayant du contenu non vu :
  // l'utilisateur voit d'abord ce qui est nouveau pour lui.
  const groupes = [...parAuteur.values()].sort((a, b) => {
    if (a.estMoi !== b.estMoi) return a.estMoi ? -1 : 1;
    if (a.toutesVues !== b.toutesVues) return a.toutesVues ? 1 : -1;
    return 0;
  });

  return res.json({ succes: true, groupes });
});

/* ================================================================== *
 *  POST /api/stories/:id/vue
 * ================================================================== */

/**
 * Enregistre la consultation d'une story.
 *
 * `updateOne` avec `upsert: true` plutot que « chercher puis creer » :
 * l'operation est atomique, donc deux ouvertures simultanees ne peuvent pas
 * creer deux vues. Le compteur n'est incremente que si le document vient
 * reellement d'etre cree (`upsertedCount`), sinon rouvrir une story dix fois
 * la ferait apparaitre dix fois vue.
 */
export const marquerVue = asyncHandler(async (req, res) => {
  const story = await Story.findById(req.params.id).populate(
    'auteur',
    'visibilite type diplome isActive'
  );

  if (!story || story.expireAt <= new Date() || !story.auteur?.isActive) {
    throw ApiError.notFound('Story introuvable ou expiree');
  }

  const relation = await relationAvec(req.user, story.auteur);
  if (!peutVoirContenu(relation, story.auteur)) {
    throw ApiError.forbidden('Ce compte est privé');
  }

  // L'auteur qui relit sa propre story ne s'ajoute pas a ses spectateurs.
  if (String(story.auteur._id) === req.user._id.toString()) {
    return res.json({ succes: true, dejaVue: true, vuesCount: story.vuesCount });
  }

  const resultat = await StoryView.updateOne(
    { story: story._id, spectateur: req.user._id },
    { $setOnInsert: { expireAt: story.expireAt } },
    { upsert: true }
  );

  const nouvelleVue = resultat.upsertedCount > 0;
  if (nouvelleVue) {
    await Story.updateOne({ _id: story._id }, { $inc: { vuesCount: 1 } });
  }

  return res.json({
    succes: true,
    dejaVue: !nouvelleVue,
    vuesCount: story.vuesCount + (nouvelleVue ? 1 : 0),
  });
});

/* ================================================================== *
 *  GET /api/stories/:id/vues
 * ================================================================== */

/** Liste des spectateurs — reservee a l'auteur de la story. */
export const listerVues = asyncHandler(async (req, res) => {
  const story = await Story.findById(req.params.id);
  if (!story) throw ApiError.notFound('Story introuvable');

  if (String(story.auteur) !== req.user._id.toString()) {
    throw ApiError.forbidden('Seul l’auteur peut consulter les vues de sa story');
  }

  const vues = await StoryView.find({ story: story._id })
    .sort({ createdAt: -1 })
    .limit(100)
    .populate('spectateur', 'pseudo nom prenom avatar type diplome');

  return res.json({
    succes: true,
    vuesCount: story.vuesCount,
    spectateurs: vues
      .filter((v) => v.spectateur)
      .map((v) => ({
        _id: v.spectateur._id,
        pseudo: v.spectateur.pseudo,
        prenom: v.spectateur.prenom,
        nom: v.spectateur.nom,
        avatar: v.spectateur.avatar,
        date: v.createdAt,
      })),
  });
});

/* ================================================================== *
 *  DELETE /api/stories/:id
 * ================================================================== */

export const supprimerStory = asyncHandler(async (req, res) => {
  const story = await Story.findById(req.params.id);
  if (!story) throw ApiError.notFound('Story introuvable');

  const estAuteur = String(story.auteur) === req.user._id.toString();
  if (!estAuteur && req.user.type !== 'admin') {
    throw ApiError.forbidden('Vous ne pouvez supprimer que vos propres stories');
  }

  const media = story.media;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await StoryView.deleteMany({ story: story._id }, { session });
      await Story.deleteOne({ _id: story._id }, { session });
    });
  } finally {
    await session.endSession();
  }

  // Hors transaction : le stockage externe n'est pas transactionnel.
  await supprimer(media.publicId, media.type);

  return res.json({ succes: true, message: 'Story supprimée' });
});

/* ================================================================== *
 *  GET /api/stories/utilisateur/:identifiant
 * ================================================================== */

/** Stories encore valides d'un profil donne, pour la page de profil. */
export const storiesUtilisateur = asyncHandler(async (req, res) => {
  const { identifiant } = req.params;

  const critere = mongoose.isValidObjectId(identifiant)
    ? { _id: identifiant }
    : { pseudo: String(identifiant).toLowerCase() };

  const cible = await User.findOne(critere);
  if (!cible || !cible.isActive) throw ApiError.notFound('Profil introuvable');

  const relation = await relationAvec(req.user, cible);
  if (!peutVoirContenu(relation, cible)) {
    return res.json({ succes: true, stories: [], contenuVisible: false });
  }

  const stories = await Story.find({
    auteur: cible._id,
    expireAt: { $gt: new Date() },
  })
    .sort({ createdAt: 1 })
    .populate('auteur', 'pseudo nom prenom avatar type diplome');

  const abonnements = await abonnementsPremiumActifs(req.user?._id);

  return res.json({
    succes: true,
    contenuVisible: true,
    stories: stories.map((s) =>
      s.versionPour(req.user, aAccesPremium(req.user, cible._id, abonnements))
    ),
  });
});
