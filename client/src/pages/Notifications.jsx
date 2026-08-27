import { useState, useEffect, useCallback } from 'react';

import notificationApi from '@/api/notification.api';
import useSocket from '@/hooks/useSocket';
import useNotifications from '@/hooks/useNotifications';
import NotificationItem from '@/components/notification/NotificationItem';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import Spinner from '@/components/ui/Spinner';

/**
 * Notifications — /notifications
 *
 * ON N'OUVRE PAS AUTOMATIQUEMENT « TOUT MARQUER COMME LU ».
 *
 * La tentation est forte : arriver sur la page vaudrait lecture, et la
 * pastille retomberait toute seule. C'est ce que fait la messagerie du
 * module 11, et c'est justifié là-bas — ouvrir une conversation, c'est la
 * lire.
 *
 * Ici, non. Une liste de vingt notifications ne se lit pas d'un regard : on
 * en repère deux ou trois qui comptent, on clique, on revient. Tout marquer
 * à l'arrivée ferait disparaître le repère visuel de ce qui restait à voir —
 * et l'on ne saurait plus où l'on en était. Le bouton existe, il est
 * explicite, et c'est l'utilisateur qui décide.
 */

const ONGLETS = [
  { cle: 'toutes', libelle: 'Toutes' },
  { cle: 'non-lues', libelle: 'Non lues' },
];

export default function Notifications() {
  const { ecouter } = useSocket();
  const { decrementer, remettreAZero, rafraichir } = useNotifications();

  const [notifications, setNotifications] = useState([]);
  const [onglet, setOnglet] = useState('toutes');
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);

  /* --------------------------- Chargement --------------------------- */

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      const reponse = await notificationApi.liste({
        nonLues: onglet === 'non-lues',
        limite: 50,
      });
      setNotifications(reponse.data.elements || []);
      setErreur(null);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setChargement(false);
    }
  }, [onglet]);

  useEffect(() => {
    charger();
  }, [charger]);

  /* --------------------------- Temps réel --------------------------- */

  useEffect(() => {
    const arret = ecouter('notification:nouvelle', ({ notification }) => {
      /*
       * ON AJOUTE EN TÊTE SANS RECHARGER. Un `charger()` par notification
       * reçue repartirait chercher cinquante lignes pour n'en ajouter qu'une,
       * et ferait sauter la liste sous le curseur.
       *
       * Le dédoublonnage protège du regroupement côté serveur : une
       * notification regroupée revient avec le MÊME identifiant, et doit
       * remonter en tête plutôt que s'afficher deux fois.
       */
      setNotifications((precedentes) => [
        notification,
        ...precedentes.filter((n) => n._id !== notification._id),
      ]);
    });

    return arret;
  }, [ecouter]);

  /* ---------------------------- Actions ---------------------------- */

  const marquerLu = async (notification) => {
    if (notification.lu) return;

    // Optimisme assumé : la ligne change d'état tout de suite. La requête
    // part en parallèle, et un échec se corrige au prochain chargement.
    setNotifications((precedentes) =>
      precedentes.map((n) => (n._id === notification._id ? { ...n, lu: true } : n))
    );
    decrementer();

    try {
      await notificationApi.marquerLu(notification._id);
    } catch {
      rafraichir();
    }
  };

  const toutMarquerLu = async () => {
    setEnCours(true);
    try {
      await notificationApi.toutMarquerLu();
      setNotifications((precedentes) => precedentes.map((n) => ({ ...n, lu: true })));
      remettreAZero();

      // L'onglet « non lues » devient forcément vide : on le recharge plutôt
      // que d'afficher des lignes qui n'y ont plus leur place.
      if (onglet === 'non-lues') charger();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnCours(false);
    }
  };

  const supprimer = async (notification) => {
    setNotifications((precedentes) =>
      precedentes.filter((n) => n._id !== notification._id)
    );
    if (!notification.lu) decrementer();

    try {
      await notificationApi.supprimer(notification._id);
    } catch {
      charger();
    }
  };

  /* ----------------------------- Rendu ----------------------------- */

  const restantes = notifications.filter((n) => !n.lu).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-ardoise-900">Notifications</h1>

        {restantes > 0 && (
          <Button
            variante="secondaire"
            taille="sm"
            chargement={enCours}
            onClick={toutMarquerLu}
          >
            Tout marquer comme lu
          </Button>
        )}
      </div>

      <nav
        className="flex gap-1 rounded-carte border border-ardoise-200 bg-white p-1"
        aria-label="Filtrer les notifications"
      >
        {ONGLETS.map((o) => (
          <button
            key={o.cle}
            onClick={() => setOnglet(o.cle)}
            aria-current={onglet === o.cle ? 'page' : undefined}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              onglet === o.cle
                ? 'bg-marque-500 text-white'
                : 'text-ardoise-600 hover:bg-ardoise-100'
            }`}
          >
            {o.libelle}
          </button>
        ))}
      </nav>

      {erreur && <Alert variante="erreur">{erreur}</Alert>}

      {chargement && <Spinner className="mx-auto my-10" />}

      {!chargement && notifications.length === 0 && (
        <div className="rounded-carte border border-ardoise-200 bg-white p-8 text-center">
          <p className="text-sm text-ardoise-600">
            {onglet === 'non-lues'
              ? 'Aucune notification non lue.'
              : 'Aucune notification pour le moment.'}
          </p>
          <p className="mt-1 text-xs text-ardoise-500">
            Vous serez prévenu ici des likes, commentaires, abonnés et messages.
          </p>
        </div>
      )}

      {!chargement && notifications.length > 0 && (
        <ul
          className="overflow-hidden rounded-carte border border-ardoise-200 bg-white"
          data-testid="liste-notifications"
        >
          {notifications.map((notification) => (
            <NotificationItem
              key={notification._id}
              notification={notification}
              surLecture={marquerLu}
              surSuppression={supprimer}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
