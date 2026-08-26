import Button from '@/components/ui/Button';

/**
 * Bandeau d'une demande de conversation.
 *
 * TROIS SITUATIONS, TROIS MESSAGES DIFFÉRENTS — et les confondre rendrait
 * l'écran incompréhensible :
 *
 *   je suis le demandeur, en attente   « votre demande attend une réponse »
 *   je suis la cible, en attente       deux boutons : accepter / refuser
 *   la demande a été refusée           plus aucune action possible
 *
 * LE REFUS EST ANNONCÉ AVANT D'ÊTRE CLIQUÉ. « Cette personne ne pourra plus
 * vous écrire » est une conséquence définitive : la découvrir après coup, sur
 * un bouton qui disait seulement « refuser », serait une mauvaise surprise.
 */
export default function ChatRequestBanner({ conversation, surReponse, enCours }) {
  if (!conversation || conversation.statut === 'accepte') return null;

  const autre = conversation.interlocuteur;
  const nom = autre?.prenom ? `${autre.prenom} ${autre.nom}` : autre?.pseudo;

  if (conversation.statut === 'refuse') {
    return (
      <div
        role="status"
        className="border-b border-ardoise-200 bg-ardoise-50 px-4 py-3 text-center"
      >
        <p className="text-sm text-ardoise-600">
          Cette conversation a été refusée. Plus aucun message ne peut y être envoyé.
        </p>
      </div>
    );
  }

  if (conversation.estDemandeur) {
    return (
      <div
        role="status"
        className="border-b border-ardoise-200 bg-ardoise-50 px-4 py-3 text-center"
      >
        <p className="text-sm text-ardoise-600">
          Votre demande attend une réponse. Vous pourrez écrire de nouveau
          lorsque {nom} l&apos;aura acceptée.
        </p>
      </div>
    );
  }

  return (
    <div className="border-b border-marque-200 bg-marque-50 px-4 py-3">
      <p className="text-sm text-ardoise-800">
        <strong>{nom}</strong> souhaite vous écrire.
      </p>
      <p className="mt-0.5 text-xs text-ardoise-600">
        Répondre suffit à accepter. Refuser l&apos;empêchera définitivement de
        vous écrire.
      </p>

      <div className="mt-3 flex gap-2">
        <Button
          taille="sm"
          chargement={enCours}
          onClick={() => surReponse('accepter')}
        >
          Accepter
        </Button>
        <Button
          taille="sm"
          variante="secondaire"
          chargement={enCours}
          onClick={() => surReponse('refuser')}
        >
          Refuser
        </Button>
      </div>
    </div>
  );
}
