/**
 * Distance lisible : « 850 m » ou « 12,4 km ».
 *
 * POURQUOI CETTE FONCTION VIT ICI ET PLUS DANS `MarqueurCoach`.
 * Elle y était née avec la carte, ce qui semblait naturel. Mais elle sert
 * aussi aux cartes d'événements et aux résultats de recherche — et importer
 * une fonction de mise en forme depuis un composant `react-leaflet` traîne
 * TOUTE la bibliothèque Leaflet dans le paquet de l'écran appelant. Cent
 * cinquante kilo-octets pour formater un nombre, sur une page qui n'affiche
 * aucune carte.
 *
 * Le défaut est invisible à la lecture du code — l'import a l'air anodin — et
 * ne se voit que dans la taille des fragments produits par l'empaqueteur.
 *
 * @param {number|null|undefined} metres
 * @returns {string|null}
 */
export function formaterDistance(metres) {
  if (metres === undefined || metres === null) return null;
  if (metres < 1000) return `${metres} m`;
  return `${(metres / 1000).toFixed(1).replace('.', ',')} km`;
}

export default formaterDistance;
