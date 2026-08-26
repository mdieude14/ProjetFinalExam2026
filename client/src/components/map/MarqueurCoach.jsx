import { Marker, Popup } from 'react-leaflet';
import { Link } from 'react-router-dom';

import { iconeCoachCertifie, iconeCoach } from './iconesLeaflet';
import { formaterPrix } from '@/utils/prix';
import Avatar from '@/components/ui/Avatar';
import { formaterDistance } from '@/utils/distance';

/**
 * Un coach sur la carte : le marqueur et sa fiche.
 *
 * POURQUOI UN COMPOSANT A PART.
 * La fiche qui s'ouvre au clic est une vraie carte de visite — avatar, nom,
 * certification, distance, sports, tarif, lien vers le profil. Laissee dans
 * la boucle de rendu de la carte, elle noyait la logique cartographique sous
 * du balisage. Isolee, chacune des deux parties reste lisible, et la fiche
 * peut evoluer sans qu'on relise la gestion des tuiles.
 *
 * ORDRE DES COORDONNEES : `coach.position` arrive en [longitude, latitude]
 * (convention GeoJSON, celle de notre API) ; Leaflet attend [latitude,
 * longitude]. L'inversion se fait ICI, a la frontiere, et nulle part ailleurs.
 *
 * CE QUE LA FICHE N'AFFICHE PAS, ET C'EST VOULU : ni bio, ni statistiques, ni
 * date d'inscription. La vue « carte » du serveur ne les envoie meme pas —
 * une carte sert des dizaines de profils a qui n'en a demande aucun. Le
 * visiteur clique sur « Voir le profil » s'il veut la suite.
 */


// Reexporte pour les appelants historiques ; la definition vit dans
// `utils/distance.js`, hors de toute dependance a Leaflet.
export { formaterDistance };

export default function MarqueurCoach({ coach, surSelection }) {
  const [longitude, latitude] = coach.position;

  const nomComplet = coach.prenom ? `${coach.prenom} ${coach.nom}` : coach.pseudo;

  return (
    <Marker
      position={[latitude, longitude]}
      icon={coach.estCertifie ? iconeCoachCertifie : iconeCoach}
      eventHandlers={{ click: () => surSelection?.(coach) }}
      /*
       * LE PSEUDO FIGURE DANS L'INFOBULLE, PAS SEULEMENT LE NOM.
       * Deux coachs peuvent parfaitement s'appeler « Marc Bernard ». Au
       * survol, le seul nom ne permet alors pas de savoir sur lequel on
       * pointe — et sur une carte ou les marqueurs se cotoient, c'est
       * exactement le moment ou la distinction compte. Le pseudo, lui, est
       * unique par construction.
       */
      alt={`Coach ${nomComplet} (@${coach.pseudo})`}
      title={`${nomComplet} (@${coach.pseudo})`}
    >
      <Popup>
        <div className="min-w-[13rem]" data-testid="fiche-coach">
          <div className="flex items-center gap-2">
            <Avatar utilisateur={coach} taille="sm" />
            <div className="min-w-0">
              <p className="truncate font-semibold text-ardoise-900">{nomComplet}</p>
              <p className="truncate text-xs text-ardoise-500">@{coach.pseudo}</p>
            </div>
          </div>

          <p className="mt-1.5 text-xs text-ardoise-600">
            {coach.estCertifie ? '✓ Coach certifié' : 'Certification en cours'}
            {coach.ville && ` · ${coach.ville}`}
          </p>

          {coach.distanceM !== undefined && (
            <p className="text-xs text-ardoise-500">
              à environ {formaterDistance(coach.distanceM)}
            </p>
          )}

          {coach.positionPartagee && (
            <p className="mt-0.5 text-xs text-ardoise-400">
              Position approchée — plusieurs coachs dans ce secteur
            </p>
          )}

          {coach.sports?.length > 0 && (
            <p className="mt-1 text-xs text-ardoise-600">{coach.sports.join(' · ')}</p>
          )}

          {coach.premium?.prixMensuel && (
            <p className="mt-1 text-xs font-semibold text-marque-600">
              Premium {formaterPrix(coach.premium.prixMensuel, coach.premium.devise)}/mois
            </p>
          )}

          <Link
            to={`/profile/${coach.pseudo}`}
            className="mt-2 inline-block text-xs font-semibold text-marque-600 hover:underline"
          >
            Voir le profil →
          </Link>
        </div>
      </Popup>
    </Marker>
  );
}
