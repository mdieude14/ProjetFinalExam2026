import { useState } from 'react';
import { Link } from 'react-router-dom';
import postApi from '@/api/post.api';
import useAuth from '@/hooks/useAuth';
import Avatar from '@/components/ui/Avatar';
import Badge from '@/components/ui/Badge';
import PremiumLock from './PremiumLock';
import CommentList from './CommentList';
import CarrouselMedias from './CarrouselMedias';

/**
 * Carte d'une publication dans le fil d'actualite.
 *
 * Gere l'affichage des medias, le like optimiste, le depliage des
 * commentaires et la suppression.
 */

/**
 * Date relative en francais : « il y a 3 h ».
 * Au-dela d'une semaine, on repasse a une date absolue : « il y a 43 j » ne
 * dit rien a personne, « 12 juin » se situe immediatement.
 */
function dateRelative(iso) {
  const secondes = Math.floor((Date.now() - new Date(iso)) / 1000);

  if (secondes < 60) return 'a l instant';
  if (secondes < 3600) return `il y a ${Math.floor(secondes / 60)} min`;
  if (secondes < 86400) return `il y a ${Math.floor(secondes / 3600)} h`;
  if (secondes < 604800) return `il y a ${Math.floor(secondes / 86400)} j`;

  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export default function PostCard({ post, onSupprime }) {
  const { utilisateur, estAdmin } = useAuth();

  const [aLike, setALike] = useState(post.aLike);
  const [likesCount, setLikesCount] = useState(post.likesCount);
  const [commentsCount, setCommentsCount] = useState(post.commentsCount);
  const [commentairesOuverts, setCommentairesOuverts] = useState(false);
  const [suppression, setSuppression] = useState(false);
  const [erreur, setErreur] = useState(null);

  const estAuteur = String(post.auteur?._id) === String(utilisateur?._id);
  const peutSupprimer = estAuteur || estAdmin;

  /**
   * Like optimiste : l'interface reagit immediatement, l'appel reseau suit.
   * Un aller-retour serveur de 200 ms sur un simple coeur donne une
   * impression de lenteur ; on inverse donc l'ordre et l'on revient en
   * arriere si le serveur refuse.
   */
  const basculerLike = async () => {
    const precedentALike = aLike;
    const precedentCount = likesCount;

    setALike(!precedentALike);
    setLikesCount(precedentCount + (precedentALike ? -1 : 1));

    try {
      const reponse = await postApi.basculerLike(post._id);
      // On aligne sur la valeur du serveur : d'autres ont pu aimer entre-temps.
      setALike(reponse.data.aLike);
      setLikesCount(reponse.data.likesCount);
    } catch (e) {
      setALike(precedentALike);
      setLikesCount(precedentCount);
      setErreur(e.message);
    }
  };

  const supprimer = async () => {
    setSuppression(true);
    try {
      await postApi.supprimer(post._id);
      onSupprime?.(post._id);
    } catch (e) {
      setErreur(e.message);
      setSuppression(false);
    }
  };

  return (
    /*
     * PLEINE LARGEUR SUR TÉLÉPHONE, CARTE SUR ORDINATEUR.
     *
     * `Layout` réserve 16 px de marge de chaque côté (`px-4`) : sur un écran
     * de 375 px, une publication n'occupait que 343 px. Instagram, lui, va
     * d'un bord à l'autre. `-mx-4` annule exactement cette marge, et les
     * angles arrondis comme la bordure latérale disparaissent — ils n'ont
     * plus de sens quand le contenu touche les bords.
     *
     * Au-delà de 640 px (`sm`), tout revient à l'état d'origine : marges,
     * bordure complète et angles arrondis. Les dimensions sur ordinateur ne
     * changent pas.
     */
    <article className="-mx-4 overflow-hidden border-y border-ardoise-200 bg-white sm:mx-0 sm:rounded-carte sm:border">
      {/* ---------- En-tete ---------- */}
      <header className="flex items-center gap-3 p-4">
        <Link to={`/profile/${post.auteur?.pseudo}`}>
          <Avatar utilisateur={post.auteur} taille="md" />
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              to={`/profile/${post.auteur?.pseudo}`}
              className="truncate font-semibold text-ardoise-900 hover:underline"
            >
              {post.auteur?.prenom} {post.auteur?.nom}
            </Link>
            {post.auteur?.estCertifie && <Badge variante="succes">✓</Badge>}
            {post.estPremium && <Badge variante="marque">Premium</Badge>}
          </div>
          <p className="truncate text-xs text-ardoise-500">
            @{post.auteur?.pseudo} · {dateRelative(post.createdAt)}
          </p>
        </div>

        {peutSupprimer && (
          <button
            onClick={supprimer}
            disabled={suppression}
            aria-label="Supprimer la publication"
            className="rounded-lg px-2 py-1 text-sm text-ardoise-400 hover:bg-red-50 hover:text-erreur disabled:opacity-50"
          >
            {suppression ? '…' : 'Supprimer'}
          </button>
        )}
      </header>

      {/* ---------- Titre ---------- */}
      {post.titre && (
        <h3 className="px-4 pb-2 font-semibold text-ardoise-900">{post.titre}</h3>
      )}

      {/* ---------- Media ou verrou ---------- */}
      {post.verrouille ? (
        <PremiumLock post={post} auteur={post.auteur} />
      ) : (
        post.medias?.length > 0 && <CarrouselMedias medias={post.medias} titre={post.titre} />
      )}

      {/* ---------- Actions ---------- */}
      <div className="flex items-center gap-4 px-4 pt-3">
        <button
          onClick={basculerLike}
          disabled={post.verrouille}
          aria-pressed={aLike}
          className={`cursor-pointer flex items-center gap-1.5 text-sm font-medium transition-colors disabled:opacity-40 ${
            aLike ? 'text-erreur' : 'text-ardoise-500 hover:text-ardoise-800'
          }`}
        >
          <span aria-hidden="true" className="text-lg">{aLike ? '♥' : '♡'}</span>
          <span className="tabular-nums">{likesCount}</span>
          <span className="lecteur-ecran-seulement">
            {aLike ? 'Retirer le like' : 'Aimer'}
          </span>
        </button>

        <button
          onClick={() => setCommentairesOuverts((v) => !v)}
          disabled={post.verrouille}
          aria-expanded={commentairesOuverts}
          className=" cursor-pointer flex items-center gap-1.5 text-sm font-medium text-ardoise-500 hover:text-ardoise-800 disabled:opacity-40"
        >
          <span aria-hidden="true" className="text-lg">💬</span>
          <span className="tabular-nums">{commentsCount}</span>
          <span className="lecteur-ecran-seulement">Commentaires</span>
        </button>
      </div>

      {/* ---------- Description ---------- */}
      {post.description && (
        <p className="whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed text-ardoise-700">
          {post.description}
        </p>
      )}

      {erreur && <p className="px-4 pb-2 text-xs text-erreur">{erreur}</p>}

      {/* ---------- Commentaires ---------- */}
      {commentairesOuverts && !post.verrouille && (
        <CommentList
          idPost={post._id}
          idAuteurPost={post.auteur?._id}
          onChangementNombre={setCommentsCount}
        />
      )}
    </article>
  );
}
