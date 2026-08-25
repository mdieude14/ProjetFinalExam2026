import { Router } from 'express';
import mongoose from 'mongoose';

import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import adminRoutes from './admin.routes.js';
import postRoutes from './post.routes.js';
import commentRoutes from './comment.routes.js';
import storyRoutes from './story.routes.js';
import followRoutes from './follow.routes.js';

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

/*
 * A venir :
 *   router.use('/subscriptions', subRoutes);   // module 7
 */

export default router;
