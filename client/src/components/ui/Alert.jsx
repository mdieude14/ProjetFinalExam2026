/**
 * Message d'information, d'erreur ou de succes affiche en bloc.
 *
 * Sert aux erreurs globales qui ne se rattachent a aucun champ precis :
 * « Identifiants invalides », « Serveur injoignable », « Trop de tentatives ».
 * Les erreurs propres a un champ, elles, s'affichent sous ce champ via
 * le composant Input.
 *
 * Chaque variante combine une couleur ET un pictogramme : l'information ne
 * repose jamais sur la seule couleur.
 */
export default function Alert({ variante = 'erreur', titre, children, className = '' }) {
  const variantes = {
    erreur: {
      conteneur: 'bg-red-50 border-red-200 text-red-800',
      icone: '!',
      pastille: 'bg-red-100 text-red-700',
    },
    succes: {
      conteneur: 'bg-green-50 border-green-200 text-green-800',
      icone: '✓',
      pastille: 'bg-green-100 text-green-700',
    },
    info: {
      conteneur: 'bg-blue-50 border-blue-200 text-blue-800',
      icone: 'i',
      pastille: 'bg-blue-100 text-blue-700',
    },
    alerte: {
      conteneur: 'bg-amber-50 border-amber-200 text-amber-800',
      icone: '!',
      pastille: 'bg-amber-100 text-amber-700',
    },
  };

  const style = variantes[variante] || variantes.erreur;

  return (
    <div
      // `role="alert"` pour une erreur : le message est annonce immediatement.
      // `role="status"` sinon : annonce sans interrompre la lecture en cours.
      role={variante === 'erreur' ? 'alert' : 'status'}
      className={`flex gap-3 rounded-xl border p-3.5 text-sm ${style.conteneur} ${className}`}
    >
      <span
        aria-hidden="true"
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${style.pastille}`}
      >
        {style.icone}
      </span>

      <div className="min-w-0">
        {titre && <p className="font-semibold">{titre}</p>}
        <div className={titre ? 'mt-0.5' : ''}>{children}</div>
      </div>
    </div>
  );
}
