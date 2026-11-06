import { useState, useEffect, useCallback } from 'react';

import messageApi from '@/api/message.api';
import Modal from '@/components/ui/Modal';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Alert from '@/components/ui/Alert';
import Spinner from '@/components/ui/Spinner';

/**
 * Démarrer une conversation depuis la page Messages.
 *
 * POURQUOI CE CHEMIN EXISTE EN PLUS DU PROFIL.
 * Jusqu'ici, écrire à quelqu'un supposait de passer par sa page de profil —
 * donc de savoir d'avance à qui on veut écrire, et de l'avoir retrouvé.
 * C'est l'inverse du geste réel : on ouvre sa messagerie, puis on choisit.
 * Les deux chemins restent ouverts, celui du profil n'est pas touché.
 *
 * LA CONVERSATION N'EST CRÉÉE QU'À L'ENVOI, ET C'EST UNE DÉCISION MESURÉE.
 * `listeConversations` ne filtre que sur les participants : elle ne saute PAS
 * les conversations sans message. Ouvrir le fil au clic sur une personne
 * laisserait donc une conversation vide dans la liste dès qu'on se ravise —
 * un déchet visible, et impossible à distinguer d'un échange réel effacé. On
 * appelle donc `ouvrir` puis `envoyer` d'affilée, au moment du seul geste qui
 * exprime une intention : l'envoi.
 *
 * LA RECHERCHE EST FAITE PAR LE SERVEUR, PAS DANS LE NAVIGATEUR.
 * Filtrer une liste d'abonnés déjà chargée paraît plus simple, mais cette
 * liste est paginée : on ne trouverait jamais quelqu'un au-delà de la
 * première page, et le défaut ne se verrait qu'avec un carnet d'adresses
 * fourni — c'est-à-dire en production. `GET /messages/destinataires` applique
 * en plus les mêmes exclusions que l'ouverture (blocage dans les deux sens,
 * compte désactivé) : on ne propose personne à qui l'envoi serait ensuite
 * refusé.
 */
export default function NouvelleConversation({ ouvert, onFermer, surCreation }) {
  const [saisie, setSaisie] = useState('');
  const [personnes, setPersonnes] = useState([]);
  const [recherche, setRecherche] = useState(false);
  const [choisie, setChoisie] = useState(null);
  const [message, setMessage] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState(null);

  /* --------------------------- Ouverture --------------------------- */

  /*
   * REMISE À ZÉRO À CHAQUE OUVERTURE. Sans cela, la fenêtre réapparaîtrait
   * avec la personne et le brouillon de la fois précédente — et un envoi
   * distrait partirait au mauvais destinataire.
   */
  useEffect(() => {
    if (!ouvert) return;
    setSaisie('');
    setChoisie(null);
    setMessage('');
    setErreur(null);
  }, [ouvert]);

  /* -------------------------- La recherche -------------------------- */

  const chercher = useCallback(async (texte) => {
    setRecherche(true);
    try {
      const reponse = await messageApi.destinataires({ q: texte });
      setPersonnes(reponse.data.destinataires || []);
      setErreur(null);
    } catch (e) {
      setErreur(e.message);
      setPersonnes([]);
    } finally {
      setRecherche(false);
    }
  }, []);

  /*
   * ON ATTEND 250 ms APRÈS LA DERNIÈRE FRAPPE.
   * Interroger à chaque lettre enverrait sept requêtes pour « thibaut », dont
   * six dont la réponse est déjà périmée en arrivant — et rien ne garantit
   * qu'elles reviennent dans l'ordre où elles sont parties. Le minuteur est
   * annulé à chaque frappe, donc une seule requête survit.
   */
  useEffect(() => {
    if (!ouvert || choisie) return;
    const minuteur = setTimeout(() => chercher(saisie), 250);
    return () => clearTimeout(minuteur);
  }, [ouvert, choisie, saisie, chercher]);

  /* --------------------------- Le choix --------------------------- */

  const choisir = (personne) => {
    setChoisie(personne);
    setErreur(null);
  };

  /* --------------------------- L'envoi --------------------------- */

  const envoyer = async () => {
    const contenu = message.trim();
    if (!choisie || !contenu || envoi) return;

    setEnvoi(true);
    setErreur(null);
    try {
      /*
       * DEUX APPELS, DANS CET ORDRE, ET AUCUN N'EST ÉVITABLE.
       * `ouvrir` est idempotent : si une conversation existe déjà avec cette
       * personne, il la rend telle quelle au lieu d'en créer une seconde —
       * la base le garantit par un index unique sur la paire triée. Choisir
       * quelqu'un à qui l'on écrit déjà reprend donc le fil existant.
       */
      const ouverture = await messageApi.ouvrir(choisie._id);
      const conversation = ouverture.data.conversation;

      await messageApi.envoyer(conversation._id, { contenu });

      onFermer?.();
      surCreation?.(conversation);
    } catch (e) {
      /*
       * L'OUVERTURE PEUT ÉCHOUER EN 404 ALORS QUE LA PERSONNE ÉTAIT AFFICHÉE :
       * elle a pu bloquer ou désactiver son compte entre la recherche et
       * l'envoi. On le dit sans trahir lequel des deux, comme le serveur.
       */
      setErreur(e.message || 'Le message n’a pas pu être envoyé.');
    } finally {
      setEnvoi(false);
    }
  };

  /* ---------------------------- Rendu ---------------------------- */

  return (
    <Modal ouvert={ouvert} onFermer={onFermer} titre="Nouveau message" taille="md">
      <div className="space-y-4" data-test="nouvelle-conversation">
        {erreur && <Alert variante="erreur">{erreur}</Alert>}

        {!choisie ? (
          <>
            <Input
              libelle="À qui voulez-vous écrire ?"
              placeholder="Rechercher parmi vos abonnés et abonnements…"
              aide="Vous pouvez écrire aux personnes qui vous suivent et à celles que vous suivez."
              value={saisie}
              onChange={(e) => setSaisie(e.target.value)}
              data-test="recherche-destinataire"
              autoFocus
            />

            {recherche && <Spinner className="mx-auto my-4" />}

            {!recherche && personnes.length === 0 && (
              /*
               * DEUX RAISONS DE NE RIEN AVOIR, ET ELLES N'APPELLENT PAS LA
               * MÊME PHRASE : une recherche sans correspondance, ou aucune
               * relation du tout. Un message unique laisserait croire à un
               * compte vide à qui a simplement mal orthographié un pseudo.
               */
              <p className="py-6 text-center text-sm text-ardoise-500" data-test="aucun-destinataire">
                {saisie.trim().length >= 2
                  ? `Personne ne correspond à « ${saisie.trim()} » parmi vos abonnés et vos abonnements.`
                  : saisie.trim().length === 1
                    ? 'Encore une lettre, au moins.'
                    : 'Vous n’avez encore ni abonné ni abonnement : suivez quelqu’un pour pouvoir lui écrire.'}
              </p>
            )}

            {!recherche && personnes.length > 0 && (
              <ul className="max-h-72 divide-y divide-ardoise-100 overflow-y-auto" data-test="liste-destinataires">
                {personnes.map((personne) => (
                  <li key={personne._id}>
                    <button
                      type="button"
                      onClick={() => choisir(personne)}
                      data-test="destinataire"
                      data-pseudo={personne.pseudo}
                      className="flex w-full items-center gap-3 px-1 py-2.5 text-left transition hover:bg-ardoise-50"
                    >
                      <Avatar utilisateur={personne} taille="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ardoise-900">
                          {personne.prenom ? `${personne.prenom} ${personne.nom}` : personne.pseudo}
                        </span>
                        <span className="block truncate text-xs text-ardoise-500">
                          @{personne.pseudo}
                          {personne.type === 'coach' && ' · coach'}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-carte bg-ardoise-50 px-3 py-2">
              <Avatar utilisateur={choisie} taille="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ardoise-900">
                  {choisie.prenom ? `${choisie.prenom} ${choisie.nom}` : choisie.pseudo}
                </span>
                <span className="block truncate text-xs text-ardoise-500">@{choisie.pseudo}</span>
              </span>
              <Button
                variante="fantome"
                taille="sm"
                onClick={() => setChoisie(null)}
                data-test="changer-destinataire"
              >
                Changer
              </Button>
            </div>

            <Textarea
              libelle="Votre message"
              placeholder="Écrivez votre message…"
              rows={4}
              maxLength={2000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              data-test="message-nouvelle-conversation"
              /*
               * `autoFocus` ET NON UNE `ref` : `Textarea` n est pas un
               * `forwardRef`, une ref y serait ignoree en silence. Le champ
               * est monte au moment ou la personne est choisie, donc
               * `autoFocus` se declenche exactement au bon instant.
               */
              autoFocus
            />

            <div className="flex justify-end gap-2">
              <Button variante="secondaire" onClick={onFermer} disabled={envoi}>
                Annuler
              </Button>
              <Button
                onClick={envoyer}
                chargement={envoi}
                disabled={!message.trim() || envoi}
                data-test="envoyer-nouvelle-conversation"
              >
                Envoyer
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
