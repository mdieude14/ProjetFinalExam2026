import mongoose from 'mongoose';
import { config, estDeveloppement } from './env.js';

/**
 * Ouvre la connexion a MongoDB.
 *
 * `strictQuery: true` fait que Mongoose ignore les champs de filtre qui
 * n'existent pas dans le schema. Sans cela, une faute de frappe dans un
 * `find({ pseudoo: 'x' })` renverrait toute la collection au lieu de rien.
 */
export async function connecterDB() {
  mongoose.set('strictQuery', true);

  // En developpement uniquement : affiche chaque requete Mongo dans la console.
  // Tres utile pour verifier qu'un index est bien utilise.
  if (estDeveloppement && process.env.MONGOOSE_DEBUG === 'true') {
    mongoose.set('debug', true);
  }

  try {
    const connexion = await mongoose.connect(config.mongoUri, {
      // Delai avant d'abandonner la selection d'un serveur du cluster.
      // 10 s au lieu des 30 s par defaut : on veut savoir vite que ca ne passe pas.
      serverSelectionTimeoutMS: 10000,
      // Taille du pool de connexions reutilisables.
      maxPoolSize: 10,
    });

    console.log(`[DB] Connecte a MongoDB : ${connexion.connection.name}`);

    // Construit les index declares dans les schemas s'ils n'existent pas encore.
    // A ne PAS faire automatiquement en production sur une grosse base
    // (la creation d'index peut bloquer) : on le limite au developpement.
    if (estDeveloppement) {
      await mongoose.connection.syncIndexes?.().catch(() => {});
    }
  } catch (erreur) {
    console.error('[DB] Connexion impossible :', erreur.message);
    // Sans base de donnees, l'API ne sert a rien : on arrete le processus
    // pour que l'orchestrateur (nodemon, Docker, Render...) puisse relancer.
    process.exit(1);
  }

  // Evenements post-connexion : une coupure reseau ne doit pas passer inapercue.
  mongoose.connection.on('error', (erreur) => {
    console.error('[DB] Erreur de connexion :', erreur.message);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('[DB] Deconnecte de MongoDB');
  });
}

/**
 * Ferme proprement la connexion (appele lors de l'arret du serveur).
 */
export async function deconnecterDB() {
  await mongoose.connection.close();
  console.log('[DB] Connexion fermee');
}
