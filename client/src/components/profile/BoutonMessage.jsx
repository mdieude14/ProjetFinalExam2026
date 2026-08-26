import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import messageApi from '@/api/message.api';
import Button from '@/components/ui/Button';

/**
 * Bouton « Envoyer un message » d'une fiche profil.
 *
 * POURQUOI CE COMPOSANT EXISTE, ET POURQUOI SON ABSENCE ÉTAIT UN VRAI DÉFAUT.
 * Tout le module 11 — modèles, transactions, sockets, écran de messagerie —
 * était en place et vérifié, mais AUCUNE porte d'entrée ne menait à une
 * nouvelle conversation. On pouvait lire et répondre à un fil existant,
 * jamais en ouvrir un. Une fonctionnalité sans point de départ n'existe pas
 * pour l'utilisateur, si complète soit-elle par ailleurs.
 *
 * OUVRIR N'EST PAS ENVOYER. Le bouton crée — ou retrouve — la conversation,
 * puis emmène vers le fil. Il n'écrit aucun message : rédiger se fait dans la
 * conversation, où l'on voit à qui l'on parle et ce qui a déjà été dit.
 *
 * L'API est IDEMPOTENTE côté serveur : rappeler `ouvrir()` sur une
 * conversation existante la renvoie telle quelle plutôt que d'en créer une
 * seconde. Ce bouton peut donc être cliqué autant de fois qu'on veut sans
 * multiplier les fils — la garantie vient de l'index unique sur la paire, pas
 * d'une précaution prise ici.
 */
export default function BoutonMessage({ profil, estMoi, className }) {
  const naviguer = useNavigate();
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState(null);

  // On ne s'écrit pas à soi-même : le serveur le refuse, et proposer le
  // bouton reviendrait à promettre une action vouée à l'échec.
  if (estMoi || !profil?._id) return null;

  const ouvrir = async () => {
    setChargement(true);
    setErreur(null);

    try {
      const reponse = await messageApi.ouvrir(profil._id);
      const conversation = reponse.data.conversation;
      naviguer(`/messages?c=${conversation._id}`);
    } catch (e) {
      setErreur(e.message);
      setChargement(false);
    }
  };

  return (
    <div className={className}>
      <Button
        variante="secondaire"
        taille="sm"
        chargement={chargement}
        onClick={ouvrir}
      >
        Envoyer un message
      </Button>

      {erreur && <p className="mt-1 text-xs text-red-600">{erreur}</p>}
    </div>
  );
}
