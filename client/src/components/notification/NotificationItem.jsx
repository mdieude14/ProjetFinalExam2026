import { Link } from 'react-router-dom';

import Avatar from '@/components/ui/Avatar';
import { delaiDepuis } from '@/utils/dates';

/**
 * Une notification dans la liste.
 *
 * DEUX CHOSES À FAIRE, ET LES DEUX SONT DES DÉCISIONS D'INTERFACE :
 *
 *   1. TRADUIRE UN TYPE EN PHRASE. Le serveur envoie `like`, `demande_chat`,
 *      `inscription_event`. Ces mots sont justes côté base, illisibles côté
 *      écran. La traduction vit ici, en un seul endroit, plutôt que dispersée
 *      dans des ternaires au fil du rendu.
 *
 *   2. MENER À L'ENDROIT EXACT. Une notification qui ne conduit nulle part
 *      oblige à retrouver soi-même la publication commentée — et l'on
 *      renonce. Le lien se déduit du couple (type, cibleType).
 *
 * LA CIBLE PEUT AVOIR DISPARU. La publication commentée a pu être supprimée
 * entre-temps : `cible` vaut alors `null`. On affiche quand même la
 * notification — « quelqu'un a commenté votre publication » reste une
 * information juste — mais sans lien, faute de destination.
 */

/**
 * Phrase affichée, par type.
 *
 * Le nom de l'émetteur est passé en paramètre plutôt qu'interpolé dans une
 * table de chaînes : « Bob » doit rester un lien cliquable vers son profil,
 * ce qu'une chaîne pré-assemblée ne permettrait pas.
 */
const PHRASES = {
  follow: 'vous suit désormais',
  demande_follow: 'demande à vous suivre',
  like: 'a aimé votre publication',
  commentaire: 'a commenté votre publication',
  demande_chat: 'souhaite vous écrire',
  message: 'vous a envoyé un message',
  inscription_event: 's’est inscrit à votre événement',
  nouvel_abonne_premium: 's’est abonné à votre offre premium',
  diplome_verifie: 'Votre diplôme a été examiné',
};

/** Pictogramme par type — doublé du texte, jamais seul porteur de sens. */
const ICONES = {
  follow: '👤',
  demande_follow: '👤',
  like: '❤️',
  commentaire: '💬',
  demande_chat: '✉️',
  message: '✉️',
  inscription_event: '▤',
  nouvel_abonne_premium: '★',
  diplome_verifie: '✓',
};

/**
 * Destination d'une notification.
 *
 * Renvoie `null` quand il n'y a nulle part où aller — cible supprimée, ou
 * type qui ne pointe vers rien de consultable. L'appelant rend alors la ligne
 * sans lien plutôt qu'un lien mort.
 */
function destination(notification) {
  const { type, cibleType, cible, emetteur } = notification;

  if (type === 'demande_follow') return '/demandes';

  if (type === 'message' || type === 'demande_chat') {
    return cible ? `/messages?c=${cible}` : '/messages';
  }

  if (cibleType === 'SportEvent' && cible) return `/evenements/${cible}`;

  // Un like ou un commentaire pointe sur la publication ; faute de page
  // dédiée à un post isolé, on renvoie au profil de son auteur — c'est-à-dire
  // le nôtre, puisque nous en sommes le destinataire.
  if (cibleType === 'Post') return cible ? '/home' : null;

  if (emetteur?.pseudo) return `/profile/${emetteur.pseudo}`;

  return null;
}

export default function NotificationItem({ notification, surLecture, surSuppression }) {
  const { type, emetteur, lu, createdAt } = notification;

  const nom = emetteur?.prenom
    ? `${emetteur.prenom} ${emetteur.nom}`
    : emetteur?.pseudo;

  const lien = destination(notification);
  const phrase = PHRASES[type] || 'Nouvelle notification';

  // Seul type sans émetteur : la décision vient de l'administration, pas
  // d'une personne dont on afficherait l'avatar.
  const sansEmetteur = !emetteur;

  const contenu = (
    <>
      <span className="shrink-0" aria-hidden="true">
        {sansEmetteur ? (
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ardoise-100 text-lg">
            {ICONES[type] || '•'}
          </span>
        ) : (
          <span className="relative block">
            <Avatar utilisateur={emetteur} taille="md" />
            <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[11px] ring-1 ring-ardoise-200">
              {ICONES[type] || '•'}
            </span>
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-sm text-ardoise-800">
          {!sansEmetteur && <strong className="font-semibold">{nom}</strong>}
          {!sansEmetteur && ' '}
          {phrase}
        </span>
        <span className="mt-0.5 block text-xs text-ardoise-400">
          {delaiDepuis(createdAt)}
        </span>
      </span>
    </>
  );

  return (
    <li
      className={`flex items-center gap-3 border-b border-ardoise-100 p-3 transition-colors ${
        lu ? 'bg-white' : 'bg-marque-50/60'
      }`}
    >
      {lien ? (
        <Link
          to={lien}
          onClick={() => !lu && surLecture?.(notification)}
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          {contenu}
        </Link>
      ) : (
        /*
         * Sans destination, la ligne reste une ligne — pas un lien mort.
         * Un lien qui ne mène nulle part est pire qu'un texte simple : on
         * clique, rien ne se passe, et l'on recommence.
         */
        <span className="flex min-w-0 flex-1 items-center gap-3">{contenu}</span>
      )}

      <span className="flex shrink-0 items-center gap-1">
        {!lu && (
          <button
            type="button"
            onClick={() => surLecture?.(notification)}
            title="Marquer comme lue"
            className="rounded-lg px-2 py-1 text-xs text-marque-600 hover:bg-marque-100"
          >
            {/* Le texte accessible dit l'action complète : « ✓ » seul ne
                s'annonce pas à un lecteur d'écran. */}
            <span aria-hidden="true">✓</span>
            <span className="lecteur-ecran-seulement">Marquer comme lue</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => surSuppression?.(notification)}
          title="Supprimer"
          className="rounded-lg px-2 py-1 text-xs text-ardoise-400 hover:bg-ardoise-100 hover:text-ardoise-600"
        >
          <span aria-hidden="true">✕</span>
          <span className="lecteur-ecran-seulement">Supprimer cette notification</span>
        </button>
      </span>
    </li>
  );
}
