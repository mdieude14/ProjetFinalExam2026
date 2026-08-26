import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import eventApi from '@/api/event.api';
import useAuth from '@/hooks/useAuth';
import usePosition from '@/hooks/usePosition';
import EventCard from '@/components/event/EventCard';
import EventForm from '@/components/event/EventForm';
import CarteEvenements from '@/components/map/CarteEvenements';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';

/**
 * Événements sportifs — /evenements
 *
 * TROIS ONGLETS, PARCE QUE CE SONT TROIS QUESTIONS DIFFÉRENTES :
 *
 *   À venir          « qu'est-ce qui se passe ? »        liste + filtres
 *   Autour de moi    « qu'est-ce qui se passe ICI ? »    carte + distance
 *   Mes inscriptions « où me suis-je engagé ? »          agenda personnel
 *
 * Les fondre en un seul écran obligerait à empiler filtres, carte et agenda,
 * et à charger les trois jeux de données pour n'en regarder qu'un.
 *
 * LA POSITION N'EST JAMAIS DEMANDÉE AU CHARGEMENT — même règle qu'au module 8.
 * Une fenêtre de permission qui surgit sans que rien ne l'ait demandée se
 * solde le plus souvent par un refus, que le navigateur mémorise ensuite.
 * L'onglet « Autour de moi » propose le bouton, l'utilisateur décide.
 */

const RAYONS = [
  { valeur: 5000, libelle: '5 km' },
  { valeur: 15000, libelle: '15 km' },
  { valeur: 25000, libelle: '25 km' },
  { valeur: 50000, libelle: '50 km' },
  { valeur: 100000, libelle: '100 km' },
];

const ONGLETS = [
  { cle: 'avenir', libelle: 'À venir' },
  { cle: 'proches', libelle: 'Autour de moi' },
  { cle: 'miennes', libelle: 'Mes inscriptions' },
];

export default function Events() {
  const { utilisateur } = useAuth();
  const naviguer = useNavigate();

  const {
    position,
    erreur: erreurPosition,
    chargement: localisationEnCours,
    demander,
  } = usePosition();

  const [onglet, setOnglet] = useState('avenir');
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [erreur, setErreur] = useState(null);

  /* --------------------------- Onglet « à venir » --------------------------- */

  const [evenements, setEvenements] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [chargement, setChargement] = useState(false);
  const [filtres, setFiltres] = useState({ ville: '', sport: '', type: '' });
  const [rechercheVille, setRechercheVille] = useState('');

  /* -------------------------- Onglet « autour de moi » -------------------------- */

  const [proches, setProches] = useState([]);
  const [rayon, setRayon] = useState(25000);
  const [selection, setSelection] = useState(null);

  /* ------------------------- Onglet « mes inscriptions » ------------------------ */

  const [inscriptions, setInscriptions] = useState([]);

  /*
   * Un coach dont le diplôme n'est pas vérifié ne peut pas créer d'événement :
   * le serveur refuse. On n'affiche donc pas le bouton — proposer une action
   * vouée au refus est la meilleure façon de faire croire à une panne.
   */
  const peutCreer = utilisateur?.type === 'coach' && utilisateur?.estCertifie;

  /* ------------------------------ Chargements ------------------------------ */

  const chargerListe = useCallback(
    async (page = 1) => {
      setChargement(true);
      setErreur(null);
      try {
        const reponse = await eventApi.liste({ ...filtres, page });
        // Page 1 : on remplace. Pages suivantes : on ajoute, sinon
        // « charger plus » effacerait ce qui vient d'être lu.
        setEvenements((precedents) =>
          page === 1 ? reponse.data.elements : [...precedents, ...reponse.data.elements]
        );
        setPagination(reponse.data.pagination);
      } catch (e) {
        setErreur(e.message);
      } finally {
        setChargement(false);
      }
    },
    [filtres]
  );

  const chargerProches = useCallback(async () => {
    if (!position) return;

    setChargement(true);
    setErreur(null);
    try {
      const reponse = await eventApi.proches({
        lng: position.lng,
        lat: position.lat,
        rayon,
        sport: filtres.sport || undefined,
      });
      setProches(reponse.data.evenements || []);
    } catch (e) {
      setErreur(e.message);
      setProches([]);
    } finally {
      setChargement(false);
    }
  }, [position, rayon, filtres.sport]);

  const chargerInscriptions = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      const reponse = await eventApi.mesInscriptions({ limite: 50 });
      setInscriptions(reponse.data.elements || []);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setChargement(false);
    }
  }, []);

  // Chaque onglet ne charge que ses propres données, et seulement quand il
  // est affiché : ouvrir la page ne doit pas déclencher trois requêtes dont
  // deux ne seront jamais regardées.
  useEffect(() => {
    if (onglet === 'avenir') chargerListe(1);
    if (onglet === 'proches') chargerProches();
    if (onglet === 'miennes') chargerInscriptions();
  }, [onglet, chargerListe, chargerProches, chargerInscriptions]);

  const centre = useMemo(
    () => (position ? { lng: position.lng, lat: position.lat } : null),
    [position]
  );

  /* -------------------------------- Rendu -------------------------------- */

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-ardoise-900">Événements</h1>

        {peutCreer && (
          <Button onClick={() => setFormulaireOuvert(true)}>Créer un événement</Button>
        )}
      </div>

      {/* ---------------------------- Onglets ---------------------------- */}
      <nav
        className="flex gap-1 overflow-x-auto rounded-carte border border-ardoise-200 bg-white p-1"
        aria-label="Vues des événements"
      >
        {ONGLETS.map((o) => (
          <button
            key={o.cle}
            onClick={() => setOnglet(o.cle)}
            aria-current={onglet === o.cle ? 'page' : undefined}
            className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
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

      {/* ========================= À VENIR ========================= */}
      {onglet === 'avenir' && (
        <>
          <section className="rounded-carte border border-ardoise-200 bg-white p-4">
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                setFiltres((f) => ({ ...f, ville: rechercheVille.trim() }));
              }}
            >
              <label className="text-sm">
                <span className="mb-1 block font-medium text-ardoise-700">Ville</span>
                <input
                  value={rechercheVille}
                  onChange={(e) => setRechercheVille(e.target.value)}
                  placeholder="Toutes les villes"
                  className="rounded-xl border border-ardoise-200 px-3 py-2 text-sm"
                />
              </label>

              <label className="text-sm">
                <span className="mb-1 block font-medium text-ardoise-700">Sport</span>
                <input
                  value={filtres.sport}
                  onChange={(e) => setFiltres((f) => ({ ...f, sport: e.target.value }))}
                  placeholder="Tous les sports"
                  className="rounded-xl border border-ardoise-200 px-3 py-2 text-sm"
                />
              </label>

              <label className="text-sm">
                <span className="mb-1 block font-medium text-ardoise-700">Accès</span>
                <select
                  value={filtres.type}
                  onChange={(e) => setFiltres((f) => ({ ...f, type: e.target.value }))}
                  className="rounded-xl border border-ardoise-200 px-3 py-2 text-sm"
                >
                  <option value="">Tous</option>
                  <option value="public">Ouverts à tous</option>
                  <option value="prive">Réservés aux abonnés</option>
                </select>
              </label>

              <Button type="submit" variante="secondaire">
                Filtrer
              </Button>
            </form>
          </section>

          {chargement && evenements.length === 0 && <Spinner className="mx-auto my-8" />}

          {!chargement && evenements.length === 0 && (
            <div className="rounded-carte border border-ardoise-200 bg-white p-6 text-center">
              <p className="text-sm text-ardoise-600">Aucun événement à venir.</p>
              <p className="mt-1 text-xs text-ardoise-500">
                {filtres.ville || filtres.sport || filtres.type
                  ? 'Essayez de retirer un filtre.'
                  : 'Les coachs certifiés peuvent en organiser depuis cette page.'}
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {evenements.map((evenement) => (
              <EventCard key={evenement._id} evenement={evenement} />
            ))}
          </div>

          {pagination?.aSuivante && (
            <div className="flex justify-center">
              <Button
                variante="secondaire"
                chargement={chargement}
                onClick={() => chargerListe(pagination.page + 1)}
              >
                Charger la suite
              </Button>
            </div>
          )}
        </>
      )}

      {/* ====================== AUTOUR DE MOI ====================== */}
      {onglet === 'proches' && (
        <>
          {!position && (
            <section className="rounded-carte border border-ardoise-200 bg-white p-5">
              {!erreurPosition ? (
                <>
                  <h2 className="text-base font-bold text-ardoise-900">
                    Autoriser la géolocalisation
                  </h2>
                  <p className="mt-1 text-sm text-ardoise-600">
                    Votre position sert uniquement à calculer les distances. Elle
                    n&apos;est ni enregistrée ni transmise.
                  </p>
                  <Button
                    className="mt-4"
                    chargement={localisationEnCours}
                    onClick={demander}
                  >
                    Me localiser
                  </Button>
                </>
              ) : (
                <>
                  <Alert variante={erreurPosition.refusee ? 'info' : 'alerte'}>
                    {erreurPosition.message}{' '}
                    {erreurPosition.refusee
                      ? 'L’onglet « À venir » permet de filtrer par ville.'
                      : 'Vous pouvez réessayer, ou filtrer par ville dans l’onglet « À venir ».'}
                  </Alert>

                  {/* Réessayer n'a de sens que si le refus ne vient pas de
                      l'utilisateur : le navigateur ne redemandera rien tant
                      qu'il n'aura pas changé son choix lui-même. */}
                  {!erreurPosition.refusee && (
                    <Button
                      variante="secondaire"
                      className="mt-3"
                      chargement={localisationEnCours}
                      onClick={demander}
                    >
                      Réessayer
                    </Button>
                  )}
                </>
              )}
            </section>
          )}

          {position && (
            <>
              <section className="rounded-carte border border-ardoise-200 bg-white p-4">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-sm">
                    <span className="mb-1 block font-medium text-ardoise-700">Rayon</span>
                    <select
                      value={rayon}
                      onChange={(e) => setRayon(Number(e.target.value))}
                      className="rounded-xl border border-ardoise-200 px-3 py-2 text-sm"
                    >
                      {RAYONS.map((r) => (
                        <option key={r.valeur} value={r.valeur}>
                          {r.libelle}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-sm">
                    <span className="mb-1 block font-medium text-ardoise-700">Sport</span>
                    <input
                      value={filtres.sport}
                      onChange={(e) => setFiltres((f) => ({ ...f, sport: e.target.value }))}
                      placeholder="Tous les sports"
                      className="rounded-xl border border-ardoise-200 px-3 py-2 text-sm"
                    />
                  </label>

                  <span className="py-2 text-xs text-ardoise-500">
                    {chargement ? 'Recherche…' : `${proches.length} événement(s)`}
                  </span>
                </div>
              </section>

              <CarteEvenements
                centre={centre}
                rayonM={rayon}
                evenements={proches}
                surSelection={setSelection}
              />

              {/*
                Un événement privé perd ses coordonnées pour un non-abonné :
                il ne peut pas figurer sur la carte, mais il reste dans cette
                liste. Le retirer des deux vues laisserait croire qu'il
                n'existe pas — et supprimerait l'argument qui donne envie de
                s'abonner.
              */}
              <div className="grid gap-3 sm:grid-cols-2">
                {proches.map((evenement) => (
                  <EventCard
                    key={evenement._id}
                    evenement={evenement}
                    actif={selection?._id === evenement._id}
                    surSurvol={setSelection}
                  />
                ))}
              </div>

              {!chargement && proches.length === 0 && (
                <div className="rounded-carte border border-ardoise-200 bg-white p-6 text-center">
                  <p className="text-sm text-ardoise-600">
                    Aucun événement dans ce rayon.
                  </p>
                  <p className="mt-1 text-xs text-ardoise-500">
                    Élargissez le rayon, ou retirez le filtre de sport.
                  </p>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ====================== MES INSCRIPTIONS ====================== */}
      {onglet === 'miennes' && (
        <>
          {chargement && inscriptions.length === 0 && <Spinner className="mx-auto my-8" />}

          {!chargement && inscriptions.length === 0 && (
            <div className="rounded-carte border border-ardoise-200 bg-white p-6 text-center">
              <p className="text-sm text-ardoise-600">
                Vous n&apos;êtes inscrit à aucun événement.
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {inscriptions.map((inscription) => (
              <EventCard key={inscription._id} evenement={inscription.event} />
            ))}
          </div>
        </>
      )}

      {/* ========================= Création ========================= */}
      <Modal
        ouvert={formulaireOuvert}
        onFermer={() => setFormulaireOuvert(false)}
        titre="Nouvel événement"
        taille="lg"
      >
        <EventForm
          surAnnuler={() => setFormulaireOuvert(false)}
          surCree={(evenement) => {
            setFormulaireOuvert(false);
            // On emmène l'organisateur sur sa fiche : c'est là qu'il vérifie
            // ce qu'il vient de créer, et qu'il pourra la corriger.
            naviguer(`/evenements/${evenement._id}`);
          }}
        />
      </Modal>
    </div>
  );
}
