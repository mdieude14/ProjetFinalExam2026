import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * Fenetre modale.
 *
 * TROIS COMPORTEMENTS ATTENDUS, SOUVENT OUBLIES :
 *
 * 1. `createPortal` monte la fenetre a la racine du document, hors de la
 *    hierarchie du composant appelant. Sans cela, un parent avec
 *    `overflow: hidden` ou un `z-index` bas rognerait ou masquerait la modale.
 *
 * 2. La touche Echap ferme. C'est le reflexe de tout utilisateur clavier ;
 *    son absence donne l'impression d'etre piege dans la fenetre.
 *
 * 3. Le defilement de la page est bloque pendant l'affichage. Sinon, faire
 *    defiler la modale entraine la page derriere, et l'on perd sa position
 *    de lecture en fermant.
 */
export default function Modal({
  ouvert,
  onFermer,
  titre,
  children,
  taille = 'md',
  fondSombre = false,
}) {
  const referenceFond = useRef(null);

  useEffect(() => {
    if (!ouvert) return;

    const surTouche = (evenement) => {
      if (evenement.key === 'Escape') onFermer?.();
    };

    document.addEventListener('keydown', surTouche);

    const defilementInitial = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', surTouche);
      document.body.style.overflow = defilementInitial;
    };
  }, [ouvert, onFermer]);

  if (!ouvert) return null;

  const tailles = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    plein: 'max-w-none w-full h-full',
  };

  return createPortal(
    <div
      ref={referenceFond}
      // Le clic ne ferme que s'il vise le fond lui-meme : sans ce test,
      // relacher la souris hors de la fenetre apres avoir selectionne du
      // texte a l'interieur la fermerait par erreur.
      onClick={(evenement) => {
        if (evenement.target === referenceFond.current) onFermer?.();
      }}
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${
        fondSombre ? 'bg-black/90' : 'bg-black/50'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={titre}
    >
      <div
        className={`${tailles[taille]} max-h-full w-full overflow-y-auto rounded-carte bg-white shadow-xl ${
          taille === 'plein' ? 'rounded-none bg-transparent' : ''
        }`}
      >
        {titre && (
          <div className="sticky top-0 flex items-center justify-between border-b border-ardoise-200 bg-white px-5 py-3">
            <h2 className="text-base font-bold text-ardoise-900">{titre}</h2>
            <button
              onClick={onFermer}
              aria-label="Fermer"
              className="rounded-lg px-2 py-1 text-xl leading-none text-ardoise-400 hover:bg-ardoise-100 hover:text-ardoise-700"
            >
              ×
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
}
