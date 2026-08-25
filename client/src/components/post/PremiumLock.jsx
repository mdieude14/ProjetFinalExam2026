import { Link } from 'react-router-dom';
import Button from '@/components/ui/Button';

/**
 * Superposition affichee a la place d'un contenu premium verrouille.
 *
 * POINT ESSENTIEL A COMPRENDRE — ET A EXPLIQUER EN SOUTENANCE :
 * ce composant n'est PAS un mecanisme de securite. Il n'y a rien a
 * « deverrouiller » ici, parce qu'il n'y a rien a masquer : le serveur a
 * retire les URL des medias de la reponse avant de l'envoyer.
 *
 * Ce que le navigateur recoit pour un post verrouille :
 *   { verrouille: true, medias: [], description: null, nombreMedias: 2 }
 *
 * Ouvrir les outils de developpement, inspecter le DOM ou desactiver le CSS
 * ne revele donc rien. On affiche un degrade decoratif, pas une image floutee
 * qu'un filtre CSS suffirait a rendre nette — erreur classique qui laisse le
 * contenu payant accessible a qui sait ouvrir l'onglet reseau.
 */
export default function PremiumLock({ post, auteur }) {
  const ratio =
    post.apercu?.largeur && post.apercu?.hauteur
      ? post.apercu.largeur / post.apercu.hauteur
      : 1;

  return (
    <div
      className="relative flex flex-col items-center justify-center gap-3 overflow-hidden bg-linear-to-br from-marque-100 via-ardoise-100 to-marque-50 p-8 text-center"
      // Reserve la place du media pour eviter que la mise en page « saute ».
      style={{ aspectRatio: ratio > 0 ? ratio : 1, minHeight: '240px' }}
    >
      <span className="text-4xl" aria-hidden="true">🔒</span>

      <div>
        <p className="text-sm font-bold text-ardoise-900">Contenu exclusif</p>
        <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-ardoise-600">
          Abonnez-vous a {auteur?.prenom || 'ce coach'} pour acceder a ses
          programmes et contenus reserves.
        </p>
      </div>

      {post.nombreMedias > 1 && (
        <p className="text-xs text-ardoise-500">
          {post.nombreMedias} medias verrouilles
        </p>
      )}

      {auteur?.pseudo && (
        <Link to={`/profile/${auteur.pseudo}`}>
          <Button taille="sm">Voir l&apos;abonnement</Button>
        </Link>
      )}
    </div>
  );
}
