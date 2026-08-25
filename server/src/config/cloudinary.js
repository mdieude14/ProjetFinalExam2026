import { v2 as cloudinary } from 'cloudinary';
import { config } from './env.js';

/**
 * Configuration du SDK Cloudinary.
 *
 * Les trois cles sont facultatives au demarrage : tant qu'elles ne sont pas
 * renseignees, le service de stockage bascule automatiquement sur le disque
 * local (voir services/storage.service.js). Le developpement et les tests
 * fonctionnent donc sans compte Cloudinary.
 *
 * `secure: true` force les URL en https. Sans cette option, Cloudinary
 * renvoie des URL en http, et un navigateur affichant une page https
 * bloquerait le chargement pour cause de contenu mixte.
 */
const cle = config.cloudinary;

export const cloudinaryConfigure = Boolean(
  cle.cloudName && cle.apiKey && cle.apiSecret
);

if (cloudinaryConfigure) {
  cloudinary.config({
    cloud_name: cle.cloudName,
    api_key: cle.apiKey,
    api_secret: cle.apiSecret,
    secure: true,
  });
}

/**
 * Verifie que les identifiants sont valides en interrogeant l'API.
 * Appele au demarrage du serveur : mieux vaut decouvrir une cle erronee
 * au lancement qu'au premier televersement d'un utilisateur.
 */
export async function verifierCloudinary() {
  if (!cloudinaryConfigure) return false;
  try {
    await cloudinary.api.ping();
    return true;
  } catch (erreur) {
    console.error('[CLOUDINARY] Identifiants refuses :', erreur.message);
    return false;
  }
}

export default cloudinary;
