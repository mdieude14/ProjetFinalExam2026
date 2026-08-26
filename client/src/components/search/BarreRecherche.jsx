import { useState, useEffect, useRef, useId } from 'react';
import { useNavigate } from 'react-router-dom';

import searchApi from '@/api/search.api';
import useDebounce from '@/hooks/useDebounce';
import Avatar from '@/components/ui/Avatar';

/**
 * Barre de recherche avec autocomplétion.
 *
 * TROIS PROBLÈMES QUE CE COMPOSANT RÉSOUT, ET QU'ON NE VOIT PAS À L'ÉCRAN :
 *
 *   1. LE VOLUME. Sans délai d'attente, huit lettres font huit requêtes.
 *      `useDebounce` n'en laisse partir qu'une, à la pause dans la frappe.
 *
 *   2. L'ORDRE D'ARRIVÉE. Rien ne garantit que la réponse à « nat » revienne
 *      avant celle à « natation » : la liste régresserait sous les yeux de
 *      l'utilisateur. Chaque requête annule la précédente.
 *
 *   3. LE CLAVIER. Une liste de suggestions inaccessible aux flèches est
 *      inutilisable sans souris — et pénible avec, sur un ordinateur portable.
 *
 * ACCESSIBILITÉ : le motif ARIA est celui d'une `combobox`. Sans
 * `aria-activedescendant`, un lecteur d'écran n'annonce pas la suggestion
 * survolée au clavier, et la navigation devient silencieuse.
 */
export default function BarreRecherche({ valeurInitiale = '', surRecherche, autoFocus }) {
  const naviguer = useNavigate();
  const idListe = useId();

  const [saisie, setSaisie] = useState(valeurInitiale);
  const [suggestions, setSuggestions] = useState([]);
  const [ouvert, setOuvert] = useState(false);
  const [surligne, setSurligne] = useState(-1);

  const conteneur = useRef(null);
  const requeteEnCours = useRef(null);

  const saisieRetardee = useDebounce(saisie, 300);

  /* ------------------------- Suggestions ------------------------- */

  useEffect(() => {
    const terme = saisieRetardee.trim();

    // Le serveur refuse en dessous de deux caractères : inutile de lui
    // envoyer une requête dont on connaît déjà le sort.
    if (terme.length < 2) {
      setSuggestions([]);
      return;
    }

    // Annulation de la requête précédente : voir le point 2 en tête de fichier.
    requeteEnCours.current?.abort();
    const controleur = new AbortController();
    requeteEnCours.current = controleur;

    searchApi
      .suggestions(terme, { signal: controleur.signal })
      .then((reponse) => {
        setSuggestions(reponse.data.suggestions || []);
        setSurligne(-1);
      })
      .catch(() => {
        /*
         * Une annulation lève ici comme une erreur — c'est le comportement
         * normal, pas un incident. Et un échec réseau sur une SUGGESTION ne
         * mérite pas de message : l'utilisateur est en train de taper, lui
         * jeter une alerte rouge à la troisième lettre serait absurde. La
         * recherche validée, elle, signale ses erreurs.
         */
      });

    return () => controleur.abort();
  }, [saisieRetardee]);

  /* ---------------------- Fermeture au clic ---------------------- */

  useEffect(() => {
    const surClic = (evenement) => {
      if (!conteneur.current?.contains(evenement.target)) setOuvert(false);
    };

    document.addEventListener('mousedown', surClic);
    return () => document.removeEventListener('mousedown', surClic);
  }, []);

  /* --------------------------- Actions --------------------------- */

  const lancer = (terme) => {
    const propre = (terme ?? saisie).trim();
    if (propre.length < 2) return;

    setOuvert(false);
    if (surRecherche) surRecherche(propre);
    else naviguer(`/recherche?q=${encodeURIComponent(propre)}`);
  };

  const allerAuProfil = (personne) => {
    setOuvert(false);
    setSaisie('');
    naviguer(`/profile/${personne.pseudo}`);
  };

  const surTouche = (evenement) => {
    if (evenement.key === 'ArrowDown') {
      evenement.preventDefault();
      setOuvert(true);
      setSurligne((i) => Math.min(i + 1, suggestions.length - 1));
      return;
    }

    if (evenement.key === 'ArrowUp') {
      evenement.preventDefault();
      setSurligne((i) => Math.max(i - 1, -1));
      return;
    }

    if (evenement.key === 'Enter') {
      evenement.preventDefault();
      // Une suggestion surlignée l'emporte sur la saisie brute : c'est elle
      // que l'utilisateur regardait au moment d'appuyer.
      if (surligne >= 0 && suggestions[surligne]) allerAuProfil(suggestions[surligne]);
      else lancer();
      return;
    }

    if (evenement.key === 'Escape') {
      /*
       * `preventDefault` EST INDISPENSABLE ICI, et son absence produit un
       * défaut qu'on n'attribue jamais spontanément au navigateur.
       *
       * Sur un `input type="search"`, Échap a une action native : VIDER LE
       * CHAMP. Cette action déclenche `onChange`, qui rouvre la liste. Le
       * résultat observé est absurde — Échap efface la saisie et laisse les
       * suggestions ouvertes, soit exactement l'inverse des deux intentions.
       *
       * Le défaut ne se voit pas en lisant ce fichier : le code dit
       * « fermer », et c'est le navigateur qui fait autre chose derrière.
       */
      evenement.preventDefault();
      setOuvert(false);
      setSurligne(-1);
    }
  };

  const listeVisible = ouvert && suggestions.length > 0;

  return (
    <div ref={conteneur} className="relative w-full">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          lancer();
        }}
      >
        <input
          type="search"
          value={saisie}
          autoFocus={autoFocus}
          onChange={(e) => {
            setSaisie(e.target.value);
            setOuvert(true);
          }}
          onFocus={() => setOuvert(true)}
          onKeyDown={surTouche}
          placeholder="Rechercher une personne, une publication, un événement…"
          aria-label="Rechercher"
          role="combobox"
          aria-expanded={listeVisible}
          aria-controls={idListe}
          aria-autocomplete="list"
          aria-activedescendant={
            surligne >= 0 && suggestions[surligne]
              ? `${idListe}-${suggestions[surligne]._id}`
              : undefined
          }
          className="w-full rounded-xl border border-ardoise-200 bg-white px-4 py-2.5 text-sm text-ardoise-900 placeholder:text-ardoise-400 focus:border-marque-500 focus:outline-none focus:ring-2 focus:ring-marque-500/30"
        />
      </form>

      {listeVisible && (
        <ul
          id={idListe}
          role="listbox"
          aria-label="Suggestions"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-xl border border-ardoise-200 bg-white py-1 shadow-lg"
        >
          {suggestions.map((personne, index) => (
            <li
              key={personne._id}
              id={`${idListe}-${personne._id}`}
              role="option"
              aria-selected={index === surligne}
            >
              <button
                type="button"
                /*
                 * `onMouseDown` et non `onClick` : le clic retire d'abord le
                 * focus du champ, ce qui ferme la liste — et le bouton
                 * disparaît avant d'avoir reçu le clic. `mousedown` part
                 * avant la perte de focus.
                 */
                onMouseDown={() => allerAuProfil(personne)}
                onMouseEnter={() => setSurligne(index)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${
                  index === surligne ? 'bg-marque-50' : 'hover:bg-ardoise-50'
                }`}
              >
                <Avatar utilisateur={personne} taille="sm" />

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ardoise-900">
                    {personne.prenom
                      ? `${personne.prenom} ${personne.nom}`
                      : personne.pseudo}
                    {personne.estCertifie && (
                      <span className="ml-1 text-marque-600" title="Coach certifié">
                        ✓
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-ardoise-500">
                    @{personne.pseudo}
                    {personne.ville ? ` · ${personne.ville}` : ''}
                  </span>
                </span>

                {personne.type === 'coach' && (
                  <span className="shrink-0 text-xs text-ardoise-400">Coach</span>
                )}
              </button>
            </li>
          ))}

          {/* Sortie de secours vers la page de résultats : les suggestions ne
              montrent que des personnes, la recherche complète va plus loin. */}
          <li>
            <button
              type="button"
              onMouseDown={() => lancer()}
              className="w-full border-t border-ardoise-100 px-3 py-2 text-left text-xs font-semibold text-marque-600 hover:bg-marque-50"
            >
              Voir tous les résultats pour « {saisie.trim()} »
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
