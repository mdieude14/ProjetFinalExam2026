import { useEffect, useState } from 'react';

import subscriptionApi from '@/api/subscription.api';
import { formaterPrix, formaterDate } from '@/utils/prix';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';

/**
 * Bouton d'abonnement premium affiche sur le profil d'un coach.
 *
 * L'ETAT AFFICHE VIENT TOUJOURS DU SERVEUR, jamais d'une deduction locale.
 * Cinq situations distinctes, cinq rendus :
 *
 *   pas d'offre        le coach ne vend rien -> on n'affiche rien du tout
 *   non abonne         « S'abonner — 19,90 €/mois »
 *   abonne actif       « Abonné » + resiliation possible
 *   resilie en cours   date de fin annoncee + reprise possible
 *   impaye             alerte : le prelevement a echoue, l'acces est coupe
 *
 * Le composant ne s'affiche pas sur son propre profil : un coach ne s'abonne
 * pas a lui-meme, et le serveur le refuserait de toute facon.
 */
export default function BoutonAbonnement({ coach, estMoi = false, surChangement }) {
  const [statut, setStatut] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [action, setAction] = useState(false);
  const [erreur, setErreur] = useState(null);

  const identifiant = coach?.pseudo;

  /* ------------------------- Lecture de l'etat ------------------------- */

  useEffect(() => {
    // Inutile d'interroger le serveur pour son propre profil, ou pour un
    // compte qui n'est pas coach : la reponse est connue d'avance.
    if (!identifiant || estMoi || coach?.type !== 'coach') {
      setChargement(false);
      return;
    }

    let vivant = true;

    subscriptionApi
      .statutAvecCoach(identifiant)
      .then((r) => vivant && setStatut(r.data))
      .catch(() => vivant && setStatut(null))
      .finally(() => vivant && setChargement(false));

    return () => {
      vivant = false;
    };
  }, [identifiant, estMoi, coach?.type]);

  /* ---------------------------- Souscription --------------------------- */

  /**
   * Ouvre la session de paiement puis quitte le site.
   *
   * `window.location.assign` et non `navigate` : Stripe Checkout est une page
   * externe, elle ne fait pas partie du routeur React. On ne remet pas non
   * plus `action` a faux — la page est en train d'etre remplacee, laisser le
   * bouton en chargement evite un double clic pendant la bascule.
   */
  const sabonner = async () => {
    setAction(true);
    setErreur(null);
    try {
      const reponse = await subscriptionApi.creerCheckout(identifiant);
      window.location.assign(reponse.data.url);
    } catch (e) {
      setErreur(e.message);
      setAction(false);
    }
  };

  /* ------------------------ Resiliation / reprise ----------------------- */

  const rafraichir = async () => {
    const r = await subscriptionApi.statutAvecCoach(identifiant);
    setStatut(r.data);
    surChangement?.(r.data);
  };

  const resilier = async () => {
    setAction(true);
    setErreur(null);
    try {
      await subscriptionApi.resilier(statut.abonnement._id);
      await rafraichir();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setAction(false);
    }
  };

  const reprendre = async () => {
    setAction(true);
    setErreur(null);
    try {
      await subscriptionApi.reprendre(statut.abonnement._id);
      await rafraichir();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setAction(false);
    }
  };

  /* ------------------------------ Rendus ------------------------------ */

  if (estMoi || coach?.type !== 'coach') return null;
  if (chargement) return null;

  // Le coach ne propose pas d'abonnement : ne rien afficher vaut mieux qu'un
  // bouton desactive, qui laisserait croire a une offre indisponible.
  if (!statut?.offreDisponible && !statut?.abonnement) return null;

  const abonnement = statut.abonnement;
  // `prixMensuel` arrive EN CENTIMES : 1990 s'affiche « 19,90 € ».
  const prix = formaterPrix(statut.prixMensuel, statut.devise);
  const dateFin = abonnement?.periodeFin ? formaterDate(abonnement.periodeFin) : null;

  return (
    <div className="space-y-2">
      {erreur && <Alert variante="erreur">{erreur}</Alert>}

      {/* --- Prélèvement en échec : l'accès est déjà coupé --- */}
      {abonnement?.statut === 'impaye' && (
        <Alert variante="alerte" titre="Paiement en échec">
          Le dernier prélèvement n&apos;a pas abouti. L&apos;accès au contenu
          premium est suspendu le temps de régulariser.
        </Alert>
      )}

      {/* --- Résiliation programmée : l'accès court encore --- */}
      {abonnement?.annuleALaFinPeriode && abonnement?.donneAcces && (
        <Alert variante="info">
          Abonnement résilié. Vous gardez l&apos;accès
          {dateFin ? ` jusqu’au ${dateFin}` : ' jusqu’à la fin de la période payée'}.
        </Alert>
      )}

      {/* --- Le bouton lui-même --- */}
      {!abonnement?.donneAcces && statut.offreDisponible && (
        <Button pleineLargeur chargement={action} onClick={sabonner}>
          S&apos;abonner — {prix}/mois
        </Button>
      )}

      {abonnement?.donneAcces && abonnement?.annuleALaFinPeriode && (
        <Button
          pleineLargeur
          variante="secondaire"
          chargement={action}
          onClick={reprendre}
        >
          Reprendre l&apos;abonnement
        </Button>
      )}

      {abonnement?.donneAcces && !abonnement?.annuleALaFinPeriode && (
        <div className="flex items-center gap-2">
          <span className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-green-50 px-4 py-2.5 text-sm font-semibold text-green-800">
            <span aria-hidden="true">✓</span> Abonné
          </span>
          <Button variante="fantome" taille="sm" chargement={action} onClick={resilier}>
            Résilier
          </Button>
        </div>
      )}
    </div>
  );
}
