import { useMemo } from 'react';

import CarteBase from './CarteBase';
import MarqueurEvenement from './MarqueurEvenement';
import etalerPositions from './etalerPositions';

/**
 * Carte des evenements sportifs.
 *
 * Elle partage tout son socle avec la carte des coachs (`CarteBase`) et n'en
 * differe que par ses marqueurs.
 *
 * LES EVENEMENTS SANS COORDONNEES SONT ECARTES, POUR DEUX RAISONS
 * DIFFERENTES qu'il vaut mieux ne pas confondre :
 *
 *   - un evenement peut n'avoir qu'une ville : le lieu precis n'a jamais ete
 *     saisi, il n'y a rien a placer ;
 *   - un evenement PRIVE voit son adresse retiree de la reponse pour qui
 *     n'est pas abonne : la donnee existe, elle n'est simplement pas pour ce
 *     visiteur-la.
 *
 * Dans les deux cas la carte ne peut rien montrer, mais l'evenement reste
 * dans la LISTE a cote — avec, pour le second cas, la mention qui explique
 * ce qui manque. Le disparaitre des deux vues laisserait croire qu'il
 * n'existe pas.
 */
export default function CarteEvenements({
  centre,
  rayonM = 25000,
  evenements = [],
  hauteur = '60vh',
  surSelection,
}) {
  /*
   * Un cours hebdomadaire donne dans la meme salle produit une serie
   * d'evenements aux coordonnees identiques : sans ecartement, un seul
   * marqueur reste cliquable. Memoise, sinon chaque rendu refait les groupes.
   */
  const marqueurs = useMemo(
    () =>
      etalerPositions(
        evenements.filter((e) => e.lieu?.localisation?.coordinates),
        {
          lire: (e) => e.lieu.localisation.coordinates,
          ecrire: (e, coordinates) => ({
            ...e,
            lieu: { ...e.lieu, localisation: { ...e.lieu.localisation, coordinates } },
          }),
        }
      ),
    [evenements]
  );

  return (
    <CarteBase centre={centre} rayonM={rayonM} hauteur={hauteur} afficherRayon={Boolean(centre)}>
      {marqueurs.map((evenement) => (
        <MarqueurEvenement
          key={evenement._id}
          evenement={evenement}
          surSelection={surSelection}
        />
      ))}
    </CarteBase>
  );
}
