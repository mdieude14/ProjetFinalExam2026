import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import searchApi from '@/api/search.api';
import BarreRecherche from '@/components/search/BarreRecherche';
import PostCard from '@/components/post/PostCard';
import EventCard from '@/components/event/EventCard';
import Avatar from '@/components/ui/Avatar';
import Badge from '@/components/ui/Badge';
import Alert from '@/components/ui/Alert';
import Spinner from '@/components/ui/Spinner';

/**
 * Recherche — /recherche
 *
 * LE TERME VIT DANS L'URL, PAS DANS UN ÉTAT LOCAL.
 * `?q=natation` rend la recherche partageable, rechargeable et navigable au
 * bouton « précédent ». Rangé dans un `useState`, le même terme disparaîtrait
 * au premier rafraîchissement, et un lien vers des résultats serait
 * impossible à envoyer.
 *
 * QUATRE ONGLETS, DONT UN QUI N'EST PAS COMME LES AUTRES.
 * « Tout » interroge les trois familles en une requête — le serveur les lance
 * en parallèle — et n'en montre qu'un aperçu. Les trois autres interrogent
 * une seule famille et en montrent davantage. Charger les quatre d'un coup
 * ferait payer trois requêtes pour un onglet regardé.
 */

const ONGLETS = [
  { cle: 'tout', libelle: 'Tout' },
  { cle: 'personnes', libelle: 'Personnes' },
  { cle: 'publications', libelle: 'Publications' },
  { cle: 'evenements', libelle: 'Événements' },
];

/** Une personne dans les résultats. */
function LignePersonne({ personne }) {
  return (
    <li className="flex items-center gap-3 rounded-carte border border-ardoise-200 bg-white p-3.5">
      <Link to={`/profile/${personne.pseudo}`} className="shrink-0">
        <Avatar utilisateur={personne} taille="md" />
      </Link>

      <div className="min-w-0 flex-1">
        <Link
          to={`/profile/${personne.pseudo}`}
          className="font-semibold text-ardoise-900 hover:underline"
        >
          {personne.prenom ? `${personne.prenom} ${personne.nom}` : personne.pseudo}
        </Link>
        <p className="truncate text-xs text-ardoise-400">@{personne.pseudo}</p>

        {personne.bio && (
          <p className="mt-0.5 line-clamp-2 text-xs text-ardoise-600">{personne.bio}</p>
        )}

        <p className="mt-0.5 truncate text-xs text-ardoise-500">
          {personne.ville}
          {personne.sports?.length > 0 && ` · ${personne.sports.join(' · ')}`}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        {personne.estCertifie && <Badge variante="succes">✓ Certifié</Badge>}
        {/* Un profil privé reste trouvable : c'est la règle du module 4. On
            le dit, plutôt que de laisser croire à un profil vide. */}
        {personne.visibilite === 'prive' && <Badge variante="neutre">Privé</Badge>}
      </div>
    </li>
  );
}

/**
 * Message affiché quand la recherche ne ramène rien.
 *
 * IL NOMME LA FAMILLE INTERROGÉE, et ce n'est pas un détail de formulation.
 * « Aucun résultat » sur l'onglet « Personnes » laisse croire que le terme
 * n'existe nulle part, alors que l'événement cherché est peut-être à un clic,
 * dans l'onglet voisin. Nommer le périmètre transforme une impasse apparente
 * en indication de l'endroit où regarder.
 *
 * Un composant vide par section avait d'abord été écrit : il était
 * INATTEIGNABLE. Une famille vide sur son propre onglet donne un total nul,
 * donc ce bloc-ci — jamais l'autre. Le test l'a montré en cherchant le
 * mauvais message.
 */
const LIBELLE_VIDE = {
  tout: 'Aucun résultat pour',
  personnes: 'Aucune personne pour',
  publications: 'Aucune publication pour',
  evenements: 'Aucun événement pour',
};

export default function Search() {
  const [parametres, setParametres] = useSearchParams();
  const terme = parametres.get('q') || '';

  const [onglet, setOnglet] = useState('tout');
  const [resultats, setResultats] = useState(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState(null);

  const requeteEnCours = useRef(null);

  const chercher = useCallback(async () => {
    if (terme.trim().length < 2) {
      setResultats(null);
      return;
    }

    // Même précaution que dans la barre : une réponse lente ne doit pas
    // écraser une réponse plus récente.
    requeteEnCours.current?.abort();
    const controleur = new AbortController();
    requeteEnCours.current = controleur;

    setChargement(true);
    setErreur(null);

    try {
      const options = { signal: controleur.signal, limite: onglet === 'tout' ? 6 : 20 };

      if (onglet === 'tout') {
        const reponse = await searchApi.globale(terme, options);
        setResultats(reponse.data);
      } else if (onglet === 'personnes') {
        const reponse = await searchApi.utilisateurs(terme, options);
        setResultats({ utilisateurs: reponse.data.utilisateurs });
      } else if (onglet === 'publications') {
        const reponse = await searchApi.publications(terme, options);
        setResultats({ publications: reponse.data.publications });
      } else {
        const reponse = await searchApi.evenements(terme, options);
        setResultats({ evenements: reponse.data.evenements });
      }
    } catch (e) {
      // Une annulation n'est pas un incident : elle survient à chaque
      // changement d'onglet ou de terme, et afficher « requête annulée »
      // serait un message d'erreur pour un fonctionnement normal.
      if (e.code !== 'ERR_CANCELED') setErreur(e.message);
    } finally {
      if (!controleur.signal.aborted) setChargement(false);
    }
  }, [terme, onglet]);

  useEffect(() => {
    chercher();
  }, [chercher]);

  const personnes = resultats?.utilisateurs || [];
  const publications = resultats?.publications || [];
  const evenements = resultats?.evenements || [];
  const total = personnes.length + publications.length + evenements.length;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ardoise-900">Recherche</h1>

      <BarreRecherche
        valeurInitiale={terme}
        autoFocus={!terme}
        surRecherche={(q) => setParametres({ q })}
      />

      {terme.trim().length < 2 ? (
        <div className="rounded-carte border border-ardoise-200 bg-white p-8 text-center">
          <p className="text-sm text-ardoise-600">
            Saisissez au moins deux caractères.
          </p>
          <p className="mt-1 text-xs text-ardoise-500">
            Les suggestions apparaissent dès la deuxième lettre ; validez pour
            chercher aussi dans les publications et les événements.
          </p>
        </div>
      ) : (
        <>
          <nav
            className="flex gap-1 overflow-x-auto rounded-carte border border-ardoise-200 bg-white p-1"
            aria-label="Types de résultats"
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

          {chargement && <Spinner className="mx-auto my-8" />}

          {!chargement && resultats && total === 0 && (
            <div className="rounded-carte border border-ardoise-200 bg-white p-8 text-center">
              <p className="text-sm text-ardoise-600">
                {LIBELLE_VIDE[onglet]} « {terme} ».
              </p>
              <p className="mt-1 text-xs text-ardoise-500">
                Vérifiez l&apos;orthographe, ou essayez un mot plus court.
              </p>
            </div>
          )}

          {!chargement && resultats && total > 0 && (
            <div className="space-y-6">
              {/* ---------------------- Personnes ---------------------- */}
              {(onglet === 'tout' || onglet === 'personnes') && (
                <section>
                  {onglet === 'tout' && (
                    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ardoise-500">
                      Personnes
                    </h2>
                  )}

                  {personnes.length === 0 ? null : (
                    <ul className="space-y-2">
                      {personnes.map((personne) => (
                        <LignePersonne key={personne._id} personne={personne} />
                      ))}
                    </ul>
                  )}
                </section>
              )}

              {/* -------------------- Publications --------------------- */}
              {(onglet === 'tout' || onglet === 'publications') && (
                <section>
                  {onglet === 'tout' && (
                    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ardoise-500">
                      Publications
                    </h2>
                  )}

                  {publications.length === 0 ? null : (
                    <div className="space-y-3">
                      {publications.map((post) => (
                        <PostCard key={post._id} post={post} />
                      ))}
                    </div>
                  )}
                </section>
              )}

              {/* ---------------------- Événements --------------------- */}
              {(onglet === 'tout' || onglet === 'evenements') && (
                <section>
                  {onglet === 'tout' && (
                    <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ardoise-500">
                      Événements
                    </h2>
                  )}

                  {evenements.length === 0 ? null : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {evenements.map((evenement) => (
                        <EventCard key={evenement._id} evenement={evenement} />
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
