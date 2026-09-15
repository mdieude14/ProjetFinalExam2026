import { useEffect, useId, useRef, useState } from 'react';

/**
 * ===========================================================================
 *  MENU « ⋯ » — liste d'options déroulante
 * ===========================================================================
 *
 * COMPOSANT GÉNÉRIQUE, PLACÉ DANS `ui/` ET NON DANS `moderation/`.
 * Il ne sait rien de ce qu'il déroule : on lui passe des entrées, il gère
 * l'ouverture, la fermeture et le clavier. La modération est son premier
 * usage ; le menu d'une publication ou d'un événement s'y branchera sans une
 * ligne de plus.
 *
 * QUATRE COMPORTEMENTS QU'UN MENU DOIT AVOIR, ET QU'ON OUBLIE :
 *
 *   1. FERMER AU CLIC EXTÉRIEUR. Sans cela, le menu reste ouvert pendant
 *      qu'on fait autre chose, et deux menus peuvent s'afficher en même temps.
 *
 *   2. FERMER À ÉCHAP, en RENDANT LE FOCUS au bouton. Sans ce retour, la
 *      tabulation repart du début du document : l'utilisateur clavier est
 *      renvoyé en haut de la page pour avoir fermé un menu.
 *
 *   3. NAVIGUER AUX FLÈCHES. C'est ce qui distingue un menu d'une pile de
 *      boutons — et ce que les lecteurs d'écran annoncent grâce aux rôles.
 *
 *   4. S'ANNONCER. `aria-haspopup` dit qu'un menu va s'ouvrir,
 *      `aria-expanded` dit s'il est ouvert. Sans eux, le bouton est décrit
 *      comme un bouton ordinaire et rien ne signale ce qui vient de se passer.
 *
 * LE MENU S'OUVRE VERS LA GAUCHE (`right-0`). Il est posé tout à droite d'un
 * en-tête : ouvert vers la droite, il déborderait hors de l'écran.
 */
export default function MenuOptions({
  entrees = [],
  libelle = 'Options',
  alignement = 'droite',
  className = '',
}) {
  const [ouvert, setOuvert] = useState(false);
  const [indexActif, setIndexActif] = useState(-1);

  const conteneur = useRef(null);
  const bouton = useRef(null);
  const elements = useRef([]);

  const idMenu = useId();

  /* Les séparateurs ne sont pas focusables : on ne navigue que sur les actions. */
  const actionnables = entrees.filter((e) => e && !e.separateur);

  /* ------------------------------------------------------------------ *
   *  Fermeture au clic extérieur
   * ------------------------------------------------------------------ */
  useEffect(() => {
    if (!ouvert) return undefined;

    const surClic = (evenement) => {
      if (!conteneur.current?.contains(evenement.target)) setOuvert(false);
    };

    /*
     * `mousedown` ET NON `click`. Avec `click`, l'événement du bouton qui
     * vient d'ouvrir le menu remonterait jusqu'à ce gestionnaire dans la même
     * salve et le refermerait aussitôt : le menu ne s'ouvrirait jamais.
     */
    document.addEventListener('mousedown', surClic);
    return () => document.removeEventListener('mousedown', surClic);
  }, [ouvert]);

  /* ------------------------------------------------------------------ *
   *  Focus sur l'entrée active
   * ------------------------------------------------------------------ */
  useEffect(() => {
    if (ouvert && indexActif >= 0) elements.current[indexActif]?.focus();
  }, [ouvert, indexActif]);

  const fermer = ({ rendreFocus = true } = {}) => {
    setOuvert(false);
    setIndexActif(-1);
    if (rendreFocus) bouton.current?.focus();
  };

  /*
   * LE CLAVIER EST ECOUTE SUR LE DOCUMENT, PAS SUR LE MENU — ET C'EST LA
   * CORRECTION D'UN DEFAUT REEL, TROUVE PAR LE TEST NAVIGATEUR.
   *
   * L'ecouteur etait pose sur le div du menu. Or ouvrir a la SOURIS laisse le
   * focus sur le BOUTON : l'evenement clavier partait donc du bouton, ne
   * traversait jamais le menu, et Echap ne fermait rien. Le defaut ne se
   * voyait pas au clavier — ouvert par Entree, le focus etait deja dans le
   * menu et tout fonctionnait. Il ne touchait donc QUE le cas le plus
   * frequent : ouvrir d'un clic puis vouloir refermer.
   *
   * C'est le meme choix que `Modal.jsx` fait pour Echap, et pour la meme
   * raison : la touche doit agir quel que soit l'element qui a le focus.
   */
  useEffect(() => {
    if (!ouvert) return undefined;
    document.addEventListener('keydown', surTouche);
    return () => document.removeEventListener('keydown', surTouche);
    /*
     * Les dependances se limitent a ces deux valeurs parce que TOUTES les
     * mises a jour d'etat du gestionnaire sont fonctionnelles
     * (setIndexActif((i) => ...)) : il n'a donc jamais besoin de lire
     * l'index courant, et une fermeture obsolete ne peut pas le figer.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert, actionnables.length]);

  function surTouche(evenement) {
    const dernier = actionnables.length - 1;

    switch (evenement.key) {
      case 'Escape':
        evenement.preventDefault();
        fermer();
        break;

      case 'ArrowDown':
        evenement.preventDefault();
        // Boucle sur la première entrée : arrivé en bas, on repart en haut.
        setIndexActif((i) => (i >= dernier ? 0 : i + 1));
        break;

      case 'ArrowUp':
        evenement.preventDefault();
        setIndexActif((i) => (i <= 0 ? dernier : i - 1));
        break;

      case 'Home':
        evenement.preventDefault();
        setIndexActif(0);
        break;

      case 'End':
        evenement.preventDefault();
        setIndexActif(dernier);
        break;

      /*
       * TABULATION FERME LE MENU SANS RENDRE LE FOCUS. En sortir par Tab doit
       * mener à l'élément SUIVANT de la page ; rendre le focus au bouton
       * ramènerait dans le menu au coup de Tab d'après — une boucle dont on
       * ne sort plus au clavier.
       */
      case 'Tab':
        fermer({ rendreFocus: false });
        break;

      default:
        break;
    }
  }

  const surToucheBouton = (evenement) => {
    if (evenement.key === 'ArrowDown' || evenement.key === 'Enter' || evenement.key === ' ') {
      evenement.preventDefault();
      setOuvert(true);
      setIndexActif(0);
    }
  };

  let curseur = -1;

  return (
    <div ref={conteneur} className={`relative ${className}`}>
      <button
        ref={bouton}
        type="button"
        onClick={() => {
          setOuvert((o) => !o);
          setIndexActif(-1);
        }}
        onKeyDown={surToucheBouton}
        aria-haspopup="menu"
        aria-expanded={ouvert}
        aria-controls={ouvert ? idMenu : undefined}
        aria-label={libelle}
        data-test="menu-options"
        /*
         * `cursor-pointer` EST EXPLICITE. Depuis Tailwind 4, le preflight pose
         * `cursor: default` sur les boutons : sans cette classe, le survol ne
         * se signale plus et le menu passe pour un simple décor.
         */
        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-ardoise-500 transition-colors hover:bg-ardoise-100 hover:text-ardoise-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-marque-500"
      >
        {/*
          TROIS CERCLES SVG, PAS LE CARACTÈRE « ⋯ ».
          C'est la leçon du « + » de la messagerie : un glyphe est centré sur
          sa boîte de ligne, pas sur son encre, et son rendu varie d'une
          police à l'autre. Trois cercles tracés sont centrés au pixel près,
          partout et sans mesure.
        */}
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="currentColor">
          <circle cx="9" cy="3.5" r="1.6" />
          <circle cx="9" cy="9" r="1.6" />
          <circle cx="9" cy="14.5" r="1.6" />
        </svg>
      </button>

      {ouvert && (
        <div
          id={idMenu}
          role="menu"
          aria-label={libelle}
          className={`absolute z-40 mt-1 min-w-56 overflow-hidden rounded-carte border border-ardoise-200 bg-white py-1 shadow-lg ${
            alignement === 'droite' ? 'right-0' : 'left-0'
          }`}
        >
          {entrees.filter(Boolean).map((entree, position) => {
            if (entree.separateur) {
              return (
                <div
                  key={`separateur-${position}`}
                  role="separator"
                  className="my-1 border-t border-ardoise-100"
                />
              );
            }

            curseur += 1;
            const index = curseur;

            return (
              <button
                key={entree.cle || entree.libelle}
                ref={(noeud) => {
                  elements.current[index] = noeud;
                }}
                type="button"
                role="menuitem"
                /*
                 * UNE SEULE ENTRÉE EST ATTEIGNABLE PAR TABULATION (« roving
                 * tabindex »). Un menu n'est pas une pile de boutons : on y
                 * entre une fois, puis on circule aux flèches. Sans cela, dix
                 * options coûteraient dix coups de Tab pour être traversées.
                 */
                tabIndex={index === indexActif ? 0 : -1}
                disabled={entree.desactive}
                onClick={() => {
                  fermer();
                  entree.action?.();
                }}
                onMouseEnter={() => setIndexActif(index)}
                className={`flex w-full cursor-pointer items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${
                  entree.danger
                    ? 'text-erreur hover:bg-erreur/10 focus-visible:bg-erreur/10'
                    : 'text-ardoise-700 hover:bg-ardoise-50 focus-visible:bg-ardoise-50'
                }`}
              >
                {entree.icone && (
                  <span aria-hidden="true" className="shrink-0">
                    {entree.icone}
                  </span>
                )}

                <span className="min-w-0">
                  <span className="block truncate font-medium">{entree.libelle}</span>
                  {entree.description && (
                    <span className="mt-0.5 block text-xs font-normal text-ardoise-400">
                      {entree.description}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
