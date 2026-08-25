import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cloudinary, { cloudinaryConfigure } from '../config/cloudinary.js';
import { ApiError } from '../utils/ApiError.js';
import { lireDimensions } from '../utils/dimensionsImage.js';

/**
 * ===========================================================================
 *  SERVICE DE STOCKAGE DES MEDIAS
 * ===========================================================================
 *
 * DEUX IMPLEMENTATIONS DERRIERE UNE SEULE INTERFACE
 *
 *   Cloudinary    des que les trois cles sont presentes dans .env
 *   Disque local  sinon, en repli automatique
 *
 * POURQUOI CE REPLI ?
 * Le reste de l'application appelle `televerser()` et `supprimer()` sans
 * jamais savoir lequel des deux est actif. Concretement :
 *   - on developpe et on teste sans compte Cloudinary, hors ligne ;
 *   - passer en production revient a remplir trois variables d'environnement,
 *     sans toucher une ligne de code ;
 *   - une panne de Cloudinary n'empeche pas de faire tourner une demonstration.
 *
 * Cloudinary reste la cible reelle : le disque local ne survit pas a un
 * redeploiement sur un hebergeur a disque ephemere (Render, Railway), et
 * n'offre ni compression video, ni miniatures, ni diffusion par CDN.
 * ===========================================================================
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOSSIER_LOCAL = path.resolve(__dirname, '../../uploads');

/** Indique quelle implementation est active. Affiche au demarrage. */
export const modeStockage = cloudinaryConfigure ? 'cloudinary' : 'local';

/**
 * Correspondance type MIME -> extension.
 *
 * L'EXTENSION EST RECALCULEE ICI, JAMAIS LUE DANS LE NOM DU FICHIER ENVOYE.
 * Un client peut nommer son fichier « photo.jpg.exe » ou
 * « ../../../etc/passwd » : reconstruire l'extension a partir du type MIME
 * verifie coupe court a toute traversee de repertoire et a tout fichier
 * deguise.
 */
const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'application/pdf': 'pdf',
};

/** Deduit la categorie du media a partir du type MIME. */
export function categorieMedia(mimetype) {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  return 'raw'; // PDF (justificatifs de diplome)
}

/* ================================================================== *
 *  IMPLEMENTATION CLOUDINARY
 * ================================================================== */

function televerserCloudinary(fichier, dossier) {
  const categorie = categorieMedia(fichier.mimetype);

  return new Promise((resoudre, rejeter) => {
    // upload_stream accepte directement le tampon memoire de Multer :
    // aucun fichier temporaire n'est ecrit sur le disque du serveur.
    const flux = cloudinary.uploader.upload_stream(
      {
        folder: `sportsocial/${dossier}`,
        resource_type: categorie === 'raw' ? 'raw' : categorie,
        // Cloudinary genere son propre identifiant : le nom d'origine,
        // fourni par le client, n'est jamais utilise pour nommer le fichier.
        use_filename: false,
        unique_filename: true,
        overwrite: false,
      },
      (erreur, resultat) => {
        if (erreur) return rejeter(erreur);

        resoudre({
          url: resultat.secure_url,
          publicId: resultat.public_id,
          type: categorie === 'raw' ? 'image' : categorie,
          largeur: resultat.width,
          hauteur: resultat.height,
          duree: resultat.duration,
          format: resultat.format,
          taille: resultat.bytes,
        });
      }
    );

    flux.end(fichier.buffer);
  });
}

async function supprimerCloudinary(publicId, type = 'image') {
  await cloudinary.uploader.destroy(publicId, {
    resource_type: type === 'video' ? 'video' : 'image',

    /**
     * PURGE DU CACHE DU RESEAU DE DIFFUSION.
     *
     * Sans cette option, `destroy` retire le fichier du stockage Cloudinary
     * — l'API le declare aussitot introuvable — mais les nœuds du CDN
     * continuent de servir la copie qu'ils ont en cache. Verifie en test :
     * l'URL renvoyait encore 200 alors que la ressource n'existait plus.
     *
     * Pour un contenu premium, c'est un vrai probleme : quelqu'un ayant
     * releve l'URL pourrait continuer d'y acceder apres sa suppression.
     *
     * `invalidate: true` demande la purge des nœuds. Elle n'est pas
     * instantanee — Cloudinary annonce jusqu'a une heure de propagation —
     * mais c'est le seul levier disponible, et ne pas le demander revient
     * a laisser le contenu accessible indefiniment.
     */
    invalidate: true,
  });
}

/* ================================================================== *
 *  IMPLEMENTATION DISQUE LOCAL
 * ================================================================== */

async function televerserLocal(fichier, dossier) {
  const cible = path.join(DOSSIER_LOCAL, dossier);
  await mkdir(cible, { recursive: true });

  // Nom aleatoire de 16 octets + extension deduite du type MIME.
  // Deux fichiers ne peuvent pas se telescoper, et aucun caractere venu
  // du client ne se retrouve dans un chemin du systeme de fichiers.
  const extension = EXTENSIONS[fichier.mimetype] || 'bin';
  const nom = `${randomBytes(16).toString('hex')}.${extension}`;

  await writeFile(path.join(cible, nom), fichier.buffer);

  const categorie = categorieMedia(fichier.mimetype);

  /**
   * Dimensions lues directement dans les premiers octets du fichier.
   *
   * Sans elles, le front ne peut pas reserver la place de l'image avant son
   * chargement et retombe sur un carre : une photo en paysage se retrouve
   * recadree. Cloudinary les fournit spontanement ; en local, on les extrait.
   *
   * Renvoie un objet vide pour les videos et les PDF — l'appelant retombe
   * alors sur son comportement par defaut.
   */
  const { largeur, hauteur } =
    categorie === 'image' ? lireDimensions(fichier.buffer) : {};

  return {
    // URL relative servie par Express (voir app.js), relayee par le proxy
    // Vite en developpement.
    url: `/uploads/${dossier}/${nom}`,
    publicId: `${dossier}/${nom}`,
    type: categorie === 'raw' ? 'image' : categorie,
    largeur,
    hauteur,
    // La duree d'une video demanderait un vrai decodeur : on la laisse a
    // Cloudinary, qui la calcule au televersement.
    duree: undefined,
    format: extension,
    taille: fichier.size,
  };
}

async function supprimerLocal(publicId) {
  const chemin = path.join(DOSSIER_LOCAL, publicId);

  // Garde-fou contre la traversee de repertoire : meme si un publicId
  // corrompu arrivait jusqu'ici, on refuse de supprimer hors du dossier
  // d'uploads.
  if (!chemin.startsWith(DOSSIER_LOCAL)) {
    throw ApiError.internal('Chemin de suppression invalide');
  }

  await unlink(chemin).catch(() => {
    // Fichier deja absent : ce n'est pas une erreur. L'objectif — qu'il
    // n'existe plus — est atteint.
  });
}

/* ================================================================== *
 *  INTERFACE PUBLIQUE
 * ================================================================== */

/**
 * Televerse un fichier et renvoie ses metadonnees normalisees.
 *
 * @param {object} fichier - objet Multer (buffer, mimetype, size)
 * @param {string} dossier - sous-dossier logique : posts, stories, avatars...
 */
export async function televerser(fichier, dossier = 'divers') {
  if (!fichier?.buffer) {
    throw ApiError.badRequest('Fichier invalide ou vide');
  }

  try {
    return cloudinaryConfigure
      ? await televerserCloudinary(fichier, dossier)
      : await televerserLocal(fichier, dossier);
  } catch (erreur) {
    console.error('[STOCKAGE] Echec du téléversement :', erreur.message);
    throw ApiError.internal('Le téléversement du fichier a echoue');
  }
}

/** Televerse plusieurs fichiers en parallele. */
export async function televerserPlusieurs(fichiers, dossier) {
  return Promise.all(fichiers.map((f) => televerser(f, dossier)));
}

/**
 * Supprime un fichier.
 *
 * N'echoue JAMAIS de maniere bloquante : si l'effacement du media rate, on
 * ne veut pas empecher la suppression du post lui-meme. Un fichier orphelin
 * est un desagrement ; un post que l'utilisateur ne parvient pas a effacer
 * est un vrai probleme. Les echecs sont journalises pour le script de
 * nettoyage.
 */
export async function supprimer(publicId, type = 'image') {
  if (!publicId) return;

  try {
    if (cloudinaryConfigure) await supprimerCloudinary(publicId, type);
    else await supprimerLocal(publicId);
  } catch (erreur) {
    console.error(`[STOCKAGE] Suppression impossible (${publicId}) :`, erreur.message);
  }
}

/** Supprime une liste de medias. */
export async function supprimerPlusieurs(medias = []) {
  await Promise.all(medias.map((m) => supprimer(m.publicId, m.type)));
}

export { DOSSIER_LOCAL };
