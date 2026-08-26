import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';

import CercleRayon from './CercleRayon';
import { iconeMoi } from './iconesLeaflet';

/**
 * Coquille cartographique partagee par la carte des coachs et celle des
 * evenements.
 *
 * POURQUOI L'AVOIR EXTRAITE. Les deux cartes different par UNE seule chose :
 * ce qu'elles posent comme marqueurs. Tout le reste — fond de plan,
 * attribution, recentrage, recalcul de taille, cercle de recherche, pastille
 * de position — est strictement identique. Recopie, ce socle aurait vecu en
 * deux exemplaires : le jour ou l'un est corrige, l'autre garde le defaut, et
 * la panne ne se manifeste que sur la moitie des ecrans.
 *
 * Les marqueurs arrivent donc en `children`, et chaque carte reste
 * responsable de sa seule specialite.
 *
 * FOND DE PLAN OPENSTREETMAP. L'attribution en bas a droite n'est pas
 * decorative : la licence ODbL l'exige. La masquer en CSS rendrait l'usage
 * des tuiles illicite.
 *
 * ORDRE DES COORDONNEES : Leaflet travaille en `[latitude, longitude]`,
 * notre API en `[longitude, latitude]` (GeoJSON). L'inversion se fait dans
 * les composants de marqueur, a la frontiere, et nulle part ailleurs.
 */

/**
 * Recentre la carte quand la recherche se deplace.
 *
 * Un composant a part parce que `useMap()` n'est utilisable qu'a l'INTERIEUR
 * de `MapContainer` : le contexte de la carte n'existe pas au-dessus.
 */
function Recentrage({ centre, rayonM }) {
  const carte = useMap();

  useEffect(() => {
    if (!centre) return;

    /*
     * Le zoom est deduit du rayon plutot que fixe.
     * Afficher un rayon de 100 km au meme zoom qu'un rayon de 1 km montrerait
     * soit un cercle grand comme un pixel, soit un cercle qui deborde de
     * l'ecran. Ces paliers gardent le cercle de recherche entierement visible.
     */
    const zoom =
      rayonM <= 2000 ? 14 : rayonM <= 5000 ? 13 : rayonM <= 15000 ? 12 : rayonM <= 40000 ? 10 : 9;

    carte.setView([centre.lat, centre.lng], zoom);
  }, [carte, centre, rayonM]);

  return null;
}

/**
 * Force Leaflet a recalculer ses dimensions.
 *
 * POURQUOI C'EST NECESSAIRE. Leaflet mesure son conteneur au montage. Si la
 * carte nait dans un element encore masque ou pas encore dimensionne — ce
 * qui arrive systematiquement en bascule liste/carte sur mobile —, elle se
 * croit minuscule et n'affiche qu'un quart de tuile grise. `invalidateSize()`
 * lui fait reprendre ses mesures.
 */
function RecalculTaille() {
  const carte = useMap();

  useEffect(() => {
    const minuteur = setTimeout(() => carte.invalidateSize(), 150);
    return () => clearTimeout(minuteur);
  }, [carte]);

  return null;
}

export default function CarteBase({
  centre,
  rayonM = 25000,
  hauteur = '70vh',
  afficherRayon = true,
  children,
}) {
  // Repli sur le centre de la France : mieux vaut une carte utilisable qu'un
  // rectangle vide tant que la position n'est pas connue.
  const depart = centre || { lat: 46.6, lng: 2.5 };

  return (
    <div
      className="overflow-hidden rounded-carte border border-ardoise-200"
      style={{ height: hauteur }}
    >
      <MapContainer
        center={[depart.lat, depart.lng]}
        zoom={centre ? 12 : 5}
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={19}
        />

        <RecalculTaille />
        <Recentrage centre={centre} rayonM={rayonM} />

        {/* Zone de recherche effectivement appliquée par le serveur */}
        {centre && afficherRayon && <CercleRayon centre={centre} rayonM={rayonM} />}

        {centre && (
          <Marker position={[centre.lat, centre.lng]} icon={iconeMoi}>
            <Popup>Votre position</Popup>
          </Marker>
        )}

        {children}
      </MapContainer>
    </div>
  );
}
