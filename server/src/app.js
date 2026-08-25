import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';

import { config, estProduction } from './config/env.js';
import routes from './routes/index.js';
import { notFoundMiddleware } from './middlewares/notFound.middleware.js';
import { errorMiddleware } from './middlewares/error.middleware.js';
import { limiteurGlobal } from './middlewares/rateLimit.middleware.js';
import { DOSSIER_LOCAL } from './services/storage.service.js';

const app = express();

/* ==================================================================
 *  1. CONFIANCE DANS LE PROXY
 * ==================================================================
 * Derriere un hebergeur (Render, Railway, Heroku), les requetes passent par
 * un reverse proxy. Sans cette ligne, req.ip renvoie l'IP du proxy et non
 * celle du visiteur : le rate limiting deviendrait global au lieu d'etre
 * par utilisateur, et les cookies « secure » ne seraient pas poses.
 */
app.set('trust proxy', 1);

/* ==================================================================
 *  2. WEBHOOKS STRIPE  —  A MONTER AVANT express.json()
 * ==================================================================
 * Stripe signe le corps BRUT de la requete. Si express.json() l'a deja parse
 * en objet JavaScript, la signature ne correspond plus et la verification
 * echoue systematiquement. Cette route doit donc etre declaree ici, avant
 * tout parseur de corps.
 *
 * Sera active au module 7 :
 *   import webhookRoutes from './routes/webhook.routes.js';
 *   app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);
 */

/* ==================================================================
 *  3. SECURITE
 * ================================================================== */

// En-tetes HTTP de securite (anti-clickjacking, anti-sniffing MIME, etc.).
app.use(
  helmet({
    // Les medias servis par Cloudinary sont sur un autre domaine :
    // sans cet assouplissement, le navigateur bloquerait leur chargement.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// CORS : seules les origines declarees dans .env peuvent appeler l'API.
// `credentials: true` est indispensable pour que le navigateur envoie
// le cookie du refresh token.
app.use(
  cors({
    origin: (origin, callback) => {
      // `!origin` couvre Postman, les tests et les appels serveur a serveur.
      if (!origin || config.clientUrls.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origine non autorisee par CORS : ${origin}`));
    },
    credentials: true,
  })
);

/* ==================================================================
 *  4. PARSEURS DE CORPS
 * ================================================================== */

// Limite a 1 Mo : les fichiers ne transitent pas par JSON mais par Multer
// (multipart/form-data). Une limite basse reduit la surface d'attaque.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

/* ==================================================================
 *  5. ASSAINISSEMENT DES ENTREES
 * ==================================================================
 * Retire les cles commencant par « $ » ou contenant « . » dans req.body,
 * req.params et req.query. C'est la parade a l'injection NoSQL : sans elle,
 * un corps { "email": { "$gt": "" } } ferait matcher le premier utilisateur
 * venu lors de la connexion.
 */
app.use(mongoSanitize({ replaceWith: '_' }));

/* ==================================================================
 *  6. PERFORMANCE ET JOURNALISATION
 * ================================================================== */

app.use(compression()); // compression gzip des reponses

// Journal des requetes : format concis en developpement, format Apache
// standard en production (exploitable par les outils d'analyse).
app.use(morgan(estProduction ? 'combined' : 'dev'));

/* ==================================================================
 *  6 bis. FICHIERS TELEVERSES (mode de stockage local uniquement)
 * ==================================================================
 * Quand Cloudinary n'est pas configure, les medias sont ecrits dans
 * server/uploads et servis ici en statique.
 *
 * `dotfiles: 'deny'` refuse les fichiers commencant par un point, et
 * `index: false` empeche de lister le contenu d'un dossier. Les noms de
 * fichiers etant aleatoires, personne ne peut deviner l'URL d'un media
 * qu'on ne lui a pas communiquee.
 *
 * En production avec Cloudinary, ce dossier reste vide et cette route
 * ne sert jamais.
 */
app.use(
  '/uploads',
  express.static(DOSSIER_LOCAL, {
    dotfiles: 'deny',
    index: false,
    maxAge: '7d', // les medias ne changent jamais : cache long cote navigateur
  })
);

/* ==================================================================
 *  7. ROUTES APPLICATIVES
 * ==================================================================
 * Le limiteur global s'applique a l'ensemble de l'API. Il est monte ici,
 * apres l'emplacement reserve aux webhooks Stripe : les appels de Stripe ne
 * doivent jamais etre bloques par une limite de debit, sous peine de voir des
 * paiements confirmes ne jamais etre enregistres en base.
 *
 * Les limiteurs specifiques (connexion, inscription) s'ajoutent a celui-ci
 * sur leurs routes respectives, sans le remplacer.
 */

app.use('/api', limiteurGlobal, routes);

/* ==================================================================
 *  8. GESTION DES ERREURS  —  TOUJOURS EN DERNIER
 * ==================================================================
 * L'ordre est imperatif : Express parcourt les middlewares de haut en bas.
 * Places avant les routes, ces deux-la intercepteraient tout.
 */
app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;
