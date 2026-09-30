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

/*
 * EN PRODUCTION, L'ENVOI D'E-MAILS EST EXIGÉ. Sans lui, « mot de passe
 * oublié » répondrait normalement… et aucun e-mail ne partirait jamais : la
 * personne attendrait un lien qui n'arrivera pas. En développement, les
 * e-mails sont déposés localement (voir `services/mail.service.js`).
 */
if (process.env.NODE_ENV === 'production' && !(process.env.SMTP_USER && process.env.SMTP_PASS)) {
  console.error(
    '[CONFIG] SMTP_USER et SMTP_PASS sont requis en production : ' +
      'sans eux, les e-mails de réinitialisation du mot de passe ne partiraient pas.'
  );
  process.exit(1);
}

/*
 * Garde-fou du module 15 : LES DEUX CLÉS DU SUPPORT DOIVENT DIFFÉRER.
 *
 * La clé de relève ouvre la file des escalades ; la clé d'agent authentifie
 * ce que l'agent du widget écrit. Ce second agent est exposé à du contenu non
 * fiable — n'importe qui lui écrit. Une même valeur dans les deux variables
 * lui donnerait la file de l'exploitant, et annulerait la séparation des deux
 * zones de confiance. Copier une clé dans l'autre est l'erreur naturelle :
 * une recommandation ne suffit pas, on refuse de démarrer.
 */
if (
  process.env.SUPPORT_SERVICE_KEY &&
  process.env.SUPPORT_AGENT_KEY &&
  process.env.SUPPORT_SERVICE_KEY === process.env.SUPPORT_AGENT_KEY
) {
  console.error(
    '\n[CONFIG] SUPPORT_AGENT_KEY et SUPPORT_SERVICE_KEY ont la même valeur.\n' +
      'Elles protègent deux zones de confiance distinctes : générez-en une seconde.\n\n' +
      '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n'
  );
  process.exit(1);
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

  /**
   * Envoi d'e-mails — réinitialisation du mot de passe.
   *
   * VOLONTAIREMENT FACULTATIF en développement : sans identifiants SMTP, les
   * e-mails sont déposés dans `server/.boite-mails/` au lieu d'être envoyés
   * (voir `services/mail.service.js`). La fonction reste ainsi utilisable et
   * testable avant toute configuration. En production, ils sont exigés.
   */
  mail: {
    hote: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 465,
    // 465 = TLS dès la connexion ; 587 = STARTTLS. Gmail accepte les deux.
    securise: (process.env.SMTP_SECURE ?? 'true') === 'true',
    utilisateur: process.env.SMTP_USER,
    motDePasse: process.env.SMTP_PASS,
    expediteur: process.env.MAIL_FROM || process.env.SMTP_USER,
  },

  /**
   * Support automatisé (module 15).
   *
   * VOLONTAIREMENT FACULTATIVE. Absente, les deux routes de relève restent
   * fermées et le reste de l'application fonctionne sans changement — le
   * support automatisé est une couche en plus, pas une dépendance. Le
   * middleware `serviceAutorise` refuse alors tout appel, plutôt que
   * d'ouvrir la route : c'est l'erreur qu'il ne faut pas commettre.
   */
  support: {
    serviceKey: process.env.SUPPORT_SERVICE_KEY,
    // Facultative elle aussi : absente, aucun ticket ne peut porter de
    // réponse d'agent, et tous remontent à un humain.
    agentKey: process.env.SUPPORT_AGENT_KEY,
  },
};

export const estProduction = config.env === 'production';
export const estDeveloppement = config.env === 'development';
