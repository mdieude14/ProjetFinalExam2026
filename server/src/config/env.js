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
 * ===========================================================================
 *  L'ADRESSE PUBLIQUE DE L'APPLICATION, ET POURQUOI ELLE EST À PART
 * ===========================================================================
 *
 * `CLIENT_URL` servait DEUX choses qui n'en sont pas une :
 *
 *   - les ORIGINES AUTORISÉES à appeler l'API (CORS, Socket.io) — toute la liste ;
 *   - l'ADRESSE PUBLIQUE de l'application — et là, seulement la PREMIÈRE.
 *
 * Trois endroits lisaient `clientUrls[0]` : les URL de retour de Stripe Checkout,
 * le lien d'onboarding Connect, et **le lien des courriels de réinitialisation
 * de mot de passe**.
 *
 * LE PIÈGE ÉTAIT ARMÉ, mesuré le 27 octobre : `CLIENT_URL` contenait déjà
 * `http://localhost:5173,http://localhost:4173`. Ajouter le domaine de
 * production À LA FIN de cette liste — le geste naturel, puisqu'il s'agit
 * d'autoriser une origine de plus — aurait renvoyé les acheteurs sur
 * `localhost` après paiement, les coachs sur `localhost` après onboarding, et
 * surtout aurait fait partir de VRAIS courriels avec un lien mort.
 *
 * Rien n'aurait planté. Les trois auraient échoué chez l'utilisateur.
 *
 * D'OÙ UNE VARIABLE DÉDIÉE. `PUBLIC_URL` dit ce qu'elle nomme. En son absence,
 * on retombe sur la première origine : le comportement d'avant, à l'identique,
 * pour qu'aucune installation existante ne change.
 */
const origines = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);

const urlPublique =
  (process.env.PUBLIC_URL || '').trim() || origines[0] || 'http://localhost:5173';

/*
 * ET EN PRODUCTION, ON REFUSE DE DÉMARRER SUR UNE ADRESSE LOCALE.
 *
 * C'est le même raisonnement que les secrets JWT ci-dessus : un serveur qui
 * démarre à moitié configuré est plus difficile à diagnostiquer qu'un serveur
 * qui refuse de démarrer en disant quoi corriger. Ici, la panne serait pire que
 * silencieuse — elle serait INVISIBLE DEPUIS LE SERVEUR, puisque tout
 * fonctionne de son point de vue : c'est l'utilisateur qui reçoit le lien mort.
 */
if (process.env.NODE_ENV === 'production' && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(urlPublique)) {
  console.error(
    `\n[CONFIG] L'adresse publique vaut « ${urlPublique} » en production.\n\n` +
      '  Les retours de paiement Stripe, l’onboarding Connect et les liens des\n' +
      '  courriels de réinitialisation pointeraient vers cette adresse locale,\n' +
      '  chez l’utilisateur, sans qu’aucune erreur ne remonte au serveur.\n\n' +
      '  Renseignez PUBLIC_URL avec le domaine public de l’application,\n' +
      '  ou placez ce domaine EN PREMIER dans CLIENT_URL.\n'
  );
  process.exit(1);
}

/*
 * EN PRODUCTION, L'ENVOI D'E-MAILS EST EXIGÉ. Sans lui, « mot de passe
 * oublié » répondrait normalement… et aucun e-mail ne partirait jamais : la
 * personne attendrait un lien qui n'arrivera pas. En développement, les
 * e-mails sont déposés localement (voir `services/mail.service.js`).
 */
/*
 * DEUX FAÇONS DE S'AUTHENTIFIER, ET L'UNE SUFFIT.
 *
 * OAuth2 est la méthode recommandée par Google, et la seule qui reste ouverte :
 * la page des mots de passe d'application n'est pas disponible pour tous les
 * comptes — elle exige la validation en deux étapes, qu'une clé d'accès ne
 * remplace pas, et Google la ferme sur les comptes récents ou sous Protection
 * avancée. Le mot de passe d'application reste accepté pour ne pas casser une
 * installation qui en détient déjà un.
 *
 * LE MÊME CLIENT OAUTH SERT L'ASSISTANT DE MESSAGERIE (module 15) : un seul
 * mécanisme pour lire la boîte et pour en envoyer.
 */
const envoiParOAuth = Boolean(
  process.env.SMTP_USER &&
  process.env.GOOGLE_OAUTH_CLIENT_ID &&
  process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
  process.env.GOOGLE_OAUTH_REFRESH_TOKEN
);
const envoiParMotDePasse = Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);

if (process.env.NODE_ENV === 'production' && !envoiParOAuth && !envoiParMotDePasse) {
  console.error('[CONFIG] L’envoi d’e-mails n’est pas configuré, et il est REQUIS en production.');
  console.error('  OAuth2, recommandé : SMTP_USER + GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET + GOOGLE_OAUTH_REFRESH_TOKEN');
  console.error('  ou mot de passe d’application : SMTP_USER + SMTP_PASS');
  console.error('  Sans l’un des deux, « mot de passe oublié » répondrait normalement et aucun e-mail ne partirait jamais.');
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
  clientUrls: origines,

  /**
   * L'adresse publique, pour tout ce qui SORT de l'application : URL de retour
   * de Stripe, lien d'onboarding Connect, liens des courriels.
   *
   * NE PAS LA CONFONDRE AVEC `clientUrls`, qui dit qui a le droit d'ENTRER.
   * Les deux étaient la même variable jusqu'au 27 octobre — voir l'explication
   * en tête de ce fichier.
   */
  urlPublique,

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

    /*
     * OAUTH2 — la voie recommandée, et celle que l'assistant de messagerie
     * utilise déjà. Les trois valeurs viennent d'un client « application de
     * bureau » créé dans Google Cloud ; le jeton de rafraîchissement est obtenu
     * une fois, en autorisant le compte, puis il ne s'expire plus (sauf si
     * l'application Google reste « en test », auquel cas Google le périme au
     * bout de sept jours — voir docs/SUIVI.md).
     *
     * ABSENTES, L'ENVOI RETOMBE SUR LE MOT DE PASSE D'APPLICATION, puis sur la
     * boîte de dépôt locale. Aucune configuration n'est obligatoire en
     * développement.
     */
    oauth: {
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      refreshToken: process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
    },
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
