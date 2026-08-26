import api from './axios';

/**
 * Appels lies aux abonnements premium payants.
 *
 * A ne pas confondre avec `follow.api.js` : le suivi y est gratuit et
 * instantane, alors qu'ici chaque abonnement passe par un paiement Stripe.
 *
 * AUCUNE DONNEE BANCAIRE NE TRANSITE PAR CE FICHIER — ni ailleurs dans le
 * front. On demande une session Checkout au serveur, puis on redirige le
 * navigateur vers Stripe, qui heberge le formulaire de carte. Le numero de
 * carte n'entre jamais dans notre domaine : c'est ce qui nous dispense de la
 * certification PCI-DSS la plus lourde.
 */
export const subscriptionApi = {
  /* ------------------------- Cote abonne (sportif) ------------------------ */

  /**
   * Ouvre une session de paiement pour s'abonner a un coach.
   * Renvoie `{ url }` : l'adresse Stripe vers laquelle rediriger.
   */
  creerCheckout: (identifiantCoach) =>
    api.post(`/subscriptions/${identifiantCoach}/checkout`),

  /** Mes abonnements, le plus recent d'abord. */
  mesAbonnements: ({ page = 1, limite = 20, tout = false } = {}) =>
    api.get('/subscriptions', { params: { page, limite, ...(tout ? { tout: 1 } : {}) } }),

  /**
   * Ma relation d'abonnement avec un coach donne.
   * Alimente le bouton du profil sans charger toute la liste.
   */
  statutAvecCoach: (identifiantCoach) =>
    api.get(`/subscriptions/statut/${identifiantCoach}`),

  /**
   * Resilie un abonnement.
   * L'acces court jusqu'a la fin de la periode deja payee — le serveur
   * renvoie la date exacte pour qu'on puisse l'annoncer.
   */
  resilier: (idAbonnement) => api.delete(`/subscriptions/${idAbonnement}`),

  /** Annule une resiliation programmee, tant que la periode court encore. */
  reprendre: (idAbonnement) => api.post(`/subscriptions/${idAbonnement}/reprendre`),

  /* --------------------------- Cote coach --------------------------- */

  /** Mes abonnes payants — refuse (403) a un sportif. */
  mesAbonnes: ({ page = 1, limite = 20 } = {}) =>
    api.get('/subscriptions/abonnes', { params: { page, limite } }),
};

/**
 * Reglages de la monetisation, cote coach.
 *
 * Regroupes a part parce qu'ils vivent sous /api/stripe et non sous
 * /api/subscriptions : ce ne sont pas des abonnements mais la configuration
 * du compte vendeur.
 */
export const monetisationApi = {
  /** Demarre ou reprend l'inscription Stripe Connect. Renvoie `{ url }`. */
  demarrerOnboarding: () => api.post('/stripe/connect/onboarding'),

  /** Etat du compte Stripe : en_attente, restreint, actif. */
  statutConnect: () => api.get('/stripe/connect/statut'),

  /**
   * Definit le tarif mensuel.
   *
   * ATTENTION A L'UNITE, elle n'est pas symetrique :
   *   on ENVOIE des EUROS   (nombre entre 5 et 500, deux decimales au plus)
   *   on RELIT des CENTIMES (`coach.premium.prixMensuel`)
   * C'est le serveur qui convertit, pour ne transmettre a Stripe que des
   * entiers. Voir `utils/prix.js`.
   *
   * Les abonnes en cours conservent leur ancien prix : un tarif Stripe est
   * immuable, le serveur en cree un nouveau et archive le precedent.
   */
  definirTarif: (prixMensuel) => api.put('/stripe/premium/tarif', { prixMensuel }),

  /** Ouvre ou suspend les nouvelles souscriptions. */
  changerActivation: (actif) => api.patch('/stripe/premium/actif', { actif }),

  /** Revenus mensuels : brut, commission de la plateforme, net. */
  revenus: () => api.get('/stripe/premium/revenus'),
};

export default subscriptionApi;
