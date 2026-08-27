import { createContext, useState, useEffect, useCallback, useMemo } from 'react';

import notificationApi from '@/api/notification.api';
import useAuth from '@/hooks/useAuth';
import useSocket from '@/hooks/useSocket';

/**
 * ===========================================================================
 *  NOTIFICATIONS — ÉTAT GLOBAL
 * ===========================================================================
 *
 * POURQUOI UN CONTEXTE ET PAS UN ÉTAT DANS LA PAGE.
 * Le compteur s'affiche dans la barre de navigation, donc sur TOUS les
 * écrans. Rangé dans `Notifications.jsx`, il n'existerait que sur la page des
 * notifications — c'est-à-dire précisément là où il ne sert à rien, puisqu'on
 * y voit déjà la liste.
 *
 * DEUX SOURCES, ET IL EN FAUT DEUX — même raisonnement qu'au module 11.
 * Le socket porte l'immédiat : une notification qui arrive pendant qu'on lit
 * une autre page incrémente la pastille sur-le-champ. Mais il ne raconte que
 * ce qui s'est passé DEPUIS la connexion : à l'ouverture de l'application, ou
 * après une coupure réseau, il ne dira rien de ce qui est arrivé entre-temps.
 * La lecture HTTP au montage comble ce trou.
 *
 * N'en garder qu'une donne deux défauts symétriques : une pastille qui ne
 * bouge jamais, ou une pastille toujours à zéro au démarrage.
 * ===========================================================================
 */

// eslint-disable-next-line react-refresh/only-export-components
export const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const { estConnecte } = useAuth();
  const { ecouter } = useSocket();

  const [nonLues, setNonLues] = useState(0);

  /** Relit le compteur depuis le serveur — la seule source qui fasse foi. */
  const rafraichir = useCallback(async () => {
    if (!estConnecte) {
      setNonLues(0);
      return;
    }

    try {
      const reponse = await notificationApi.nonLues();
      setNonLues(reponse.data.nombre || 0);
    } catch {
      // Sans conséquence : on n'affiche simplement pas de pastille. Une
      // alerte rouge parce qu'un compteur n'a pas pu être lu donnerait à
      // croire que l'application est en panne alors que tout fonctionne.
    }
  }, [estConnecte]);

  useEffect(() => {
    rafraichir();
  }, [rafraichir]);

  /* --------------------------- Temps réel --------------------------- */

  useEffect(() => {
    if (!estConnecte) return;

    const arret = ecouter('notification:nouvelle', () => {
      /*
       * ON INCRÉMENTE LOCALEMENT plutôt que de relire le serveur.
       *
       * Une relecture par notification reçue ferait une requête HTTP à chaque
       * like d'une publication populaire — exactement le trafic que le temps
       * réel devait éviter. Le compteur peut dériver de la valeur exacte ;
       * la prochaine navigation le remet d'aplomb.
       */
      setNonLues((n) => n + 1);
    });

    return arret;
  }, [ecouter, estConnecte]);

  /**
   * Retire une notification du compteur après lecture.
   *
   * Exposé plutôt que recalculé : la page des notifications sait ce qu'elle
   * vient de marquer comme lu, et la faire redemander le compteur au serveur
   * ajouterait un aller-retour pour une information qu'elle possède déjà.
   */
  const decrementer = useCallback((combien = 1) => {
    setNonLues((n) => Math.max(0, n - combien));
  }, []);

  const remettreAZero = useCallback(() => setNonLues(0), []);

  const valeur = useMemo(
    () => ({ nonLues, rafraichir, decrementer, remettreAZero }),
    [nonLues, rafraichir, decrementer, remettreAZero]
  );

  return (
    <NotificationContext.Provider value={valeur}>
      {children}
    </NotificationContext.Provider>
  );
}
