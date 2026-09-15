import Spinner from './Spinner';

/**
 * Bouton unifie de l'application.
 *
 * Centraliser les styles ici garantit la coherence visuelle : le jour ou la
 * couleur de marque change, un seul fichier est a modifier.
 *
 * Le bouton se desactive automatiquement pendant le chargement, ce qui evite
 * les doubles soumissions de formulaire — un classique qui cree deux comptes
 * ou deux paiements identiques.
 */
export default function Button({
  children,
  variante = 'principal',
  taille = 'md',
  chargement = false,
  pleineLargeur = false,
  type = 'button',
  disabled,
  className = '',
  ...props
}) {
  const base =
    /*
     * `cursor-pointer` EST DANS LA BASE, ET NON DANS UN SEUL VARIANT.
     *
     * Depuis Tailwind 4, le preflight pose `cursor: default` sur les boutons :
     * un bouton ne se signale plus au survol tant qu'on ne le demande pas.
     * Seul le variant `choix` portait la classe ; « Annuler », « Envoyer »,
     * « Bloquer » et tous les autres boutons de l'application affichaient
     * donc la fleche ordinaire — mesure faite au navigateur, pas devinee.
     *
     * L'ORDRE COMPTE : `disabled:cursor-not-allowed` vient APRES et l'emporte
     * donc sur un bouton desactive, ou la main serait un mensonge.
     */
    'inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl ' +
    'font-semibold transition-colors duration-150 ' +
    'disabled:cursor-not-allowed disabled:opacity-60';

  const variantes = {
    principal: 'bg-marque-500 text-white hover:bg-marque-600 active:bg-marque-700',
    secondaire:
      'bg-white text-ardoise-700 border border-ardoise-200 hover:bg-ardoise-50 active:bg-ardoise-100',
    fantome: 'text-ardoise-600 hover:bg-ardoise-100 active:bg-ardoise-200',
    danger: 'bg-erreur text-white hover:brightness-90 active:brightness-75',
    /*
     * CHOIX — options de même rang, blanches au repos, marque au survol.
     * Sert quand plusieurs actions se valent et qu'aucune ne doit être
     * présentée comme la bonne : un bouton principal orienterait le choix.
     *
     * Le curseur main est desormais porte par la base, pour tous les
     * variants — voir le commentaire ci-dessus.
     */
    choix:
      'bg-white text-ardoise-700 border border-ardoise-200 ' +
      'hover:bg-marque-500 hover:text-white hover:border-marque-500 ' +
      'active:bg-marque-600 active:border-marque-600',
  };

  const tailles = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2.5 text-sm',
    lg: 'px-6 py-3 text-base',
  };

  return (
    <button
      type={type}
      disabled={disabled || chargement}
      // aria-busy informe les technologies d'assistance qu'une operation
      // est en cours, sans quoi le changement d'etat passe inapercu.
      aria-busy={chargement}
      className={[
        base,
        variantes[variante],
        tailles[taille],
        pleineLargeur ? 'w-full' : '',
        className,
      ].join(' ')}
      {...props}
    >
      {chargement && <Spinner taille="sm" />}
      {children}
    </button>
  );
}
