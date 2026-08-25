/**
 * Pastille d'etat : « Coach certifie », « En verification », « Prive »...
 *
 * Chaque variante associe une couleur ET un texte explicite. Une pastille
 * verte sans libelle ne dirait rien a un utilisateur daltonien, ni a un
 * lecteur d'ecran.
 */
export default function Badge({ variante = 'neutre', children, className = '' }) {
  const variantes = {
    neutre: 'bg-ardoise-100 text-ardoise-700',
    succes: 'bg-green-100 text-green-800',
    attente: 'bg-amber-100 text-amber-800',
    erreur: 'bg-red-100 text-red-800',
    marque: 'bg-marque-100 text-marque-800',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
        variantes[variante] || variantes.neutre
      } ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * Badge dedie au statut du diplome d'un coach.
 * Centralise la correspondance statut -> libelle : elle est utilisee sur le
 * profil, dans les reglages et dans le back-office, et doit rester identique
 * partout.
 */
export function BadgeDiplome({ statut, className = '' }) {
  const correspondance = {
    non_soumis: { variante: 'neutre', texte: 'Diplôme non soumis' },
    en_attente: { variante: 'attente', texte: 'Vérification en cours' },
    verifie: { variante: 'succes', texte: '✓ Coach certifié' },
    refuse: { variante: 'erreur', texte: 'Diplôme refusé' },
  };

  const info = correspondance[statut];
  if (!info) return null;

  return (
    <Badge variante={info.variante} className={className}>
      {info.texte}
    </Badge>
  );
}
