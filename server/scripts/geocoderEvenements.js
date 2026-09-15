import { connecterDB, deconnecterDB } from '../src/config/db.js';
import SportEvent from '../src/models/SportEvent.js';
import { geocoder } from '../src/services/geocodage.service.js';

/**
 * Géocodage des événements sans point — REPRISE DE DONNÉES.
 *
 *   npm run geocoder-evenements
 *
 * POURQUOI CE SCRIPT EXISTE, ET POURQUOI IL EST OBLIGATOIRE.
 * Le géocodage à la création ne concerne que les événements enregistrés
 * APRÈS son introduction. Tous ceux créés avant n'ont pas de coordonnées, et
 * rien ne les forcera à se réenregistrer : ils resteraient absents de
 * « Autour de moi » indéfiniment.
 *
 * C'est exactement le piège de `reindexerRecherche.js` au module 10, et il
 * produit le même symptôme trompeur : la fonctionnalité marche parfaitement
 * sur les événements créés pendant le développement, et ne trouve rien sur
 * les données existantes.
 *
 * IDEMPOTENT : il ne touche que les événements DÉPOURVUS de point. Relancé,
 * il ignore ceux qu'il a déjà traités et ne déplace jamais un point posé à la
 * main ou par la position de l'organisateur.
 *
 * LENT, ET C'EST NORMAL : la politique d'usage de Nominatim limite à une
 * requête par seconde, et le service la respecte. Cent événements prennent
 * donc près de deux minutes. C'est le prix d'un service gratuit et sans clé.
 */

async function principal() {
  await connecterDB();

  /*
   * On ne prend que les événements sans point ET pourvus d'une adresse
   * exploitable : géocoder un lieu vide ne rendrait jamais rien, et
   * consommerait une seconde de cadence pour un échec certain.
   */
  const aTraiter = await SportEvent.find(
    {
      'lieu.localisation.coordinates': { $exists: false },
      'lieu.ville': { $exists: true, $ne: '' },
    },
    'titre lieu'
  );

  if (aTraiter.length === 0) {
    console.log('Aucun événement à géocoder — tous portent déjà un point.');
    return;
  }

  console.log(`${aTraiter.length} événement(s) sans point.\n`);

  let places = 0;
  let introuvables = 0;

  for (const evenement of aTraiter) {
    const point = await geocoder(evenement.lieu);

    if (!point) {
      introuvables += 1;
      console.log(`  ✗  ${evenement.titre} — « ${evenement.lieu.ville} » introuvable`);
      continue;
    }

    /*
     * `updateOne` plutôt que `save()` : on ne touche qu'un sous-champ, et
     * `save()` relancerait la validation complète du schéma — y compris la
     * règle `dateDebut < dateFin`, qui ferait échouer la reprise sur un
     * événement passé dont les dates n'ont plus à être défendues.
     */
    await SportEvent.updateOne(
      { _id: evenement._id },
      { $set: { 'lieu.localisation': point } }
    );

    places += 1;
    const [lng, lat] = point.coordinates;
    console.log(
      `  ✓  ${evenement.titre} — ${evenement.lieu.ville} → ${lat.toFixed(4)}, ${lng.toFixed(4)}`
    );
  }

  console.log(`\n${places} événement(s) placé(s), ${introuvables} adresse(s) introuvable(s).`);

  if (introuvables > 0) {
    console.log(
      'Les adresses introuvables restent visibles dans « À venir » et par ville.\n' +
        'Corrigez la ville depuis l’interface : la modification relance le géocodage.'
    );
  }
}

principal()
  .catch((erreur) => {
    console.error('Échec de la reprise :', erreur.message);
    process.exitCode = 1;
  })
  .finally(deconnecterDB);
