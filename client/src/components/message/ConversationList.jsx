import Avatar from '@/components/ui/Avatar';
import { delaiDepuis } from '@/utils/dates';

/**
 * Liste des conversations.
 *
 * CHAQUE LIGNE RÉPOND À TROIS QUESTIONS : qui, quand, quoi. C'est ce qui
 * permet de choisir où aller sans ouvrir. Le reste — avatar en grand,
 * historique, pièces jointes — appartient au fil lui-même.
 *
 * LA PASTILLE DE NON-LUS EST DOUBLÉE D'UNE MISE EN GRAS.
 * Une pastille colorée seule ne dit rien à qui ne distingue pas les couleurs,
 * et un lecteur d'écran ne l'annonce pas davantage. Le libellé accessible
 * porte donc le nombre en toutes lettres.
 */

/** Extrait affiché sous le nom, selon ce que contient le dernier message. */
function Extrait({ conversation, moi }) {
  const dernier = conversation.dernierMessage;

  if (!dernier) {
    return (
      <span className="italic text-ardoise-400">
        {conversation.estDemandeur
          ? 'Demande envoyée, pas encore de message'
          : 'Nouvelle demande de conversation'}
      </span>
    );
  }

  const deMoi = String(dernier.expediteur) === String(moi);
  const prefixe = deMoi ? 'Vous : ' : '';

  if (dernier.supprime) {
    return <span className="italic text-ardoise-400">{prefixe}message supprimé</span>;
  }

  if (!dernier.texte && dernier.avecMedia) {
    return <span className="text-ardoise-500">{prefixe}📎 pièce jointe</span>;
  }

  return (
    <span className="text-ardoise-500">
      {prefixe}
      {dernier.texte}
    </span>
  );
}

export default function ConversationList({
  conversations = [],
  selection,
  surSelection,
  moi,
}) {
  if (conversations.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-ardoise-600">Aucune conversation.</p>
        <p className="mt-1 text-xs text-ardoise-500">
          Ouvrez le profil de quelqu&apos;un pour lui écrire.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-ardoise-100" role="list">
      {conversations.map((conversation) => {
        const autre = conversation.interlocuteur;
        const actif = selection === conversation._id;
        const nonLus = conversation.nonLus || 0;

        return (
          <li key={conversation._id}>
            <button
              type="button"
              onClick={() => surSelection(conversation)}
              aria-current={actif ? 'true' : undefined}
              className={`flex w-full items-center gap-3 p-3 text-left transition-colors ${
                actif ? 'bg-marque-50' : 'hover:bg-ardoise-50'
              }`}
            >
              <Avatar utilisateur={autre} taille="md" />

              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span
                    className={`truncate ${
                      nonLus > 0 ? 'font-bold text-ardoise-900' : 'font-medium text-ardoise-800'
                    }`}
                  >
                    {autre?.prenom ? `${autre.prenom} ${autre.nom}` : autre?.pseudo}
                  </span>

                  {conversation.dernierMessage?.date && (
                    <span className="shrink-0 text-[11px] text-ardoise-400">
                      {delaiDepuis(conversation.dernierMessage.date)}
                    </span>
                  )}
                </span>

                <span
                  className={`mt-0.5 block truncate text-xs ${
                    nonLus > 0 ? 'font-semibold text-ardoise-700' : ''
                  }`}
                >
                  <Extrait conversation={conversation} moi={moi} />
                </span>

                {conversation.statut === 'en_attente' && (
                  <span className="mt-1 inline-block rounded-full bg-ardoise-100 px-2 py-0.5 text-[10px] font-semibold text-ardoise-600">
                    {conversation.estDemandeur ? 'En attente de réponse' : 'Demande reçue'}
                  </span>
                )}

                {conversation.statut === 'refuse' && (
                  <span className="mt-1 inline-block rounded-full bg-ardoise-100 px-2 py-0.5 text-[10px] font-semibold text-ardoise-500">
                    Refusée
                  </span>
                )}
              </span>

              {nonLus > 0 && (
                <span
                  className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-marque-500 px-1.5 text-[11px] font-bold text-white"
                  aria-label={`${nonLus} message${nonLus > 1 ? 's' : ''} non lu${nonLus > 1 ? 's' : ''}`}
                >
                  {nonLus > 9 ? '9+' : nonLus}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
