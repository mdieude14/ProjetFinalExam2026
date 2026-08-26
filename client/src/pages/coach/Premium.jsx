import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

import useAuth from '@/hooks/useAuth';
import { monetisationApi, subscriptionApi } from '@/api/subscription.api';
import { formaterPrix, centimesVersEuros } from '@/utils/prix';
import { traiterErreurApi } from '@/utils/erreurs';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import Spinner from '@/components/ui/Spinner';

/**
 * Monetisation du coach — /coach/premium
 *
 * Trois choses sur un meme ecran, dans l'ordre ou elles doivent etre faites :
 *
 *   1. le compte de paiement Stripe (obligatoire pour encaisser)
 *   2. le tarif mensuel (obligatoire pour que l'offre existe)
 *   3. les revenus (consequence des deux premiers)
 *
 * L'ORDRE N'EST PAS DECORATIF. Vendre exige trois conditions cumulatives :
 * diplome verifie, compte Stripe capable d'encaisser, tarif defini. Tant
 * qu'il en manque une, le serveur refuse toute souscription. Plutot que de
 * laisser le coach se demander pourquoi personne ne peut s'abonner, l'ecran
 * affiche explicitement ce qui manque — c'est ce que renvoie `manque`.
 *
 * C'est aussi l'adresse de retour de l'inscription Stripe (`return_url`),
 * d'ou la lecture du parametre `?stripe=`.
 */
export default function Premium() {
  const { utilisateur } = useAuth();
  const [parametres, setParametres] = useSearchParams();

  const [connect, setConnect] = useState(null);
  const [revenus, setRevenus] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [message, setMessage] = useState(null);

  /* --------------------------- Chargement --------------------------- */

  const charger = useCallback(async () => {
    try {
      // `statutConnect` interroge Stripe en direct : c'est volontaire, l'etat
      // du compte peut avoir change pendant que le coach etait chez Stripe.
      const [etat, chiffres] = await Promise.all([
        monetisationApi.statutConnect(),
        monetisationApi.revenus().catch(() => null),
      ]);
      setConnect(etat.data);
      setRevenus(chiffres?.data?.revenus ?? null);
    } catch (e) {
      setMessage({ variante: 'erreur', texte: e.message });
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    charger();
  }, [charger]);

  /* ------------------- Retour depuis l'inscription Stripe ------------------ */

  useEffect(() => {
    const retour = parametres.get('stripe');
    if (!retour) return;

    /*
     * ON NE CROIT PAS CE PARAMETRE SUR PAROLE.
     * `return_url` est appelee des que le coach quitte le formulaire Stripe,
     * qu'il l'ait termine ou non. Il ne prouve donc rien : seul l'appel a
     * `statutConnect` ci-dessus fait foi. Ce parametre ne sert qu'a choisir
     * le message affiche.
     */
    setMessage(
      retour === 'rafraichir'
        ? {
            variante: 'alerte',
            texte:
              'Le lien d’inscription Stripe avait expiré. Relancez-la pour reprendre où vous en étiez.',
          }
        : {
            variante: 'info',
            texte:
              'Retour depuis Stripe. L’état ci-dessous reflète ce que Stripe nous répond à l’instant.',
          }
    );

    // On nettoie l'URL pour que le message ne revienne pas a chaque rechargement.
    parametres.delete('stripe');
    setParametres(parametres, { replace: true });
  }, [parametres, setParametres]);

  /* ---------------------------- Inscription ---------------------------- */

  const [onboarding, setOnboarding] = useState(false);

  const lancerOnboarding = async () => {
    setOnboarding(true);
    setMessage(null);
    try {
      const reponse = await monetisationApi.demarrerOnboarding();
      // Stripe heberge le formulaire : on quitte l'application.
      window.location.assign(reponse.data.url);
    } catch (e) {
      setMessage({ variante: 'erreur', texte: e.message });
      setOnboarding(false);
    }
  };

  /* ------------------------------- Tarif ------------------------------- */

  const [tarif, setTarif] = useState('');
  const [erreursTarif, setErreursTarif] = useState({});
  const [enregistrement, setEnregistrement] = useState(false);

  // Pre-remplissage une fois le tarif connu, sans ecraser une saisie en cours.
  useEffect(() => {
    if (tarif === '' && utilisateur?.premium?.prixMensuel) {
      setTarif(centimesVersEuros(utilisateur.premium.prixMensuel));
    }
  }, [utilisateur?.premium?.prixMensuel, tarif]);

  const enregistrerTarif = async (evenement) => {
    evenement.preventDefault();
    setErreursTarif({});
    setMessage(null);
    setEnregistrement(true);

    try {
      // Le champ est envoye EN EUROS : c'est le serveur qui convertit en
      // centimes pour Stripe. Voir le commentaire de `definirTarif`.
      const reponse = await monetisationApi.definirTarif(Number(tarif));
      setMessage({ variante: 'succes', texte: reponse.data.message });
      await charger();
    } catch (erreur) {
      const { parChamp, global } = traiterErreurApi(erreur);
      setErreursTarif(parChamp);
      if (global) setMessage({ variante: 'erreur', texte: global });
    } finally {
      setEnregistrement(false);
    }
  };

  /* ---------------------------- Abonnés ---------------------------- */

  const [abonnes, setAbonnes] = useState(null);

  useEffect(() => {
    subscriptionApi
      .mesAbonnes({ limite: 50 })
      .then((r) => setAbonnes(r.data.elements || []))
      .catch(() => setAbonnes([]));
  }, []);

  /* ------------------------------ Rendu ------------------------------ */

  if (chargement) return <Spinner taille="lg" className="mx-auto my-16" />;

  const manque = connect?.manque || {};
  const pretAVendre = Boolean(connect?.peutMonetiser);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ardoise-900">Contenu premium</h1>

      {message && <Alert variante={message.variante}>{message.texte}</Alert>}

      {/* ================= 0. Ce qui manque ================= */}
      <section className="rounded-carte border border-ardoise-200 bg-white p-5 sm:p-6">
        <h2 className="text-base font-bold text-ardoise-900">
          {pretAVendre ? 'Votre offre est en ligne' : 'Il reste des étapes'}
        </h2>

        {pretAVendre ? (
          <Alert variante="succes" className="mt-4">
            Les sportifs peuvent s&apos;abonner à votre contenu premium. La
            plateforme prélève {revenus?.tauxCommission ?? 15} % de commission
            sur chaque abonnement, le reste vous est reversé par Stripe.
          </Alert>
        ) : (
          <ul className="mt-4 space-y-2 text-sm">
            <EtapeManquante
              faite={!manque.diplome}
              titre="Diplôme vérifié"
              detail="Un administrateur doit valider votre diplôme avant que vous puissiez vendre."
            />
            <EtapeManquante
              faite={!manque.stripe}
              titre="Compte de paiement Stripe"
              detail="Stripe doit pouvoir encaisser en votre nom."
            />
            <EtapeManquante
              faite={!manque.tarif}
              titre="Tarif mensuel défini"
              detail="Sans tarif, aucune offre n’est proposée aux sportifs."
            />
          </ul>
        )}
      </section>

      {/* ================= 1. Compte Stripe ================= */}
      <section className="rounded-carte border border-ardoise-200 bg-white p-5 sm:p-6">
        <h2 className="text-base font-bold text-ardoise-900">Compte de paiement</h2>

        <p className="mt-1 text-xs text-ardoise-500">
          Stripe encaisse pour vous et vous reverse directement. CoachConnect
          ne détient jamais votre argent, et ne voit jamais vos coordonnées
          bancaires.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <EtatStripe statut={connect?.statut} />
          {connect?.payoutsEnabled && (
            <span className="text-xs text-ardoise-500">Virements activés</span>
          )}
        </div>

        {/* Ce que Stripe attend encore, mot pour mot. */}
        {connect?.exigences?.length > 0 && (
          <Alert variante="alerte" className="mt-4" titre="Informations attendues par Stripe">
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs">
              {connect.exigences.map((e, i) => (
                <li key={i}>{e.champ}</li>
              ))}
            </ul>
          </Alert>
        )}

        {connect?.statut !== 'actif' && (
          <Button className="mt-4" chargement={onboarding} onClick={lancerOnboarding}>
            {connect?.statut === 'en_attente'
              ? 'Créer mon compte de paiement'
              : 'Compléter mon inscription Stripe'}
          </Button>
        )}
      </section>

      {/* ================= 2. Tarif ================= */}
      <section className="rounded-carte border border-ardoise-200 bg-white p-5 sm:p-6">
        <h2 className="text-base font-bold text-ardoise-900">Tarif mensuel</h2>

        <p className="mt-1 text-xs text-ardoise-500">
          Entre 5 € et 500 € par mois. Vos abonnés actuels conservent le tarif
          auquel ils ont souscrit : une modification ne s&apos;applique
          qu&apos;aux nouvelles souscriptions.
        </p>

        <form onSubmit={enregistrerTarif} noValidate className="mt-4 flex flex-wrap items-end gap-3">
          <Input
            libelle="Prix par mois (€)"
            type="number"
            step="0.01"
            min="5"
            max="500"
            value={tarif}
            onChange={(e) => setTarif(e.target.value)}
            erreur={erreursTarif.prixMensuel}
            placeholder="19.90"
            className="w-40"
            required
          />
          <Button type="submit" chargement={enregistrement}>
            Enregistrer le tarif
          </Button>
        </form>

        {utilisateur?.premium?.prixMensuel && (
          <p className="mt-3 text-sm text-ardoise-600">
            Tarif actuellement proposé :{' '}
            <strong>{formaterPrix(utilisateur.premium.prixMensuel)}</strong> par mois
          </p>
        )}
      </section>

      {/* ================= 3. Revenus ================= */}
      <section className="rounded-carte border border-ardoise-200 bg-white p-5 sm:p-6">
        <h2 className="text-base font-bold text-ardoise-900">Revenus mensuels</h2>

        {!revenus ? (
          <p className="mt-3 text-sm text-ardoise-500">Aucun revenu pour le moment.</p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Chiffre libelle="Abonnés actifs" valeur={revenus.abonnesActifs} />
              <Chiffre libelle="Brut mensuel" valeur={formaterPrix(revenus.brutMensuel)} />
              <Chiffre
                libelle={`Commission (${revenus.tauxCommission} %)`}
                valeur={`− ${formaterPrix(revenus.commissionPlateforme)}`}
                ton="text-ardoise-500"
              />
              <Chiffre
                libelle="Net pour vous"
                valeur={formaterPrix(revenus.netMensuel)}
                ton="text-green-700"
              />
            </div>

            {revenus.impayes > 0 && (
              <Alert variante="alerte" className="mt-4">
                {revenus.impayes} abonnement{revenus.impayes > 1 ? 's' : ''} en
                échec de paiement. Stripe relance automatiquement ; l&apos;accès
                au contenu est suspendu entre-temps.
              </Alert>
            )}

            <p className="mt-3 text-xs text-ardoise-500">
              Montants récurrents sur la base des abonnements actifs. Les
              virements sont effectués par Stripe selon votre calendrier de
              versement.
            </p>
          </>
        )}
      </section>

      {/* ================= 4. Abonnés ================= */}
      <section className="rounded-carte border border-ardoise-200 bg-white p-5 sm:p-6">
        <h2 className="text-base font-bold text-ardoise-900">
          Mes abonnés {abonnes ? `(${abonnes.length})` : ''}
        </h2>

        {abonnes === null && <Spinner className="my-4" />}

        {abonnes?.length === 0 && (
          <p className="mt-3 text-sm text-ardoise-500">Aucun abonné pour l&apos;instant.</p>
        )}

        {abonnes?.length > 0 && (
          <ul className="mt-3 divide-y divide-ardoise-100">
            {abonnes.map((a) => (
              <li key={a._id} className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-ardoise-800">
                  {a.utilisateur?.prenom
                    ? `${a.utilisateur.prenom} ${a.utilisateur.nom}`
                    : a.utilisateur?.pseudo}
                  <span className="ml-1.5 text-xs text-ardoise-400">
                    @{a.utilisateur?.pseudo}
                  </span>
                </span>
                <span
                  className={
                    a.statut === 'impaye'
                      ? 'text-xs font-medium text-red-700'
                      : 'text-xs font-medium text-green-700'
                  }
                >
                  {a.statut === 'impaye' ? 'Paiement en échec' : 'Actif'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ---------------------------- Sous-composants ---------------------------- */

function EtapeManquante({ faite, titre, detail }) {
  return (
    <li className="flex gap-2.5">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          faite ? 'bg-green-100 text-green-700' : 'bg-ardoise-100 text-ardoise-400'
        }`}
        aria-hidden="true"
      >
        {faite ? '✓' : '•'}
      </span>
      <span>
        <span className={faite ? 'text-ardoise-500 line-through' : 'font-medium text-ardoise-800'}>
          {titre}
        </span>
        {!faite && <span className="block text-xs text-ardoise-500">{detail}</span>}
      </span>
    </li>
  );
}

function EtatStripe({ statut }) {
  const etats = {
    actif: { texte: 'Compte actif', classe: 'bg-green-100 text-green-800' },
    restreint: { texte: 'Informations manquantes', classe: 'bg-amber-100 text-amber-800' },
    en_attente: { texte: 'Inscription non commencée', classe: 'bg-ardoise-100 text-ardoise-600' },
  };
  const e = etats[statut] || etats.en_attente;

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${e.classe}`}>{e.texte}</span>
  );
}

function Chiffre({ libelle, valeur, ton = 'text-ardoise-900' }) {
  return (
    <div className="rounded-xl bg-ardoise-50 p-3">
      <p className="text-xs text-ardoise-500">{libelle}</p>
      <p className={`mt-0.5 text-lg font-bold ${ton}`}>{valeur}</p>
    </div>
  );
}
