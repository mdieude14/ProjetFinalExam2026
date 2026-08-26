import mongoose from 'mongoose';
import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { config } from '../config/env.js';
import { lirePagination, reponsePaginee } from '../utils/pagination.js';
import * as stripeService from '../services/stripe.service.js';

/**
 * ===========================================================================
 *  CÔTÉ SPORTIF — SOUSCRIRE, CONSULTER, RÉSILIER
 * ===========================================================================
 */

const urlBase = () => config.clientUrls[0] || 'http://localhost:5173';

/** Résout un identifiant d'URL — ObjectId ou pseudo — en document User. */
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
 *  POST /api/subscriptions/:identifiant/checkout
 * ================================================================== */

/**
 * Ouvre une session de paiement pour s'abonner à un coach.
 *
 * ON NE CRÉE PAS L'ABONNEMENT ICI. Tant que le sportif n'a pas payé, rien ne
 * doit exister en base : c'est le webhook `checkout.session.completed` qui
 * enregistrera l'abonnement, une fois Stripe certain de l'encaissement.
 *
 * Créer un document « en attente » à ce stade paraîtrait plus simple, mais
 * laisserait des abonnements fantômes chaque fois que quelqu'un ouvre la
 * page de paiement puis se ravise — ce qui arrive constamment.
 */
export const creerCheckout = asyncHandler(async (req, res) => {
  const coach = await resoudreUtilisateur(req.params.identifiant);

  if (String(coach._id) === req.user._id.toString()) {
    throw ApiError.badRequest('Vous ne pouvez pas vous abonner à vous-même');
  }

  // Vérifie les trois conditions de monétisation : diplôme vérifié, compte
  // Stripe actif, tarif publié. Lève une erreur explicite selon ce qui manque.
  stripeService.verifierCoachMonetisable(coach);

  // Un abonnement déjà actif interdit la souscription. L'index unique partiel
  // du modèle garantit la règle en base, mais on refuse ici avec un message
  // clair plutôt que de laisser remonter une erreur 11000 au moment du
  // webhook — donc après que le sportif a payé.
  const existant = await Subscription.findOne({
    utilisateur: req.user._id,
    coach: coach._id,
    statut: 'actif',
  });

  if (existant) {
    throw ApiError.conflict(`Vous êtes déjà abonné à ${coach.pseudo}`);
  }

  const session = await stripeService.creerSessionCheckout({
    utilisateur: req.user,
    coach,
    urlBase: urlBase(),
  });

  return res.json({
    succes: true,
    message: 'Redirection vers le paiement sécurisé',
    url: session.url,
    sessionId: session.id,
  });
});

/* ================================================================== *
 *  GET /api/subscriptions
 * ================================================================== */

/** Mes abonnements premium, du plus récent au plus ancien. */
export const mesAbonnements = asyncHandler(async (req, res) => {
  const { page, limite, saut } = lirePagination(req);

  const filtre = { utilisateur: req.user._id };
  // Par défaut on masque les abonnements incomplets : ce sont des sessions
  // de paiement ouvertes puis abandonnées, sans intérêt pour l'utilisateur.
  if (!req.query.tout) filtre.statut = { $ne: 'incomplete' };

  const [abonnements, total] = await Promise.all([
    Subscription.find(filtre)
      .sort({ createdAt: -1 })
      .skip(saut)
      .limit(limite)
      .populate('coach', 'pseudo nom prenom avatar type diplome premium'),
    Subscription.countDocuments(filtre),
  ]);

  return res.json(
    reponsePaginee(
      abonnements.filter((a) => a.coach).map((a) => a.versionPublique()),
      total,
      { page, limite }
    )
  );
});

/* ================================================================== *
 *  GET /api/subscriptions/abonnes
 * ================================================================== */

/** Mes abonnés payants — réservé aux coachs. */
export const mesAbonnes = asyncHandler(async (req, res) => {
  const { page, limite, saut } = lirePagination(req);

  const filtre = { coach: req.user._id, statut: { $in: ['actif', 'impaye'] } };

  const [abonnements, total] = await Promise.all([
    Subscription.find(filtre)
      .sort({ createdAt: -1 })
      .skip(saut)
      .limit(limite)
      .populate('utilisateur', 'pseudo nom prenom avatar type ville'),
    Subscription.countDocuments(filtre),
  ]);

  return res.json(
    reponsePaginee(
      abonnements.filter((a) => a.utilisateur).map((a) => a.versionPublique()),
      total,
      { page, limite }
    )
  );
});

/* ================================================================== *
 *  GET /api/subscriptions/statut/:identifiant
 * ================================================================== */

/**
 * Ma relation d'abonnement avec un coach donné.
 * Alimente le bouton du profil : « S'abonner », « Abonné », « Paiement en
 * échec », sans avoir à charger toute la liste.
 */
export const statutAvecCoach = asyncHandler(async (req, res) => {
  const coach = await resoudreUtilisateur(req.params.identifiant);

  const abonnement = await Subscription.findOne({
    utilisateur: req.user._id,
    coach: coach._id,
    statut: { $in: ['actif', 'impaye', 'annule'] },
  }).sort({ createdAt: -1 });

  return res.json({
    succes: true,
    abonne: Boolean(abonnement?.donneAcces),
    abonnement: abonnement ? abonnement.versionPublique() : null,
    // Le coach propose-t-il seulement un abonnement en ce moment ?
    offreDisponible: Boolean(
      coach.peutMonetiser && coach.premium?.actif && coach.premium?.stripePriceId
    ),
    prixMensuel: coach.premium?.prixMensuel,
    devise: coach.premium?.devise || 'eur',
  });
});

/* ================================================================== *
 *  DELETE /api/subscriptions/:id
 * ================================================================== */

/**
 * Résilie un abonnement, à la fin de la période en cours.
 *
 * L'ACCÈS N'EST PAS COUPÉ IMMÉDIATEMENT — l'utilisateur a payé le mois
 * entamé. Stripe enverra `customer.subscription.deleted` le jour de
 * l'échéance, et c'est ce webhook qui basculera le statut. Ici on se contente
 * de programmer l'arrêt et de le noter en base pour l'affichage.
 */
export const resilier = asyncHandler(async (req, res) => {
  const abonnement = await Subscription.findById(req.params.id);

  if (!abonnement) throw ApiError.notFound('Abonnement introuvable');

  if (String(abonnement.utilisateur) !== req.user._id.toString()) {
    throw ApiError.forbidden('Cet abonnement n’est pas le vôtre');
  }

  if (!['actif', 'impaye'].includes(abonnement.statut)) {
    throw ApiError.conflict('Cet abonnement n’est plus actif');
  }

  if (abonnement.annuleALaFinPeriode) {
    throw ApiError.conflict('La résiliation est déjà programmée');
  }

  const resultat = await stripeService.resilier(abonnement.stripeSubscriptionId);

  abonnement.annuleALaFinPeriode = true;
  abonnement.dateAnnulation = new Date();
  if (resultat.periodeFin) abonnement.periodeFin = resultat.periodeFin;
  await abonnement.save();

  const fin = abonnement.periodeFin
    ? abonnement.periodeFin.toLocaleDateString('fr-FR', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : null;

  return res.json({
    succes: true,
    message: fin
      ? `Résiliation enregistrée. Vous gardez l’accès jusqu’au ${fin}.`
      : 'Résiliation enregistrée. Vous gardez l’accès jusqu’à la fin de la période payée.',
    abonnement: abonnement.versionPublique(),
  });
});

/* ================================================================== *
 *  POST /api/subscriptions/:id/reprendre
 * ================================================================== */

/** Annule une résiliation programmée, tant que la période court encore. */
export const reprendre = asyncHandler(async (req, res) => {
  const abonnement = await Subscription.findById(req.params.id);

  if (!abonnement) throw ApiError.notFound('Abonnement introuvable');

  if (String(abonnement.utilisateur) !== req.user._id.toString()) {
    throw ApiError.forbidden('Cet abonnement n’est pas le vôtre');
  }

  if (!abonnement.annuleALaFinPeriode) {
    throw ApiError.conflict('Aucune résiliation n’est programmée');
  }

  await stripeService.reprendre(abonnement.stripeSubscriptionId);

  abonnement.annuleALaFinPeriode = false;
  abonnement.dateAnnulation = undefined;
  await abonnement.save();

  return res.json({
    succes: true,
    message: 'Résiliation annulée, votre abonnement continue',
    abonnement: abonnement.versionPublique(),
  });
});
