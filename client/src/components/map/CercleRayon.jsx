import { Circle } from 'react-leaflet';

/**
 * Zone de recherche materialisee sur la carte.
 *
 * A QUOI SERT CE CERCLE. Sans lui, un resultat absent est inexplicable : le
 * visiteur ne sait pas si le coach manquant est hors zone ou si la recherche
 * a echoue. Le cercle rend la limite VISIBLE, et transforme « il n'y a
 * personne » en « il n'y a personne DANS CETTE ZONE » — une information
 * actionnable, puisqu'il suffit d'elargir le rayon.
 *
 * Le rayon dessine est celui que le SERVEUR a reellement applique, pas celui
 * demande : le service borne la valeur entre 1 et 100 km, et un cercle qui
 * mentirait sur la zone couverte serait pire que pas de cercle du tout.
 *
 * Le remplissage reste tres pale (6 %) : il doit situer la zone sans masquer
 * le fond de plan ni les marqueurs qu'il contient.
 */
export default function CercleRayon({ centre, rayonM }) {
  return (
    <Circle
      center={[centre.lat, centre.lng]}
      radius={rayonM}
      pathOptions={{
        color: '#f97316',
        fillColor: '#f97316',
        fillOpacity: 0.06,
        weight: 1.5,
      }}
    />
  );
}
