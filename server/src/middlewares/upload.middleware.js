import multer from 'multer';
import { ApiError } from '../utils/ApiError.js';

/**
 * ===========================================================================
 *  RECEPTION DES FICHIERS
 * ===========================================================================
 *
 * STOCKAGE EN MEMOIRE, PAS SUR DISQUE.
 * Multer peut ecrire directement dans un dossier temporaire. On prefere
 * garder le fichier en memoire :
 *   - aucun fichier a nettoyer si le televersement vers Cloudinary echoue ;
 *   - rien n'est jamais ecrit sur le disque du serveur a partir d'une
 *     donnee venue du client, ce qui elimine toute une famille d'attaques ;
 *   - le tampon part directement dans le flux d'upload.
 *
 * La contrepartie est la consommation memoire, bornee par les limites de
 * taille ci-dessous.
 * ===========================================================================
 */

/**
 * LISTE BLANCHE DES TYPES AUTORISES.
 *
 * Une liste blanche, jamais une liste noire : enumerer ce qui est interdit
 * laisse forcement passer ce a quoi l'on n'a pas pense.
 *
 * `image/svg+xml` est VOLONTAIREMENT ABSENT. Un SVG est un document XML qui
 * peut contenir du JavaScript ; servi depuis le domaine de l'application, il
 * s'executerait dans le contexte de la page. C'est un vecteur de XML classique
 * et souvent oublie, car « c'est juste une image ».
 */
const TYPES_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const TYPES_VIDEO = ['video/mp4', 'video/quicktime', 'video/webm'];
const TYPES_DOCUMENT = ['application/pdf'];

const MO = 1024 * 1024;
export const TAILLE_MAX_IMAGE = 10 * MO;
export const TAILLE_MAX_VIDEO = 100 * MO;
export const TAILLE_MAX_DOCUMENT = 10 * MO;

/**
 * Construit un filtre de type MIME.
 *
 * ATTENTION A LA PORTEE DE CETTE VERIFICATION : `mimetype` est declare par le
 * client et peut etre falsifie. Le filtre bloque les envois accidentels et
 * les tentatives naives, mais la garantie reelle vient d'ailleurs :
 *   - Cloudinary refuse un fichier dont le contenu ne correspond pas au type
 *     de ressource demande ;
 *   - en mode local, l'extension est recalculee depuis ce type MIME et le
 *     fichier est servi en tant que ressource statique, jamais execute.
 */
function filtre(typesAutorises, libelle) {
  return (req, fichier, callback) => {
    if (typesAutorises.includes(fichier.mimetype)) {
      return callback(null, true);
    }
    callback(
      ApiError.badRequest(
        `Format non accepte pour ${libelle}. Types autorises : ${typesAutorises
          .map((t) => t.split('/')[1])
          .join(', ')}`
      )
    );
  };
}

/* ================================================================== *
 *  MIDDLEWARES PRETS A L'EMPLOI
 * ================================================================== */

/**
 * Medias d'une publication : jusqu'a 10 fichiers, images ou videos.
 *
 * La limite de taille retenue est celle de la video, la plus haute des deux :
 * Multer applique une limite unique a l'ensemble des fichiers. Le controleur
 * affine ensuite, image par image, avec `verifierTaillesMedias`.
 */
export const uploadPostMedias = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: TAILLE_MAX_VIDEO,
    files: 10,
    // Borne le nombre de champs texte du formulaire : sans elle, un corps
    // multipart contenant des milliers de champs saturerait le parseur.
    fields: 20,
  },
  fileFilter: filtre([...TYPES_IMAGE, ...TYPES_VIDEO], 'une publication'),
}).array('medias', 10);

/** Media unique d'une story. */
export const uploadStoryMedia = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAILLE_MAX_VIDEO, files: 1, fields: 10 },
  fileFilter: filtre([...TYPES_IMAGE, ...TYPES_VIDEO], 'une story'),
}).single('media');

/** Photo de profil : image seule, pas de video. */
export const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAILLE_MAX_IMAGE, files: 1, fields: 5 },
  fileFilter: filtre(TYPES_IMAGE, 'un avatar'),
}).single('avatar');

/** Justificatif de diplome : image ou PDF. */
export const uploadJustificatif = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAILLE_MAX_DOCUMENT, files: 1, fields: 5 },
  fileFilter: filtre([...TYPES_IMAGE, ...TYPES_DOCUMENT], 'un justificatif'),
}).single('justificatif');

/* ================================================================== *
 *  VERIFICATION FINE DES TAILLES
 * ================================================================== */

/**
 * Applique la bonne limite selon la nature de chaque fichier.
 *
 * Multer ne connait qu'une limite globale. Sans ce controle, une image de
 * 80 Mo passerait, puisqu'elle reste sous le plafond video de 100 Mo — alors
 * qu'aucune photo legitime n'atteint cette taille.
 */
export function verifierTaillesMedias(req, res, next) {
  const fichiers = req.files || (req.file ? [req.file] : []);

  for (const fichier of fichiers) {
    const estVideo = fichier.mimetype.startsWith('video/');
    const limite = estVideo ? TAILLE_MAX_VIDEO : TAILLE_MAX_IMAGE;

    if (fichier.size > limite) {
      return next(
        ApiError.badRequest(
          `« ${fichier.originalname} » depasse la limite de ${Math.round(
            limite / MO
          )} Mo pour ${estVideo ? 'une video' : 'une image'}`
        )
      );
    }
  }

  next();
}

/**
 * Exige la presence d'au moins un fichier.
 * Multer ne signale pas l'absence de fichier : `req.files` vaut simplement
 * un tableau vide, et l'erreur n'apparaitrait qu'a la validation du schema,
 * avec un message bien moins clair.
 */
export function exigerFichier(req, res, next) {
  const aDesFichiers = (req.files?.length || 0) > 0 || Boolean(req.file);
  if (!aDesFichiers) {
    return next(ApiError.badRequest('Aucun fichier fourni'));
  }
  next();
}
