import { ApiError } from '../utils/ApiError.js';

/**
 * Restreint une route a certains types de comptes.
 * S'utilise TOUJOURS apres `protect`, qui a renseigne req.user.
 *
 *   router.post('/events', protect, autoriser('coach'), creerEvenement);
 *   router.get('/admin/diplomes', protect, autoriser('admin'), listerDiplomes);
 */
export function autoriser(...typesAutorises) {
  return (req, res, next) => {
    // Garde-fou de developpement : signale un oubli de `protect` en amont,
    // qui laisserait la route ouverte a tous.
    if (!req.user) {
      return next(ApiError.internal('autoriser() utilise sans protect() en amont'));
    }

    if (!typesAutorises.includes(req.user.type)) {
      return next(
        ApiError.forbidden(
          `Action réservée aux comptes de type : ${typesAutorises.join(', ')}`
        )
      );
    }

    next();
  };
}

/**
 * Reserve une route aux coachs dont le diplome a ete verifie par un
 * administrateur.
 *
 * C'est la garantie centrale du projet : un coach non certifie peut exister
 * et publier du contenu gratuit, mais il ne peut ni afficher le badge, ni
 * organiser d'evenement, ni vendre quoi que ce soit.
 */
export function coachCertifie(req, res, next) {
  if (!req.user) {
    return next(ApiError.internal('coachCertifie() utilise sans protect() en amont'));
  }

  if (req.user.type !== 'coach') {
    return next(ApiError.forbidden('Action réservée aux coachs'));
  }

  if (req.user.diplome?.statut !== 'verifie') {
    const messages = {
      non_soumis: 'Vous devez d’abord soumettre votre diplôme',
      en_attente: 'Votre diplôme est en cours de vérification',
      refuse: 'Votre diplôme a été refusé : ' + (req.user.diplome?.motifRefus || 'motif non precise'),
    };
    return next(
      ApiError.forbidden(messages[req.user.diplome?.statut] || 'Diplôme non vérifié')
    );
  }

  next();
}

/**
 * Reserve une route aux coachs en capacite de vendre.
 * Verifie les trois conditions cumulatives : diplome verifie, compte Stripe
 * Connect autorise a encaisser, et tarif publie.
 *
 * Utilise au module 7 pour la publication de contenu premium.
 */
export function peutMonetiser(req, res, next) {
  if (!req.user) {
    return next(ApiError.internal('peutMonetiser() utilise sans protect() en amont'));
  }

  if (!req.user.peutMonetiser) {
    if (req.user.diplome?.statut !== 'verifie') {
      return next(ApiError.forbidden('Votre diplôme doit être vérifié'));
    }
    if (!req.user.stripeAccount?.chargesEnabled) {
      return next(ApiError.forbidden('Finalisez votre inscription Stripe pour encaisser des paiements'));
    }
    return next(ApiError.forbidden('Definissez le tarif de votre abonnement premium'));
  }

  next();
}

/**
 * Autorise soit le proprietaire de la ressource, soit un administrateur.
 *
 * @param {Function} extraireProprietaire - recoit req, renvoie l'identifiant
 *        du proprietaire (souvent req.params.id ou ressource.auteur)
 */
export function proprietaireOuAdmin(extraireProprietaire) {
  return (req, res, next) => {
    if (!req.user) {
      return next(ApiError.internal('proprietaireOuAdmin() utilise sans protect() en amont'));
    }

    if (req.user.type === 'admin') return next();

    const idProprietaire = String(extraireProprietaire(req));
    if (idProprietaire !== req.user._id.toString()) {
      return next(ApiError.forbidden('Vous ne pouvez modifier que vos propres contenus'));
    }

    next();
  };
}
