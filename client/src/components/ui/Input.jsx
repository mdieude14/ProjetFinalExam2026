import { useId, useState } from 'react';

/**
 * Champ de formulaire avec libelle, message d'aide et gestion d'erreur.
 *
 * ACCESSIBILITE — trois liaisons souvent oubliees :
 *   - `htmlFor` / `id` : cliquer le libelle place le curseur dans le champ,
 *     et le lecteur d'ecran annonce le bon intitule.
 *   - `aria-invalid` : signale l'erreur autrement que par la couleur rouge,
 *     invisible pour un utilisateur daltonien.
 *   - `aria-describedby` : rattache le message d'erreur au champ, de sorte
 *     qu'il soit lu a la prise de focus.
 *
 * `useId` genere un identifiant unique et stable, y compris si le composant
 * est affiche plusieurs fois sur la meme page.
 */
export default function Input({
  libelle,
  erreur,
  aide,
  type = 'text',
  className = '',
  id: idFourni,
  ...props
}) {
  const idGenere = useId();
  const id = idFourni || idGenere;
  const idAide = `${id}-aide`;
  const idErreur = `${id}-erreur`;

  // Pour un champ mot de passe, on propose de reveler la saisie.
  // Recommandation d'ergonomie : la saisie masquee provoque beaucoup
  // d'erreurs, surtout sur mobile.
  const [revele, setRevele] = useState(false);
  const estMotDePasse = type === 'password';
  const typeEffectif = estMotDePasse && revele ? 'text' : type;

  return (
    <div className="w-full">
      {libelle && (
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ardoise-700">
          {libelle}
        </label>
      )}

      <div className="relative">
        <input
          id={id}
          type={typeEffectif}
          aria-invalid={Boolean(erreur)}
          aria-describedby={erreur ? idErreur : aide ? idAide : undefined}
          className={[
            'w-full rounded-xl border bg-white px-4 py-2.5 text-sm text-ardoise-900',
            'placeholder:text-ardoise-400',
            'focus:outline-none focus:ring-2 focus:ring-offset-0',
            erreur
              ? 'border-erreur focus:border-erreur focus:ring-erreur/30'
              : 'border-ardoise-200 focus:border-marque-500 focus:ring-marque-500/30',
            estMotDePasse ? 'pr-20' : '',
            className,
          ].join(' ')}
          {...props}
        />

        {estMotDePasse && (
          <button
            type="button"
            onClick={() => setRevele((v) => !v)}
            className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-ardoise-500 hover:text-ardoise-700"
          >
            {revele ? 'Masquer' : 'Afficher'}
          </button>
        )}
      </div>

      {/* `role="alert"` fait annoncer l'erreur des son apparition. */}
      {erreur && (
        <p id={idErreur} role="alert" className="mt-1.5 text-xs text-erreur">
          {erreur}
        </p>
      )}

      {!erreur && aide && (
        <p id={idAide} className="mt-1.5 text-xs text-ardoise-500">
          {aide}
        </p>
      )}
    </div>
  );
}
