import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { config } from '../config/env.js';
import * as stripeService from '../services/stripe.service.js';

/**
 * ===========================================================================
 *  CÔTÉ COACH — ENRÔLEMENT ET TARIF
 * ===========================================================================
 * Ces routes concernent le coach qui met en place sa monétisation. Le côté
 * sportif — souscrire, résilier — vit dans subscription.controller.js.
 * ===========================================================================
 */

/** Origine du front, pour construire les URL de retour de Stripe. */
const urlBase = () => config.clientUrls[0] || 'http://localhost:5173';

/* ================================================================== *
 *  POST /api/stripe/connect/onboarding
 * ================================================================== */

/**
 * Démarre — ou reprend — l'enrôlement Stripe du coach.
 *
 * Renvoie systématiquement un lien neuf, même si le compte existe déjà :
 * un lien d'inscription expire en quelques minutes, et le coach abandonne
 * souvent le formulaire en cours de route pour y revenir plus tard.
 *
 * Le middleware `coachCertifie` garde cette route en amont : on ne laisse
 * pas quelqu'un mettre en place des paiements avant que son diplôme ait été
 * validé par un administrateur.
 */
export const demarrerOnboarding = asyncHandler(async (req, res) => {
  const { id, deja } = await stripeService.creerCompteConnecte(req.user);

  const url = await stripeService.lienOnboarding(id, urlBase());

  return res.json({
    succes: true,
    message: deja
      ? 'Reprenez votre inscription Stripe là où vous l’aviez laissée'
      : 'Compte de paiement créé, finalisez votre inscription',
    url,
    // Le front redirige immédiatement vers cette URL ; on la renvoie plutôt
    // que de faire une redirection HTTP, pour que l'appel reste une requête
    // AJAX classique et que le front puisse gérer l'erreur.
    compteExistant: deja,
  });
});

/* ================================================================== *
 *  GET /api/stripe/connect/statut
 * ================================================================== */

/**
 * Interroge Stripe et met la base à jour.
 *
 * ON NE SE FIE JAMAIS À `return_url`. Stripe y renvoie le coach dès qu'il
 * quitte le formulaire, même s'il l'a abandonné. Seule l'API dit si le
 * compte peut réellement recevoir des virements — c'est cette réponse qui
 * fait foi, et qui débloque `peutMonetiser`.
 */
export const statutConnect = asyncHandler(async (req, res) => {
  const etat = await stripeService.rafraichirCompteConnecte(req.user);

  // On relit l'utilisateur : le service vient de le modifier en base, et le
  // virtuel `peutMonetiser` doit être calculé sur les valeurs à jour.
  const coach = await User.findById(req.user._id);

  return res.json({
    succes: true,
    ...etat,
    peutMonetiser: coach.peutMonetiser,
    // Ce qui manque encore, pour l'afficher au coach plutôt que de le
    // laisser deviner pourquoi il reste bloqué.
    manque: {
      diplome: coach.diplome?.statut !== 'verifie',
      stripe: !coach.stripeAccount?.chargesEnabled,
      tarif: !coach.premium?.stripePriceId,
    },
  });
});

/* ================================================================== *
 *  PUT /api/stripe/premium/tarif
 * ================================================================== */

/**
 * Définit ou modifie le tarif mensuel.
 *
 * Le montant arrive en EUROS depuis le formulaire et part en CENTIMES chez
 * Stripe. La conversion se fait ici, une seule fois : manipuler des euros à
 * virgule dans le reste du code exposerait aux erreurs d'arrondi des nombres
 * à virgule flottante.
 */
export const definirTarif = asyncHandler(async (req, res) => {
  const { prixMensuel, description } = req.body;

  // Le coach doit avoir un compte Stripe capable d'encaisser avant de fixer
  // un prix : autrement on afficherait une offre que personne ne pourrait
  // souscrire.
  if (!req.user.stripeAccount?.chargesEnabled) {
    throw ApiError.forbidden(
      'Finalisez d’abord votre inscription Stripe pour pouvoir recevoir des paiements'
    );
  }

  const centimes = Math.round(Number(prixMensuel) * 100);

  const resultat = await stripeService.definirTarif(req.user, centimes, description);

  const coach = await User.findById(req.user._id);

  return res.json({
    succes: true,
    message: resultat.ancienPrixArchive
      ? 'Tarif mis à jour. Vos abonnés actuels conservent leur ancien prix.'
      : 'Tarif défini, votre abonnement premium est en ligne',
    premium: coach.versionPrivee().premium,
    peutMonetiser: coach.peutMonetiser,
  });
});

/* ================================================================== *
 *  PATCH /api/stripe/premium/actif
 * ================================================================== */

/**
 * Suspend ou reprend la vente de l'abonnement.
 *
 * Suspendre EMPÊCHE LES NOUVELLES SOUSCRIPTIONS sans toucher aux
 * abonnements en cours : ceux-ci continuent de courir et d'être prélevés.
 * Les résilier d'office reviendrait à rompre unilatéralement un contrat
 * déjà payé.
 */
export const changerActivationPremium = asyncHandler(async (req, res) => {
  const { actif } = req.body;

  if (actif && !req.user.premium?.stripePriceId) {
    throw ApiError.badRequest('Définissez d’abord un tarif');
  }

  await User.updateOne({ _id: req.user._id }, { 'premium.actif': actif });

  const abonnesActifs = await Subscription.countDocuments({
    coach: req.user._id,
    statut: 'actif',
  });

  return res.json({
    succes: true,
    message: actif
      ? 'Votre abonnement premium est de nouveau proposé'
      : `Nouvelles souscriptions suspendues. Vos ${abonnesActifs} abonné${
          abonnesActifs > 1 ? 's' : ''
        } actuel${abonnesActifs > 1 ? 's' : ''} ${
          abonnesActifs > 1 ? 'conservent' : 'conserve'
        } son accès.`,
    actif,
    abonnesActifs,
  });
});

/* ================================================================== *
 *  GET /api/stripe/premium/revenus
 * ================================================================== */

/**
 * Tableau de bord financier du coach.
 *
 * Les montants sont calculés depuis NOTRE base, pas depuis Stripe : c'est
 * instantané, et les webhooks maintiennent déjà la cohérence. Interroger
 * Stripe à chaque affichage ajouterait une latence réseau pour une
 * information qu'on possède.
 */
export const revenus = asyncHandler(async (req, res) => {
  const [actifs, impayes, annules, total] = await Promise.all([
    Subscription.find({ coach: req.user._id, statut: 'actif' }).select('montant'),
    Subscription.countDocuments({ coach: req.user._id, statut: 'impaye' }),
    Subscription.countDocuments({ coach: req.user._id, statut: 'annule' }),
    Subscription.countDocuments({ coach: req.user._id }),
  ]);

  const brutMensuel = actifs.reduce((somme, a) => somme + (a.montant || 0), 0);
  const commission = Math.round((brutMensuel * config.stripe.commissionPct) / 100);

  return res.json({
    succes: true,
    revenus: {
      abonnesActifs: actifs.length,
      impayes,
      annules,
      total,
      // Tous les montants restent en centimes : le front divise à
      // l'affichage, comme partout ailleurs dans le projet.
      brutMensuel,
      commissionPlateforme: commission,
      netMensuel: brutMensuel - commission,
      devise: 'eur',
      tauxCommission: config.stripe.commissionPct,
    },
  });
});
