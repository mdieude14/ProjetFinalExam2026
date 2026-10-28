import mongoose from 'mongoose';
import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { construireVueProfil, peutVoirProfil } from '../services/access.service.js';
import { etatModeration } from '../services/moderation.service.js';
import { televerser, supprimer } from '../services/storage.service.js';
import { accepterDemandesEnAttente } from '../services/follow.service.js';
import { geocoderCommune } from '../services/geocodage.service.js';

/**
 * Champs modifiables par leur proprietaire.
 *
 * LISTE BLANCHE STRICTE. Le controleur d'edition ne recopie que ces cles.
 * Sont donc structurellement hors d'atteinte :
 *   type        -> pas d'auto-promotion en coach ou en admin
 *   email       -> changerait l'identifiant de connexion sans verification
 *   password    -> passe par PATCH /auth/password, qui exige l'ancien
 *   stats       -> un compteur de 50 000 abonnes s'obtiendrait en une requete
 *   diplome     -> seul un admin peut le passer a « verifie »
 *   stripe*     -> synchronise par les webhooks, jamais par le client
 *   isActive    -> reserve a la moderation
 */
const CHAMPS_MODIFIABLES = ['nom', 'prenom', 'pseudo', 'bio', 'ville', 'sports'];

/* ================================================================== *
 *  GET /api/users/me
 * ================================================================== */

/**
 * Profil complet du proprietaire, justificatif de diplome compris.
 * `protect` a deja charge et verifie l'utilisateur.
 */
export const monProfil = asyncHandler(async (req, res) => {
  return res.json({ succes: true, profil: req.user.versionPrivee() });
});

/* ================================================================== *
 *  GET /api/users/:identifiant
 * ================================================================== */

/**
 * Profil d'un utilisateur, par ObjectId OU par pseudo.
 *
 * POURQUOI ACCEPTER LES DEUX ?
 * Les URL lisibles (/profile/julie.sport) sont attendues sur un reseau
 * social : partageables, memorisables, meilleures pour le referencement.
 * Mais les liens internes disposent souvent deja de l'ObjectId. Accepter les
 * deux formes evite une requete de resolution supplementaire.
 *
 * La route est en `protectOptionnel` : un visiteur anonyme peut consulter un
 * profil public, et un visiteur connecte obtient en plus l'etat de sa
 * relation avec la personne.
 */
export const profilPublic = asyncHandler(async (req, res) => {
  const { identifiant } = req.params;

  // isValidObjectId distingue les deux formes. Un pseudo de 24 caracteres
  // hexadecimaux serait ambigu, mais le validateur de pseudo interdit
  // qu'il soit interprete a tort : on tente l'ObjectId en premier, et l'on
  // retombe sur le pseudo si rien n'est trouve.
  const critere = mongoose.isValidObjectId(identifiant)
    ? { _id: identifiant }
    : { pseudo: String(identifiant).toLowerCase() };

  const cible = await User.findOne(critere);

  if (!cible || !peutVoirProfil(req.user, cible)) {
    // Meme reponse dans les deux cas : un compte desactive ne doit pas etre
    // distinguable d'un compte inexistant, sinon la desactivation devient
    // une information publique.
    throw ApiError.notFound('Profil introuvable');
  }

  // Toute la decision d'affichage est prise par le service d'acces.
  const vue = await construireVueProfil(req.user, cible);

  /*
   * L'ETAT DE MODERATION VOYAGE AVEC LE PROFIL, et non par un appel separe.
   *
   * Le menu « ⋯ » doit savoir quoi proposer — « Bloquer » ou « Debloquer »,
   * « Restreindre » ou « Lever la restriction » — DES SON PREMIER AFFICHAGE.
   * Une seconde requete au moment du clic le ferait clignoter : on verrait
   * « Bloquer » une fraction de seconde sur un compte deja bloque, et le
   * risque serait de cliquer sur l'entree d'avant.
   *
   * Le service ne fait que DEUX requetes pour les trois etats, et elles ne
   * partent que pour un visiteur connecte regardant quelqu'un d'autre.
   */
  const moderation =
    req.user && vue.relation !== 'soi'
      ? await etatModeration(req.user, cible._id)
      : { bloque: false, restreint: false, aSignale: false };

  return res.json({
    succes: true,
    profil: vue.profil,
    relation: vue.relation,
    contenuVisible: vue.contenuVisible,
    estPriveNonAccessible: vue.estPriveNonAccessible,

    /*
     * DEUX INFORMATIONS DISTINCTES, ET IL FAUT LES DEUX.
     *
     * `estBloque` est SYMETRIQUE : il vaut vrai que j'aie bloque l'autre ou
     * qu'il m'ait bloque. C'est ce qui commande l'ecran — pas de bouton
     * « Suivre », pas de contenu.
     *
     * `moderation.bloque` est ORIENTE : il ne vaut vrai que si c'est MOI qui
     * ai bloque. C'est ce qui commande le menu, car je ne peux debloquer que
     * ce que j'ai bloque. Les confondre afficherait « Debloquer » a quelqu'un
     * qui vient de se faire bloquer, et le bouton n'aurait aucun effet.
     */
    estBloque: vue.estBloque,
    moderation,
  });
});

/* ================================================================== *
 *  PATCH /api/users/me
 * ================================================================== */

/**
 * Edition du profil.
 *
 * La boucle sur CHAMPS_MODIFIABLES est le coeur de la protection : tout
 * champ absent de la liste est ignore, quelle que soit son apparence dans
 * le corps de la requete.
 */
export const modifierProfil = asyncHandler(async (req, res) => {
  const utilisateur = await User.findById(req.user._id);
  if (!utilisateur) throw ApiError.notFound('Compte introuvable');

  const champsRecopies = [];
  for (const champ of CHAMPS_MODIFIABLES) {
    if (req.body[champ] !== undefined) {
      utilisateur[champ] = req.body[champ];
      champsRecopies.push(champ);
    }
  }

  if (champsRecopies.length === 0) {
    throw ApiError.badRequest('Aucun champ modifiable fourni');
  }

  // save() plutot que findByIdAndUpdate : declenche les validateurs du schema
  // ET le hook pre-save. Ici le mot de passe n'est pas modifie, donc le hook
  // de hachage ne fait rien — mais compter dessus reste le comportement sur.
  await utilisateur.save();

  return res.json({
    succes: true,
    message: 'Profil mis a jour',
    champsModifies: champsRecopies,
    profil: utilisateur.versionPrivee(),
  });
});

/* ================================================================== *
 *  PATCH /api/users/me/visibilite
 * ================================================================== */

/**
 * Bascule public / prive.
 *
 * CHOIX DE CONCEPTION : passer en prive NE ROMPT PAS les relations de suivi
 * existantes. Les personnes qui suivaient deja conservent leur acces ; seules
 * les nouvelles demandes devront etre approuvees. C'est le comportement
 * d'Instagram, et l'inverse serait brutal — on ne s'attend pas a perdre ses
 * abonnes en changeant un reglage de confidentialite.
 */
export const changerVisibilite = asyncHandler(async (req, res) => {
  const { visibilite } = req.body;
  const ancienne = req.user.visibilite;

  await User.updateOne({ _id: req.user._id }, { visibilite });

  /**
   * PASSAGE DE PRIVE A PUBLIC : les demandes en attente sont acceptees.
   *
   * Elles n'ont plus d'objet — n'importe qui peut desormais voir le contenu.
   * Les laisser en attente afficherait une pastille de notification que rien
   * ne permettrait de traiter utilement, et obligerait l'utilisateur a
   * valider une par une des demandes deja sans effet.
   */
  let acceptees = 0;
  if (ancienne === 'prive' && visibilite === 'public') {
    const resultat = await accepterDemandesEnAttente(req.user._id);
    acceptees = resultat.acceptees;
  }

  const messages = {
    prive:
      'Votre profil est désormais privé : les nouvelles demandes devront être approuvees',
    public:
      acceptees > 0
        ? `Votre profil est desormais public. ${acceptees} demande${
            acceptees > 1 ? 's' : ''
          } en attente ${acceptees > 1 ? 'ont' : 'a'} ete acceptee${
            acceptees > 1 ? 's' : ''
          } automatiquement.`
        : 'Votre profil est désormais public',
  };

  return res.json({
    succes: true,
    message: messages[visibilite],
    visibilite,
    demandesAcceptees: acceptees,
  });
});

/* ================================================================== *
 *  PATCH /api/users/me/localisation
 * ================================================================== */

/**
 * Mise a jour de la position.
 *
 * RAPPEL : l'API de geolocalisation du navigateur expose `coords.latitude`
 * puis `coords.longitude`, tandis que GeoJSON attend l'ordre inverse. Le
 * front effectue la conversion et envoie deja [longitude, latitude] ; les
 * bornes sont revalidees ici et dans le schema.
 */
export const changerLocalisation = asyncHandler(async (req, res) => {
  const { coordinates, ville } = req.body;

  const maj = {
    localisation: { type: 'Point', coordinates: coordinates.map(Number) },
    /*
     * LA PROVENANCE EST ÉCRITE ICI AUSSI, pas seulement sur le chemin de la
     * ville. Sans cette ligne, un coach ayant une fois géocodé sa ville
     * resterait marqué `'ville'` après avoir relevé sa vraie position, et la
     * carte publique lui serait refusée pour un point qu'il a pourtant relevé.
     */
    localisationSource: 'navigateur',
  };
  if (ville) maj.ville = ville;

  await User.updateOne({ _id: req.user._id }, maj);

  return res.json({
    succes: true,
    message: 'Position enregistree',
    localisation: maj.localisation,
    ville: ville || req.user.ville,
  });
});

/* ================================================================== *
 *  PATCH /api/users/me/localisation-depuis-ville
 * ================================================================== */

/**
 * Déduit la position de la VILLE DU PROFIL, sans aucune coordonnée du client.
 *
 * POURQUOI UNE ROUTE À PART, et non `coordinates` rendu facultatif sur
 * `/me/localisation`. Les deux portent deux modèles de consentement
 * différents : là, la personne a autorisé son navigateur à donner sa position
 * exacte ; ici, elle accepte d'être située à sa ville, et rien de plus. Les
 * mélanger dans un seul point d'entrée obligerait à affaiblir le validateur
 * de l'autre — qui est précisément ce qui garantit qu'une coordonnée reçue a
 * bien été fournie.
 *
 * CE QU'ELLE CORRIGE. L'onglet « Autour de moi » restait vide pour qui refuse
 * la géolocalisation du navigateur, sans rien proposer d'autre. Un refus est
 * un choix légitime, pas une panne : l'écran doit offrir une sortie.
 *
 * LES DEUX ÉCHECS SONT EXPLICITES, et c'est le point. `geocoder()` rend
 * `null` sur une ville introuvable comme sur une panne de Nominatim : le
 * traduire en `422` avec un message, plutôt qu'en succès vide, évite de
 * reproduire ici le défaut qu'on est en train de corriger — un écran vide
 * sans raison affichée.
 */
export const localiserDepuisVille = asyncHandler(async (req, res) => {
  const ville = String(req.user.ville ?? '').trim();

  if (!ville) {
    throw ApiError.badRequest(
      'Renseignez la ville de votre profil pour pouvoir l’utiliser ici'
    );
  }

  const { point: localisation, ambigu } = await geocoderCommune(ville);

  /*
   * L'HOMONYME EST REFUSÉ, PAS ARBITRÉ. « Castres » seul désigne deux communes
   * à 691 km l'une de l'autre, et rien dans le profil ne dit laquelle : le
   * champ `ville` est le seul que `User` porte. Choisir à la place de la
   * personne remplirait « Autour de moi » d'événements plausibles et faux,
   * sans rien signaler.
   *
   * 409 ET NON 422 : la demande n'est pas intraitable, elle est AMBIGUË. Et le
   * message donne la sortie exacte, à la portée de la personne — préciser sa
   * ville dans son profil, sans qu'aucun champ nouveau soit nécessaire.
   */
  if (ambigu) {
    throw ApiError.conflict(
      `Plusieurs communes s’appellent « ${ville} ». Précisez-la dans votre profil ` +
        `en y ajoutant le code postal, par exemple « ${ville} 81100 ».`
    );
  }

  if (!localisation) {
    throw ApiError.unprocessable(
      `Nous n’avons pas pu situer « ${ville} ». Vérifiez l’orthographe dans votre profil.`
    );
  }

  await User.updateOne(
    { _id: req.user._id },
    { localisation, localisationSource: 'ville' }
  );

  return res.json({
    succes: true,
    message: `Position déduite de « ${ville} »`,
    localisation,
    ville,
    /*
     * LA PRÉCISION EST ANNONCÉE AU CLIENT. L'écran doit pouvoir dire « autour
     * de <ville> » et non « autour de vous » : laisser croire à un relevé
     * exact ferait passer un rayon de 5 km pour un rayon de 5 km... depuis le
     * mauvais point de départ.
     */
    source: 'ville',
  });
});

/* ================================================================== *
 *  POST /api/users/me/diplome
 * ================================================================== */

/**
 * Soumission ou re-soumission d'un diplome pour verification.
 *
 * Un diplome deja verifie ne peut pas etre resoumis : ce serait le moyen le
 * plus simple de faire valider un document, puis de le remplacer par un
 * autre. Une modification apres certification devra passer par un admin.
 */
export const soumettreDiplome = asyncHandler(async (req, res) => {
  const { intitule, organisme } = req.body;
  const utilisateur = await User.findById(req.user._id);

  if (utilisateur.diplome?.statut === 'verifie') {
    throw ApiError.conflict(
      'Votre diplôme est déjà vérifié. Contactez le support pour le modifier.'
    );
  }

  if (utilisateur.diplome?.statut === 'en_attente') {
    throw ApiError.conflict('Une vérification est déjà en cours');
  }

  utilisateur.diplome = {
    intitule,
    organisme,
    statut: 'en_attente',
    dateSoumission: new Date(),
    // Le motif du refus precedent est efface : il ne concerne plus
    // le dossier en cours.
    motifRefus: undefined,
    // Le justificatif (PDF ou image) sera rattache au module 5,
    // une fois le televersement Cloudinary en place.
    url: utilisateur.diplome?.url,
    publicId: utilisateur.diplome?.publicId,
  };

  await utilisateur.save();

  return res.status(201).json({
    succes: true,
    message: 'Diplôme soumis. Un administrateur le verifiera prochainement.',
    diplome: utilisateur.versionPrivee().diplome,
  });
});

/* ================================================================== *
 *  PATCH /api/users/me/avatar
 * ================================================================== */

/**
 * Photo de profil.
 *
 * L'ANCIENNE IMAGE EST SUPPRIMEE DU STOCKAGE. Sans cela, chaque changement
 * d'avatar laisserait un fichier inaccessible mais toujours facture : un
 * utilisateur qui change dix fois de photo consommerait dix fois le quota
 * pour une seule image visible.
 *
 * L'ordre est important : on televerse la nouvelle image AVANT d'effacer
 * l'ancienne. Si le televersement echoue, l'utilisateur conserve sa photo
 * actuelle plutot que de se retrouver sans rien.
 */
export const changerAvatar = asyncHandler(async (req, res) => {
  const utilisateur = await User.findById(req.user._id);
  const ancienAvatar = utilisateur.avatar;

  const media = await televerser(req.file, 'avatars');

  utilisateur.avatar = { url: media.url, publicId: media.publicId };
  await utilisateur.save();

  if (ancienAvatar?.publicId) {
    await supprimer(ancienAvatar.publicId, 'image');
  }

  return res.json({
    succes: true,
    message: 'Photo de profil mise a jour',
    avatar: utilisateur.avatar,
  });
});

/* ================================================================== *
 *  POST /api/users/me/diplome/justificatif
 * ================================================================== */

/**
 * Televersement du justificatif de diplome (image ou PDF).
 *
 * Complete la dependance laissee ouverte au module 4 : le coach pouvait
 * declarer son diplome, mais pas fournir de preuve, ce qui rendait la
 * verification par l'administrateur purement declarative.
 *
 * Le fichier n'est jamais expose publiquement : `versionPublique()` omet
 * `diplome.url`, que seuls le proprietaire et l'administrateur recoivent.
 */
export const televerserJustificatif = asyncHandler(async (req, res) => {
  const utilisateur = await User.findById(req.user._id);

  if (utilisateur.diplome?.statut === 'verifie') {
    throw ApiError.conflict(
      'Votre diplôme est déjà vérifié. Contactez le support pour le modifier.'
    );
  }

  const ancien = { url: utilisateur.diplome?.url, publicId: utilisateur.diplome?.publicId };

  const media = await televerser(req.file, 'justificatifs');

  utilisateur.diplome.url = media.url;
  utilisateur.diplome.publicId = media.publicId;

  // Un nouveau justificatif remet le dossier en file d'attente : l'ancien
  // examen portait sur un autre document.
  if (utilisateur.diplome.statut !== 'en_attente') {
    utilisateur.diplome.statut = 'en_attente';
    utilisateur.diplome.dateSoumission = new Date();
    utilisateur.diplome.motifRefus = undefined;
  }

  await utilisateur.save();

  if (ancien.publicId) await supprimer(ancien.publicId, 'image');

  return res.json({
    succes: true,
    message: 'Justificatif téléversé. Votre dossier est en attente de vérification.',
    diplome: utilisateur.versionPrivee().diplome,
  });
});

/* ================================================================== *
 *  DELETE /api/users/me
 * ================================================================== */

/**
 * Desactivation du compte.
 *
 * ON NE SUPPRIME PAS LE DOCUMENT. Des posts, commentaires, messages et
 * inscriptions a des evenements le referencent par ObjectId : l'effacer
 * laisserait des references orphelines partout, et les conversations
 * afficheraient des expediteurs introuvables.
 *
 * La desactivation bloque la connexion (verifiee dans login et dans le
 * middleware protect) et rend le profil invisible. L'increment de
 * refreshTokenVersion coupe immediatement toutes les sessions ouvertes.
 */
export const desactiverCompte = asyncHandler(async (req, res) => {
  await User.updateOne(
    { _id: req.user._id },
    { isActive: false, $inc: { refreshTokenVersion: 1 } }
  );

  return res.json({
    succes: true,
    message: 'Compte désactivé. Contactez le support pour le reactiver.',
  });
});
