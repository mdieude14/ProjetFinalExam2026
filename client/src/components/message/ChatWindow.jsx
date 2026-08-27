import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';

import messageApi from '@/api/message.api';
import useSocket from '@/hooks/useSocket';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import Spinner from '@/components/ui/Spinner';
import ChatRequestBanner from './ChatRequestBanner';
import { formaterDateHeure } from '@/utils/dates';

/**
 * Fil d'une conversation.
 *
 * LE TEMPS RÉEL NE REMPLACE PAS LE CHARGEMENT, IL LE COMPLÈTE.
 * On charge l'historique par HTTP à l'ouverture, puis on écoute le socket
 * pour la suite. S'appuyer uniquement sur le socket laisserait un fil vide à
 * qui ouvre une conversation ancienne ; s'appuyer uniquement sur HTTP
 * obligerait à recharger la page pour voir arriver un message.
 *
 * LES MESSAGES REÇUS SONT FILTRÉS PAR CONVERSATION.
 * Le socket diffuse vers la SALLE de l'utilisateur, pas vers celle d'un fil :
 * ce composant reçoit donc aussi les messages des autres conversations. Les
 * ajouter sans filtrer les ferait apparaître dans le mauvais fil — un défaut
 * spectaculaire et facile à commettre.
 */

/** Une bulle. */
function Bulle({ message, deMoi }) {
  return (
    <li className={`flex ${deMoi ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-3.5 py-2 ${
          deMoi
            ? 'rounded-br-sm bg-marque-500 text-white'
            : 'rounded-bl-sm bg-ardoise-100 text-ardoise-900'
        }`}
      >
        {message.supprime ? (
          <p className={`text-sm italic ${deMoi ? 'text-white/70' : 'text-ardoise-400'}`}>
            Message supprimé
          </p>
        ) : (
          <>
            {message.media?.url && (
              <img
                src={message.media.url}
                alt="Pièce jointe"
                loading="lazy"
                className="mb-1.5 max-h-64 w-full rounded-lg object-cover"
              />
            )}
            {message.contenu && (
              // `whitespace-pre-wrap` conserve les retours à la ligne saisis.
              // Sans lui, un message écrit en plusieurs paragraphes s'affiche
              // en un seul bloc, ce qui le rend souvent illisible.
              <p className="whitespace-pre-wrap break-words text-sm">{message.contenu}</p>
            )}
          </>
        )}

        <p
          className={`mt-0.5 text-right text-[10px] ${
            deMoi ? 'text-white/70' : 'text-ardoise-400'
          }`}
        >
          {formaterDateHeure(message.createdAt)}
          {/* La double coche ne concerne que MES messages : savoir que j'ai
              lu les miens n'apprendrait rien à personne. */}
          {deMoi && (message.lu ? ' ✓✓' : ' ✓')}
        </p>
      </div>
    </li>
  );
}

export default function ChatWindow({ conversation, moi, surMaj, surRetour }) {
  const { ecouter, emettre, connecte } = useSocket();

  const [messages, setMessages] = useState([]);
  const [chargement, setChargement] = useState(false);
  const [saisie, setSaisie] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [ecrit, setEcrit] = useState(false);

  const basDuFil = useRef(null);
  const minuteurSaisie = useRef(null);
  const idConversation = conversation?._id;

  /* ---------------------- Chargement initial ---------------------- */

  useEffect(() => {
    if (!idConversation) return;

    let annule = false;
    setChargement(true);
    setErreur(null);

    messageApi
      .messages(idConversation)
      .then((reponse) => {
        if (annule) return;
        setMessages(reponse.data.messages || []);
      })
      .catch((e) => {
        if (!annule) setErreur(e.message);
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });

    // Ouvrir une conversation vaut lecture : le compteur retombe à zéro et
    // l'expéditeur voit sa double coche apparaître.
    messageApi.marquerLu(idConversation).catch(() => {});

    return () => {
      annule = true;
    };
  }, [idConversation]);

  /* ---------------------- Rattrapage à la connexion ---------------------- */

  /*
   * LE SOCKET NE RACONTE QUE CE QUI S'EST PASSÉ PENDANT QU'IL ÉCOUTAIT.
   *
   * Entre l'affichage de la page et l'authentification du socket — qui fait
   * un aller-retour en base — il existe une fenêtre de quelques centaines de
   * millisecondes, parfois davantage sur une machine chargée. Un message
   * envoyé dans cette fenêtre n'est jamais diffusé à ce client : il n'était
   * pas encore dans sa salle.
   *
   * En temps normal l'écart se comble tout seul, à la prochaine ouverture du
   * fil. Mais pour quelqu'un qui laisse sa conversation ouverte, le message
   * resterait invisible indéfiniment.
   *
   * On relit donc le fil à chaque fois que la connexion s'établit — y compris
   * après une coupure réseau, où le trou peut être bien plus large.
   */
  useEffect(() => {
    if (!idConversation || !connecte) return;

    let annule = false;
    messageApi
      .messages(idConversation)
      .then((reponse) => {
        if (annule) return;
        setMessages(reponse.data.messages || []);
      })
      .catch(() => {
        // Sans conséquence : le fil déjà chargé reste affiché.
      });

    return () => {
      annule = true;
    };
  }, [idConversation, connecte]);

  /* ------------------------- Temps réel ------------------------- */

  useEffect(() => {
    if (!idConversation) return;

    const arrets = [
      ecouter('message:nouveau', ({ conversation: idRecu, message }) => {
        // Le filtre indispensable : le socket diffuse vers la salle de
        // l'utilisateur, donc tous ses fils confondus.
        if (String(idRecu) !== String(idConversation)) return;

        setMessages((precedents) =>
          // Un message déjà présent — celui qu'on vient d'envoyer et qui
          // revient par le socket — ne doit pas s'afficher deux fois.
          precedents.some((m) => m._id === message._id)
            ? precedents
            : [...precedents, message]
        );

        if (String(message.expediteur?._id) !== String(moi)) {
          messageApi.marquerLu(idConversation).catch(() => {});
        }
      }),

      ecouter('messages:lus', ({ conversation: idRecu, par }) => {
        if (String(idRecu) !== String(idConversation)) return;
        if (String(par) === String(moi)) return;

        setMessages((precedents) =>
          precedents.map((m) =>
            String(m.expediteur?._id) === String(moi) ? { ...m, lu: true } : m
          )
        );
      }),

      ecouter('message:supprime', ({ conversation: idRecu, message }) => {
        if (String(idRecu) !== String(idConversation)) return;
        setMessages((precedents) =>
          precedents.map((m) =>
            m._id === message ? { ...m, supprime: true, contenu: null, media: null } : m
          )
        );
      }),

      ecouter('saisie:debut', ({ conversation: idRecu }) => {
        if (String(idRecu) !== String(idConversation)) return;
        setEcrit(true);
      }),

      ecouter('saisie:fin', ({ conversation: idRecu }) => {
        if (String(idRecu) !== String(idConversation)) return;
        setEcrit(false);
      }),
    ];

    return () => arrets.forEach((arreter) => arreter());
  }, [ecouter, idConversation, moi]);

  /*
   * L'indicateur « écrit… » s'éteint tout seul.
   *
   * SANS CE MINUTEUR, IL PEUT RESTER ALLUMÉ POUR TOUJOURS : il suffit que
   * l'autre ferme son onglet entre le `saisie:debut` et le `saisie:fin`. Le
   * second n'arrive jamais, et l'interface affirme indéfiniment que quelqu'un
   * est en train d'écrire.
   */
  useEffect(() => {
    if (!ecrit) return;
    const minuteur = setTimeout(() => setEcrit(false), 5000);
    return () => clearTimeout(minuteur);
  }, [ecrit, messages.length]);

  /* --------------------- Défilement automatique --------------------- */

  useEffect(() => {
    basDuFil.current?.scrollIntoView({ block: 'end' });
  }, [messages, ecrit]);

  /* ---------------------------- Envoi ---------------------------- */

  const envoyer = async (evenement) => {
    evenement.preventDefault();
    const texte = saisie.trim();
    if (!texte || envoi) return;

    setEnvoi(true);
    setErreur(null);

    try {
      const reponse = await messageApi.envoyer(idConversation, { contenu: texte });
      setSaisie('');
      emettre('saisie:fin', { conversation: idConversation });

      // On ajoute localement sans attendre le socket : sur une connexion
      // lente, voir son propre message mettre une seconde à apparaître donne
      // l'impression que l'envoi a échoué.
      const nouveau = reponse.data.donnees;
      setMessages((precedents) =>
        precedents.some((m) => m._id === nouveau._id) ? precedents : [...precedents, nouveau]
      );

      surMaj?.();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnvoi(false);
    }
  };

  /**
   * Signale la saisie, sans inonder le serveur.
   *
   * UN ÉVÉNEMENT PAR FRAPPE SERAIT ABSURDE : « natation » en enverrait huit
   * pour dire une seule chose. On n'émet qu'au début d'une série, et un
   * minuteur referme la série après deux secondes de silence.
   */
  const signalerSaisie = useCallback(() => {
    if (!minuteurSaisie.current) {
      emettre('saisie:debut', { conversation: idConversation });
    } else {
      clearTimeout(minuteurSaisie.current);
    }

    minuteurSaisie.current = setTimeout(() => {
      emettre('saisie:fin', { conversation: idConversation });
      minuteurSaisie.current = null;
    }, 2000);
  }, [emettre, idConversation]);

  useEffect(() => () => clearTimeout(minuteurSaisie.current), []);

  /* ----------------------------- Rendu ----------------------------- */

  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <p className="text-sm text-ardoise-500">
          Choisissez une conversation pour l&apos;afficher.
        </p>
      </div>
    );
  }

  const autre = conversation.interlocuteur;
  const nom = autre?.prenom ? `${autre.prenom} ${autre.nom}` : autre?.pseudo;
  const peutEcrire =
    conversation.statut === 'accepte' ||
    (conversation.statut === 'en_attente' && !conversation.estDemandeur) ||
    (conversation.statut === 'en_attente' &&
      conversation.estDemandeur &&
      messages.filter((m) => String(m.expediteur?._id) === String(moi)).length === 0);

  return (
    <div className="flex h-full flex-col">
      {/* ------------------------- En-tête ------------------------- */}
      <header className="flex items-center gap-3 border-b border-ardoise-200 p-3">
        {/* Retour visible en mobile seulement : sur grand écran, la liste
            reste affichée à gauche et le bouton n'aurait aucun sens. */}
        <button
          type="button"
          onClick={surRetour}
          className="rounded-lg px-2 py-1 text-ardoise-500 hover:bg-ardoise-100 md:hidden"
          aria-label="Retour aux conversations"
        >
          ←
        </button>

        <Link to={`/profile/${autre?.pseudo}`} className="flex min-w-0 items-center gap-2.5">
          <Avatar utilisateur={autre} taille="sm" />
          <span className="min-w-0">
            <span className="block truncate font-semibold text-ardoise-900">{nom}</span>
            <span className="block truncate text-xs text-ardoise-400">@{autre?.pseudo}</span>
          </span>
        </Link>
      </header>

      <ChatRequestBanner
        conversation={conversation}
        enCours={envoi}
        surReponse={async (action) => {
          setEnvoi(true);
          try {
            await messageApi.repondreDemande(idConversation, action);
            surMaj?.();
          } catch (e) {
            setErreur(e.message);
          } finally {
            setEnvoi(false);
          }
        }}
      />

      {/* -------------------------- Le fil -------------------------- */}
      <div className="flex-1 overflow-y-auto p-3">
        {chargement && <Spinner className="mx-auto my-8" />}

        {!chargement && messages.length === 0 && (
          <p className="py-8 text-center text-sm text-ardoise-400">
            Aucun message. Écrivez le premier.
          </p>
        )}

        {/* Repere stable pour les bancs d essai : le fil, distinct de
            l extrait affiche dans la liste des conversations. */}
        <ul className="space-y-2" data-testid="fil-messages">
          {messages.map((message) => (
            <Bulle
              key={message._id}
              message={message}
              deMoi={String(message.expediteur?._id) === String(moi)}
            />
          ))}
        </ul>

        {ecrit && (
          <p className="mt-2 text-xs italic text-ardoise-400" role="status">
            {nom} écrit…
          </p>
        )}

        <div ref={basDuFil} />
      </div>

      {/* ------------------------- Saisie ------------------------- */}
      {erreur && (
        <div className="px-3">
          <Alert variante="erreur">{erreur}</Alert>
        </div>
      )}

      {peutEcrire ? (
        <form onSubmit={envoyer} className="flex items-end gap-2 border-t border-ardoise-200 p-3">
          <textarea
            value={saisie}
            onChange={(e) => {
              setSaisie(e.target.value);
              signalerSaisie();
            }}
            onKeyDown={(e) => {
              // Entrée envoie, Maj+Entrée passe à la ligne : la convention de
              // toutes les messageries. L'inverse oblige à cliquer pour
              // envoyer chaque message.
              if (e.key === 'Enter' && !e.shiftKey) envoyer(e);
            }}
            rows={1}
            placeholder="Écrivez un message…"
            aria-label="Votre message"
            className="max-h-32 flex-1 resize-none rounded-xl border border-ardoise-200 px-3 py-2 text-sm focus:border-marque-500 focus:outline-none focus:ring-2 focus:ring-marque-500/30"
          />
          <Button type="submit" chargement={envoi} disabled={!saisie.trim()}>
            Envoyer
          </Button>
        </form>
      ) : (
        conversation.statut === 'en_attente' &&
        conversation.estDemandeur && (
          <p className="border-t border-ardoise-200 p-3 text-center text-xs text-ardoise-500">
            Vous pourrez écrire de nouveau lorsque votre demande aura été acceptée.
          </p>
        )
      )}
    </div>
  );
}
