import { connecterDB, deconnecterDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import { termesDe } from '../src/utils/texte.js';

/**
 * Reconstruction des termes de recherche — REPRISE DE DONNÉES.
 *
 *   npm run reindexer-recherche
 *
 * POURQUOI CE SCRIPT EXISTE, ET POURQUOI IL EST OBLIGATOIRE.
 * Le champ `termesRecherche` est alimenté par un crochet `pre('save')` du
 * modèle. Ce crochet ne s'exécute que lorsqu'un document est enregistré :
 * tous les comptes créés AVANT le module 10 n'ont donc pas de termes, et
 * resteraient invisibles à l'autocomplétion — indéfiniment, puisque rien ne
 * force un compte existant à se réenregistrer.
 *
 * C'est le prix de toute dénormalisation ajoutée après coup, et l'oublier
 * produit le pire des symptômes : la fonctionnalité marche parfaitement sur
 * les comptes de test créés pendant le développement, et ne trouve rien en
 * production.
 *
 * IDEMPOTENT : relancé, il recalcule les mêmes valeurs. On peut donc
 * l'exécuter sans crainte après un import ou une correction manuelle.
 */

async function principal() {
  await connecterDB();

  /*
   * `.lean()` et une écriture groupée plutôt que `save()` document par
   * document. Sur quelques centaines de comptes la différence est
   * anecdotique ; sur cent mille, `save()` déclencherait cent mille
   * validations complètes de schéma pour ne toucher qu'un seul champ.
   *
   * On sélectionne explicitement les champs nécessaires : charger les bios,
   * les avatars et les données Stripe pour recalculer des termes serait du
   * trafic pur.
   */
  const comptes = await User.find({}, 'pseudo nom prenom ville sports').lean();

  if (comptes.length === 0) {
    console.log('Aucun compte à réindexer.');
    return;
  }

  const operations = comptes.map((compte) => ({
    updateOne: {
      filter: { _id: compte._id },
      update: {
        $set: {
          termesRecherche: termesDe(
            compte.pseudo,
            compte.nom,
            compte.prenom,
            compte.ville,
            compte.sports
          ),
        },
      },
    },
  }));

  const resultat = await User.bulkWrite(operations, { ordered: false });

  console.log(`Comptes examinés  : ${comptes.length}`);
  console.log(`Comptes mis à jour : ${resultat.modifiedCount}`);
  console.log(
    resultat.modifiedCount === 0
      ? '(rien à faire : les termes étaient déjà à jour)'
      : 'Réindexation terminée.'
  );
}

principal()
  .catch((erreur) => {
    console.error('Échec de la réindexation :', erreur.message);
    process.exitCode = 1;
  })
  .finally(deconnecterDB);
