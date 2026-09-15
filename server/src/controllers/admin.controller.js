import User from '../models/User.js';
import Signalement from '../models/Signalement.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { lirePagination, reponsePaginee } from '../utils/pagination.js';
import * as notifications from '../services/notification.service.js';

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

  /*
   * SANS EMETTEUR, et c'est le seul type dans ce cas : la decision vient de
   * l'administration, pas d'une personne dont on afficherait l'avatar. Le
   * champ `emetteur` est facultatif precisement pour cette situation.
   *
   * On notifie AUSSI un refus : un coach qui n'en est pas informe attendrait
   * indefiniment une reponse deja rendue.
   */
  await notifications.creer({
    destinataire: coach._id,
    type: 'diplome_verifie',
    cibleType: 'User',
    cible: coach._id,
  });

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
 *  GET /api/admin/signalements
 * ================================================================== */

/**
 * File des signalements deposes par les utilisateurs.
 *
 * LES PLUS ANCIENS D'ABORD, comme la file des diplomes et pour la meme
 * raison : un signalement qui attend depuis trois jours passe avant celui de
 * ce matin. Le tri decroissant, plus habituel, laisserait les dossiers les
 * plus vieux au fond — ceux-la memes qui posent probleme.
 *
 * LE MOTIF ET LES PRECISIONS SONT RENVOYES TELS QUELS. C'est tout l'objet du
 * signalement : sans eux, l'administration recevrait « quelqu'un a signale
 * quelqu'un » et devrait deviner quoi instruire.
 *
 * L'IDENTITE DU SIGNALEUR NE SORT QUE VERS L'ADMINISTRATION. Le routeur pose
 * `autoriser('admin')` sur tout ce fichier ; c'est ce qui autorise
 * `versionAdmin()` a l'inclure ici, alors qu'elle ne sort jamais ailleurs.
 */
export const listerSignalements = asyncHandler(async (req, res) => {
  const { page, limite, saut } = lirePagination(req);
  const statut = req.query.statut || 'ouvert';

  const [signalements, total] = await Promise.all([
    Signalement.find({ statut })
      .sort({ createdAt: 1 })
      .skip(saut)
      .limit(limite)
      .populate('signaleur', 'pseudo nom prenom avatar type')
      .populate('cible', 'pseudo nom prenom avatar type isActive')
      .populate('traitePar', 'pseudo nom prenom'),
    Signalement.countDocuments({ statut }),
  ]);

  return res.json(
    reponsePaginee(
      signalements.map((s) => s.versionAdmin()),
      total,
      { page, limite }
    )
  );
});

/* ================================================================== *
 *  PATCH /api/admin/signalements/:id
 * ================================================================== */

/**
 * Instruction d'un signalement : traite ou rejete.
 *
 * ON NE SUPPRIME PAS LE DOSSIER, ON LE CLASSE. Un compte signale trois fois
 * puis blanchi trois fois n'est pas le meme qu'un compte jamais signale, et
 * l'historique est ce qui permet de le voir. La suppression effacerait
 * justement le motif de vigilance.
 *
 * LE CLASSEMENT ROUVRE LA POSSIBILITE DE SIGNALER. L'index unique du modele
 * ne porte que sur les signalements `ouvert` : une fois celui-ci tranche,
 * la meme personne peut de nouveau alerter en cas de recidive.
 */
export const deciderSignalement = asyncHandler(async (req, res) => {
  const { decision, commentaire } = req.body;

  const signalement = await Signalement.findById(req.params.id);
  if (!signalement) throw ApiError.notFound('Signalement introuvable');

  if (signalement.statut !== 'ouvert') {
    throw ApiError.badRequest('Ce signalement a déjà été instruit');
  }

  signalement.statut = decision === 'traiter' ? 'traite' : 'rejete';
  signalement.traitePar = req.user._id;
  signalement.traiteLe = new Date();
  signalement.decision = commentaire;

  await signalement.save();

  await signalement.populate('signaleur', 'pseudo nom prenom avatar type');
  await signalement.populate('cible', 'pseudo nom prenom avatar type isActive');

  /*
   * PERSONNE N'EST NOTIFIE, NI LE SIGNALEUR NI LA CIBLE.
   *
   * Prevenir le signaleur revelerait que son alerte a abouti — utile en
   * apparence, mais cela transforme le signalement en arme mesurable : on
   * saurait quels motifs « marchent ». Prevenir la cible lui apprendrait
   * qu'elle a ete signalee, et par recoupement souvent par qui.
   *
   * Les mesures prises (desactivation du compte, refus de diplome) ont leurs
   * propres notifications, la ou elles se justifient.
   */

  return res.json({
    succes: true,
    message: signalement.statut === 'traite' ? 'Signalement traité' : 'Signalement rejeté',
    signalement: signalement.versionAdmin(),
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
    signalementsOuverts,
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
    // La pastille du back-office : combien de dossiers attendent d'etre lus.
    Signalement.countDocuments({ statut: 'ouvert' }),
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
      signalementsOuverts,
      total: utilisateurs + coachs,
    },
  });
});
