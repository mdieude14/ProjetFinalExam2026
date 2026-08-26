import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { lirePagination, reponsePaginee } from '../utils/pagination.js';

import SportEvent from '../models/SportEvent.js';
import EventRegistration from '../models/EventRegistration.js';
import * as eventService from '../services/event.service.js';
import * as storage from '../services/storage.service.js';
import { abonnementsPremiumActifs } from '../services/feed.service.js';

/* ================================================================== *
 *  OUTILS COMMUNS
 * ================================================================== */

/**
 * Le visiteur a-t-il accès aux détails d'un événement privé ?
 *
 * ON RÉUTILISE `abonnementsPremiumActifs()` DU MODULE 7, sans le dupliquer.
 * C'est le point unique qui décide de l'accès premium dans toute
 * l'application : y ajouter une seconde implémentation garantirait qu'un jour
 * les deux divergent, et qu'un contenu resterait ouvert d'un côté après avoir
 * été fermé de l'autre.
 */
async function accesPremiumSur(visiteur, idOrganisateur) {
  if (!visiteur) return false;
  if (String(visiteur._id) === String(idOrganisateur)) return true;
  if (visiteur.type === 'admin') return true;

  const abonnements = await abonnementsPremiumActifs(visiteur._id);
  return abonnements.has(String(idOrganisateur));
}

/** Charge un événement ou lève une 404. */
async function chargerEvenement(id, peupler = true) {
  const requete = SportEvent.findById(id);
  if (peupler) {
    requete.populate('organisateur', 'pseudo nom prenom avatar type diplome premium');
  }

  const evenement = await requete;
  if (!evenement) throw ApiError.notFound('Evenement introuvable');
  return evenement;
}

/* ================================================================== *
 *  POST /api/events
 * ================================================================== */

/**
 * Crée un événement.
 *
 * RÉSERVÉ AUX COACHS CERTIFIÉS — le middleware `coachCertifie` du module 2
 * s'en charge sur la route. Un événement rassemble des gens autour d'une
 * activité physique encadrée : c'est précisément ce que le diplôme atteste.
 *
 * L'affiche est téléversée AVANT l'écriture en base, comme pour les
 * publications du module 5 : si le stockage échoue, aucun événement fantôme
 * ne reste en base.
 */
export const creer = asyncHandler(async (req, res) => {
  const { titre, description, sport, type, dateDebut, dateFin, capaciteMax } = req.body;
  const lieuRecu = req.body.lieu || {};

  let image;
  if (req.file) {
    const televerse = await storage.televerser(req.file, 'evenements');
    image = {
      url: televerse.url,
      publicId: televerse.publicId,
      largeur: televerse.largeur,
      hauteur: televerse.hauteur,
    };
  }

  const lieu = {
    adresse: lieuRecu.adresse,
    ville: lieuRecu.ville,
    codePostal: lieuRecu.codePostal,
  };

  // Les coordonnées sont facultatives : un événement peut n'avoir qu'une
  // ville. On ne crée le point que si les DEUX valeurs sont là — le
  // validateur a déjà refusé qu'une seule soit fournie.
  if (lieuRecu.longitude !== undefined && lieuRecu.latitude !== undefined) {
    lieu.localisation = {
      type: 'Point',
      coordinates: [Number(lieuRecu.longitude), Number(lieuRecu.latitude)],
    };
  }

  try {
    const evenement = await SportEvent.create({
      organisateur: req.user._id,
      titre,
      description,
      sport,
      type: type || 'public',
      dateDebut,
      dateFin,
      lieu,
      capaciteMax: capaciteMax ?? null,
      image,
    });

    return res.status(201).json({
      succes: true,
      message: 'Evenement cree',
      evenement: evenement.versionPour(req.user, true),
    });
  } catch (erreur) {
    // Rattrapage : le fichier est déjà chez Cloudinary, l'écriture a échoué.
    // Sans ce nettoyage, chaque tentative ratée laisserait une image orpheline
    // que plus rien ne référence — donc impossible à retrouver.
    if (image?.publicId) await storage.supprimer(image.publicId, 'image');
    throw erreur;
  }
});

/* ================================================================== *
 *  GET /api/events
 * ================================================================== */

/** Événements à venir, filtrables. */
export const liste = asyncHandler(async (req, res) => {
  const { page, limite } = lirePagination(req);

  const { evenements, total } = await eventService.listeAVenir({
    ville: req.query.ville,
    sport: req.query.sport,
    type: req.query.type,
    page,
    limite,
  });

  /*
   * L'ACCÈS PREMIUM EST CALCULÉ UNE FOIS POUR TOUTE LA PAGE.
   * Un appel par événement multiplierait les requêtes par la taille de la
   * liste — vingt allers-retours en base pour afficher vingt cartes. On lit
   * l'ensemble des abonnements du visiteur une seule fois, puis on interroge
   * cet ensemble en mémoire.
   */
  const abonnements = await abonnementsPremiumActifs(req.user?._id);

  const elements = evenements.map((e) => {
    const idOrga = e.organisateur?._id || e.organisateur;
    const aAcces =
      Boolean(req.user) &&
      (String(req.user._id) === String(idOrga) ||
        req.user.type === 'admin' ||
        abonnements.has(String(idOrga)));

    return e.versionPour(req.user, aAcces);
  });

  return res.json(reponsePaginee(elements, total, { page, limite }));
});

/* ================================================================== *
 *  GET /api/events/proches
 * ================================================================== */

/** Événements autour d'un point, du plus proche au plus lointain. */
export const proches = asyncHandler(async (req, res) => {
  const { lng, lat, rayon, sport } = req.query;

  const trouves = await eventService.evenementsAutourDe({
    centre: [lng, lat],
    rayonM: rayon,
    sport,
  });

  const abonnements = await abonnementsPremiumActifs(req.user?._id);

  const elements = trouves.map(({ document, distanceM }) => {
    const idOrga = document.organisateur;
    const aAcces =
      Boolean(req.user) &&
      (String(req.user._id) === String(idOrga) ||
        req.user.type === 'admin' ||
        abonnements.has(String(idOrga)));

    return { ...document.versionPour(req.user, aAcces), distanceM };
  });

  return res.json({ succes: true, nombre: elements.length, evenements: elements });
});

/* ================================================================== *
 *  GET /api/events/mes-inscriptions
 * ================================================================== */

/** Mes inscriptions, la plus récente d'abord. */
export const mesInscriptions = asyncHandler(async (req, res) => {
  const { page, limite, saut } = lirePagination(req);

  const filtre = { utilisateur: req.user._id };
  // Les désistements restent consultables sur demande explicite : par
  // défaut, « mes inscriptions » désigne celles qui tiennent encore.
  if (!req.query.tout) filtre.statut = 'inscrit';

  const [inscriptions, total] = await Promise.all([
    EventRegistration.find(filtre)
      .sort({ createdAt: -1 })
      .skip(saut)
      .limit(limite)
      .populate({
        path: 'event',
        populate: { path: 'organisateur', select: 'pseudo nom prenom avatar type diplome' },
      }),
    EventRegistration.countDocuments(filtre),
  ]);

  const abonnements = await abonnementsPremiumActifs(req.user._id);

  const elements = inscriptions
    .filter((i) => i.event) // événement supprimé entre-temps
    .map((i) => {
      const idOrga = i.event.organisateur?._id || i.event.organisateur;
      const aAcces =
        String(req.user._id) === String(idOrga) ||
        req.user.type === 'admin' ||
        abonnements.has(String(idOrga));

      return {
        ...i.versionPublique(),
        event: i.event.versionPour(req.user, aAcces),
      };
    });

  return res.json(reponsePaginee(elements, total, { page, limite }));
});

/* ================================================================== *
 *  GET /api/events/:id
 * ================================================================== */

/** Détail d'un événement. La liste des participants est réservée. */
export const detail = asyncHandler(async (req, res) => {
  const evenement = await chargerEvenement(req.params.id);
  const idOrga = evenement.organisateur?._id || evenement.organisateur;

  const aAcces = await accesPremiumSur(req.user, idOrga);
  const estOrganisateur =
    req.user && String(req.user._id) === String(idOrga);

  const reponse = {
    succes: true,
    evenement: evenement.versionPour(req.user, aAcces),
  };

  // Mon propre statut d'inscription, pour que le bouton sache quoi afficher.
  if (req.user) {
    const mienne = await EventRegistration.findOne({
      event: evenement._id,
      utilisateur: req.user._id,
    });
    reponse.monInscription = mienne ? mienne.versionPublique() : null;
  }

  /*
   * LA LISTE DES PARTICIPANTS N'EST PAS PUBLIQUE.
   * Elle révèle qui pratique quoi, où et quand — une information qu'aucun
   * inscrit n'a accepté de rendre publique en s'inscrivant. Elle reste donc
   * réservée à l'organisateur, qui en a un besoin concret (préparer sa
   * séance), et à l'administration.
   */
  if (estOrganisateur || req.user?.type === 'admin') {
    const participants = await EventRegistration.find({
      event: evenement._id,
      statut: 'inscrit',
    })
      .sort({ createdAt: 1 })
      .populate('utilisateur', 'pseudo nom prenom avatar type ville');

    reponse.participants = participants
      .filter((p) => p.utilisateur)
      .map((p) => p.versionPublique());
  }

  return res.json(reponse);
});

/* ================================================================== *
 *  PATCH /api/events/:id
 * ================================================================== */

/** Modifie un événement. Organisateur ou administrateur uniquement. */
export const modifier = asyncHandler(async (req, res) => {
  const evenement = await chargerEvenement(req.params.id, false);

  const estProprietaire = String(evenement.organisateur) === String(req.user._id);
  if (!estProprietaire && req.user.type !== 'admin') {
    throw ApiError.forbidden('Vous ne pouvez modifier que vos propres événements');
  }

  if (evenement.statut === 'annule') {
    throw ApiError.conflict('Un événement annulé ne peut plus être modifié');
  }

  /*
   * LISTE BLANCHE DES CHAMPS MODIFIABLES.
   * Sans elle, un `Object.assign(evenement, req.body)` laisserait passer
   * `inscritsCount`, `organisateur` ou `statut` — de quoi s'attribuer
   * l'événement d'un autre, ou fabriquer des places qui n'existent pas.
   * Même précaution qu'au module 4 pour l'édition de profil.
   */
  const CHAMPS = ['titre', 'description', 'sport', 'type', 'dateDebut', 'dateFin'];
  for (const champ of CHAMPS) {
    if (req.body[champ] !== undefined) evenement[champ] = req.body[champ];
  }

  if (req.body.lieu) {
    evenement.lieu.adresse = req.body.lieu.adresse ?? evenement.lieu.adresse;
    evenement.lieu.ville = req.body.lieu.ville ?? evenement.lieu.ville;
    evenement.lieu.codePostal = req.body.lieu.codePostal ?? evenement.lieu.codePostal;
  }

  /*
   * ON REFUSE DE DESCENDRE LA CAPACITÉ SOUS LE NOMBRE D'INSCRITS.
   * L'accepter mettrait l'événement dans un état incohérent — douze inscrits
   * pour dix places — et poserait une question sans bonne réponse : lesquels
   * des douze perdent leur place ? On refuse plutôt que de choisir à la place
   * de l'organisateur.
   */
  if (req.body.capaciteMax !== undefined) {
    const nouvelle = req.body.capaciteMax;
    if (nouvelle !== null && nouvelle < evenement.inscritsCount) {
      throw ApiError.badRequest(
        `Impossible : ${evenement.inscritsCount} personnes sont déjà inscrites`
      );
    }
    evenement.capaciteMax = nouvelle;
  }

  await evenement.save();

  return res.json({
    succes: true,
    message: 'Evenement mis a jour',
    evenement: evenement.versionPour(req.user, true),
  });
});

/* ================================================================== *
 *  DELETE /api/events/:id
 * ================================================================== */

/**
 * Annule un événement.
 *
 * ANNULER, PAS SUPPRIMER — et ce n'est pas une nuance.
 * Les inscrits ont bloqué une date. Effacer l'événement le ferait disparaître
 * de leur liste sans la moindre explication : ils se présenteraient sur place,
 * ou resteraient avec un créneau réservé pour rien. L'événement demeure, son
 * statut passe à `annule`, et le motif est affiché.
 */
export const annuler = asyncHandler(async (req, res) => {
  const evenement = await chargerEvenement(req.params.id, false);

  const estProprietaire = String(evenement.organisateur) === String(req.user._id);
  if (!estProprietaire && req.user.type !== 'admin') {
    throw ApiError.forbidden('Vous ne pouvez annuler que vos propres événements');
  }

  if (evenement.statut === 'annule') {
    throw ApiError.conflict('Cet événement est déjà annulé');
  }

  evenement.statut = 'annule';
  evenement.motifAnnulation = req.body.motifAnnulation;
  await evenement.save();

  return res.json({
    succes: true,
    message: 'Evenement annule. Les inscrits en seront informes.',
    evenement: evenement.versionPour(req.user, true),
  });
});

/* ================================================================== *
 *  POST /api/events/:id/inscription
 * ================================================================== */

/**
 * S'inscrire.
 *
 * Tout le travail délicat — capacité, concurrence, retour après désistement —
 * est dans `event.service.js`. Ce contrôleur ne fait que traduire l'intention
 * en appel de service et vérifier l'accès à un événement privé.
 */
export const sInscrire = asyncHandler(async (req, res) => {
  const evenement = await chargerEvenement(req.params.id, false);

  /*
   * UN ÉVÉNEMENT PRIVÉ EXIGE UN ABONNEMENT PREMIUM.
   * Le contrôle est ici et pas dans le service : le service traite la
   * mécanique des places, le contrôleur traite le droit d'entrée. Les mêlant,
   * on ne saurait plus lequel des deux garantit quoi.
   */
  if (evenement.type === 'prive') {
    const aAcces = await accesPremiumSur(req.user, evenement.organisateur);
    if (!aAcces) {
      throw ApiError.forbidden(
        'Cet événement est réservé aux abonnés premium de ce coach'
      );
    }
  }

  const inscription = await eventService.inscrire(
    req.params.id,
    req.user,
    req.body.message
  );

  const aJour = await SportEvent.findById(req.params.id);

  return res.status(201).json({
    succes: true,
    message: 'Inscription confirmee',
    inscription: inscription.versionPublique(),
    placesRestantes: aJour.placesRestantes,
  });
});

/* ================================================================== *
 *  DELETE /api/events/:id/inscription
 * ================================================================== */

/** Se désinscrire, et libérer sa place. */
export const seDesinscrire = asyncHandler(async (req, res) => {
  await chargerEvenement(req.params.id, false);

  const inscription = await eventService.desinscrire(req.params.id, req.user);
  const aJour = await SportEvent.findById(req.params.id);

  return res.json({
    succes: true,
    message: 'Inscription annulee. Votre place a ete liberee.',
    inscription: inscription.versionPublique(),
    placesRestantes: aJour.placesRestantes,
  });
});
