import { useId } from 'react';

/**
 * Champ de texte multiligne, avec compteur de caracteres.
 *
 * Le compteur n'est pas cosmetique : le serveur refuse une bio de plus de
 * 300 caracteres. Sans retour visuel, l'utilisateur redige un long texte,
 * le soumet, et decouvre l'erreur seulement a ce moment — en ayant perdu
 * le fil de ce qu'il devait couper.
 *
 * Memes liaisons d'accessibilite que Input : `htmlFor`, `aria-invalid`,
 * `aria-describedby`.
 */
export default function Textarea({
  libelle,
  erreur,
  aide,
  maxLength,
  value = '',
  className = '',
  id: idFourni,
  ...props
}) {
  const idGenere = useId();
  const id = idFourni || idGenere;
  const idErreur = `${id}-erreur`;
  const idAide = `${id}-aide`;

  const restants = maxLength ? maxLength - value.length : null;
  const procheLimite = restants !== null && restants <= 20;

  return (
    <div className="w-full">
      {libelle && (
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ardoise-700">
          {libelle}
        </label>
      )}

      <textarea
        id={id}
        value={value}
        maxLength={maxLength}
        aria-invalid={Boolean(erreur)}
        aria-describedby={erreur ? idErreur : aide ? idAide : undefined}
        className={[
          'w-full resize-y rounded-xl border bg-white px-4 py-2.5 text-sm text-ardoise-900',
          'placeholder:text-ardoise-400 focus:outline-none focus:ring-2',
          erreur
            ? 'border-erreur focus:border-erreur focus:ring-erreur/30'
            : 'border-ardoise-200 focus:border-marque-500 focus:ring-marque-500/30',
          className,
        ].join(' ')}
        {...props}
      />

      <div className="mt-1.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          {erreur && (
            <p id={idErreur} role="alert" className="text-xs text-erreur">
              {erreur}
            </p>
          )}
          {!erreur && aide && (
            <p id={idAide} className="text-xs text-ardoise-500">
              {aide}
            </p>
          )}
        </div>

        {restants !== null && (
          <span
            className={`shrink-0 text-xs tabular-nums ${
              procheLimite ? 'text-alerte' : 'text-ardoise-400'
            }`}
          >
            {restants}
          </span>
        )}
      </div>
    </div>
  );
}
