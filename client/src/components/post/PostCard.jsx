import { useState } from 'react';
import { Link } from 'react-router-dom';
import postApi from '@/api/post.api';
import useAuth from '@/hooks/useAuth';
import Avatar from '@/components/ui/Avatar';
import Badge from '@/components/ui/Badge';
import PremiumLock from './PremiumLock';
import CommentList from './CommentList';

/**
 * Carte d'une publication dans le fil d'actualite.
 *
 * Gere l'affichage des medias, le like optimiste, le depliage des
 * commentaires et la suppression.
 */

/**
 * Carrousel de medias, avec pastilles de navigation.
 *
 * `titre` sert UNIQUEMENT au texte alternatif des images. Il est passe en
 * propriete plutot que lu depuis la publication : ce composant ne connait pas
 * `post`, et l'y supposer accessible a coute une panne — `post is not
 * defined` a l'execution, sur du code que le lint et la compilation avaient
 * tous deux laisse passer.
 */
function Carrousel({ medias, titre }) {
  const [index, setIndex] = useState(0);
  const media = medias[index];

  // Ratio connu (Cloudinary) ou carre par defaut (stockage local, qui ne
  // fournit pas les dimensions). Reserver la place evite que le fil « saute »
  // pendant le chargement des images.
  const ratio = media.largeur && media.hauteur ? media.largeur / media.hauteur : 1;

  return (
    <div className="relative bg-ardoise-900" style={{ aspectRatio: ratio }}>
      {media.type === 'video' ? (
        <video
          src={media.url}
          controls
          playsInline
          // `preload="metadata"` charge la duree et la premiere image sans
          // telecharger la video entiere : un fil de dix videos consommerait
          // sinon des centaines de mega-octets a l'ouverture.
          preload="metadata"
          className="h-full w-full object-contain"
        />
      ) : (
        <img
          src={media.url}
          /*
           * LE MEDIA EST LE CONTENU, PAS UNE DECORATION.
           * `alt=""` le retire entierement de la lecture d'ecran : la
           * publication devient alors un cadre vide, sans que rien ne dise
           * qu'il s'y trouvait une image. Faute d'un texte alternatif saisi
           * par l'auteur, on annonce au moins de quoi il s'agit, en
           * s'appuyant sur le titre quand il existe.
           */
          alt={titre ? `Image de la publication « ${titre} »` : 'Image de la publication'}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      )}

      {medias.length > 1 && (
        <>
          {index > 0 && (
            <button
              onClick={() => setIndex((i) => i - 1)}
              aria-label="Média précédent"
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 px-3 py-1.5 text-white hover:bg-black/70"
            >
              ‹
            </button>
          )}
          {index < medias.length - 1 && (
            <button
              onClick={() => setIndex((i) => i + 1)}
              aria-label="Média suivant"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 px-3 py-1.5 text-white hover:bg-black/70"
            >
              ›
            </button>
          )}

          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
            {medias.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full ${
                  i === index ? 'bg-white' : 'bg-white/50'
                }`}
              />
            ))}
          </div>

          <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
            {index + 1}/{medias.length}
          </span>
        </>
      )}
    </div>
  );
}

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
    <article className="overflow-hidden rounded-carte border border-ardoise-200 bg-white">
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
        post.medias?.length > 0 && <Carrousel medias={post.medias} titre={post.titre} />
      )}

      {/* ---------- Actions ---------- */}
      <div className="flex items-center gap-4 px-4 pt-3">
        <button
          onClick={basculerLike}
          disabled={post.verrouille}
          aria-pressed={aLike}
          className={`flex items-center gap-1.5 text-sm font-medium transition-colors disabled:opacity-40 ${
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
          className="flex items-center gap-1.5 text-sm font-medium text-ardoise-500 hover:text-ardoise-800 disabled:opacity-40"
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
