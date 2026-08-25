import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import postApi from '@/api/post.api';
import useAuth from '@/hooks/useAuth';
import Avatar from '@/components/ui/Avatar';
import Spinner from '@/components/ui/Spinner';

/**
 * Section commentaires d'une publication.
 *
 * Charge les commentaires racines a l'ouverture, et les reponses seulement
 * si l'on deplie un fil : afficher toutes les reponses d'emblee alourdirait
 * la reponse pour un contenu que la plupart des lecteurs ne consultent pas.
 */

function Commentaire({ commentaire, idAuteurPost, onSupprime, onRepondre, niveau = 0 }) {
  const { utilisateur, estAdmin } = useAuth();
  const [reponses, setReponses] = useState([]);
  const [reponsesOuvertes, setReponsesOuvertes] = useState(false);
  const [chargementReponses, setChargementReponses] = useState(false);

  // Trois personnes peuvent supprimer : l'auteur du commentaire, l'auteur de
  // la publication (moderation de sa propre section) et un administrateur.
  const peutSupprimer =
    String(commentaire.auteur?._id) === String(utilisateur?._id) ||
    String(idAuteurPost) === String(utilisateur?._id) ||
    estAdmin;

  const chargerReponses = async () => {
    if (reponsesOuvertes) {
      setReponsesOuvertes(false);
      return;
    }
    setChargementReponses(true);
    try {
      const reponse = await postApi.commentaires(commentaire.post, {
        parent: commentaire._id,
        limite: 50,
      });
      setReponses(reponse.data.elements);
      setReponsesOuvertes(true);
    } finally {
      setChargementReponses(false);
    }
  };

  return (
    <li className={niveau > 0 ? 'ml-9 border-l border-ardoise-100 pl-3' : ''}>
      <div className="flex gap-2.5 py-2">
        <Link to={`/profile/${commentaire.auteur?.pseudo}`}>
          <Avatar utilisateur={commentaire.auteur} taille="sm" />
        </Link>

        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <Link
              to={`/profile/${commentaire.auteur?.pseudo}`}
              className="font-semibold text-ardoise-900 hover:underline"
            >
              {commentaire.auteur?.pseudo}
            </Link>{' '}
            <span className="text-ardoise-700">{commentaire.texte}</span>
          </p>

          <div className="mt-1 flex flex-wrap gap-3 text-xs text-ardoise-400">
            <time dateTime={commentaire.createdAt}>
              {new Date(commentaire.createdAt).toLocaleDateString('fr-FR', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </time>

            {niveau === 0 && (
              <button
                onClick={() => onRepondre(commentaire)}
                className="font-medium hover:text-ardoise-700"
              >
                Répondre
              </button>
            )}

            {peutSupprimer && (
              <button
                onClick={() => onSupprime(commentaire)}
                className="font-medium hover:text-erreur"
              >
                Supprimer
              </button>
            )}
          </div>

          {commentaire.reponsesCount > 0 && niveau === 0 && (
            <button
              onClick={chargerReponses}
              className="mt-1.5 text-xs font-medium text-ardoise-500 hover:text-ardoise-800"
            >
              {chargementReponses
                ? 'Chargement...'
                : reponsesOuvertes
                  ? 'Masquer les réponses'
                  : `Voir les ${commentaire.reponsesCount} reponse${
                      commentaire.reponsesCount > 1 ? 's' : ''
                    }`}
            </button>
          )}
        </div>
      </div>

      {reponsesOuvertes && (
        <ul>
          {reponses.map((reponse) => (
            <Commentaire
              key={reponse._id}
              commentaire={reponse}
              idAuteurPost={idAuteurPost}
              onSupprime={onSupprime}
              onRepondre={onRepondre}
              niveau={1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function CommentList({ idPost, idAuteurPost, onChangementNombre }) {
  const { utilisateur } = useAuth();

  const [commentaires, setCommentaires] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [aSuivante, setASuivante] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [texte, setTexte] = useState('');
  const [repondA, setRepondA] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState(null);

  const charger = useCallback(
    async (numeroPage = 1) => {
      setChargement(true);
      try {
        const reponse = await postApi.commentaires(idPost, { page: numeroPage });
        setCommentaires((precedents) =>
          numeroPage === 1
            ? reponse.data.elements
            : [...precedents, ...reponse.data.elements]
        );
        setTotal(reponse.data.pagination.total);
        setASuivante(reponse.data.pagination.aSuivante);
        setPage(numeroPage);
      } catch (e) {
        setErreur(e.message);
      } finally {
        setChargement(false);
      }
    },
    [idPost]
  );

  useEffect(() => {
    charger(1);
  }, [charger]);

  const envoyer = async (evenement) => {
    evenement.preventDefault();
    if (!texte.trim()) return;

    setEnvoi(true);
    setErreur(null);
    try {
      const reponse = await postApi.commenter(idPost, texte, repondA?._id);

      if (repondA) {
        // La reponse est rattachee a un fil replie : on incremente le
        // compteur du parent plutot que d'inserer la reponse a la racine,
        // ou elle apparaitrait au mauvais endroit.
        setCommentaires((precedents) =>
          precedents.map((c) =>
            c._id === repondA._id
              ? { ...c, reponsesCount: (c.reponsesCount || 0) + 1 }
              : c
          )
        );
      } else {
        setCommentaires((precedents) => [reponse.data.commentaire, ...precedents]);
      }

      setTexte('');
      setRepondA(null);
      onChangementNombre?.((n) => n + 1);
      setTotal((n) => n + 1);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnvoi(false);
    }
  };

  const supprimer = async (commentaire) => {
    try {
      const reponse = await postApi.supprimerCommentaire(commentaire._id);
      const supprimes = reponse.data.supprimes || 1;

      setCommentaires((precedents) => precedents.filter((c) => c._id !== commentaire._id));
      setTotal((n) => Math.max(0, n - supprimes));
      onChangementNombre?.((n) => Math.max(0, n - supprimes));
    } catch (e) {
      setErreur(e.message);
    }
  };

  return (
    <div className="border-t border-ardoise-100 px-4 py-3">
      {/* ---------- Formulaire ---------- */}
      <form onSubmit={envoyer} className="mb-3">
        {repondA && (
          <div className="mb-2 flex items-center justify-between rounded-lg bg-ardoise-50 px-3 py-1.5 text-xs">
            <span className="text-ardoise-600">
              Reponse a <strong>@{repondA.auteur?.pseudo}</strong>
            </span>
            <button
              type="button"
              onClick={() => setRepondA(null)}
              className="font-medium text-ardoise-500 hover:text-ardoise-800"
            >
              Annuler
            </button>
          </div>
        )}

        <div className="flex gap-2">
          <Avatar utilisateur={utilisateur} taille="sm" />
          <input
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            maxLength={1000}
            placeholder="Ajouter un commentaire..."
            aria-label="Ajouter un commentaire"
            className="min-w-0 flex-1 rounded-xl border border-ardoise-200 px-3 py-2 text-sm focus:border-marque-500 focus:outline-none focus:ring-2 focus:ring-marque-500/30"
          />
          <button
            type="submit"
            disabled={!texte.trim() || envoi}
            className="shrink-0 text-sm font-semibold text-marque-600 disabled:opacity-40"
          >
            {envoi ? '…' : 'Publier'}
          </button>
        </div>
      </form>

      {erreur && <p className="mb-2 text-xs text-erreur">{erreur}</p>}

      {/* ---------- Liste ---------- */}
      {chargement && commentaires.length === 0 ? (
        <div className="flex justify-center py-4">
          <Spinner className="text-marque-500" />
        </div>
      ) : commentaires.length === 0 ? (
        <p className="py-3 text-center text-xs text-ardoise-400">
          Aucun commentaire. Soyez le premier.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-ardoise-50">
            {commentaires.map((commentaire) => (
              <Commentaire
                key={commentaire._id}
                commentaire={commentaire}
                idAuteurPost={idAuteurPost}
                onSupprime={supprimer}
                onRepondre={setRepondA}
              />
            ))}
          </ul>

          {aSuivante && (
            <button
              onClick={() => charger(page + 1)}
              disabled={chargement}
              className="mt-2 w-full py-2 text-xs font-medium text-ardoise-500 hover:text-ardoise-800"
            >
              {chargement ? 'Chargement...' : `Voir plus de commentaires (${total})`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
