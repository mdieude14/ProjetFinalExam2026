import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';

import messageApi from '@/api/message.api';
import moderationApi from '@/api/moderation.api';
import useSocket from '@/hooks/useSocket';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';
import Textarea from '@/components/ui/Textarea';
import CapturePhoto from '@/components/story/CapturePhoto';
import MenuOptions from '@/components/ui/MenuOptions';
import MenuModeration from '@/components/moderation/MenuModeration';
import ChatRequestBanner from './ChatRequestBanner';
import { formaterDateHeure } from '@/utils/dates';

/* Plafonds du serveur, rappelés ici pour refuser AVANT de téléverser. */
const MO = 1024 * 1024;
const TAILLE_MAX_IMAGE = 5 * MO;
const TAILLE_MAX_VIDEO = 25 * MO;
const TYPES_ACCEPTES =
  'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime';

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

/**
 * Une bulle.
 *
 * LES ACTIONS NE SONT PROPOSÉES QUE SUR MES PROPRES MESSAGES, ET SEULEMENT
 * TANT QU'ILS EXISTENT. Le serveur refuserait de toute façon (403 sur le
 * message d'un autre, 409 sur un message supprimé), mais afficher une entrée
 * qui mène à une erreur est une impasse offerte : l'utilisateur essaie, et
 * c'est le message d'erreur qui lui apprend la règle.
 */
function Bulle({ message, deMoi, surLike, surDemanderModification, surDemanderSuppression }) {
  const modifiable = deMoi && !message.supprime;

  return (
    <li className={`flex items-end ${deMoi ? 'justify-end' : 'justify-start'}`}>
      {/*
        LE MENU EST À GAUCHE DE MA BULLE, ET À DROITE DE CELLE DE L'AUTRE.
        Mes bulles sont alignées à droite : poser le menu après elles le
        collerait au bord de l'écran. Le placer du côté intérieur le garde
        atteignable sans déplacer la bulle.
      */}
      {modifiable && (
        <MenuOptions
          libelle="Actions sur ce message"
          alignement="gauche"
          /*
           * `self-center` ET NON `self-end`.
           *
           * Le coeur, lui, est cale en bas : il accompagne l horodatage, qui
           * se trouve au pied de la bulle. Le menu n accompagne RIEN — il
           * agit sur la bulle entiere. Aligne en bas, il paraissait decroche
           * sur un message de plusieurs lignes, ou la bulle est haute et le
           * bouton tombait tout en bas, loin du texte qu il concerne.
           */
          className="shrink-0 self-center"
          entrees={[
            {
              cle: 'modifier',
              libelle: 'Modifier',
              description: 'La mention « modifié » restera visible',
              icone: '✏️',
              action: () => surDemanderModification?.(message),
            },
            {
              cle: 'supprimer',
              libelle: 'Supprimer',
              description: 'La bulle restera, vidée de son contenu',
              icone: '🗑️',
              danger: true,
              action: () => surDemanderSuppression?.(message),
            },
          ]}
        />
      )}

      <div
        className={`max-w-[75%] rounded-2xl px-3.5 py-2 ${
          deMoi
            ? 'rounded-br-sm bg-marque-500 text-white'
            : 'rounded-bl-sm bg-ardoise-100 text-ardoise-900'
        }`}
        data-test="bulle-message"
      >
        {message.supprime ? (
          <p className={`text-sm italic ${deMoi ? 'text-white/70' : 'text-ardoise-400'}`}>
            Message supprimé
          </p>
        ) : (
          <>
            {/*
              UNE VIDÉO NE S'AFFICHE PAS COMME UNE IMAGE.
              `<img>` sur une URL de vidéo ne rend rien du tout — pas d'erreur,
              juste une bulle vide. On choisit donc la balise d'après le type
              renvoyé par le serveur, et non d'après l'extension de l'URL.

              `preload="metadata"` charge la première image et la durée, pas la
              vidéo entière : un fil qui en contient dix ne doit pas déclencher
              dix téléchargements complets à l'ouverture.
            */}
            {message.media?.url &&
              (message.media.type === 'video' ? (
                <video
                  src={message.media.url}
                  controls
                  playsInline
                  preload="metadata"
                  className="mb-1.5 max-h-64 w-full rounded-lg bg-black"
                />
              ) : (
                <img
                  src={message.media.url}
                  alt="Pièce jointe"
                  loading="lazy"
                  className="mb-1.5 max-h-64 w-full rounded-lg object-cover"
                />
              ))}
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
          {/*
            « MODIFIÉ » EST AFFICHÉ AUX DEUX PARTICIPANTS, PAS SEULEMENT À
            L'AUTEUR. C'est toute la raison d'être de la date : une retouche
            que le destinataire ne verrait pas ferait de la messagerie un
            compte rendu non fiable de ce qui a été dit.

            Un message supprimé ne la porte pas : « Message supprimé, modifié »
            n'apprendrait rien et ferait douter de ce qui a disparu.
          */}
          {!message.supprime && message.modifieLe && (
            <span data-test="marque-modifie" title={`Modifié le ${formaterDateHeure(message.modifieLe)}`}>
              {' · modifié'}
            </span>
          )}
          {/* La double coche ne concerne que MES messages : savoir que j'ai
              lu les miens n'apprendrait rien à personne. */}
          {deMoi && (message.lu ? ' ✓✓' : ' ✓')}
        </p>
      </div>

      {/*
        LE CŒUR EST HORS DE LA BULLE, PAS DEDANS.
        À l'intérieur, il se confondrait avec le contenu — et sur une bulle
        de marque, un cœur rouge sur fond orange est illisible. Placé à côté,
        il reste lisible quel que soit le fond, et n'élargit pas la bulle.

        Un message supprimé n'en a pas : on ne peut pas aimer ce qu'on ne
        voit plus.
      */}
      {!message.supprime && (
        <button
          type="button"
          onClick={() => surLike?.(message._id)}
          data-test="like-message"
          aria-pressed={Boolean(message.aLike)}
          aria-label={message.aLike ? 'Retirer mon like' : 'Aimer ce message'}
          className={`mx-1 flex shrink-0 cursor-pointer items-end gap-0.5 self-end pb-1 text-xs transition-colors ${
            message.aLike ? 'text-erreur' : 'text-ardoise-300 hover:text-ardoise-500'
          }`}
        >
          <span aria-hidden="true">{message.aLike ? '❤' : '♡'}</span>
          {message.likesCount > 0 && (
            <span className="tabular-nums" data-test="compteur-like">
              {message.likesCount}
            </span>
          )}
        </button>
      )}
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

  /* Pièce jointe en attente d'envoi : { fichier, url, type }. */
  const [jointe, setJointe] = useState(null);
  const [choixOuvert, setChoixOuvert] = useState(false);
  const [cameraOuverte, setCameraOuverte] = useState(false);
  const champFichier = useRef(null);
  const [ecrit, setEcrit] = useState(false);

  const basDuFil = useRef(null);
  const minuteurSaisie = useRef(null);
  const idConversation = conversation?._id;

  /* ------------------ Etat de moderation de l'interlocuteur ------------------ */

  const [moderation, setModeration] = useState(null);

  /* ------------------ Modifier / supprimer un message ------------------ */

  /*
   * TROIS ÉTATS, ET AUCUN N'EST DE TROP.
   * `enEdition` porte le message en cours de réécriture — un seul à la fois,
   * sans quoi deux brouillons coexisteraient et le second écraserait le
   * premier sans rien dire. `aSupprimer` ouvre la confirmation. `actionEnCours`
   * désarme les boutons pendant l'appel : un double clic sur « Supprimer »
   * enverrait deux requêtes, dont la seconde recevrait un 404 affiché comme
   * une panne.
   */
  const [enEdition, setEnEdition] = useState(null);
  const [texteEdition, setTexteEdition] = useState('');
  const [aSupprimer, setASupprimer] = useState(null);
  const [suppressionConv, setSuppressionConv] = useState(false);
  const [actionEnCours, setActionEnCours] = useState(false);

  const demanderModification = (message) => {
    setEnEdition(message);
    setTexteEdition(message.contenu || '');
    setErreur(null);
  };

  const enregistrerModification = async () => {
    const texte = texteEdition.trim();
    if (!enEdition || !texte || actionEnCours) return;

    setActionEnCours(true);
    setErreur(null);
    try {
      const reponse = await messageApi.modifier(enEdition._id, texte);
      const aJour = reponse.data.donnees;

      /*
       * ON MET À JOUR LOCALEMENT SANS ATTENDRE LE SOCKET.
       * La diffusion arrive aussi, et remplacera ce message par le même
       * contenu : l'opération est idempotente. Ne compter que sur le socket
       * laisserait la bulle inchangée pendant un aller-retour, et inchangée
       * POUR TOUJOURS si la diffusion se perdait.
       */
      setMessages((precedents) => precedents.map((m) => (m._id === aJour._id ? aJour : m)));
      setEnEdition(null);
      setTexteEdition('');
      surMaj?.();
    } catch (e) {
      setErreur(e?.response?.data?.message || 'Le message n’a pas pu être modifié.');
    } finally {
      setActionEnCours(false);
    }
  };

  const confirmerSuppressionMessage = async () => {
    if (!aSupprimer || actionEnCours) return;

    setActionEnCours(true);
    setErreur(null);
    try {
      await messageApi.supprimer(aSupprimer._id);
      /*
       * LA BULLE RESTE, VIDÉE. C'est le comportement du serveur — suppression
       * douce — et le reproduire ici évite que la bulle disparaisse une
       * seconde puis réapparaisse vide quand le socket arrive.
       */
      setMessages((precedents) =>
        precedents.map((m) =>
          m._id === aSupprimer._id
            ? { ...m, supprime: true, contenu: null, media: null, likesCount: 0, aLike: false }
            : m
        )
      );
      setASupprimer(null);
      surMaj?.();
    } catch (e) {
      setErreur(e?.response?.data?.message || 'Le message n’a pas pu être supprimé.');
    } finally {
      setActionEnCours(false);
    }
  };

  const confirmerSuppressionConversation = async () => {
    if (actionEnCours || !idConversation) return;

    setActionEnCours(true);
    setErreur(null);
    try {
      await messageApi.supprimerConversation(idConversation);
      setSuppressionConv(false);
      /*
       * ON REMONTE AU PARENT PLUTÔT QUE DE SE FERMER SOI-MÊME.
       * Le fil n'est qu'une colonne de la page : c'est elle qui tient la
       * liste et l'URL. Se contenter de vider l'affichage laisserait `?c=`
       * pointer vers une conversation absente de la liste, et un
       * rafraîchissement rouvrirait un fil supprimé.
       */
      surMaj?.();
      surRetour?.();
    } catch (e) {
      setErreur(e?.response?.data?.message || 'La conversation n’a pas pu être supprimée.');
      setActionEnCours(false);
    }
  };
  const idInterlocuteur = conversation?.interlocuteur?._id;

  /**
   * Le menu « ⋯ » doit savoir quoi proposer — « Bloquer » ou « Debloquer » —
   * DES SON PREMIER AFFICHAGE. Une conversation ne charge aucun profil : on
   * demande donc les trois booleens a la route dediee, une seule fois par
   * interlocuteur.
   *
   * UN ECHEC EST SILENCIEUX. Ce n'est pas le sujet de l'ecran : la
   * conversation doit rester utilisable meme si cet appel echoue. Le menu
   * retombe alors sur ses libelles par defaut.
   */
  const chargerModeration = useCallback(async () => {
    if (!idInterlocuteur) return;

    try {
      const reponse = await moderationApi.etat(idInterlocuteur);
      setModeration(reponse.data.moderation);
    } catch {
      setModeration(null);
    }
  }, [idInterlocuteur]);

  useEffect(() => {
    chargerModeration();
  }, [chargerModeration]);

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

      /*
       * LE MESSAGE MODIFIE ARRIVE PAR LA MEME VOIE QUE LE SUPPRIME.
       * On remplace la bulle entiere par la version du serveur : elle porte
       * `modifieLe`, et c est elle qui fait apparaitre « modifie » chez
       * l interlocuteur sans qu il recharge.
       */
      ecouter('message:modifie', ({ conversation: idRecu, message }) => {
        if (String(idRecu) !== String(idConversation)) return;
        setMessages((precedents) =>
          precedents.map((m) => (m._id === message._id ? { ...m, ...message } : m))
        );
      }),

      ecouter('message:supprime', ({ conversation: idRecu, message }) => {
        if (String(idRecu) !== String(idConversation)) return;
        setMessages((precedents) =>
          precedents.map((m) =>
            m._id === message
              ? { ...m, supprime: true, contenu: null, media: null, likesCount: 0, aLike: false }
              : m
          )
        );
      }),

      /*
       * LE SERVEUR ENVOIE QUI A AIMÉ, PAS MON PROPRE ÉTAT.
       * Il diffuse le même message aux deux participants : il ne peut pas y
       * mettre un `aLike` qui vaudrait pour l'un et pas pour l'autre. Chacun
       * le calcule donc de son côté, en comparant `par` à son identifiant.
       *
       * Mon propre like m'est renvoyé aussi : c'est ce qui synchronise mes
       * autres onglets. La réponse HTTP a déjà mis à jour celui-ci, et
       * réappliquer la même valeur ne change rien.
       */
      ecouter('message:like', ({ conversation: idRecu, message, likesCount, par, ajoute }) => {
        if (String(idRecu) !== String(idConversation)) return;

        setMessages((precedents) =>
          precedents.map((m) =>
            m._id === message
              ? {
                  ...m,
                  likesCount,
                  aLike: String(par) === String(moi) ? ajoute : m.aLike,
                }
              : m
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

  /*
   * CHOIX D'UNE PIÈCE JOINTE — ON REFUSE AVANT DE TÉLÉVERSER.
   * Laisser partir un fichier de 40 Mo pour le voir rejeté à l'arrivée fait
   * attendre pour rien, sur la connexion la plus lente qui soit. Les plafonds
   * du serveur sont donc rappelés ici — sans le remplacer : c'est lui qui
   * décide, le client ne fait qu'éviter l'aller-retour.
   */
  const retenir = (fichier) => {
    if (!fichier) return;

    const estVideo = fichier.type.startsWith('video/');
    const limite = estVideo ? TAILLE_MAX_VIDEO : TAILLE_MAX_IMAGE;

    if (fichier.size > limite) {
      setErreur(
        `Fichier trop lourd : ${Math.round(limite / MO)} Mo au maximum pour ${
          estVideo ? 'une vidéo' : 'une image'
        }.`
      );
      return;
    }

    // L'URL de l'aperçu précédent est libérée : sans cela, choisir cinq
    // fichiers de suite retient cinq blobs jusqu'au rechargement de la page.
    if (jointe) URL.revokeObjectURL(jointe.url);

    setErreur(null);
    setJointe({
      fichier,
      url: URL.createObjectURL(fichier),
      type: estVideo ? 'video' : 'image',
    });
  };

  const retirerJointe = () => {
    if (jointe) URL.revokeObjectURL(jointe.url);
    setJointe(null);
  };

  /*
   * LIKE OPTIMISTE, CORRIGÉ PAR LA RÉPONSE.
   * Le cœur doit répondre au doigt sans attendre le réseau. On applique donc
   * le changement tout de suite, puis on recale sur ce que dit le serveur —
   * c'est lui qui tranche, notamment si deux appareils cliquent en même
   * temps. En cas d'échec, on remet l'état d'avant : laisser un cœur rouge
   * sur un like qui n'a pas été enregistré serait pire que ne rien afficher.
   */
  const basculerLike = useCallback(
    async (idMessage) => {
      let precedent = null;

      setMessages((liste) =>
        liste.map((m) => {
          if (m._id !== idMessage) return m;
          precedent = { aLike: Boolean(m.aLike), likesCount: m.likesCount || 0 };
          return {
            ...m,
            aLike: !m.aLike,
            likesCount: (m.likesCount || 0) + (m.aLike ? -1 : 1),
          };
        })
      );

      try {
        const reponse = await messageApi.basculerLike(idMessage);
        const { likesCount, aLike } = reponse.data.donnees;
        setMessages((liste) =>
          liste.map((m) => (m._id === idMessage ? { ...m, likesCount, aLike } : m))
        );
      } catch (e) {
        if (precedent) {
          setMessages((liste) =>
            liste.map((m) => (m._id === idMessage ? { ...m, ...precedent } : m))
          );
        }
        setErreur(e.message);
      }
    },
    []
  );

  const surFichierChoisi = (evenement) => {
    const fichier = evenement.target.files?.[0];
    // Vidé avant traitement : sans cela, rechoisir le même fichier de suite
    // ne déclencherait pas de second `change`.
    evenement.target.value = '';
    retenir(fichier);
  };

  /* Les URL d'objet sont libérées au démontage du fil. */
  useEffect(() => {
    return () => {
      if (jointe) URL.revokeObjectURL(jointe.url);
    };
  }, [jointe]);

  const envoyer = async (evenement) => {
    evenement.preventDefault();
    const texte = saisie.trim();

    // Un message peut n'être QU'une pièce jointe : le serveur accepte l'un ou
    // l'autre. Exiger du texte interdirait d'envoyer une photo seule.
    if ((!texte && !jointe) || envoi) return;

    setEnvoi(true);
    setErreur(null);

    try {
      const reponse = await messageApi.envoyer(idConversation, {
        contenu: texte || undefined,
        media: jointe?.fichier,
      });
      setSaisie('');
      retirerJointe();
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

        {/*
          MENU « ⋯ » — TOUT A DROITE DE L'EN-TETE.
          `ml-auto` est necessaire ICI, contrairement au profil : le lien qui
          precede porte `min-w-0` pour pouvoir tronquer un pseudo long, mais
          pas `flex-1`. Rien n'absorbe donc l'espace restant, et sans cette
          marge automatique le menu se collerait au pseudo au lieu du bord.

          LE MEME COMPOSANT QUE SUR LE PROFIL, avec les memes actions sur la
          meme personne. Une seconde implementation divergerait au premier
          ajustement.
        */}
        <MenuModeration
          utilisateur={autre}
          etat={moderation}
          /*
           * « Supprimer la conversation » N EST AJOUTE QUE D ICI.
           * Le meme menu sert sur la page de profil, ou il n y a pas
           * forcement de fil : l entree y serait sans objet, et au mieux
           * sans effet.
           */
          entreesSupplementaires={[
            {
              cle: 'supprimer-conversation',
              libelle: 'Supprimer la conversation',
              description: 'De votre liste seulement, pas de la sienne',
              icone: '🗑️',
              danger: true,
              action: () => setSuppressionConv(true),
            },
          ]}
          surChangement={async () => {
            await chargerModeration();
            /*
             * ON PREVIENT LE PARENT : bloquer ferme la conversation cote
             * serveur (404 a l'ouverture, 403 a l'ecriture). Sans ce rappel,
             * le fil resterait affiche et la premiere tentative d'envoi
             * echouerait sur une erreur incomprehensible.
             */
            surMaj?.();
          }}
          className="ml-auto shrink-0"
        />
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
              surLike={basculerLike}
              surDemanderModification={demanderModification}
              surDemanderSuppression={setASupprimer}
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
        <form onSubmit={envoyer} className="border-t border-ardoise-200 p-3">
          {/* ---------- Aperçu de la pièce jointe ---------- */}
          {jointe && (
            <div
              data-test="apercu-jointe"
              className="relative mb-2 inline-block rounded-xl border border-ardoise-200 p-1"
            >
              {jointe.type === 'video' ? (
                <video
                  src={jointe.url}
                  muted
                  playsInline
                  preload="metadata"
                  className="h-24 w-24 rounded-lg bg-black object-cover"
                />
              ) : (
                <img
                  src={jointe.url}
                  alt="Pièce jointe à envoyer"
                  className="h-24 w-24 rounded-lg object-cover"
                />
              )}

              <button
                type="button"
                onClick={retirerJointe}
                data-test="retirer-jointe"
                aria-label="Retirer la pièce jointe"
                className="absolute -right-2 -top-2 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-2 border-white bg-ardoise-700 text-sm leading-none text-white hover:bg-ardoise-900"
              >
                ×
              </button>
            </div>
          )}

          <div className="flex items-end gap-2">
            <input
              ref={champFichier}
              type="file"
              accept={TYPES_ACCEPTES}
              onChange={surFichierChoisi}
              className="lecteur-ecran-seulement"
              id="piece-jointe-message"
            />

            {/* Même geste que la barre de stories : le « + » propose les deux
                sources plutôt que d'ouvrir directement le sélecteur. */}
            <button
              type="button"
              onClick={() => {
                setErreur(null);
                setChoixOuvert(true);
              }}
              disabled={envoi}
              data-test="ajouter-jointe"
              aria-label="Ajouter une photo ou une vidéo"
              className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-ardoise-200 text-ardoise-500 hover:border-marque-400 hover:bg-marque-50 hover:text-marque-600 disabled:opacity-60"
            >
              {/*
                UN « + » DESSINÉ, PAS UN CARACTÈRE.
                `items-center` centre la BOÎTE DE LIGNE, pas l'encre du
                glyphe : dans la plupart des polices, le « + » se cale sur
                l'axe mathématique, au-dessus du milieu du cadratin. Le
                caractère paraissait donc trop haut, et l'écart aurait changé
                avec la police de repli d'une autre machine.

                Un tracé dans un `viewBox` carré est centré par construction :
                les deux traits se croisent en 12,12 d'une grille de 24.
              */}
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
                <path
                  d="M12 5.5v13M5.5 12h13"
                  stroke="currentColor"
                  strokeWidth="2.25"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
            </button>

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
            <Button
              type="submit"
              chargement={envoi}
              disabled={!saisie.trim() && !jointe}
              className="cursor-pointer"
            >
              Envoyer
            </Button>
          </div>
        </form>
      ) : (
        conversation.statut === 'en_attente' &&
        conversation.estDemandeur && (
          <p className="border-t border-ardoise-200 p-3 text-center text-xs text-ardoise-500">
            Vous pourrez écrire de nouveau lorsque votre demande aura été acceptée.
          </p>
        )
      )}

      {/* ---------- Choix de la source ---------- */}
      <Modal
        ouvert={choixOuvert}
        onFermer={() => setChoixOuvert(false)}
        titre="Ajouter à votre message"
        taille="sm"
      >
        <div className="flex flex-col gap-3 p-5" data-test="choix-source-message">
          <Button
            pleineLargeur
            variante="choix"
            data-test="source-fichier-message"
            onClick={() => {
              setChoixOuvert(false);
              champFichier.current?.click();
            }}
          >
            Importer une photo ou une vidéo
          </Button>

          <Button
            pleineLargeur
            variante="choix"
            data-test="source-camera-message"
            onClick={() => {
              setChoixOuvert(false);
              setCameraOuverte(true);
            }}
          >
            Prendre une photo
          </Button>

          <p className="text-center text-xs text-ardoise-500">
            Images jusqu’à 5 Mo, vidéos jusqu’à 25 Mo.
          </p>
        </div>
      </Modal>

      {/*
        LE MÊME COMPOSANT QUE LES STORIES, RÉUTILISÉ TEL QUEL.
        Il rend un fichier JPEG ; la messagerie n'a donc rien de particulier à
        savoir de la caméra, et les correctifs faits d'un côté profitent à
        l'autre — arrêt du flux, bornage à 1920 px, causes d'échec distinguées.
      */}
      {/* --------------------- Modifier un message --------------------- */}

      <Modal
        ouvert={Boolean(enEdition)}
        onFermer={() => setEnEdition(null)}
        titre="Modifier le message"
        taille="md"
      >
        <div className="space-y-4 p-5" data-test="modifier-message">
          <Textarea
            libelle="Votre message"
            rows={4}
            maxLength={2000}
            value={texteEdition}
            onChange={(e) => setTexteEdition(e.target.value)}
            data-test="champ-modification"
            autoFocus
          />

          {/*
            ON ANNONCE LA CONSÉQUENCE AVANT LE CLIC, PAS APRÈS.
            La mention « modifié » est visible par l'autre personne : le
            découvrir après coup donnerait l'impression d'une retouche
            discrète qui ne l'est pas.
          */}
          <p className="text-xs text-ardoise-500">
            La mention « modifié » restera visible par votre interlocuteur.
          </p>

          <div className="flex justify-end gap-2">
            <Button variante="secondaire" onClick={() => setEnEdition(null)} disabled={actionEnCours}>
              Annuler
            </Button>
            <Button
              onClick={enregistrerModification}
              chargement={actionEnCours}
              disabled={
                actionEnCours ||
                !texteEdition.trim() ||
                texteEdition.trim() === (enEdition?.contenu || '')
              }
              data-test="valider-modification"
            >
              Enregistrer
            </Button>
          </div>
        </div>
      </Modal>

      {/* ------------------ Supprimer un message ------------------ */}

      <Modal
        ouvert={Boolean(aSupprimer)}
        onFermer={() => setASupprimer(null)}
        titre="Supprimer ce message ?"
        taille="sm"
      >
        <div className="space-y-4 p-5" data-test="confirmer-suppression-message">
          <p className="text-sm text-ardoise-700">
            La bulle restera dans le fil, vidée de son contenu, et portera la mention
            «&nbsp;Message supprimé&nbsp;». Une pièce jointe est, elle, réellement effacée.
          </p>

          <div className="flex justify-end gap-2">
            <Button variante="secondaire" onClick={() => setASupprimer(null)} disabled={actionEnCours}>
              Annuler
            </Button>
            <Button
              variante="danger"
              onClick={confirmerSuppressionMessage}
              chargement={actionEnCours}
              disabled={actionEnCours}
              data-test="valider-suppression-message"
            >
              Supprimer
            </Button>
          </div>
        </div>
      </Modal>

      {/* --------------- Supprimer la conversation --------------- */}

      <Modal
        ouvert={suppressionConv}
        onFermer={() => setSuppressionConv(false)}
        titre="Supprimer cette conversation ?"
        taille="sm"
      >
        <div className="space-y-4 p-5" data-test="confirmer-suppression-conversation">
          {/*
            CE QUE LA SUPPRESSION FAIT, ET CE QU'ELLE NE FAIT PAS.
            Les deux comptent : croire qu'on efface le fil chez l'autre est
            une erreur grave dans un sens, et croire qu'on ne peut rien
            ranger chez soi l'est dans l'autre.
          */}
          <p className="text-sm text-ardoise-700">
            Elle disparaîtra de <strong>votre</strong> liste. {' '}
            {autre?.pseudo ? `@${autre.pseudo}` : 'Votre interlocuteur'} gardera la sienne, avec
            tout l’historique.
          </p>
          <p className="text-sm text-ardoise-700">
            Si un nouveau message arrive, la conversation <strong>reviendra</strong> dans votre
            liste : sans quoi ce message serait perdu.
          </p>

          <div className="flex justify-end gap-2">
            <Button
              variante="secondaire"
              onClick={() => setSuppressionConv(false)}
              disabled={actionEnCours}
            >
              Annuler
            </Button>
            <Button
              variante="danger"
              onClick={confirmerSuppressionConversation}
              chargement={actionEnCours}
              disabled={actionEnCours}
              data-test="valider-suppression-conversation"
            >
              Supprimer
            </Button>
          </div>
        </div>
      </Modal>

      <CapturePhoto
        ouvert={cameraOuverte}
        onFermer={() => setCameraOuverte(false)}
        onValider={retenir}
      />
    </div>
  );
}
