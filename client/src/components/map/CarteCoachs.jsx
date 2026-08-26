import { useMemo } from 'react';

import CarteBase from './CarteBase';
import MarqueurCoach, { formaterDistance } from './MarqueurCoach';
import etalerPositions from './etalerPositions';

/**
 * Carte des coachs.
 *
 * Le socle cartographique — fond de plan, attribution, recentrage, recalcul
 * de taille, cercle de recherche, pastille de position — vit dans
 * `CarteBase`, partage avec la carte des evenements. Ne reste ici que ce qui
 * est propre aux coachs : leurs marqueurs, et l'ecartement de ceux qui se
 * superposent.
 */
export default function CarteCoachs({
  centre,
  rayonM = 25000,
  coachs = [],
  hauteur = '70vh',
  surSelection,
}) {
  /*
   * L'arrondi de confidentialite du serveur (~110 m) fait que deux coachs
   * proches recoivent des coordonnees IDENTIQUES : leurs marqueurs se
   * superposent au pixel pres et celui du dessous devient inatteignable.
   * On les ecarte de quelques dizaines de metres, bien en deca du flou deja
   * applique. Memoise : sans cela chaque rendu recalculerait les groupes.
   */
  const marqueurs = useMemo(() => etalerPositions(coachs), [coachs]);

  return (
    <CarteBase centre={centre} rayonM={rayonM} hauteur={hauteur}>
      {marqueurs.map((coach) => (
        <MarqueurCoach key={coach._id} coach={coach} surSelection={surSelection} />
      ))}
    </CarteBase>
  );
}

export { formaterDistance };
