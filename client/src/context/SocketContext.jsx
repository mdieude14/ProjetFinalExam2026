import { createContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

import useAuth from '@/hooks/useAuth';
import { obtenirAccessToken } from '@/api/axios';

/**
 * ===========================================================================
 *  CONNEXION TEMPS RÉEL
 * ===========================================================================
 *
 * UN SEUL SOCKET POUR TOUTE L'APPLICATION.
 * Ouvrir une connexion par écran paraîtrait plus simple à écrire — chaque
 * page gère la sienne. Mais un socket coûte une connexion TCP maintenue
 * ouverte côté serveur : multipliée par le nombre d'écrans visités, elle fait
 * grimper la consommation sans rien apporter. Et surtout, un message reçu
 * pendant qu'on est ailleurs ne mettrait à jour aucune pastille.
 *
 * ON NE SE CONNECTE QUE SI L'ON EST CONNECTÉ AU SENS DE LA SESSION.
 * Le serveur refuse la poignée de main sans jeton valide ; tenter quand même
 * produirait une boucle de reconnexions échouées, visible en console et
 * coûteuse en requêtes.
 * ===========================================================================
 */

// eslint-disable-next-line react-refresh/only-export-components
export const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { utilisateur, estConnecte } = useAuth();

  const socketRef = useRef(null);
  const [connecte, setConnecte] = useState(false);

  useEffect(() => {
    if (!estConnecte) {
      socketRef.current?.close();
      socketRef.current = null;
      setConnecte(false);
      return;
    }

    /*
     * LE JETON EST LU AU MOMENT DE LA CONNEXION, jamais mémorisé ici.
     * Il vit en mémoire dans la couche Axios et tourne toutes les quinze
     * minutes ; en garder une copie dans ce contexte reviendrait à
     * reconnecter le socket avec un jeton périmé après le premier
     * renouvellement.
     */
    const socket = io(import.meta.env.VITE_API_URL?.replace(/\/api$/, '') || '/', {
      auth: (transmettre) => transmettre({ token: obtenirAccessToken() }),
      // Le chemin par défaut de Socket.io ; explicité pour que le proxy Vite
      // le relaie sans ambiguïté.
      path: '/socket.io',
      withCredentials: true,
      // Reconnexion automatique : un ordinateur qui se met en veille, un
      // tunnel qui coupe, et le fil doit se rétablir sans intervention.
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });

    socketRef.current = socket;

    socket.on('connect', () => setConnecte(true));
    socket.on('disconnect', () => setConnecte(false));

    /*
     * UN ÉCHEC DE CONNEXION N'EST PAS SIGNALÉ À L'UTILISATEUR.
     * Le temps réel est un confort : sans lui, les messages arrivent quand
     * même, simplement au rechargement. Afficher une alerte rouge parce
     * qu'un socket n'a pas pu s'ouvrir donnerait à croire que la messagerie
     * est en panne alors qu'elle fonctionne.
     */
    socket.on('connect_error', () => setConnecte(false));

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [estConnecte, utilisateur?._id]);

  /**
   * Abonnement à un événement, avec désabonnement automatique.
   *
   * POURQUOI CE HELPER PLUTÔT QU'UN ACCÈS DIRECT AU SOCKET.
   * Chaque composant qui écoute doit se désabonner en partant, sinon le
   * gestionnaire d'un composant démonté continue de tourner — et met à jour
   * un état qui n'existe plus. En StrictMode, où React monte puis démonte
   * chaque composant, l'oubli produit deux abonnements et chaque message
   * s'affiche en double.
   */
  const ecouter = useCallback((evenement, gestionnaire) => {
    const socket = socketRef.current;
    if (!socket) return () => {};

    socket.on(evenement, gestionnaire);
    return () => socket.off(evenement, gestionnaire);
  }, []);

  /** Émet un événement éphémère (indicateur de saisie). */
  const emettre = useCallback((evenement, charge) => {
    socketRef.current?.emit(evenement, charge);
  }, []);

  const valeur = useMemo(
    () => ({ connecte, ecouter, emettre }),
    [connecte, ecouter, emettre]
  );

  return <SocketContext.Provider value={valeur}>{children}</SocketContext.Provider>;
}
