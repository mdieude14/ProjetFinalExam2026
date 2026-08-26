import { Server } from 'socket.io';

import { config } from '../config/env.js';
import { verifierAccessToken } from '../services/auth.service.js';
import User from '../models/User.js';
import { brancherChat } from './chat.handler.js';

/**
 * ===========================================================================
 *  TEMPS RÉEL — SOCKET.IO
 * ===========================================================================
 *
 * CE QUE CETTE COUCHE FAIT, ET SURTOUT CE QU'ELLE NE FAIT PAS.
 *
 * Elle DIFFUSE. Elle n'écrit rien en base, ne valide aucun contenu, n'accorde
 * aucun droit. Tout cela vit dans `message.service.js`, atteint par les
 * routes HTTP. Le socket est un tuyau de notification branché en aval.
 *
 * POURQUOI CE PARTAGE EST LA DÉCISION IMPORTANTE.
 * Écrire le message dans le gestionnaire de socket est plus direct — et c'est
 * ce que montrent la plupart des exemples. On obtient alors DEUX chemins
 * d'écriture : l'un en HTTP, l'autre en socket, chacun avec sa validation,
 * son contrôle d'accès et ses oublis. Le jour où une règle change, on la
 * corrige dans l'un et on la laisse fausse dans l'autre — et c'est la voie
 * temps réel, la moins testée, qui reste ouverte.
 *
 * Une seule voie d'écriture, un seul endroit à auditer.
 * ===========================================================================
 */

/** Instance unique, partagée par les contrôleurs pour diffuser. */
let io = null;

/**
 * Salle personnelle d'un utilisateur.
 *
 * ON DIFFUSE VERS DES PERSONNES, PAS VERS DES CONVERSATIONS.
 * Une salle par conversation obligerait à gérer les entrées et sorties à
 * chaque ouverture de fil, et à recalculer qui a le droit d'y être. Une salle
 * par utilisateur est immuable : un socket rejoint la sienne à la connexion,
 * et rien d'autre. Pour diffuser un message, on relit les participants EN
 * BASE et l'on émet vers leurs deux salles.
 *
 * Conséquence directe : aucun client ne peut s'inviter dans un échange, même
 * en trichant sur ce qu'il envoie — il n'existe aucun événement « rejoindre ».
 */
export const salleDe = (idUtilisateur) => `utilisateur:${idUtilisateur}`;

/**
 * Authentification de la poignée de main.
 *
 * LE JETON EST VÉRIFIÉ UNE FOIS, À LA CONNEXION — jamais reçu ensuite dans
 * un événement. Un client qui enverrait `{ userId: ... }` dans un message
 * serait cru sur parole ; ici l'identité est établie par la signature du JWT,
 * puis conservée sur le socket côté serveur, hors de portée du navigateur.
 *
 * LE CAS QUI SURPREND : LE JETON EXPIRE, PAS LA CONNEXION.
 * L'access token vaut 15 minutes ; un onglet reste ouvert des heures. Le
 * socket, lui, n'est pas revérifié — le fermer à l'expiration déconnecterait
 * un utilisateur parfaitement actif au milieu d'une phrase. On accepte donc
 * qu'une session socket survive à son jeton : ce socket ne peut de toute
 * façon RIEN écrire, et toute action réelle repasse par HTTP, où le jeton
 * expiré est refusé puis renouvelé. Le privilège conservé se limite à
 * recevoir ses propres notifications.
 */
async function authentifier(socket, suivant) {
  const jeton =
    socket.handshake.auth?.token ||
    socket.handshake.headers?.authorization?.replace(/^Bearer /, '');

  if (!jeton) {
    return suivant(new Error('Authentification requise'));
  }

  try {
    const charge = verifierAccessToken(jeton);

    /*
     * ON RELIT L'UTILISATEUR EN BASE plutôt que de se contenter du contenu du
     * jeton. Un compte désactivé ou supprimé depuis l'émission du jeton
     * garderait sinon un accès valide jusqu'à son expiration — quinze minutes
     * pendant lesquelles il continuerait de recevoir des messages privés.
     */
    const utilisateur = await User.findById(charge.sub).select('pseudo type isActive');

    if (!utilisateur || !utilisateur.isActive) {
      return suivant(new Error('Compte introuvable ou désactivé'));
    }

    socket.utilisateur = {
      _id: String(utilisateur._id),
      pseudo: utilisateur.pseudo,
      type: utilisateur.type,
    };

    return suivant();
  } catch {
    return suivant(new Error('Jeton invalide ou expiré'));
  }
}

/**
 * Attache Socket.io au serveur HTTP existant.
 *
 * ON RÉUTILISE LE SERVEUR D'EXPRESS plutôt que d'ouvrir un second port :
 * un port distinct imposerait une seconde configuration CORS, un second
 * réglage d'hébergement, et casserait le partage du cookie de session.
 */
export function initialiserSockets(serveurHttp) {
  io = new Server(serveurHttp, {
    cors: {
      origin: config.clientUrls,
      credentials: true,
    },
    // Le client se reconnecte seul ; ces valeurs bornent simplement le temps
    // qu'un socket mort reste compté comme vivant.
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  io.use(authentifier);

  io.on('connection', (socket) => {
    socket.join(salleDe(socket.utilisateur._id));
    brancherChat(io, socket);
  });

  console.log('[TEMPS RÉEL] Socket.io attaché au serveur HTTP');
  return io;
}

/**
 * Diffuse un événement vers plusieurs utilisateurs.
 *
 * TOLÈRE L'ABSENCE DE SOCKET.IO, et c'est délibéré : les suites de tests
 * importent les contrôleurs sans jamais démarrer le serveur temps réel. Sans
 * ce garde-fou, chaque envoi de message y échouerait sur un `io` nul — un
 * échec qui accuserait la messagerie alors que seul le tuyau est absent.
 */
export function diffuserA(idsUtilisateurs, evenement, charge) {
  if (!io) return false;

  for (const id of idsUtilisateurs) {
    io.to(salleDe(id)).emit(evenement, charge);
  }
  return true;
}

/** Instance courante, ou `null` si le temps réel n'est pas démarré. */
export function obtenirIo() {
  return io;
}
