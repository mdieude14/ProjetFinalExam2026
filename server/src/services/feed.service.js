import Follow from '../models/Follow.js';
import Post from '../models/Post.js';
import { relationAvec, peutVoirContenu } from './access.service.js';

/**
 * ===========================================================================
 *  CONSTRUCTION DU FIL D'ACTUALITE
 * ===========================================================================
 */

/**
 * Identifiants des comptes suivis, avec une demande acceptee.
 *
 * `.distinct()` renvoie directement un tableau d'ObjectId sans instancier de
 * documents Mongoose : on ne veut que des cles pour un `$in`, inutile de
 * payer la construction d'objets complets.
 */
export async function idsSuivis(idUtilisateur) {
  return Follow.distinct('following', {
    follower: idUtilisateur,
    statut: 'accepte',
  });
}

/**
 * Coachs auxquels le visiteur est abonne en premium.
 *
 * RENVOIE UN ENSEMBLE VIDE POUR L'INSTANT — le modele Subscription et les
 * paiements Stripe arrivent au module 7. Cette fonction est le seul point a
 * modifier a ce moment-la : tout le reste du code interroge deja l'ensemble
 * qu'elle renvoie, et le contenu premium restera correctement verrouille
 * d'ici la.
 *
 * @returns {Promise<Set<string>>} identifiants de coachs, en chaines
 */
export async function abonnementsPremiumActifs(idUtilisateur) {
  if (!idUtilisateur) return new Set();

  // Module 7 :
  //   const abos = await Subscription.distinct('coach', {
  //     utilisateur: idUtilisateur, statut: 'actif',
  //   });
  //   return new Set(abos.map(String));
  return new Set();
}

/**
 * Le visiteur a-t-il acces au contenu premium de cet auteur ?
 * Le proprietaire et l'administrateur y accedent toujours — sans quoi un
 * coach ne pourrait pas relire ses propres publications payantes.
 */
export function aAccesPremium(visiteur, idAuteur, ensembleAbonnements) {
  if (!visiteur) return false;
  if (String(visiteur._id) === String(idAuteur)) return true;
  if (visiteur.type === 'admin') return true;
  return ensembleAbonnements.has(String(idAuteur));
}

/**
 * Fil d'actualite : publications des comptes suivis, plus les siennes.
 *
 * PAGINATION PAR CURSEUR PLUTOT QUE PAR `skip`.
 * Avec `skip`, une publication ajoutee pendant la lecture decale tout le
 * flux : le dernier post de la page 1 reapparait en tete de la page 2. Le
 * curseur pointe sur un element precis, ce qui rend l'enchainement stable
 * meme si le fil bouge.
 *
 * On trie sur `_id` : un ObjectId MongoDB commence par un horodatage en
 * secondes, il est donc chronologique par construction. Cela evite le
 * curseur composite qu'exigerait un tri sur `createdAt`, ou deux posts
 * publies la meme milliseconde creeraient une ambiguite.
 */
export async function construireFeed(visiteur, { curseur, limite = 10 } = {}) {
  const suivis = await idsSuivis(visiteur._id);

  // Ses propres publications figurent dans son fil : c'est attendu, et cela
  // evite un fil vide pour un nouvel inscrit qui vient de publier.
  const auteurs = [...suivis, visiteur._id];

  const filtre = { auteur: { $in: auteurs } };
  if (curseur) filtre._id = { $lt: curseur };

  // On demande un element de plus que la limite : sa presence indique qu'il
  // reste des pages, sans avoir a lancer un `countDocuments` sur tout le flux.
  const posts = await Post.find(filtre)
    .sort({ _id: -1 })
    .limit(limite + 1)
    .populate('auteur', 'pseudo nom prenom avatar type diplome visibilite');

  const aSuivante = posts.length > limite;
  const page = aSuivante ? posts.slice(0, limite) : posts;

  const abonnements = await abonnementsPremiumActifs(visiteur._id);

  const elements = page.map((post) =>
    post.versionPour(visiteur, aAccesPremium(visiteur, post.auteur._id, abonnements))
  );

  return {
    elements,
    curseurSuivant: aSuivante ? String(page[page.length - 1]._id) : null,
    aSuivante,
  };
}

/**
 * Publications d'un profil donne.
 *
 * Applique en amont les regles de visibilite du module 4 : sur un profil
 * prive, un non-abonne ne recoit aucune publication — pas meme verrouillee.
 * L'existence des posts est en soi une information.
 */
export async function postsDeUtilisateur(visiteur, cible, { curseur, limite = 12 } = {}) {
  const relation = await relationAvec(visiteur, cible);

  if (!peutVoirContenu(relation, cible)) {
    return { elements: [], curseurSuivant: null, aSuivante: false, contenuVisible: false };
  }

  const filtre = { auteur: cible._id };
  if (curseur) filtre._id = { $lt: curseur };

  const posts = await Post.find(filtre)
    .sort({ _id: -1 })
    .limit(limite + 1)
    .populate('auteur', 'pseudo nom prenom avatar type diplome');

  const aSuivante = posts.length > limite;
  const page = aSuivante ? posts.slice(0, limite) : posts;

  const abonnements = await abonnementsPremiumActifs(visiteur?._id);

  const elements = page.map((post) =>
    post.versionPour(visiteur, aAccesPremium(visiteur, cible._id, abonnements))
  );

  return {
    elements,
    curseurSuivant: aSuivante ? String(page[page.length - 1]._id) : null,
    aSuivante,
    contenuVisible: true,
  };
}
