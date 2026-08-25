import dotenv from 'dotenv';

// Charge le fichier .env dans process.env.
// Appele ici, tout en haut de la chaine d'imports, pour que les variables
// soient disponibles dans tous les autres modules.
dotenv.config();

/**
 * Liste des variables sans lesquelles l'application ne peut pas demarrer.
 * On les valide au lancement plutot que de decouvrir l'oubli au premier appel
 * d'API : un serveur qui demarre a moitie configure est bien plus difficile a
 * diagnostiquer qu'un serveur qui refuse de demarrer avec un message clair.
 */
const VARIABLES_REQUISES = [
  'MONGO_URI',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
];

const manquantes = VARIABLES_REQUISES.filter((cle) => !process.env[cle]);

if (manquantes.length > 0) {
  console.error(
    '\n[CONFIG] Variables d\'environnement manquantes :\n  - ' +
      manquantes.join('\n  - ') +
      '\n\nCopiez server/.env.example vers server/.env puis renseignez-les.\n'
  );
  process.exit(1);
}

// Garde-fou : en production, refuser des secrets trop courts ou laisses
// a leur valeur d'exemple. Une cle JWT faible rend toute l'authentification
// contournable.
if (process.env.NODE_ENV === 'production') {
  const secretsFaibles = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'].filter(
    (cle) => process.env[cle].length < 32 || process.env[cle].startsWith('remplacer')
  );
  if (secretsFaibles.length > 0) {
    console.error(
      `[CONFIG] Secrets JWT trop faibles en production : ${secretsFaibles.join(', ')}`
    );
    process.exit(1);
  }
}

/**
 * Configuration centralisee.
 * Le reste du code importe cet objet plutot que de lire process.env
 * directement : une seule source de verite, des valeurs par defaut au meme
 * endroit, et des types deja convertis (nombres, tableaux).
 */
export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,

  // CORS accepte plusieurs origines separees par des virgules
  // (utile quand le front tourne en local ET sur un domaine de preproduction).
  clientUrls: (process.env.CLIENT_URL || 'http://localhost:5173')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean),

  mongoUri: process.env.MONGO_URI,

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
    refreshExpires: process.env.JWT_REFRESH_EXPIRES || '7d',
  },

  bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS) || 12,

  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    commissionPct: Number(process.env.STRIPE_COMMISSION_PCT) || 15,
  },
};

export const estProduction = config.env === 'production';
export const estDeveloppement = config.env === 'development';
