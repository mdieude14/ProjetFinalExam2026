/**
 * Indicateur de chargement.
 *
 * `role="status"` et le libelle masque visuellement annoncent le chargement
 * aux lecteurs d'ecran : une animation seule ne dit rien a un utilisateur
 * non voyant.
 */
export default function Spinner({ taille = 'md', className = '', libelle = 'Chargement' }) {
  const tailles = {
    sm: 'h-4 w-4 border-2',
    md: 'h-6 w-6 border-2',
    lg: 'h-10 w-10 border-[3px]',
  };

  return (
    <span role="status" className={`inline-flex items-center ${className}`}>
      <span
        className={`${tailles[taille]} animate-spin rounded-full border-current border-t-transparent`}
        aria-hidden="true"
      />
      <span className="lecteur-ecran-seulement">{libelle}</span>
    </span>
  );
}

/** Chargement plein ecran, utilise pendant la restauration de session. */
export function EcranChargement({ message = 'Chargement...' }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ardoise-50">
      <Spinner taille="lg" className="text-marque-500" />
      <p className="text-sm text-ardoise-500">{message}</p>
    </div>
  );
}
