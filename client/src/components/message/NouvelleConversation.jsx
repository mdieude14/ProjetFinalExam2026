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

/*
 * HAUTEUR STABLE POUR LA ZONE DE RÉSULTATS, ET CE N'EST PAS DÉCORATIF.
 *
 * Sans elle, la fenêtre change de taille à chaque frappe : dix résultats, puis
 * deux, puis un message d'absence. Elle grandit, rétrécit, et les boutons se
 * déplacent sous le curseur — on clique sur ce qui vient de bouger. Une
 * hauteur fixe fait défiler la liste À L'INTÉRIEUR d'un cadre immobile.
 */
const HAUTEUR_RESULTATS = 'h-64';

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

  const nomDe = (p) => (p?.prenom ? `${p.prenom} ${p.nom}` : p?.pseudo);

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
      setErreur(e?.response?.data?.message || 'Le message n’a pas pu être envoyé.');
    } finally {
      setEnvoi(false);
    }
  };

  /* ---------------------------- Rendu ---------------------------- */

  return (
    <Modal ouvert={ouvert} onFermer={onFermer} titre="Nouveau message" taille="md">
      <div className="space-y-4 p-5" data-test="nouvelle-conversation">
        {erreur && <Alert variante="erreur">{erreur}</Alert>}

        {!choisie ? (
          <>
            <Input
              libelle="À qui voulez-vous écrire ?"
              placeholder="Un pseudo, un prénom…"
              value={saisie}
              onChange={(e) => setSaisie(e.target.value)}
              data-test="recherche-destinataire"
              autoFocus
              /*
               * ENTRÉE CHOISIT LE PREMIER RÉSULTAT. C'est le réflexe de
               * n'importe quel champ de recherche ; sans lui, il faut lâcher
               * le clavier pour la souris alors qu'on vient de taper un nom.
               */
              onKeyDown={(e) => {
                if (e.key === 'Enter' && personnes.length > 0) {
                  e.preventDefault();
                  choisir(personnes[0]);
                }
              }}
            />

            {/*
              UN CADRE DE HAUTEUR FIXE, ET LA LISTE DÉFILE DEDANS.
              Le compte des résultats est annoncé au-dessus : il dit pourquoi
              la liste est courte, ce qu'une liste nue laisse devenir.
            */}
            <div>
              <div className="mb-1.5 flex items-baseline justify-between px-1">
                <span className="text-xs font-medium uppercase tracking-wide text-ardoise-400">
                  {saisie.trim().length >= 2 ? 'Résultats' : 'Vos relations'}
                </span>
                {personnes.length > 0 && (
                  <span className="text-xs tabular-nums text-ardoise-400">
                    {personnes.length}
                  </span>
                )}
              </div>

              <div
                className={`${HAUTEUR_RESULTATS} overflow-y-auto rounded-carte border border-ardoise-200 bg-white p-1.5`}
              >
                {recherche && (
                  <div className="flex h-full items-center justify-center">
                    <Spinner />
                  </div>
                )}

                {!recherche && personnes.length === 0 && (
                  /*
                   * TROIS RAISONS DE NE RIEN AVOIR, ET ELLES N'APPELLENT PAS
                   * LA MÊME PHRASE : une recherche sans correspondance, une
                   * saisie trop courte, ou aucune relation du tout. Un
                   * message unique laisserait croire à un compte vide à qui a
                   * simplement mal orthographié un pseudo.
                   */
                  <div
                    className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center"
                    data-test="aucun-destinataire"
                  >
                    <span className="text-2xl" aria-hidden="true">
                      {saisie.trim().length >= 2 ? '🔍' : '👋'}
                    </span>
                    <p className="text-sm font-medium text-ardoise-700">
                      {saisie.trim().length >= 2
                        ? 'Personne ne correspond'
                        : saisie.trim().length === 1
                          ? 'Encore une lettre, au moins'
                          : 'Aucune relation pour l’instant'}
                    </p>
                    <p className="text-xs leading-relaxed text-ardoise-500">
                      {saisie.trim().length >= 2
                        ? `Aucun de vos abonnés ni de vos abonnements ne correspond à « ${saisie.trim()} ».`
                        : saisie.trim().length === 1
                          ? 'La recherche commence à deux caractères.'
                          : 'Suivez quelqu’un, ou laissez-vous suivre, pour pouvoir lui écrire.'}
                    </p>
                  </div>
                )}

                {!recherche && personnes.length > 0 && (
                  <ul className="space-y-0.5" data-test="liste-destinataires">
                    {personnes.map((personne) => (
                      <li key={personne._id}>
                        <button
                          type="button"
                          onClick={() => choisir(personne)}
                          data-test="destinataire"
                          data-pseudo={personne.pseudo}
                          /*
                           * `cursor-pointer` EST EXPLICITE : depuis Tailwind 4,
                           * le preflight pose `cursor: default` sur les
                           * boutons, et une ligne cliquable ne se signalerait
                           * plus au survol.
                           */
                          className="group flex w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-marque-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-marque-500"
                        >
                          <Avatar utilisateur={personne} taille="sm" className="shrink-0" />

                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium text-ardoise-900">
                                {nomDe(personne)}
                              </span>
                              {personne.type === 'coach' && (
                                <span className="shrink-0 rounded-full bg-marque-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-marque-700">
                                  coach
                                </span>
                              )}
                            </span>
                            <span className="block truncate text-xs text-ardoise-500">
                              @{personne.pseudo}
                              {personne.ville ? ` · ${personne.ville}` : ''}
                            </span>
                          </span>

                          {/*
                            UNE FLÈCHE QUI N'APPARAÎT QU'AU SURVOL.
                            Visible en permanence sur dix lignes, elle ferait
                            du bruit ; absente, rien ne dit que la ligne mène
                            quelque part. `aria-hidden` : l'information est
                            déjà portée par le bouton lui-même.
                          */}
                          <span
                            aria-hidden="true"
                            className="shrink-0 text-ardoise-300 opacity-0 transition-opacity group-hover:opacity-100"
                          >
                            →
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            {/* La personne choisie, en évidence et toujours réversible. */}
            <div className="flex items-center gap-3 rounded-carte border border-marque-200 bg-marque-50 px-3 py-2.5">
              <Avatar utilisateur={choisie} taille="sm" className="shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ardoise-900">
                  {nomDe(choisie)}
                </span>
                <span className="block truncate text-xs text-ardoise-600">@{choisie.pseudo}</span>
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
              rows={5}
              maxLength={2000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              data-test="message-nouvelle-conversation"
              /*
               * `autoFocus` ET NON UNE `ref` : `Textarea` n'est pas un
               * `forwardRef`, une ref y serait ignorée en silence. Le champ
               * est monté au moment où la personne est choisie, donc
               * `autoFocus` se déclenche exactement au bon instant.
               */
              autoFocus
            />

            {/*
              LE PIED EST SÉPARÉ PAR UN FILET, et les boutons sont à droite.
              Sans séparation, « Envoyer » flotte contre le champ de saisie et
              l'on ne voit plus où finit le formulaire.
            */}
            <div className="flex items-center justify-end gap-2 border-t border-ardoise-100 pt-3">
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
