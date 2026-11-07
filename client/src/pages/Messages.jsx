import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

import messageApi from '@/api/message.api';
import useAuth from '@/hooks/useAuth';
import useSocket from '@/hooks/useSocket';
import ConversationList from '@/components/message/ConversationList';
import ChatWindow from '@/components/message/ChatWindow';
import NouvelleConversation from '@/components/message/NouvelleConversation';
import Alert from '@/components/ui/Alert';
import Spinner from '@/components/ui/Spinner';
import Button from '@/components/ui/Button';

/**
 * Messagerie — /messages
 *
 * DEUX COLONNES SUR GRAND ÉCRAN, UNE SEULE SUR MOBILE.
 * Ce n'est pas qu'une question de largeur : sur téléphone, afficher la liste
 * ET le fil réduirait les deux à l'inutilisable. On bascule donc de l'un à
 * l'autre, avec un retour explicite — c'est le schéma de toutes les
 * messageries mobiles, et il est attendu.
 *
 * LA CONVERSATION OUVERTE VIT DANS L'URL (`?c=`).
 * Cela rend un fil partageable entre ses propres onglets, rechargeable, et
 * navigable au bouton « précédent » — qui, sur mobile, ramène naturellement
 * à la liste.
 */
export default function Messages() {
  const { utilisateur } = useAuth();
  const { ecouter } = useSocket();

  const [parametres, setParametres] = useSearchParams();
  const idOuvert = parametres.get('c');

  const [conversations, setConversations] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [nouvelle, setNouvelle] = useState(false);

  const moi = utilisateur?._id;

  /* ----------------------- Chargement de la liste ----------------------- */

  const charger = useCallback(async () => {
    try {
      const reponse = await messageApi.conversations({ limite: 50 });
      setConversations(reponse.data.elements || []);
      setErreur(null);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    charger();
  }, [charger]);

  /* --------------------------- Temps réel --------------------------- */

  useEffect(() => {
    /*
     * ON MET À JOUR LA LISTE EN PLACE, sans la recharger.
     * Un `charger()` à chaque message repartirait chercher cinquante
     * conversations pour n'en changer qu'une — et ferait sauter la liste sous
     * le curseur pendant une conversation active.
     */
    const arret = ecouter('conversation:maj', ({ conversation }) => {
      setConversations((precedentes) => {
        const connue = precedentes.find((c) => c._id === conversation._id);
        const autres = precedentes.filter((c) => c._id !== conversation._id);

        /*
         * ON FUSIONNE, ON NE REMPLACE PAS.
         *
         * Remplacer l'objet entier fait perdre tout ce que la diffusion
         * n'apporte pas. C'est exactement ce qui est arrivé : un émetteur
         * envoyait un `interlocuteur` réduit à son identifiant, et l'en-tête
         * du fil affichait « ? » avec un lien vers /profile/undefined.
         *
         * La cause a été corrigée côté serveur, où elle devait l'être. Cette
         * fusion est la ceinture en plus de la bretelle : un futur émetteur
         * incomplet dégradera peut-être un compteur, il ne fera plus
         * disparaître l'identité de l'interlocuteur.
         */
        const fusionnee = {
          ...connue,
          ...conversation,
          interlocuteur:
            // Un identifiant nu n'a pas de `pseudo` : c'est le signe d'une
            // charge utile appauvrie, on garde alors ce qu'on savait déjà.
            conversation.interlocuteur?.pseudo
              ? conversation.interlocuteur
              : connue?.interlocuteur || conversation.interlocuteur,
        };

        // La conversation qui bouge remonte en tête : c'est le tri du
        // serveur, reproduit localement pour rester cohérent.
        return [fusionnee, ...autres];
      });
    });

    /*
     * UNE CONVERSATION SUPPRIMEE QUITTE LA LISTE DANS TOUS MES ONGLETS.
     * Le serveur ne diffuse cet evenement qu A MOI — l autre participant
     * n a pas a apprendre que j ai efface le fil. Mais mes propres
     * sessions doivent suivre : sans cela, un second onglet garderait une
     * conversation absente de la liste au prochain rechargement.
     */
    const arretSuppression = ecouter('conversation:supprimee', ({ conversation }) => {
      setConversations((precedentes) => precedentes.filter((c) => c._id !== conversation));
    });

    return () => {
      arret?.();
      arretSuppression?.();
    };
  }, [ecouter]);

  const ouverte = conversations.find((c) => c._id === idOuvert) || null;

  const selectionner = (conversation) => {
    setParametres({ c: conversation._id });

    // Optimisme assumé : le compteur retombe à zéro dès le clic. La requête
    // part en parallèle, et l'écart éventuel se corrige au prochain
    // `conversation:maj`.
    setConversations((precedentes) =>
      precedentes.map((c) => (c._id === conversation._id ? { ...c, nonLus: 0 } : c))
    );
  };

  /* ------------------------------ Rendu ------------------------------ */

  if (chargement) return <Spinner className="mx-auto my-12" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-ardoise-900">Messages</h1>

        <Button
          taille="sm"
          onClick={() => setNouvelle(true)}
          data-test="ouvrir-nouvelle-conversation"
        >
          Nouveau message
        </Button>
      </div>

      {erreur && <Alert variante="erreur">{erreur}</Alert>}

      <div className="overflow-hidden rounded-carte border border-ardoise-200 bg-white">
        <div className="grid md:grid-cols-[320px_1fr]">
          {/* ----------------------- Liste ----------------------- */}
          <div
            className={`border-ardoise-200 md:border-r ${
              ouverte ? 'hidden md:block' : 'block'
            }`}
          >
            <ConversationList
              conversations={conversations}
              selection={idOuvert}
              surSelection={selectionner}
              moi={moi}
            />
          </div>

          {/* ------------------------ Fil ------------------------ */}
          <div
            className={`h-[70vh] min-h-[420px] ${ouverte ? 'block' : 'hidden md:block'}`}
          >
            <ChatWindow
              // La clé force un remontage au changement de fil : sans elle,
              // les messages du précédent resteraient affichés le temps du
              // chargement du suivant.
              key={idOuvert || 'aucune'}
              conversation={ouverte}
              moi={moi}
              surMaj={charger}
              surRetour={() => setParametres({})}
            />
          </div>
        </div>
      </div>

      <NouvelleConversation
        ouvert={nouvelle}
        onFermer={() => setNouvelle(false)}
        /*
         * ON RECHARGE **PUIS** ON OUVRE LE FIL.
         * Le fil affiche est cherche dans `conversations` : poser `?c=` avant
         * que la liste ne contienne la conversation neuve laisserait
         * `ouverte` a `null`, et l ecran resterait vide alors que le message
         * est parti.
         */
        surCreation={async (conversation) => {
          await charger();
          setParametres({ c: conversation._id });
        }}
      />
    </div>
  );
}
