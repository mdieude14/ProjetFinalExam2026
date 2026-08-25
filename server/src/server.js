import app from './app.js';
import { config } from './config/env.js';
import { connecterDB, deconnecterDB } from './config/db.js';
import { modeStockage } from './services/storage.service.js';
import { verifierCloudinary, cloudinaryConfigure } from './config/cloudinary.js';
import { verifierStripe, stripeConfigure } from './config/stripe.js';

/**
 * Point d'entree du serveur.
 *
 * On separe volontairement server.js (demarrage, connexion, signaux systeme)
 * de app.js (configuration Express). Cela permet aux tests d'importer `app`
 * et de le passer a Supertest sans jamais ouvrir de port ni se connecter
 * a la vraie base.
 */

async function demarrer() {
  // La base d'abord : inutile d'accepter des requetes qu'on ne pourra pas servir.
  await connecterDB();

  /**
   * Etat du stockage des medias.
   * On teste les identifiants Cloudinary au demarrage : mieux vaut decouvrir
   * une cle erronee maintenant qu'au premier televersement d'un utilisateur.
   */
  if (cloudinaryConfigure) {
    const valide = await verifierCloudinary();
    console.log(
      valide
        ? '[MEDIAS] Cloudinary connecte'
        : '[MEDIAS] Cloudinary configure mais INJOIGNABLE — vérifiez les cles'
    );
  } else {
    console.log(
      '[MEDIAS] Stockage local (server/uploads) — renseignez les cles ' +
        'CLOUDINARY_* dans .env pour basculer sur Cloudinary'
    );
  }
  console.log(`[MEDIAS] Mode actif : ${modeStockage}`);

  /**
   * État des paiements. Même logique que pour les médias : on teste la clé
   * au démarrage plutôt que de découvrir qu'elle est invalide au premier
   * paiement d'un utilisateur.
   */
  if (stripeConfigure) {
    const etat = await verifierStripe();
    console.log(
      etat.actif
        ? `[PAIEMENTS] Stripe connecte (compte ${etat.compte})`
        : '[PAIEMENTS] Stripe configure mais INJOIGNABLE — verifiez la cle'
    );
  } else {
    console.log(
      '[PAIEMENTS] Stripe inactif — renseignez STRIPE_SECRET_KEY dans .env. ' +
        'Le reste de l application fonctionne normalement.'
    );
  }

  const serveur = app.listen(config.port, () => {
    console.log(`[API] Serveur demarre sur http://localhost:${config.port}`);
    console.log(`[API] Environnement : ${config.env}`);
    console.log(`[API] Sante : http://localhost:${config.port}/api/health`);
  });

  /**
   * Arret propre : on laisse les requetes en cours se terminer avant de
   * fermer la connexion Mongo. Sans cela, un redeploiement peut couper
   * une ecriture au milieu et laisser des donnees incoherentes.
   */
  const arreterProprement = async (signal) => {
    console.log(`\n[API] Signal ${signal} recu, arret en cours...`);
    serveur.close(async () => {
      await deconnecterDB();
      console.log('[API] Arret termine');
      process.exit(0);
    });

    // Filet de securite : si une requete reste bloquee, on force l'arret.
    setTimeout(() => {
      console.error('[API] Arret force après 10 s');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => arreterProprement('SIGTERM')); // hebergeur
  process.on('SIGINT', () => arreterProprement('SIGINT')); //  Ctrl+C

  /**
   * Erreurs non rattrapees : on trace puis on quitte.
   * Poursuivre l'execution apres une exception non geree laisse le processus
   * dans un etat imprevisible ; mieux vaut redemarrer proprement.
   */
  process.on('unhandledRejection', (raison) => {
    console.error('[API] Promesse rejetee non geree :', raison);
    arreterProprement('unhandledRejection');
  });

  process.on('uncaughtException', (erreur) => {
    console.error('[API] Exception non capturee :', erreur);
    process.exit(1);
  });
}

demarrer();
