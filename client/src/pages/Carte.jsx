import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';

import geoApi from '@/api/geo.api';
import usePosition from '@/hooks/usePosition';
import CarteCoachs, { formaterDistance } from '@/components/map/CarteCoachs';
import { formaterPrix } from '@/utils/prix';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import Spinner from '@/components/ui/Spinner';

/**
 * Carte des coachs — /carte
 *
 * DEUX MODES, SELON QUE LA POSITION EST CONNUE OU NON.
 *
 *   position connue   carte centrée, cercle de recherche, résultats triés
 *                     par distance
 *   position refusée  liste des villes où des coachs sont visibles
 *
 * Le second n'est pas un message d'erreur déguisé : c'est un mode de
 * navigation à part entière. Refuser de partager sa position est un choix
 * légitime, et fréquent ; répondre par un écran vide reviendrait à punir ce
 * choix. On propose donc autre chose, pas une excuse.
 *
 * LA POSITION N'EST JAMAIS DEMANDÉE AUTOMATIQUEMENT AU CHARGEMENT.
 * Une fenêtre de permission qui surgit sans que l'utilisateur ait rien
 * demandé se solde le plus souvent par un refus définitif — que le navigateur
 * mémorise. Le bouton explicite obtient bien plus d'accords.
 */

const RAYONS = [
  { valeur: 5000, libelle: '5 km' },
  { valeur: 15000, libelle: '15 km' },
  { valeur: 25000, libelle: '25 km' },
  { valeur: 50000, libelle: '50 km' },
  { valeur: 100000, libelle: '100 km' },
];

export default function Carte() {
  const { position, erreur: erreurPosition, chargement: localisationEnCours, demander } =
    usePosition();

  const [coachs, setCoachs] = useState([]);
  const [rayon, setRayon] = useState(25000);
  const [sport, setSport] = useState('');
  const [certifies, setCertifies] = useState(false);
  const [offre, setOffre] = useState(false);

  const [sportsDispo, setSportsDispo] = useState([]);
  const [villes, setVilles] = useState([]);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [selection, setSelection] = useState(null);

  /* ------------------------- Données indépendantes ------------------------ */

  // Sports et villes ne dépendent pas de la position : on les charge tout de
  // suite, ils servent aussi bien au filtre qu'au mode de repli.
  useEffect(() => {
    geoApi.sports().then((r) => setSportsDispo(r.data.sports || [])).catch(() => {});
    geoApi.villes().then((r) => setVilles(r.data.villes || [])).catch(() => {});
  }, []);

  /* ---------------------------- Recherche ---------------------------- */

  const rechercher = useCallback(async () => {
    if (!position) return;

    setChargement(true);
    setErreur(null);
    try {
      const reponse = await geoApi.coachsAutour({
        lng: position.lng,
        lat: position.lat,
        rayon,
        sport: sport || undefined,
        certifies,
        offre,
      });
      setCoachs(reponse.data.coachs || []);
    } catch (e) {
      setErreur(e.message);
      setCoachs([]);
    } finally {
      setChargement(false);
    }
  }, [position, rayon, sport, certifies, offre]);

  // Relance à chaque changement de position ou de filtre : la carte et la
  // liste doivent toujours montrer le même jeu de résultats.
  useEffect(() => {
    rechercher();
  }, [rechercher]);

  const centre = useMemo(
    () => (position ? { lng: position.lng, lat: position.lat } : null),
    [position]
  );

  /* ------------------------------ Rendu ------------------------------ */

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-ardoise-900">Coachs près de chez vous</h1>
        {position && (
          <span className="text-xs text-ardoise-500">
            {chargement
              ? 'Recherche…'
              : `${coachs.length} coach${coachs.length > 1 ? 's' : ''} dans un rayon de ${
                  rayon / 1000
                } km`}
          </span>
        )}
      </div>

      {erreur && <Alert variante="erreur">{erreur}</Alert>}

      {/* ============ Sans position : invitation ou repli ============ */}
      {!position && (
        <section className="rounded-carte border border-ardoise-200 bg-white p-5 sm:p-6">
          {!erreurPosition && (
            <>
              <h2 className="text-base font-bold text-ardoise-900">
                Autoriser la géolocalisation
              </h2>
              <p className="mt-1 text-sm text-ardoise-600">
                Votre position sert uniquement à calculer les distances. Elle
                n&apos;est ni enregistrée ni transmise à qui que ce soit.
              </p>
              <Button className="mt-4" chargement={localisationEnCours} onClick={demander}>
                Me localiser
              </Button>
            </>
          )}

          {erreurPosition && (
            <>
              <Alert variante={erreurPosition.refusee ? 'info' : 'alerte'}>
                {erreurPosition.message}
                {erreurPosition.refusee
                  ? ' Vous pouvez parcourir les villes ci-dessous.'
                  : ' Vous pouvez réessayer, ou parcourir les villes ci-dessous.'}
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

              <h3 className="mt-5 text-sm font-semibold text-ardoise-800">
                Villes où des coachs sont présents
              </h3>

              {villes.length === 0 ? (
                <p className="mt-2 text-sm text-ardoise-500">
                  Aucun coach ne s&apos;est encore rendu visible sur la carte.
                </p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {villes.map((v) => (
                    <li
                      key={v.ville}
                      className="rounded-full bg-ardoise-100 px-3 py-1.5 text-sm text-ardoise-700"
                    >
                      {v.ville}
                      <span className="ml-1.5 text-xs text-ardoise-500">
                        {v.nombre} coach{v.nombre > 1 ? 's' : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}

      {/* ============ Filtres ============ */}
      {position && (
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
              <select
                value={sport}
                onChange={(e) => setSport(e.target.value)}
                className="rounded-xl border border-ardoise-200 px-3 py-2 text-sm"
              >
                <option value="">Tous les sports</option>
                {sportsDispo.map((s) => (
                  <option key={s.sport} value={s.sport}>
                    {s.sport} ({s.nombre})
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 py-2 text-sm text-ardoise-700">
              <input
                type="checkbox"
                checked={certifies}
                onChange={(e) => setCertifies(e.target.checked)}
                className="h-4 w-4 rounded border-ardoise-300"
              />
              Certifiés seulement
            </label>

            <label className="flex items-center gap-2 py-2 text-sm text-ardoise-700">
              <input
                type="checkbox"
                checked={offre}
                onChange={(e) => setOffre(e.target.checked)}
                className="h-4 w-4 rounded border-ardoise-300"
              />
              Avec offre premium
            </label>
          </div>
        </section>
      )}

      {/* ============ Carte ============ */}
      <CarteCoachs
        centre={centre}
        rayonM={rayon}
        coachs={coachs}
        surSelection={setSelection}
        hauteur="60vh"
      />

      {/* ============ Liste, synchronisée avec la carte ============ */}
      {position && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ardoise-500">
            Résultats
          </h2>

          {chargement && <Spinner className="mx-auto my-6" />}

          {!chargement && coachs.length === 0 && (
            <div className="rounded-carte border border-ardoise-200 bg-white p-6 text-center">
              <p className="text-sm text-ardoise-600">
                Aucun coach ne correspond dans ce rayon.
              </p>
              <p className="mt-1 text-xs text-ardoise-500">
                Élargissez le rayon, ou retirez un filtre.
              </p>
            </div>
          )}

          <ul className="space-y-2">
            {coachs.map((coach) => (
              <li
                key={coach._id}
                className={`rounded-carte border bg-white p-3.5 transition-colors ${
                  selection?._id === coach._id
                    ? 'border-marque-400 bg-marque-50'
                    : 'border-ardoise-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Link to={`/profile/${coach.pseudo}`} className="shrink-0">
                    <Avatar utilisateur={coach} taille="sm" />
                  </Link>

                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/profile/${coach.pseudo}`}
                      className="font-semibold text-ardoise-900 hover:underline"
                    >
                      {coach.prenom ? `${coach.prenom} ${coach.nom}` : coach.pseudo}
                    </Link>
                    <p className="truncate text-xs text-ardoise-400">@{coach.pseudo}</p>
                    <p className="truncate text-xs text-ardoise-500">
                      {coach.estCertifie && '✓ Certifié · '}
                      {coach.ville}
                      {coach.distanceM !== undefined &&
                        ` · à environ ${formaterDistance(coach.distanceM)}`}
                    </p>
                    {coach.sports?.length > 0 && (
                      <p className="truncate text-xs text-ardoise-600">
                        {coach.sports.join(' · ')}
                      </p>
                    )}
                  </div>

                  {coach.premium?.prixMensuel && (
                    <span className="shrink-0 text-xs font-semibold text-marque-600">
                      {formaterPrix(coach.premium.prixMensuel, coach.premium.devise)}/mois
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
