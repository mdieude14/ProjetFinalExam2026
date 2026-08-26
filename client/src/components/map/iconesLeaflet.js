import L from 'leaflet';

/**
 * Icones de marqueur.
 *
 * LA PANNE CLASSIQUE QUE CE FICHIER EVITE.
 * Leaflet reference ses images de marqueur par des chemins relatifs calcules
 * a l'execution (`marker-icon.png`, `marker-shadow.png`). Vite deplace et
 * renomme les ressources a la compilation : les chemins ne resolvent plus,
 * les marqueurs deviennent INVISIBLES — et, le plus perfide, **sans la
 * moindre erreur en console**. La carte s'affiche, les popups fonctionnent
 * au clic, mais rien n'est visible.
 *
 * Plutot que de rapiecer les chemins de Leaflet, on definit nos propres
 * icones en SVG encode dans l'URL : aucune ressource externe a resoudre,
 * rien a copier au deploiement, et un rendu net a toutes les densites
 * d'ecran. C'est aussi l'occasion d'utiliser la couleur de la marque plutot
 * que le bleu par defaut de Leaflet.
 */

/** Construit une icone en forme de goutte, dans la couleur demandee. */
function goutte(couleur, taille = 34) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 34" width="${taille}" height="${taille * 34 / 24}">
      <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 22 12 22s12-13 12-22c0-6.6-5.4-12-12-12z"
            fill="${couleur}" stroke="#ffffff" stroke-width="1.5"/>
      <circle cx="12" cy="12" r="4.5" fill="#ffffff"/>
    </svg>`.trim();

  return L.icon({
    iconUrl: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    // L'ancre est la POINTE de la goutte, pas son centre : sans cela le
    // marqueur flotte au-dessus du lieu qu'il designe.
    iconSize: [taille, (taille * 34) / 24],
    iconAnchor: [taille / 2, (taille * 34) / 24],
    popupAnchor: [0, -(taille * 34) / 24 + 4],
  });
}

/** Coach certifie — couleur de la marque. */
export const iconeCoachCertifie = goutte('#f97316');

/** Coach dont le diplome n'est pas encore verifie — teinte neutre. */
export const iconeCoach = goutte('#64748b');

/**
 * Position du visiteur — pastille, et non goutte : ce n'est pas un resultat
 * de recherche, la distinction doit sauter aux yeux.
 */
export const iconeMoi = L.divIcon({
  className: '', // sans quoi Leaflet ajoute son propre fond blanc
  html: `<span class="bloc-position-visiteur"></span>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

/**
 * Evenement sportif — teinte indigo, franchement distincte de l'orange des
 * coachs.
 *
 * POURQUOI UNE COULEUR DIFFERENTE ET NON LA MEME EN PLUS PALE. Les deux
 * cartes peuvent se ressembler au premier coup d'oeil ; si un jour coachs et
 * evenements se retrouvent sur le meme fond, deux nuances d'orange ne se
 * distingueraient pas, surtout en plein soleil sur un telephone. Deux teintes
 * franches, si.
 */
export const iconeEvenement = goutte('#4f46e5');

/**
 * Evenement complet ou annule — teinte eteinte.
 *
 * L'information reste portee par le TEXTE de la fiche (« Complet »,
 * « Annule ») : la couleur seule ne dirait rien a un utilisateur daltonien.
 * Elle ne fait qu'accelerer la lecture pour les autres.
 */
export const iconeEvenementFerme = goutte('#94a3b8');
