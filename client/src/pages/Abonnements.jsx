import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';

import subscriptionApi from '@/api/subscription.api';
import { formaterPrix, formaterDate } from '@/utils/prix';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import Spinner from '@/components/ui/Spinner';

/**
 * Mes abonnements premium — /abonnements
 *
 * Recapitulatif des abonnements payants du sportif : a qui, combien, jusqu'a
 * quand, avec resiliation et reprise.
 *
 * POURQUOI UN ECRAN DEDIE PLUTOT QUE LE SEUL BOUTON DU PROFIL.
 * Un abonnement est un engagement recurrent : l'utilisateur doit pouvoir
 * repondre a « qu'est-ce qui m'est prelevé ce mois-ci, et comment j'arrete »
 * sans avoir a se souvenir des profils qu'il a visites. C'est aussi une
 * exigence de loyaute : cacher la resiliation derriere un parcours tortueux
 * est une pratique que la reglementation europeenne sanctionne.
 */

/** Un abonnement dans la liste. */
function LigneAbonnement({ abonnement, surAction }) {
  const [action, setAction] = useState(false);
  const [erreur, setErreur] = useState(null);

  const coach = abonnement.coach;
  if (!coach) return null; // compte du coach supprime entre-temps

  const executer = async (operation) => {
    setAction(true);
    setErreur(null);
    try {
      await operation();
      await surAction();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setAction(false);
    }
  };

  /* L'etat lisible par un humain, pas le statut brut de la base. */
  const libelleEtat = () => {
    if (abonnement.statut === 'impaye') return { texte: 'Paiement en échec', ton: 'text-red-700' };
    if (abonnement.annuleALaFinPeriode && abonnement.donneAcces) {
      return { texte: 'Résilié — accès jusqu’à l’échéance', ton: 'text-amber-700' };
    }
    if (abonnement.donneAcces) return { texte: 'Actif', ton: 'text-green-700' };
    return { texte: 'Terminé', ton: 'text-ardoise-500' };
  };

  const etat = libelleEtat();

  return (
    <li className="rounded-carte border border-ardoise-200 bg-white p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Link to={`/profile/${coach.pseudo}`} className="shrink-0">
          <Avatar utilisateur={coach} taille="md" />
        </Link>

        <div className="min-w-0 flex-1">
          <Link
            to={`/profile/${coach.pseudo}`}
            className="font-semibold text-ardoise-900 hover:underline"
          >
            {coach.prenom ? `${coach.prenom} ${coach.nom}` : coach.pseudo}
          </Link>
          <p className="text-xs text-ardoise-500">@{coach.pseudo}</p>

          <p className={`mt-1.5 text-sm font-medium ${etat.ton}`}>{etat.texte}</p>

          <p className="mt-0.5 text-xs text-ardoise-500">
            {formaterPrix(abonnement.montant, abonnement.devise)} par mois
            {abonnement.periodeFin && (
              <>
                {' · '}
                {abonnement.annuleALaFinPeriode ? 'fin le ' : 'prochaine échéance le '}
                {formaterDate(abonnement.periodeFin)}
              </>
            )}
          </p>
        </div>
      </div>

      {erreur && (
        <Alert variante="erreur" className="mt-3">
          {erreur}
        </Alert>
      )}

      {/* Résilier n'est possible que sur un abonnement encore en cours. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {abonnement.donneAcces && !abonnement.annuleALaFinPeriode && (
          <Button
            variante="secondaire"
            taille="sm"
            chargement={action}
            onClick={() => executer(() => subscriptionApi.resilier(abonnement._id))}
          >
            Résilier
          </Button>
        )}

        {abonnement.annuleALaFinPeriode && abonnement.donneAcces && (
          <Button
            taille="sm"
            chargement={action}
            onClick={() => executer(() => subscriptionApi.reprendre(abonnement._id))}
          >
            Reprendre l&apos;abonnement
          </Button>
        )}

        <Link to={`/profile/${coach.pseudo}`}>
          <Button variante="fantome" taille="sm">
            Voir le profil
          </Button>
        </Link>
      </div>
    </li>
  );
}

export default function Abonnements() {
  const [abonnements, setAbonnements] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  const charger = useCallback(async () => {
    try {
      const reponse = await subscriptionApi.mesAbonnements({ limite: 50 });
      setAbonnements(reponse.data.elements || []);
      setErreur(null);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    charger();
  }, [charger]);

  const enCours = abonnements.filter((a) => a.donneAcces);
  const termines = abonnements.filter((a) => !a.donneAcces);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ardoise-900">Mes abonnements</h1>

      {erreur && <Alert variante="erreur">{erreur}</Alert>}

      {chargement && <Spinner taille="lg" className="mx-auto my-10" />}

      {!chargement && abonnements.length === 0 && (
        <div className="rounded-carte border border-ardoise-200 bg-white p-8 text-center">
          <p className="text-sm text-ardoise-600">
            Vous n&apos;êtes abonné à aucun coach pour le moment.
          </p>
          <p className="mt-1 text-xs text-ardoise-500">
            L&apos;abonnement premium donne accès au contenu exclusif d&apos;un
            coach certifié. Il se résilie à tout moment.
          </p>
          <Link to="/home" className="mt-4 inline-block">
            <Button variante="secondaire">Découvrir des coachs</Button>
          </Link>
        </div>
      )}

      {enCours.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ardoise-500">
            En cours ({enCours.length})
          </h2>
          <ul className="space-y-3">
            {enCours.map((a) => (
              <LigneAbonnement key={a._id} abonnement={a} surAction={charger} />
            ))}
          </ul>
        </section>
      )}

      {termines.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ardoise-500">
            Terminés ({termines.length})
          </h2>
          <ul className="space-y-3">
            {termines.map((a) => (
              <LigneAbonnement key={a._id} abonnement={a} surAction={charger} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
