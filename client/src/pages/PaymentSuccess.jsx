import { useEffect, useState, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import subscriptionApi from '@/api/subscription.api';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import Spinner from '@/components/ui/Spinner';

/**
 * Retour de paiement — /paiement/succes
 *
 * C'est l'adresse `success_url` donnee a Stripe Checkout. Stripe y renvoie
 * le navigateur une fois la carte acceptee.
 *
 * CETTE PAGE NE CREE RIEN ET NE VALIDE RIEN.
 * L'abonnement est cree par le webhook `checkout.session.completed`, cote
 * serveur, signature verifiee. Se fier a cette redirection serait une faille
 * beante : n'importe qui peut ouvrir /paiement/succes a la main, sans avoir
 * jamais paye. La page se contente donc de CONSTATER l'etat reel en base.
 *
 * D'ou l'attente active ci-dessous : le webhook et la redirection partent en
 * meme temps, et rien ne garantit lequel arrive le premier. Plutot que
 * d'annoncer un echec parce que la base n'a pas encore recu l'evenement, on
 * interroge le serveur quelques secondes.
 */

/** Intervalle entre deux verifications, en millisecondes. */
const DELAI_ENTRE_TENTATIVES = 1200;

/** Au-dela, on cesse d'attendre et on invite a rafraichir. */
const TENTATIVES_MAX = 8;

export default function PaymentSuccess() {
  const [parametres] = useSearchParams();
  const session = parametres.get('session');

  const [etat, setEtat] = useState('verification'); // verification | confirme | lent
  const [abonnement, setAbonnement] = useState(null);

  // `useRef` et non `useState` : un compteur d'essais ne doit pas declencher
  // de rendu, et il doit survivre au double montage du mode strict de React.
  const annule = useRef(false);

  useEffect(() => {
    annule.current = false;

    async function verifier(tentative = 0) {
      if (annule.current) return;

      try {
        const reponse = await subscriptionApi.mesAbonnements({ limite: 5 });
        const actifs = (reponse.data.elements || []).filter(
          (a) => a.statut === 'actif' || a.donneAcces
        );

        // La liste est triee du plus recent au plus ancien, et l'abonnement
        // qui vient d'etre paye est donc en tete.
        //
        // ON NE FILTRE PAS SUR L'IDENTIFIANT DE SESSION passe en URL :
        // `versionPublique()` ne l'expose deliberement pas. Un identifiant de
        // session Stripe est un secret de paiement, il n'a rien a faire dans
        // une reponse d'API consultable. Le parametre d'URL ne sert donc qu'a
        // savoir qu'on arrive bien de Stripe, jamais a decider quoi que ce
        // soit : c'est la base qui fait foi.
        const trouve = actifs[0];

        if (trouve) {
          if (annule.current) return;
          setAbonnement(trouve);
          setEtat('confirme');
          return;
        }
      } catch {
        // Une erreur reseau ne doit pas interrompre l'attente : le webhook
        // peut tres bien aboutir a la tentative suivante.
      }

      if (tentative + 1 >= TENTATIVES_MAX) {
        if (!annule.current) setEtat('lent');
        return;
      }

      setTimeout(() => verifier(tentative + 1), DELAI_ENTRE_TENTATIVES);
    }

    verifier();

    // Nettoyage : si l'utilisateur quitte la page pendant l'attente, on cesse
    // de mettre a jour un composant demonte.
    return () => {
      annule.current = true;
    };
  }, [session]);

  const coach = abonnement?.coach;

  return (
    <div className="mx-auto max-w-lg py-10">
      <div className="rounded-carte border border-ardoise-200 bg-white p-6 text-center sm:p-8">
        {/* ---------------- Attente du webhook ---------------- */}
        {etat === 'verification' && (
          <>
            <Spinner taille="lg" className="mx-auto" />
            <h1 className="mt-5 text-xl font-bold text-ardoise-900">
              Confirmation du paiement…
            </h1>
            <p className="mt-2 text-sm text-ardoise-600">
              Votre banque a accepté le paiement. Nous attendons la confirmation
              de Stripe pour activer votre abonnement. Cela prend quelques
              secondes.
            </p>
          </>
        )}

        {/* ---------------- Abonnement confirmé ---------------- */}
        {etat === 'confirme' && (
          <>
            <div
              className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-2xl text-green-700"
              aria-hidden="true"
            >
              ✓
            </div>

            <h1 className="mt-5 text-xl font-bold text-ardoise-900">
              Abonnement activé
            </h1>

            <p className="mt-2 text-sm text-ardoise-600">
              {coach
                ? `Vous avez désormais accès au contenu premium de ${
                    coach.prenom ? `${coach.prenom} ${coach.nom}` : coach.pseudo
                  }.`
                : 'Vous avez désormais accès au contenu premium de ce coach.'}
            </p>

            {abonnement?.periodeFin && (
              <p className="mt-1 text-xs text-ardoise-500">
                Prochaine échéance le{' '}
                {new Date(abonnement.periodeFin).toLocaleDateString('fr-FR', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
                . Résiliable à tout moment.
              </p>
            )}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
              {coach?.pseudo && (
                <Link to={`/profile/${coach.pseudo}`}>
                  <Button pleineLargeur>Voir le contenu premium</Button>
                </Link>
              )}
              <Link to="/abonnements">
                <Button variante="secondaire" pleineLargeur>
                  Mes abonnements
                </Button>
              </Link>
            </div>
          </>
        )}

        {/* ---------------- Webhook plus lent que prévu ---------------- */}
        {etat === 'lent' && (
          <>
            <h1 className="text-xl font-bold text-ardoise-900">
              Paiement enregistré
            </h1>

            <Alert variante="info" className="mt-4 text-left">
              Votre paiement a bien été pris en compte, mais l&apos;activation
              n&apos;est pas encore visible ici. Elle se fait automatiquement,
              sans action de votre part. Rechargez la page dans un instant.
            </Alert>

            <p className="mt-3 text-xs text-ardoise-500">
              Aucun second paiement ne sera prélevé : si un abonnement existe
              déjà, une nouvelle souscription au même coach est refusée.
            </p>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Button onClick={() => window.location.reload()}>
                Recharger la page
              </Button>
              <Link to="/abonnements">
                <Button variante="secondaire" pleineLargeur>
                  Mes abonnements
                </Button>
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
