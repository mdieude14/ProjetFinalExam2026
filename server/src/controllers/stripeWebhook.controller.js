import stripe from '../config/stripe.js';
import { config } from '../config/env.js';
import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import ProcessedWebhook from '../models/ProcessedWebhook.js';
import * as stripeService from '../services/stripe.service.js';
import * as notifications from '../services/notification.service.js';

/**
 * ===========================================================================
 *  RÉCEPTION DES ÉVÉNEMENTS STRIPE
 * ===========================================================================
 *
 * C'est le point le plus délicat du module, et le seul endroit où la base se
 * met à jour après un paiement.
 *
 * POURQUOI NE PAS SE FIER À LA PAGE DE RETOUR ?
 * Quand le sportif paie, Stripe le redirige vers `success_url`. On pourrait
 * y enregistrer l'abonnement. Ce serait faux :
 *   - il peut fermer l'onglet avant la redirection — il a payé, on ne le sait
 *     pas ;
 *   - il peut fabriquer l'URL de retour à la main — on créerait un
 *     abonnement sans paiement ;
 *   - les renouvellements mensuels n'ont aucune page de retour.
 *
 * Le webhook vient de Stripe, il est signé, et il arrive quoi qu'il advienne
 * du navigateur. C'est la seule source fiable.
 *
 * TROIS GARANTIES SONT INDISPENSABLES ICI :
 *
 *  1. SIGNATURE — sans vérification, n'importe qui pourrait appeler cette
 *     route et s'offrir un abonnement gratuit.
 *  2. IDEMPOTENCE — Stripe livre « au moins une fois ». Un événement rejoué
 *     ne doit pas prolonger l'abonnement deux fois.
 *  3. RÉPONDRE 200 MÊME EN CAS DE PROBLÈME MÉTIER — un code d'erreur fait
 *     rejouer l'événement en boucle par Stripe pendant des jours. On répond
 *     200 et l'on journalise.
 * ===========================================================================
 */

/* ================================================================== *
 *  POINT D'ENTRÉE
 * ================================================================== */

export async function recevoirWebhook(req, res) {
  /* --- 1. Vérification de la signature ---------------------------- */

  const signature = req.headers['stripe-signature'];

  if (!config.stripe.webhookSecret) {
    console.error('[WEBHOOK] STRIPE_WEBHOOK_SECRET absent : événement ignoré');
    return res.status(503).json({ recu: false, message: 'Webhooks non configurés' });
  }

  let evenement;
  try {
    // `req.body` est un Buffer brut ici — la route est montée avec
    // express.raw AVANT express.json(). Si le corps avait déjà été analysé
    // en objet JavaScript, la signature ne correspondrait plus.
    evenement = stripe.webhooks.constructEvent(
      req.body,
      signature,
      config.stripe.webhookSecret
    );
  } catch (erreur) {
    // Signature invalide : c'est soit une erreur de configuration, soit une
    // tentative d'appel frauduleux. On répond 400 — et là, contrairement aux
    // erreurs métier, il FAUT échouer : Stripe doit savoir que le message
    // n'a pas été accepté.
    console.error('[WEBHOOK] Signature refusée :', erreur.message);
    return res.status(400).json({ recu: false, message: 'Signature invalide' });
  }

  /* --- 2. Idempotence --------------------------------------------- */

  try {
    // On enregistre l'identifiant AVANT de traiter. L'index unique fait
    // échouer la seconde tentative : c'est la base qui garantit l'unicité,
    // pas un `findOne` suivi d'un `create` — entre les deux, un second
    // appel pourrait passer.
    await ProcessedWebhook.create({
      stripeEventId: evenement.id,
      type: evenement.type,
    });
  } catch (erreur) {
    if (erreur.code === 11000) {
      console.log(`[WEBHOOK] ${evenement.type} (${evenement.id}) déjà traité, ignoré`);
      return res.json({ recu: true, deja: true });
    }
    throw erreur;
  }

  /* --- 3. Traitement ---------------------------------------------- */

  try {
    const traite = await router(evenement);

    await ProcessedWebhook.updateOne(
      { stripeEventId: evenement.id },
      { resultat: traite ? 'traite' : 'ignore' }
    );

    return res.json({ recu: true, type: evenement.type, traite });
  } catch (erreur) {
    console.error(`[WEBHOOK] Échec sur ${evenement.type} :`, erreur.message);

    await ProcessedWebhook.updateOne(
      { stripeEventId: evenement.id },
      { resultat: 'erreur', message: erreur.message?.slice(0, 300) }
    );

    // 200 malgré l'échec : renvoyer une erreur ferait rejouer l'événement
    // en boucle, sans plus de succès. Le journal et la collection
    // ProcessedWebhook permettent l'investigation.
    return res.json({ recu: true, erreur: true });
  }
}

/* ================================================================== *
 *  AIGUILLAGE
 * ================================================================== */

async function router(evenement) {
  const objet = evenement.data.object;

  switch (evenement.type) {
    case 'checkout.session.completed':
      return paiementInitialReussi(objet);

    case 'customer.subscription.updated':
      return abonnementModifie(objet);

    case 'customer.subscription.deleted':
      return abonnementTermine(objet);

    case 'invoice.payment_succeeded':
      return prelevementReussi(objet);

    case 'invoice.payment_failed':
      return prelevementEchoue(objet);

    /**
     * `capability.updated` EST INDISPENSABLE, et son absence a été constatée
     * en test réel.
     *
     * Lors de l'enrôlement d'un coach, Stripe émet la séquence suivante :
     *
     *   14:47:50  account.updated      capacités encore inactives
     *   14:47:58  account.updated      capacités encore inactives
     *   14:47:58  capability.updated   LES CAPACITÉS DEVIENNENT ACTIVES
     *
     * Le dernier `account.updated` précède l'activation. En ne traitant que
     * lui, la base restait bloquée sur « restreint » alors que le compte
     * pouvait déjà recevoir des virements — un coach parfaitement en règle
     * n'aurait jamais pu vendre.
     */
    case 'account.updated':
    case 'v2.core.account.updated':
    case 'capability.updated':
    case 'account.external_account.created':
      // On transmet aussi l'événement : pour un événement Connect, il porte
      // l'identifiant du compte concerné dans `evenement.account`, alors que
      // la charge utile varie selon le type (un objet Capability n'a pas le
      // même `id` qu'un objet Account).
      return compteCoachModifie(objet, evenement.account);

    default:
      // Stripe envoie des dizaines de types d'événements. Ignorer ceux qui
      // ne nous concernent pas est normal, mais on les journalise pour
      // repérer un type utile qu'on aurait oublié.
      console.log(`[WEBHOOK] Type non traité : ${evenement.type}`);
      return false;
  }
}

/* ================================================================== *
 *  CRÉATION DE L'ABONNEMENT
 * ================================================================== */

/**
 * Le sportif vient de payer : l'abonnement existe enfin.
 *
 * C'est ici — et nulle part ailleurs — que le document est créé. Avant ce
 * moment, rien ne prouvait qu'un paiement aboutirait.
 */
async function paiementInitialReussi(session) {
  const { utilisateurId, coachId } = session.metadata || {};

  if (!utilisateurId || !coachId) {
    console.error('[WEBHOOK] Session sans métadonnées, abonnement non créé');
    return false;
  }

  const abonnementStripe = await stripeService.lireAbonnement(session.subscription);

  const donnees = {
    utilisateur: utilisateurId,
    coach: coachId,
    statut: stripeService.statutDepuisStripe(abonnementStripe.status),
    stripeCustomerId: session.customer,
    stripeSubscriptionId: session.subscription,
    stripeCheckoutSessionId: session.id,
    stripePriceId: abonnementStripe.items?.data?.[0]?.price?.id,
    montant: abonnementStripe.items?.data?.[0]?.price?.unit_amount,
    devise: abonnementStripe.currency || 'eur',
    commissionPct: config.stripe.commissionPct,
    dateDebut: new Date(),
    periodeFin: stripeService.finDePeriode(abonnementStripe) ?? undefined,
  };

  // `upsert` sur l'identifiant Stripe : si l'événement est rejoué malgré la
  // garde d'idempotence — par exemple après une restauration de base — on
  // met à jour au lieu de créer un doublon.
  await Subscription.updateOne(
    { stripeSubscriptionId: session.subscription },
    { $set: donnees },
    { upsert: true }
  );

  await majCompteurAbonnes(coachId);

  /*
   * ON PREVIENT LE COACH DE SON NOUVEL ABONNE (module 12).
   *
   * La notification est creee ICI, dans le webhook, et non au moment ou le
   * sportif clique sur « s'abonner ». C'est le webhook qui porte la verite :
   * un clic n'est qu'une intention de payer, et la moitie des sessions
   * Checkout sont abandonnees. Notifier au clic annoncerait des abonnes qui
   * n'ont jamais paye.
   */
  await notifications.creer({
    destinataire: coachId,
    emetteur: utilisateurId,
    type: 'nouvel_abonne_premium',
    cibleType: 'User',
    cible: utilisateurId,
  });

  console.log(`[WEBHOOK] Abonnement créé : ${utilisateurId} → ${coachId}`);
  return true;
}

/* ================================================================== *
 *  CYCLE DE VIE
 * ================================================================== */

/**
 * Le statut a changé chez Stripe : on recopie.
 *
 * On ne cherche pas à deviner pourquoi. Stripe est la source de vérité sur
 * l'état d'un abonnement — c'est lui qui encaisse. Notre rôle est de refléter.
 */
async function abonnementModifie(abonnementStripe) {
  const abonnement = await Subscription.findOne({
    stripeSubscriptionId: abonnementStripe.id,
  });

  if (!abonnement) {
    console.warn(`[WEBHOOK] Abonnement inconnu : ${abonnementStripe.id}`);
    return false;
  }

  const ancienStatut = abonnement.statut;

  abonnement.statut = stripeService.statutDepuisStripe(abonnementStripe.status);
  abonnement.annuleALaFinPeriode = Boolean(abonnementStripe.cancel_at_period_end);

  // Depuis l'API 2026-07-29, la période vit sur les items, plus sur la
  // racine : `finDePeriode()` connaît les deux emplacements.
  const fin = stripeService.finDePeriode(abonnementStripe);
  if (fin) abonnement.periodeFin = fin;

  await abonnement.save();

  // Le compteur ne suit que les abonnements réellement actifs.
  if (ancienStatut !== abonnement.statut) {
    await majCompteurAbonnes(abonnement.coach);
  }

  console.log(
    `[WEBHOOK] Abonnement ${abonnementStripe.id} : ${ancienStatut} → ${abonnement.statut}`
  );
  return true;
}

/**
 * Fin de l'abonnement : la période payée est écoulée.
 *
 * C'est ce moment-là qui coupe réellement l'accès, pas la demande de
 * résiliation faite des semaines plus tôt.
 */
async function abonnementTermine(abonnementStripe) {
  const abonnement = await Subscription.findOne({
    stripeSubscriptionId: abonnementStripe.id,
  });

  if (!abonnement) return false;

  abonnement.statut = 'expire';
  abonnement.periodeFin = new Date();
  await abonnement.save();

  await majCompteurAbonnes(abonnement.coach);

  console.log(`[WEBHOOK] Abonnement terminé : ${abonnementStripe.id}`);
  return true;
}

/* ================================================================== *
 *  PRÉLÈVEMENTS
 * ================================================================== */

/**
 * Renouvellement mensuel réussi : la période est prolongée.
 *
 * Cet événement n'a AUCUNE page de retour — personne n'est devant son
 * écran quand Stripe prélève le 15 du mois. Sans webhook, l'abonnement
 * paraîtrait expiré alors qu'il a été payé.
 */
async function prelevementReussi(facture) {
  if (!facture.subscription) return false;

  const abonnement = await Subscription.findOne({
    stripeSubscriptionId: facture.subscription,
  });

  if (!abonnement) return false;

  const etaitImpaye = abonnement.statut === 'impaye';

  abonnement.statut = 'actif';
  abonnement.dernierEchec = undefined;

  if (facture.period_end) {
    abonnement.periodeFin = new Date(facture.period_end * 1000);
  }

  await abonnement.save();

  // Un abonnement qui repasse d'impayé à actif remet un abonné au compteur.
  if (etaitImpaye) await majCompteurAbonnes(abonnement.coach);

  console.log(`[WEBHOOK] Prélèvement réussi : ${facture.subscription}`);
  return true;
}

/**
 * Prélèvement échoué : l'accès est retiré immédiatement.
 *
 * Contrairement à une résiliation, il n'y a pas de période payée à honorer :
 * le paiement n'a pas eu lieu. Stripe relance automatiquement pendant
 * quelques jours ; si le sportif régularise, `invoice.payment_succeeded`
 * rétablira l'accès.
 */
async function prelevementEchoue(facture) {
  if (!facture.subscription) return false;

  const abonnement = await Subscription.findOne({
    stripeSubscriptionId: facture.subscription,
  });

  if (!abonnement) return false;

  abonnement.statut = 'impaye';
  abonnement.dernierEchec = {
    date: new Date(),
    motif: facture.last_finalization_error?.message || 'Prélèvement refusé',
  };
  await abonnement.save();

  await majCompteurAbonnes(abonnement.coach);

  // À brancher au module 12 : prévenir le sportif pour qu'il mette à jour
  // sa carte, plutôt que de le laisser découvrir la perte d'accès.

  console.log(`[WEBHOOK] Prélèvement échoué : ${facture.subscription}`);
  return true;
}

/* ================================================================== *
 *  COMPTE DU COACH
 * ================================================================== */

/**
 * Le coach a avancé — ou terminé — son inscription Stripe.
 *
 * C'est cet événement qui débloque réellement `peutMonetiser`, et non le
 * retour du coach sur la page. Il peut abandonner le formulaire à mi-chemin,
 * ou le compléter des jours plus tard depuis son espace Stripe.
 */
async function compteCoachModifie(objet, idCompteEvenement) {
  /**
   * Résolution de l'identifiant du compte, par ordre de fiabilité :
   *
   *   1. `evenement.account` — présent sur tout événement Connect, quelle
   *      que soit la charge utile ;
   *   2. `objet.account` — les objets Capability et ExternalAccount y
   *      référencent leur compte ;
   *   3. `objet.id` — uniquement si c'est bien un compte (« acct_… ») ;
   *      pour une Capability, `id` vaut « card_payments », pas un compte.
   */
  const idCompte =
    idCompteEvenement ||
    objet.account ||
    (typeof objet.id === 'string' && objet.id.startsWith('acct_') ? objet.id : null);

  const idUtilisateur = objet.metadata?.utilisateurId;

  const coach = idUtilisateur
    ? await User.findById(idUtilisateur)
    : idCompte
      ? await User.findOne({ 'stripeAccount.id': idCompte })
      : null;

  if (!coach) {
    console.warn(`[WEBHOOK] Compte connecté inconnu : ${idCompte || objet.id}`);
    return false;
  }

  // On relit l'état complet auprès de Stripe plutôt que de se fier au
  // fragment reçu : la charge utile de l'événement varie selon la version
  // d'API, alors que la lecture explicite est stable.
  const etat = await stripeService.rafraichirCompteConnecte(coach);

  console.log(
    `[WEBHOOK] Compte coach ${coach.pseudo} : ${etat.statut}, ` +
      `virements ${etat.chargesEnabled ? 'actifs' : 'inactifs'}`
  );
  return true;
}

/* ================================================================== *
 *  COMPTEUR DÉNORMALISÉ
 * ================================================================== */

/**
 * Recalcule le nombre d'abonnés premium d'un coach.
 *
 * On recompte au lieu d'incrémenter : les webhooks peuvent arriver dans le
 * désordre, et un `$inc` appliqué sur un événement rejoué ou hors séquence
 * ferait dériver le compteur. Un `countDocuments` sur un index est
 * suffisamment rapide, et toujours juste.
 */
async function majCompteurAbonnes(idCoach) {
  const nombre = await Subscription.countDocuments({
    coach: idCoach,
    statut: 'actif',
  });

  await User.updateOne(
    { _id: idCoach },
    { 'stats.abonnesPremiumCount': nombre }
  );
}
