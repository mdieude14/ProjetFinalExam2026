import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { lirePagination, reponsePaginee } from '../utils/pagination.js';

/**
 * ===========================================================================
 *  BACK-OFFICE DE MODERATION
 * ===========================================================================
 * Toutes les routes de ce controleur sont protegees par `autoriser('admin')`
 * applique au ROUTEUR ENTIER, et non route par route. Ajouter un endpoint ici
 * ne peut donc pas laisser une porte ouverte par oubli.
 *
 * L'enjeu depasse le confort : c'est l'administrateur qui decide quels coachs
 * peuvent afficher le badge « certifie » et, par voie de consequence, vendre
 * des abonnements. Un acces non controle a ces routes reviendrait a laisser
 * n'importe qui s'auto-certifier.
 * ===========================================================================
 */

/* ================================================================== *
 *  GET /api/admin/diplomes
 * ================================================================== */

/**
 * File d'attente de verification.
 *
 * Par defaut, les dossiers « en_attente », tries du plus ancien au plus
 * recent : un coach qui attend depuis trois jours passe avant celui qui
 * vient de soumettre. Le tri par date decroissante, plus habituel, serait
 * ici injuste.
 */
export const listerDiplomes = asyncHandler(async (req, res) => {
  const { page, limite, saut } = lirePagination(req);
  const statut = req.query.statut || 'en_attente';

  const filtre = { type: 'coach', 'diplome.statut': statut };

  // Les deux requetes sont independantes : les lancer en parallele divise
  // par deux le temps de reponse.
  const [coachs, total] = await Promise.all([
    User.find(filtre)
      .sort({ 'diplome.dateSoumission': 1 })
      .skip(saut)
      .limit(limite)
      .populate('diplome.verifiePar', 'pseudo nom prenom'),
    User.countDocuments(filtre),
  ]);

  return res.json(
    reponsePaginee(
      coachs.map((coach) => coach.versionAdmin()),
      total,
      { page, limite }
    )
  );
});

/* ================================================================== *
 *  PATCH /api/admin/diplomes/:id
 * ================================================================== */

/**
 * Verification ou refus d'un diplome.
 *
 * TRACABILITE : on enregistre QUI a decide et QUAND. Sur une plateforme ou
 * la certification conditionne l'acces a la monetisation, une decision
 * anonyme serait inacceptable — en cas de contestation, il faut pouvoir
 * remonter au moderateur.
 *
 * Un refus s'accompagne obligatoirement d'un motif (impose par le
 * validateur), et laisse le coach libre de soumettre a nouveau.
 */
export const deciderDiplome = asyncHandler(async (req, res) => {
  const { decision, motifRefus } = req.body;

  const coach = await User.findById(req.params.id);

  if (!coach) throw ApiError.notFound('Utilisateur introuvable');
  if (coach.type !== 'coach') {
    throw ApiError.badRequest('Cet utilisateur n’est pas un coach');
  }
  if (coach.diplome?.statut !== 'en_attente') {
    throw ApiError.conflict(
      `Ce dossier n’est pas en attente de vérification (statut : ${coach.diplome?.statut})`
    );
  }

  coach.diplome.statut = decision;
  coach.diplome.dateVerification = new Date();
  coach.diplome.verifiePar = req.user._id;
  coach.diplome.motifRefus = decision === 'refuse' ? motifRefus : undefined;

  await coach.save();

  // A brancher au module 12 : notifier le coach de la decision.
  // Un refus dont il n'est pas informe le laisserait attendre indefiniment.

  return res.json({
    succes: true,
    message:
      decision === 'verifie'
        ? `${coach.pseudo} est désormais coach certifié`
        : `Le diplôme de ${coach.pseudo} a été refusé`,
    coach: coach.versionAdmin(),
  });
});

/* ================================================================== *
 *  PATCH /api/admin/users/:id/statut
 * ================================================================== */

/**
 * Activation ou desactivation d'un compte.
 *
 * La desactivation revoque immediatement toutes les sessions ouvertes en
 * incrementant refreshTokenVersion : sans cela, un compte suspendu resterait
 * utilisable jusqu'a l'expiration de son access token.
 */
export const changerStatutCompte = asyncHandler(async (req, res) => {
  const { isActive } = req.body;

  // Un administrateur ne peut pas se desactiver lui-meme : la plateforme
  // pourrait se retrouver sans aucun moderateur actif.
  if (String(req.params.id) === req.user._id.toString()) {
    throw ApiError.badRequest('Vous ne pouvez pas modifier votre propre statut');
  }

  const cible = await User.findById(req.params.id);
  if (!cible) throw ApiError.notFound('Utilisateur introuvable');

  cible.isActive = isActive;
  if (!isActive) cible.refreshTokenVersion += 1; // coupe les sessions en cours
  await cible.save();

  return res.json({
    succes: true,
    message: isActive
      ? `Le compte de ${cible.pseudo} a été reactive`
      : `Le compte de ${cible.pseudo} a été désactivé`,
    utilisateur: cible.versionAdmin(),
  });
});

/* ================================================================== *
 *  GET /api/admin/stats
 * ================================================================== */

/**
 * Indicateurs de la plateforme pour le tableau de bord.
 *
 * Toutes les requetes sont lancees en parallele : elles ne dependent pas les
 * unes des autres, les enchainer multiplierait le temps de reponse par sept.
 */
export const statistiques = asyncHandler(async (req, res) => {
  const [
    utilisateurs,
    coachs,
    coachsCertifies,
    diplomesEnAttente,
    diplomesRefuses,
    comptesDesactives,
    inscriptions7j,
  ] = await Promise.all([
    User.countDocuments({ type: 'utilisateur' }),
    User.countDocuments({ type: 'coach' }),
    User.countDocuments({ type: 'coach', 'diplome.statut': 'verifie' }),
    User.countDocuments({ type: 'coach', 'diplome.statut': 'en_attente' }),
    User.countDocuments({ type: 'coach', 'diplome.statut': 'refuse' }),
    User.countDocuments({ isActive: false }),
    User.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    }),
  ]);

  return res.json({
    succes: true,
    stats: {
      utilisateurs,
      coachs,
      coachsCertifies,
      diplomesEnAttente,
      diplomesRefuses,
      comptesDesactives,
      inscriptions7j,
      total: utilisateurs + coachs,
    },
  });
});
