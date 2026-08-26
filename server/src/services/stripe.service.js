import stripe, { exigerStripe } from '../config/stripe.js';
import { config } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import User from '../models/User.js';

/**
 * ===========================================================================
 *  SERVICE STRIPE
 * ===========================================================================
 *
 * Toute la logique de paiement passe par ici. Les contrôleurs ne parlent
 * jamais directement au SDK : ils décrivent une intention métier
 * (« enrôler ce coach », « faire payer cet abonnement »), le service traduit.
 *
 * MODÈLE RETENU : DESTINATION CHARGES
 *
 *   Le sportif paie la PLATEFORME. La plateforme reverse au coach et garde
 *   sa commission au passage.
 *
 * Ce n'est pas un choix esthétique, c'est une contrainte : Stripe refuse
 * désormais Accounts v1 pour les nouvelles intégrations, et une plateforme
 * française ne peut pas créer de compte « marchand » en v2 sans passer par
 * des « account tokens » — ce qui obligerait à collecter l'identité et l'IBAN
 * des coachs dans notre propre interface.
 *
 * En configuration « recipient », le coach ne fait que RECEVOIR des
 * virements. Il saisit ses informations sur un formulaire hébergé par
 * Stripe : aucune donnée bancaire ne touche notre serveur, ce qui dispense
 * l'application de toute contrainte PCI-DSS.
 * ===========================================================================
 */

/* ================================================================== *
 *  COMPTES CONNECTÉS (COACHS)
 * ================================================================== */

/**
 * Crée le compte Stripe du coach, ou renvoie celui qui existe déjà.
 *
 * L'identifiant du coach est placé en métadonnée : quand un webhook arrivera
 * plus tard, on retrouvera l'utilisateur sans avoir à interroger la base sur
 * un champ non indexé.
 */
export async function creerCompteConnecte(coach) {
  exigerStripe();

  if (coach.stripeAccount?.id) {
    return { id: coach.stripeAccount.id, deja: true };
  }

  const compte = await stripe.v2.core.accounts.create({
    contact_email: coach.email,
    display_name: `${coach.prenom} ${coach.nom}`,
    identity: {
      country: 'fr',
      // « individual » : un coach s'enrôle en son nom propre. Une structure
      // pourra plus tard basculer en « company » depuis son espace Stripe.
      entity_type: 'individual',
    },
    include: ['configuration.recipient', 'requirements'],
    configuration: {
      recipient: {
        capabilities: {
          // Autorise Stripe à virer de l'argent sur ce compte depuis le
          // solde de la plateforme. C'est tout ce dont le coach a besoin.
          stripe_balance: { stripe_transfers: { requested: true } },
        },
      },
    },
    // Tableau de bord allégé, hébergé par Stripe : le coach y suit ses
    // virements sans que nous ayons à construire cette interface.
    dashboard: 'express',
    defaults: {
      currency: 'eur',
      responsibilities: {
        // La plateforme assume les frais et les litiges : c'est elle qui
        // encaisse, donc elle qui répond.
        fees_collector: 'application',
        losses_collector: 'application',
      },
    },
    metadata: { utilisateurId: coach._id.toString() },
  });

  await User.updateOne(
    { _id: coach._id },
    {
      'stripeAccount.id': compte.id,
      'stripeAccount.statut': 'en_attente',
      'stripeAccount.dateOnboarding': new Date(),
    }
  );

  return { id: compte.id, deja: false };
}

/**
 * Génère le lien vers le formulaire d'inscription hébergé par Stripe.
 *
 * CE LIEN EXPIRE en quelques minutes et ne sert qu'une fois. On en régénère
 * un à chaque demande plutôt que de le stocker : un lien mémorisé en base
 * serait périmé au moment où l'utilisateur cliquerait dessus.
 */
export async function lienOnboarding(idCompte, urlBase) {
  exigerStripe();

  const lien = await stripe.v2.core.accountLinks.create({
    account: idCompte,
    use_case: {
      type: 'account_onboarding',
      account_onboarding: {
        configurations: ['recipient'],
        // `refresh_url` est appelée si le lien a expiré pendant que le coach
        // remplissait le formulaire : la page redemande alors un lien neuf.
        refresh_url: `${urlBase}/coach/premium?stripe=rafraichir`,
        return_url: `${urlBase}/coach/premium?stripe=retour`,
      },
    },
  });

  return lien.url;
}

/**
 * Interroge Stripe et met la base à jour.
 *
 * ON NE SE FIE JAMAIS AU RETOUR DE L'UTILISATEUR SUR `return_url`.
 * Stripe y renvoie le coach dès qu'il quitte le formulaire, y compris s'il
 * l'a abandonné en cours de route. Seule la réponse de l'API dit si le
 * compte peut réellement recevoir des virements.
 */
export async function rafraichirCompteConnecte(coach) {
  exigerStripe();

  if (!coach.stripeAccount?.id) {
    // Forme de retour IDENTIQUE au cas nominal, `exigences` comprise :
    // un appelant qui lit `etat.exigences.length` ne doit pas planter selon
    // le chemin emprunté. Une forme de retour variable est un piège.
    return {
      statut: 'non_cree',
      chargesEnabled: false,
      payoutsEnabled: false,
      exigences: [],
    };
  }

  const compte = await stripe.v2.core.accounts.retrieve(coach.stripeAccount.id, {
    include: ['configuration.recipient', 'requirements'],
  });

  const capacites = compte.configuration?.recipient?.capabilities || {};
  const transferts = capacites.stripe_balance?.stripe_transfers?.status;
  const virements = capacites.stripe_balance?.payouts?.status;

  const peutRecevoir = transferts === 'active';
  const peutEtreVire = virements === 'active';

  // « actif » quand tout fonctionne, « restreint » quand Stripe attend
  // encore des informations, « en_attente » tant que rien n'est soumis.
  const statut = peutRecevoir
    ? 'actif'
    : compte.requirements?.entries?.length
      ? 'restreint'
      : 'en_attente';

  await User.updateOne(
    { _id: coach._id },
    {
      'stripeAccount.statut': statut,
      'stripeAccount.chargesEnabled': peutRecevoir,
      'stripeAccount.payoutsEnabled': peutEtreVire,
    }
  );

  return {
    statut,
    chargesEnabled: peutRecevoir,
    payoutsEnabled: peutEtreVire,
    // Ce qu'il reste à fournir, pour l'afficher au coach plutôt que de le
    // laisser deviner pourquoi son compte est bloqué.
    exigences: (compte.requirements?.entries || []).map((e) => ({
      champ: e.field_reference?.type || e.field_reference?.resource || 'information',
      motif: e.awaiting_action_from || e.impact?.[0]?.restricts_capability || null,
    })),
  };
}

/* ================================================================== *
 *  TARIF DU COACH
 * ================================================================== */

/**
 * Définit ou change le tarif mensuel d'un coach.
 *
 * POINT ESSENTIEL : UN PRIX STRIPE EST IMMUABLE.
 * On ne peut pas modifier le montant d'un `Price` existant. Changer de tarif
 * consiste donc à créer un nouveau `Price` et à archiver l'ancien.
 *
 * C'est en réalité une bonne chose : les abonnés en cours restent rattachés
 * à l'ancien prix et continuent de payer ce à quoi ils ont souscrit. Une
 * augmentation ne s'applique qu'aux nouveaux abonnés — le comportement
 * qu'attend n'importe quel utilisateur.
 *
 * @param {number} prixMensuel - en CENTIMES
 */
export async function definirTarif(coach, prixMensuel, description) {
  exigerStripe();

  // Le produit ne change jamais : il représente « l'abonnement à ce coach ».
  // Seul le prix qui lui est rattaché évolue.
  let idProduit = coach.premium?.stripeProductId;

  if (!idProduit) {
    const produit = await stripe.products.create({
      name: `Abonnement premium — ${coach.prenom} ${coach.nom}`,
      description: description || `Contenu exclusif de ${coach.pseudo}`,
      metadata: { utilisateurId: coach._id.toString(), pseudo: coach.pseudo },
    });
    idProduit = produit.id;
  } else if (description) {
    await stripe.products.update(idProduit, { description });
  }

  const prix = await stripe.prices.create({
    product: idProduit,
    unit_amount: prixMensuel,
    currency: 'eur',
    recurring: { interval: 'month' },
    metadata: { utilisateurId: coach._id.toString() },
  });

  // Archivage de l'ancien prix : il disparaît des nouvelles souscriptions
  // sans affecter les abonnements déjà en cours.
  const ancienPrix = coach.premium?.stripePriceId;
  if (ancienPrix && ancienPrix !== prix.id) {
    await stripe.prices.update(ancienPrix, { active: false }).catch(() => {
      // Un prix déjà archivé fait échouer l'appel : sans conséquence.
    });
  }

  await User.updateOne(
    { _id: coach._id },
    {
      'premium.prixMensuel': prixMensuel,
      'premium.devise': 'eur',
      'premium.description': description,
      'premium.stripeProductId': idProduit,
      'premium.stripePriceId': prix.id,
      'premium.actif': true,
    }
  );

  return { idProduit, idPrix: prix.id, ancienPrixArchive: Boolean(ancienPrix) };
}

/* ================================================================== *
 *  CLIENT STRIPE (PAYEUR)
 * ================================================================== */

/**
 * Renvoie l'identifiant client Stripe du payeur, en le créant au besoin.
 *
 * Un même `Customer` sert pour tous les abonnements de la personne. Elle
 * retrouve ainsi ses moyens de paiement enregistrés d'un coach à l'autre,
 * au lieu de ressaisir sa carte à chaque souscription.
 */
export async function obtenirClient(utilisateur) {
  exigerStripe();

  if (utilisateur.stripeCustomerId) return utilisateur.stripeCustomerId;

  const client = await stripe.customers.create({
    email: utilisateur.email,
    name: `${utilisateur.prenom} ${utilisateur.nom}`,
    metadata: { utilisateurId: utilisateur._id.toString(), pseudo: utilisateur.pseudo },
  });

  await User.updateOne({ _id: utilisateur._id }, { stripeCustomerId: client.id });

  return client.id;
}

/* ================================================================== *
 *  SOUSCRIPTION
 * ================================================================== */

/**
 * Ouvre une session Stripe Checkout pour s'abonner à un coach.
 *
 * LE PAIEMENT SE DÉROULE SUR UNE PAGE HÉBERGÉE PAR STRIPE. Aucune donnée
 * bancaire ne transite par notre serveur ni par notre front — c'est ce qui
 * dispense l'application des obligations PCI-DSS.
 *
 * `application_fee_percent` et `transfer_data.destination` mettent en place
 * la répartition : Stripe débite le sportif, prélève notre commission, et
 * verse le reste au coach automatiquement, à chaque échéance mensuelle.
 */
export async function creerSessionCheckout({ utilisateur, coach, urlBase }) {
  exigerStripe();

  const idClient = await obtenirClient(utilisateur);

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: idClient,
    line_items: [{ price: coach.premium.stripePriceId, quantity: 1 }],

    subscription_data: {
      // Commission de la plateforme, prélevée à chaque échéance.
      application_fee_percent: config.stripe.commissionPct,
      transfer_data: { destination: coach.stripeAccount.id },
      // Ces métadonnées reviennent dans TOUS les webhooks liés à cet
      // abonnement. C'est ce qui permet de retrouver les deux utilisateurs
      // sans dépendre de la session de paiement, qui n'existe qu'une fois.
      metadata: {
        utilisateurId: utilisateur._id.toString(),
        coachId: coach._id.toString(),
      },
    },

    metadata: {
      utilisateurId: utilisateur._id.toString(),
      coachId: coach._id.toString(),
    },

    // `{CHECKOUT_SESSION_ID}` est remplacé par Stripe au moment de la
    // redirection : la page de retour peut ainsi retrouver la session.
    success_url: `${urlBase}/paiement/succes?session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${urlBase}/profile/${coach.pseudo}?paiement=annule`,

    locale: 'fr',
  });

  return { url: session.url, id: session.id };
}

/**
 * Programme la résiliation à la fin de la période en cours.
 *
 * ON NE RÉSILIE PAS IMMÉDIATEMENT. L'utilisateur a payé le mois entamé, il
 * en garde le bénéfice jusqu'au bout. `cancel_at_period_end` est exactement
 * fait pour ça, et Stripe enverra `customer.subscription.deleted` le jour de
 * l'échéance — c'est ce webhook qui coupera l'accès.
 */
export async function resilier(idAbonnementStripe) {
  exigerStripe();

  const abonnement = await stripe.subscriptions.update(idAbonnementStripe, {
    cancel_at_period_end: true,
  });

  return {
    annuleALaFinPeriode: abonnement.cancel_at_period_end,
    periodeFin: finDePeriode(abonnement),
  };
}

/**
 * Fin de la période payée en cours, en `Date` — ou `null`.
 *
 * POURQUOI UNE FONCTION PLUTÔT QU'UN ACCÈS DIRECT.
 * Depuis la version d'API `2026-07-29.dahlia`, Stripe a DÉPLACÉ
 * `current_period_end` de la racine de l'abonnement vers ses *items* : un
 * abonnement peut mêler plusieurs lignes aux échéances distinctes, la
 * période n'est donc plus une propriété de l'abonnement mais de chaque
 * ligne. La racine ne l'expose tout simplement plus.
 *
 * On interroge la racine d'abord — pour rester compatible si la version
 * d'API était un jour ramenée à un palier antérieur — puis on retombe sur
 * l'item. Notre catalogue ne comporte qu'une ligne par abonnement (celui au
 * coach) : `data[0]` est donc sans ambiguïté ici.
 *
 * Centraliser ce repli évite qu'un appelant l'oublie : c'est exactement la
 * panne qui laissait `periodeFin` vide, et avec elle un abonnement résilié
 * perdait aussitôt l'accès qu'il avait pourtant déjà payé.
 */
export function finDePeriode(abonnementStripe) {
  const horodatage =
    abonnementStripe?.current_period_end ??
    abonnementStripe?.items?.data?.[0]?.current_period_end;

  return horodatage ? new Date(horodatage * 1000) : null;
}

/** Annule une résiliation programmée, tant que la période court encore. */
export async function reprendre(idAbonnementStripe) {
  exigerStripe();

  const abonnement = await stripe.subscriptions.update(idAbonnementStripe, {
    cancel_at_period_end: false,
  });

  return { annuleALaFinPeriode: abonnement.cancel_at_period_end };
}

/** Récupère un abonnement Stripe, pour synchroniser la base. */
export async function lireAbonnement(idAbonnementStripe) {
  exigerStripe();
  return stripe.subscriptions.retrieve(idAbonnementStripe);
}

/* ================================================================== *
 *  CORRESPONDANCE DES STATUTS
 * ================================================================== */

/**
 * Traduit un statut Stripe en statut applicatif.
 *
 * Les valeurs sont volontairement proches, mais pas identiques : Stripe en
 * distingue davantage que nous n'en avons besoin. Cette table est le seul
 * endroit où la correspondance est écrite — un statut inconnu ne doit jamais
 * être interprété au hasard ailleurs dans le code.
 */
export function statutDepuisStripe(statutStripe) {
  const table = {
    active: 'actif',
    trialing: 'actif', // période d'essai : l'accès est dû
    past_due: 'impaye', // prélèvement échoué, Stripe réessaie
    unpaid: 'impaye', // Stripe a renoncé à réessayer
    canceled: 'annule',
    incomplete: 'incomplete',
    incomplete_expired: 'expire',
    paused: 'impaye',
  };

  return table[statutStripe] || 'incomplete';
}

/**
 * Vérifie qu'un coach peut réellement encaisser.
 * Les trois conditions du module 4, plus la présence effective du prix.
 */
export function verifierCoachMonetisable(coach) {
  if (coach.type !== 'coach') {
    throw ApiError.badRequest('Seuls les coachs proposent des abonnements');
  }
  if (coach.diplome?.statut !== 'verifie') {
    throw ApiError.forbidden('Ce coach n’est pas encore certifié');
  }
  if (!coach.stripeAccount?.chargesEnabled) {
    throw ApiError.forbidden('Ce coach n’a pas finalisé sa configuration de paiement');
  }
  if (!coach.premium?.actif || !coach.premium?.stripePriceId) {
    throw ApiError.forbidden('Ce coach ne propose pas d’abonnement pour le moment');
  }
}
