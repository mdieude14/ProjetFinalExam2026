import { useContext } from 'react';
import { SocketContext } from '@/context/SocketContext';

/**
 * Accède à la connexion temps réel.
 *
 *   const { connecte, ecouter, emettre } = useSocket();
 *
 * Même garde explicite que `useAuth` : sans elle, un composant placé hors du
 * `SocketProvider` échouerait sur « impossible de lire la propriété ecouter
 * de null », loin de sa cause.
 */
export function useSocket() {
  const contexte = useContext(SocketContext);

  if (contexte === null) {
    throw new Error(
      'useSocket doit être utilisé à l’intérieur d’un <SocketProvider>. ' +
        'Vérifiez que le composant est bien placé dans l’arbre de main.jsx.'
    );
  }

  return contexte;
}

export default useSocket;
