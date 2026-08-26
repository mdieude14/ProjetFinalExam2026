import { Router } from 'express';
import mongoose from 'mongoose';

import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import adminRoutes from './admin.routes.js';
import postRoutes from './post.routes.js';
import commentRoutes from './comment.routes.js';
import storyRoutes from './story.routes.js';
import followRoutes from './follow.routes.js';
import stripeRoutes from './stripe.routes.js';
import subscriptionRoutes from './subscription.routes.js';
import geoRoutes from './geo.routes.js';
import eventRoutes from './event.routes.js';
import searchRoutes from './search.routes.js';
import messageRoutes from './message.routes.js';

const router = Router();

/**
 * Point de sante — GET /api/health
 *
 * Sert a trois choses :
 *  - verifier tout de suite qu'un deploiement est vivant,
 *  - donner a l'hebergeur (Render, Railway) une URL a sonder,
 *  - confirmer que la connexion Mongo est bien etablie et pas seulement
 *    que le processus Node tourne.
 */
router.get('/health', (req, res) => {
  const etatsMongo = ['deconnecte', 'connecte', 'connexion...', 'deconnexion...'];

  res.json({
    succes: true,
    message: 'API opérationnelle',
    horodatage: new Date().toISOString(),
    base: etatsMongo[mongoose.connection.readyState] || 'inconnu',
  });
});

/* -------------------------------------------------------------------
 *  Montage des sous-routeurs
 * ------------------------------------------------------------------- */

router.use('/auth', authRoutes); //      module 2
router.use('/users', userRoutes); //     module 4
router.use('/admin', adminRoutes); //    module 4
router.use('/posts', postRoutes); //     module 5
router.use('/comments', commentRoutes); //module 5
router.use('/stories', storyRoutes); //  module 5
router.use('/follows', followRoutes); //  module 6
router.use('/stripe', stripeRoutes); //   module 7 — configuration coach
router.use('/subscriptions', subscriptionRoutes); // module 7 — souscriptions
router.use('/geo', geoRoutes); //         module 8 — carte et proximité
router.use('/events', eventRoutes); //     module 9 — événements sportifs
router.use('/search', searchRoutes); //     module 10 — recherche
router.use('/messages', messageRoutes); //  module 11 — messagerie


export default router;
