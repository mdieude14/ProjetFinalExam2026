import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import followApi from '@/api/follow.api';
import useAuth from '@/hooks/useAuth';
import Avatar from '@/components/ui/Avatar';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import Spinner from '@/components/ui/Spinner';

/**
 * Demandes de suivi reçues — /demandes
 *
 * N'a de sens que sur un profil privé : un profil public accepte
 * automatiquement, la liste y reste donc toujours vide. On l'explique
 * plutôt que de laisser un écran vide inexpliqué.
 */
export default function Demandes() {
  const { utilisateur } = useAuth();

  const [demandes, setDemandes] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [enCours, setEnCours] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [message, setMessage] = useState(null);

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      const reponse = await followApi.demandes();
      setDemandes(reponse.data.elements);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    charger();
  }, [charger]);

  /**
   * Traite une demande.
   *
   * La ligne est retirée localement plutôt que de recharger toute la liste :
   * c'est instantané, et l'utilisateur peut enchaîner plusieurs décisions
   * sans attendre. En cas d'échec, on recharge pour se réaligner sur l'état
   * réel du serveur.
   */
  const decider = async (demande, decision) => {
    setEnCours(demande._id);
    setErreur(null);

    try {
      if (decision === 'accepter') await followApi.accepter(demande._id);
      else await followApi.refuser(demande._id);

      setDemandes((precedentes) => precedentes.filter((d) => d._id !== demande._id));
      setMessage(
        decision === 'accepter'
          ? `${demande.utilisateur.prenom} vous suit désormais`
          : 'Demande refusée'
      );
    } catch (e) {
      setErreur(e.message);
      await charger();
    } finally {
      setEnCours(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-ardoise-900">Demandes de suivi</h1>
        <p className="mt-1 text-sm text-ardoise-500">
          Ces personnes souhaitent voir vos publications.
        </p>
      </div>

      {message && <Alert variante="succes">{message}</Alert>}
      {erreur && <Alert variante="erreur">{erreur}</Alert>}

      {utilisateur.visibilite === 'public' && demandes.length === 0 && (
        <Alert variante="info">
          Votre profil est public : les nouveaux abonnés sont acceptés
          automatiquement, vous n&apos;avez aucune demande à traiter.{' '}
          <Link to="/settings" className="font-semibold underline hover:no-underline">
            Passer en privé
          </Link>
        </Alert>
      )}

      {chargement ? (
        <div className="flex justify-center py-16">
          <Spinner taille="lg" className="text-marque-500" />
        </div>
      ) : demandes.length === 0 ? (
        <div className="rounded-carte border border-dashed border-ardoise-300 p-10 text-center">
          <p className="text-3xl" aria-hidden="true">✓</p>
          <p className="mt-3 text-sm text-ardoise-500">Aucune demande en attente.</p>
        </div>
      ) : (
        <ul className="divide-y divide-ardoise-100 rounded-carte border border-ardoise-200 bg-white px-4">
          {demandes.map((demande) => {
            const u = demande.utilisateur;
            return (
              <li key={demande._id} className="flex flex-wrap items-center gap-3 py-4">
                <Link to={`/profile/${u.pseudo}`} className="shrink-0">
                  <Avatar utilisateur={u} taille="md" />
                </Link>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link
                      to={`/profile/${u.pseudo}`}
                      className="truncate font-semibold text-ardoise-900 hover:underline"
                    >
                      {u.prenom} {u.nom}
                    </Link>
                    {u.estCertifie && <Badge variante="succes">✓</Badge>}
                    {u.type === 'coach' && <Badge variante="marque">Coach</Badge>}
                  </div>

                  <p className="truncate text-xs text-ardoise-500">
                    @{u.pseudo}
                    {u.ville && ` · ${u.ville}`}
                    {' · '}
                    {new Date(demande.date).toLocaleDateString('fr-FR', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </p>
                </div>

                <div className="flex shrink-0 gap-2">
                  <Button
                    taille="sm"
                    chargement={enCours === demande._id}
                    onClick={() => decider(demande, 'accepter')}
                  >
                    Accepter
                  </Button>
                  <Button
                    variante="secondaire"
                    taille="sm"
                    disabled={enCours === demande._id}
                    onClick={() => decider(demande, 'refuser')}
                  >
                    Refuser
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
