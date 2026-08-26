import { Marker, Popup } from 'react-leaflet';
import { Link } from 'react-router-dom';

import { iconeEvenement, iconeEvenementFerme } from './iconesLeaflet';
import { formaterDistance } from '@/utils/distance';
import { formaterPlage } from '@/utils/dates';

/**
 * Un evenement sur la carte : le marqueur et sa fiche.
 *
 * ICI, LA POSITION N'EST PAS FLOUTEE — et c'est une difference de fond avec
 * la carte des coachs. Un lieu de rendez-vous collectif est une information
 * publique : c'est l'adresse ou l'on demande aux gens de se presenter. Le
 * domicile d'un coach, non. Le serveur applique donc l'arrondi de
 * confidentialite a l'un et pas a l'autre, et ce composant peut poser le
 * marqueur a l'endroit exact.
 *
 * LE SEUL ARBITRAGE PORTE SUR LES EVENEMENTS PRIVES : le serveur retire
 * `lieu.localisation` de la reponse pour qui n'est pas abonne. Un tel
 * evenement n'a donc aucune coordonnee a afficher — il est ecarte en amont,
 * dans `CarteEvenements`, et reste visible dans la liste avec la mention qui
 * explique ce qui manque.
 *
 * ORDRE DES COORDONNEES : `[longitude, latitude]` cote API (GeoJSON),
 * `[latitude, longitude]` cote Leaflet. L'inversion se fait ICI.
 */
export default function MarqueurEvenement({ evenement, surSelection }) {
  const coordonnees = evenement.lieu?.localisation?.coordinates;
  if (!coordonnees) return null;

  const [longitude, latitude] = coordonnees;

  const ferme = evenement.statut === 'annule' || evenement.estComplet;

  return (
    <Marker
      position={[latitude, longitude]}
      icon={ferme ? iconeEvenementFerme : iconeEvenement}
      eventHandlers={{ click: () => surSelection?.(evenement) }}
      alt={`Événement ${evenement.titre}`}
      title={evenement.titre}
    >
      <Popup>
        <div className="min-w-[13rem]" data-testid="fiche-evenement">
          <p className="font-semibold text-ardoise-900">{evenement.titre}</p>

          <p className="mt-0.5 text-xs text-ardoise-600">
            {formaterPlage(evenement.dateDebut, evenement.dateFin)}
          </p>

          <p className="text-xs text-ardoise-500">
            {evenement.lieu?.adresse ? `${evenement.lieu.adresse} · ` : ''}
            {evenement.lieu?.ville}
            {evenement.distanceM !== undefined &&
              ` · à ${formaterDistance(evenement.distanceM)}`}
          </p>

          {/* Places : l'information qui decide d'y aller ou non. */}
          <p className="mt-1 text-xs font-medium text-ardoise-700">
            {evenement.statut === 'annule'
              ? 'Annulé'
              : evenement.capaciteMax === null
                ? `${evenement.inscritsCount} inscrit${evenement.inscritsCount > 1 ? 's' : ''}`
                : evenement.estComplet
                  ? 'Complet'
                  : `${evenement.placesRestantes} place${
                      evenement.placesRestantes > 1 ? 's' : ''
                    } restante${evenement.placesRestantes > 1 ? 's' : ''}`}
          </p>

          <Link
            to={`/evenements/${evenement._id}`}
            className="mt-2 inline-block text-xs font-semibold text-marque-600 hover:underline"
          >
            Voir l’événement
          </Link>
        </div>
      </Popup>
    </Marker>
  );
}
