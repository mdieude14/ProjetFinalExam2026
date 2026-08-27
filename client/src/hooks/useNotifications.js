import { useContext } from 'react';
import { NotificationContext } from '@/context/NotificationContext';

/**
 * Accede au compteur global de notifications.
 *
 *   const { nonLues, rafraichir, decrementer } = useNotifications();
 *
 * Meme garde explicite que `useAuth` et `useSocket` : sans elle, un composant
 * place hors du provider echouerait sur « impossible de lire la propriete
 * nonLues de null », loin de sa cause.
 */
export function useNotifications() {
  const contexte = useContext(NotificationContext);

  if (contexte === null) {
    throw new Error(
      'useNotifications doit être utilisé à l’intérieur d’un ' +
        '<NotificationProvider>. Vérifiez l’arbre de main.jsx.'
    );
  }

  return contexte;
}

export default useNotifications;
