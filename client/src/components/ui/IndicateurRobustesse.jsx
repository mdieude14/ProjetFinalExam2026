import { evaluerMotDePasse } from '@/utils/erreurs';

/**
 * Indicateur de robustesse d'un mot de passe, pendant la saisie.
 *
 * EXTRAIT DE L'INSCRIPTION, pour servir aussi à la réinitialisation. Deux
 * copies du même indicateur finiraient par ne plus afficher les mêmes
 * critères — et la personne verrait une exigence d'un côté qui n'existe plus
 * de l'autre. Les critères eux-mêmes restent ceux de `evaluerMotDePasse`,
 * alignés sur le validateur du serveur.
 *
 * Purement indicatif : le serveur revalide tout.
 */
export default function IndicateurRobustesse({ motDePasse }) {
  if (!motDePasse) return null;

  const robustesse = evaluerMotDePasse(motDePasse);

  return (
    <div className="mt-2">
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: robustesse.total }).map((_, index) => (
          <span
            key={index}
            className={`h-1 flex-1 rounded-full ${
              index < robustesse.score
                ? robustesse.estValide
                  ? 'bg-succes'
                  : 'bg-alerte'
                : 'bg-ardoise-200'
            }`}
          />
        ))}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
        {robustesse.criteres.map((critere) => (
          <li
            key={critere.libelle}
            className={`text-xs ${critere.valide ? 'text-succes' : 'text-ardoise-400'}`}
          >
            {critere.valide ? '✓' : '○'} {critere.libelle}
          </li>
        ))}
      </ul>
    </div>
  );
}
