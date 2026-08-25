import { Link } from 'react-router-dom';
import Avatar from '@/components/ui/Avatar';
import Badge from '@/components/ui/Badge';
import BoutonSuivre from './BoutonSuivre';

/**
 * Liste d'utilisateurs réutilisable — abonnés, abonnements, suggestions,
 * et plus tard les résultats de recherche du module 10.
 *
 * Chaque ligne porte son propre bouton de suivi, alimenté par le champ
 * `maRelation` que le serveur calcule en une seule requête pour toute la
 * page. Interroger l'API ligne par ligne provoquerait vingt appels réseau
 * pour afficher une liste de vingt personnes.
 */
export default function ListeUtilisateurs({
  utilisateurs = [],
  vide = 'Personne pour le moment.',
  action,
}) {
  if (utilisateurs.length === 0) {
    return <p className="py-8 text-center text-sm text-ardoise-400">{vide}</p>;
  }

  return (
    <ul className="divide-y divide-ardoise-100">
      {utilisateurs.map((u) => (
        <li key={u._id} className="flex items-center gap-3 py-3">
          <Link to={`/profile/${u.pseudo}`} className="shrink-0">
            <Avatar utilisateur={u} taille="md" />
          </Link>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Link
                to={`/profile/${u.pseudo}`}
                className="truncate font-semibold text-ardoise-900 hover:underline"
              >
                {u.prenom} {u.nom}
              </Link>
              {u.estCertifie && <Badge variante="succes">✓</Badge>}
              {u.memeVille && <Badge variante="marque">Votre ville</Badge>}
            </div>

            <p className="truncate text-xs text-ardoise-500">
              @{u.pseudo}
              {u.ville && ` · ${u.ville}`}
              {typeof u.stats?.followersCount === 'number' &&
                ` · ${u.stats.followersCount} abonné${u.stats.followersCount > 1 ? 's' : ''}`}
            </p>
          </div>

          {/* `action` permet de remplacer le bouton de suivi par autre chose
              — « Retirer », par exemple, dans la liste de ses propres
              abonnés — sans dupliquer tout le composant. */}
          <div className="shrink-0">
            {action ? (
              action(u)
            ) : (
              <BoutonSuivre identifiant={u.pseudo} relationInitiale={u.maRelation} />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
