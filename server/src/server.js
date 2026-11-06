import app from './app.js';
import { config } from './config/env.js';
import { connecterDB, deconnecterDB } from './config/db.js';
import { modeStockage } from './services/storage.service.js';
import { verifierCloudinary, cloudinaryConfigure } from './config/cloudinary.js';
import { verifierStripe, stripeConfigure } from './config/stripe.js';
import { initialiserSockets } from './sockets/index.js';
import { creerScrutateur } from './services/telegram-scrutage.service.js';
import { verifierSmtp, modeEnvoi } from './services/mail.service.js';

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

  /**
   * État de l'envoi de courriels. Même logique que pour les médias et les
   * paiements — mais elle manquait, et son absence a coûté trois jours.
   *
   * LE JETON OAuth DE GMAIL EXPIRE AU BOUT DE SEPT JOURS, parce que
   * l'application Google est en mode Test : c'est une règle de ce mode, pas un
   * incident. Le 2 novembre 2026 il est mort à 13 h 44, et PERSONNE NE L'A SU
   * avant qu'un utilisateur attende une réponse : le back-office a affiché
   * `invalid_grant` à l'exploitant, le flux courriel a échoué vingt-sept fois
   * de suite, et la campagne est restée à 2106/2106 — aucune de ses
   * vérifications ne regardait là.
   *
   * `verifierSmtp()` EXISTAIT DÉJÀ, exportée, et n'était appelée par personne.
   * Elle authentifie sans rien envoyer et rend la raison exacte du refus. Il
   * n'y avait rien à écrire : il y avait un fil à brancher.
   *
   *   LA LEÇON : un instrument que rien n'appelle ne protège de rien. Chercher
   *   ce qui existe avant d'écrire du neuf valait ici une fonction entière.
   */
  const envoi = modeEnvoi();
  if (envoi === 'aucun') {
    console.log(
      '[COURRIEL] Envoi inactif — aucune authentification configurée. Les messages ' +
        'seront déposés dans server/.boite-mails/ au lieu d’être envoyés.'
    );
  } else {
    const etat = await verifierSmtp();
    if (etat.ok) {
      console.log(`[COURRIEL] Envoi pret (${envoi})`);
    } else {
      /*
       * ON NE REFUSE PAS DE DÉMARRER. Le reste de l'application n'a pas besoin
       * de l'envoi, et un serveur qui ne démarre pas empêcherait justement
       * d'aller lire ce message. Mais on nomme le remède, parce que personne
       * ne devine « réémettre un jeton OAuth » depuis « invalid_grant ».
       */
      console.error(`[COURRIEL] ENVOI HORS SERVICE (${envoi}) : ${etat.raison}`);
      if (/invalid_grant/i.test(etat.raison ?? '')) {
        console.error(
          '[COURRIEL] Le jeton de rafraichissement Gmail est expire ou revoque. ' +
            'Application Google en mode Test = sept jours de validite.'
        );
        console.error(
          '[COURRIEL] Remede : node server/scripts/autoriser-gmail.mjs ' +
            '(consentement dans Chrome), puis REDEMARRER ce serveur — ' +
            'nodemon ne surveille pas .env.'
        );
      }
    }
  }

  const serveur = app.listen(config.port, () => {
    console.log(`[API] Serveur demarre sur http://localhost:${config.port}`);
    console.log(`[API] Environnement : ${config.env}`);
    console.log(`[API] Sante : http://localhost:${config.port}/api/health`);
  });

  /**
   * Temps reel (module 11).
   *
   * ON ATTACHE SOCKET.IO AU SERVEUR QU'EXPRESS VIENT D'OUVRIR, plutot que
   * d'ecouter sur un second port : un port distinct imposerait une seconde
   * configuration CORS, un second reglage d'hebergement, et empecherait le
   * partage du cookie de session.
   *
   * L'attachement vient APRES `app.listen()` : Socket.io a besoin d'un
   * serveur HTTP deja cree, pas d'une application Express.
   */
  initialiserSockets(serveur);

  /**
   * Canal Telegram entrant (module 15).
   *
   * ON SCRUTE AU LIEU D'ÊTRE APPELÉ. Telegram ne livre qu'à une adresse HTTPS
   * publique ; aller chercher les messages soi-même supprime le besoin
   * d'adresse, donc le tunnel, donc l'exposition de l'éditeur n8n. Le détail
   * des trois pistes mesurées est en tête de `telegram-scrutage.service.js`.
   *
   * SANS JETON, RIEN NE PART — et c'est le défaut : le scrutateur l'annonce
   * en une ligne et s'arrête là.
   */
  const scrutateur = creerScrutateur({
    jeton: config.telegram.jeton,
    base: config.telegram.base,
    webhook: config.telegram.webhook,
    cleService: config.support.serviceKey,
  });

  /**
   * Arret propre : on laisse les requetes en cours se terminer avant de
   * fermer la connexion Mongo. Sans cela, un redeploiement peut couper
   * une ecriture au milieu et laisser des donnees incoherentes.
   */
  const arreterProprement = async (signal) => {
    console.log(`\n[API] Signal ${signal} recu, arret en cours...`);
    /*
     * LE SCRUTATEUR D'ABORD : son attente longue dure jusqu'à 50 s, et sans
     * interruption de la requête en vol l'arrêt traînerait d'autant.
     */
    await scrutateur.arreter();
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

  /*
   * LE SCRUTAGE DÉMARRE APRÈS LES GESTIONNAIRES DE SIGNAUX, pas avant. Son
   * premier geste est un appel réseau à Telegram (`deleteWebhook`) : s'il
   * traînait et qu'on frappait Ctrl-C pendant ce temps, aucun gestionnaire ne
   * serait encore posé et le processus mourrait sans refermer la base.
   */
  await scrutateur.demarrer();

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
