/**
 * Avatar d'un utilisateur.
 *
 * Repli sur les initiales tant qu'aucune image n'est televersee (l'upload
 * Cloudinary arrive au module 5). Une pastille coloree avec initiales est
 * plus lisible et plus rapide qu'une silhouette generique identique pour
 * tout le monde.
 */
export default function Avatar({ utilisateur, taille = 'md', className = '' }) {
  const tailles = {
    // `xs` sert aux mentions en pied de carte, ou l'avatar accompagne une
    // ligne de texte de 12 px : au format `sm` il la dominerait.
    xs: 'h-6 w-6 text-[10px]',
    sm: 'h-8 w-8 text-xs',
    md: 'h-12 w-12 text-sm',
    lg: 'h-20 w-20 text-xl',
    xl: 'h-28 w-28 text-3xl',
  };

  const initiales = [utilisateur?.prenom?.[0], utilisateur?.nom?.[0]]
    .filter(Boolean)
    .join('')
    .toUpperCase();

  const classes = `${tailles[taille]} shrink-0 rounded-full object-cover ${className}`;

  if (utilisateur?.avatar?.url) {
    return (
      <img
        src={utilisateur.avatar.url}
        // Le texte alternatif nomme la personne : « Photo de profil » seul
        // ne dit pas de qui il s'agit dans une liste de dix avatars.
        alt={`Photo de profil de ${utilisateur.prenom} ${utilisateur.nom}`}
        className={classes}
        loading="lazy"
      />
    );
  }

  return (
    <div
      className={`${classes} flex items-center justify-center bg-marque-100 font-bold text-marque-700`}
      // Les initiales sont decoratives : le nom figure deja a cote.
      aria-hidden="true"
    >
      {initiales || '?'}
    </div>
  );
}
