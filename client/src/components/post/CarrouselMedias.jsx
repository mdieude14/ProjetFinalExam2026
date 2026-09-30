import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * ===========================================================================
 *  CARROUSEL DE MÉDIAS D'UNE PUBLICATION
 * ===========================================================================
 *
 * UN SEUL MÉDIA : RIEN NE CHANGE. Pas de piste, pas de flèches, pas de
 * pastilles, pas d'écouteur de geste — exactement l'affichage d'origine. Tout
 * ce qui suit ne sert qu'à partir de deux médias.
 *
 * LES QUATRE COMPORTEMENTS REPRIS D'INSTAGRAM, et pourquoi :
 *
 *   glissement au doigt   c'est le geste attendu sur téléphone, où les
 *                         flèches sont trop petites et masquent l'image
 *   hauteur constante     le format est celui du PREMIER média ; sans cela,
 *                         passer d'un portrait à un paysage ferait sauter
 *                         tout le fil sous le doigt
 *   flèches au survol     sur ordinateur seulement, discrètes, jamais sur
 *                         mobile où le geste suffit
 *   pas de bouclage       au dernier média, la flèche disparaît plutôt que
 *                         de revenir au premier : on sait où l'on est
 *
 * CE QUE CE COMPOSANT NE FAIT PAS, VOLONTAIREMENT : les pastilles ne sont pas
 * cliquables. Elles indiquent la position, comme chez Instagram ; cibler une
 * pastille de six pixels au pouce rate plus souvent qu'elle n'aboutit.
 *
 * `titre` sert UNIQUEMENT au texte alternatif. Il est passé en propriété : ce
 * composant ne connaît pas `post`, et l'y supposer accessible a déjà coûté une
 * panne au module 5 — `post is not defined`, que ni le lint ni la compilation
 * n'avaient vue.
 * ===========================================================================
 */

/** Distance minimale, en pixels, pour qu'un glissement change de média. */
const SEUIL_GLISSEMENT = 50;

export default function CarrouselMedias({ medias, titre }) {
  const [index, setIndex] = useState(0);
  const [decalage, setDecalage] = useState(0); // pixels, pendant le geste
  const [glisse, setGlisse] = useState(false);

  const cadreRef = useRef(null);
  const videosRef = useRef(new Map());
  const geste = useRef(null);

  const multiple = medias.length > 1;

  /*
   * LE FORMAT EST CELUI DU PREMIER MÉDIA, pour toute la publication.
   * Les dimensions viennent de Cloudinary ; le stockage local ne les fournit
   * pas toujours, d'où le carré par défaut. Réserver la place empêche le fil
   * de « sauter » quand les images finissent de charger.
   */
  const premier = medias[0];
  const ratio = premier.largeur && premier.hauteur ? premier.largeur / premier.hauteur : 1;

  const aller = useCallback(
    (cible) => setIndex(Math.min(Math.max(cible, 0), medias.length - 1)),
    [medias.length]
  );

  /*
   * UNE VIDÉO QUI SORT DE L'ÉCRAN SE MET EN PAUSE. Sans cela, on continue de
   * l'entendre en regardant le média suivant — et deux vidéos peuvent parler
   * en même temps dans le fil.
   */
  useEffect(() => {
    for (const [position, video] of videosRef.current) {
      if (position !== index && video && !video.paused) video.pause();
    }
  }, [index]);

  /* ---------------------------- Gestes ---------------------------- */

  const debutGeste = (evenement) => {
    if (!multiple || evenement.pointerType === 'mouse') return;
    geste.current = { x: evenement.clientX, y: evenement.clientY, horizontal: null };
  };

  const pendantGeste = (evenement) => {
    if (!geste.current) return;
    const dx = evenement.clientX - geste.current.x;
    const dy = evenement.clientY - geste.current.y;

    /*
     * ON NE CAPTURE LE GESTE QUE S'IL EST HORIZONTAL. Décidé une fois, au
     * premier mouvement franc : sinon un défilement vertical du fil, jamais
     * parfaitement droit, ferait dériver le carrousel sous le doigt.
     */
    if (geste.current.horizontal === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      geste.current.horizontal = Math.abs(dx) > Math.abs(dy);
      if (geste.current.horizontal) setGlisse(true);
    }
    if (!geste.current.horizontal) return;

    // Résistance aux extrémités : le mouvement est freiné, pas bloqué net.
    const auBord = (dx > 0 && index === 0) || (dx < 0 && index === medias.length - 1);
    setDecalage(auBord ? dx / 3 : dx);
  };

  const finGeste = () => {
    if (geste.current?.horizontal) {
      if (decalage <= -SEUIL_GLISSEMENT) aller(index + 1);
      else if (decalage >= SEUIL_GLISSEMENT) aller(index - 1);
    }
    geste.current = null;
    setDecalage(0);
    setGlisse(false);
  };

  const surTouche = (evenement) => {
    if (!multiple) return;
    if (evenement.key === 'ArrowRight') { evenement.preventDefault(); aller(index + 1); }
    if (evenement.key === 'ArrowLeft') { evenement.preventDefault(); aller(index - 1); }
  };

  const translation = `translateX(calc(${-index * 100}% + ${decalage}px))`;

  return (
    <div
      ref={cadreRef}
      className="group relative touch-pan-y overflow-hidden bg-ardoise-900"
      style={{ aspectRatio: ratio }}
      data-test="carrousel"
      /*
       * Un carrousel est une RÉGION, pas un bouton : le lecteur d'écran
       * annonce sa nature, et les flèches du clavier y fonctionnent une fois
       * la région atteinte par tabulation.
       */
      {...(multiple
        ? {
            role: 'group',
            'aria-roledescription': 'carrousel',
            'aria-label': titre ? `Médias de « ${titre} »` : 'Médias de la publication',
            tabIndex: 0,
            onKeyDown: surTouche,
            onPointerDown: debutGeste,
            onPointerMove: pendantGeste,
            onPointerUp: finGeste,
            onPointerCancel: finGeste,
          }
        : {})}
    >
      <div
        className={`flex h-full w-full ${glisse ? '' : 'transition-transform duration-300 ease-out'}`}
        style={{ transform: translation }}
        data-test="carrousel-piste"
      >
        {medias.map((media, i) => (
          <div key={media.publicId || media.url || i} className="h-full w-full shrink-0">
            {media.type === 'video' ? (
              <video
                ref={(element) => {
                  if (element) videosRef.current.set(i, element);
                  else videosRef.current.delete(i);
                }}
                src={media.url}
                controls
                playsInline
                /*
                 * `metadata` pour le média affiché — la durée et la première
                 * image, sans télécharger la vidéo entière. `none` pour les
                 * autres : un carrousel de cinq vidéos coûterait sinon
                 * plusieurs centaines de méga-octets à l'ouverture du fil.
                 */
                preload={i === index ? 'metadata' : 'none'}
                className="h-full w-full object-contain"
                data-test={`carrousel-media-${i}`}
              />
            ) : (
              <img
                src={media.url}
                /*
                 * LE MÉDIA EST LE CONTENU, PAS UNE DÉCORATION. `alt=""` le
                 * retirerait de la lecture d'écran : la publication
                 * deviendrait un cadre vide. Faute d'un texte alternatif saisi
                 * par l'auteur, on annonce au moins de quoi il s'agit, et sa
                 * position quand il y en a plusieurs.
                 */
                alt={
                  (titre ? `Image de la publication « ${titre} »` : 'Image de la publication') +
                  (multiple ? ` (${i + 1} sur ${medias.length})` : '')
                }
                loading={i === 0 ? 'eager' : 'lazy'}
                draggable={false}
                className={`h-full w-full ${multiple ? 'object-contain' : 'object-cover'}`}
                data-test={`carrousel-media-${i}`}
              />
            )}
          </div>
        ))}
      </div>

      {multiple && (
        <>
          {index > 0 && (
            <button
              type="button"
              onClick={() => aller(index - 1)}
              aria-label="Média précédent"
              data-test="carrousel-precedent"
              /*
               * Visibles au survol sur ordinateur, et dès qu'elles reçoivent
               * le focus au clavier. Masquées sur mobile : le geste suffit, et
               * deux pastilles noires y mangeraient l'image.
               */
              className="absolute left-2 top-1/2 hidden h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity hover:bg-black/70 focus-visible:opacity-100 group-hover:opacity-100 sm:flex"
            >
              ‹
            </button>
          )}
          {index < medias.length - 1 && (
            <button
              type="button"
              onClick={() => aller(index + 1)}
              aria-label="Média suivant"
              data-test="carrousel-suivant"
              className="absolute right-2 top-1/2 hidden h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity hover:bg-black/70 focus-visible:opacity-100 group-hover:opacity-100 sm:flex"
            >
              ›
            </button>
          )}

          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5" aria-hidden="true">
            {medias.map((media, i) => (
              <span
                key={media.publicId || media.url || i}
                data-test={`carrousel-pastille-${i}`}
                className={`h-1.5 w-1.5 rounded-full transition-colors ${
                  i === index ? 'bg-white' : 'bg-white/50'
                }`}
              />
            ))}
          </div>

          <span
            className="absolute right-3 top-3 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white"
            aria-hidden="true"
            data-test="carrousel-compteur"
          >
            {index + 1}/{medias.length}
          </span>

          {/* Ce que les pastilles disent à l'œil, dit au lecteur d'écran. */}
          <p className="lecteur-ecran-seulement" aria-live="polite" data-test="carrousel-annonce">
            Média {index + 1} sur {medias.length}
          </p>
        </>
      )}
    </div>
  );
}
