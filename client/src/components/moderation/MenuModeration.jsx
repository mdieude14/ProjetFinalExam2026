import { useState } from 'react';

import moderationApi, { MOTIFS_SIGNALEMENT } from '@/api/moderation.api';
import MenuOptions from '@/components/ui/MenuOptions';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';

/**
 * ===========================================================================
 *  MENU « ⋯ » DE MODÉRATION — bloquer, restreindre, signaler
 * ===========================================================================
 *
 * UN SEUL COMPOSANT POUR LES DEUX SURFACES — le profil et la conversation.
 * Les deux proposent exactement les mêmes actions sur la même personne. Deux
 * copies divergeraient au premier ajustement, et c'est toujours celle qu'on
 * oublie qui reste avec l'ancien comportement.
 *
 * L'ÉTAT VIENT DU SERVEUR, IL N'EST PAS DEVINÉ. Le profil renvoie déjà
 * `moderation: { bloque, restreint, aSignale }` : le menu sait donc, dès son
 * premier affichage, s'il doit proposer « Bloquer » ou « Débloquer ». Le
 * calculer à l'ouverture le ferait clignoter, avec le risque de cliquer sur
 * l'entrée d'avant.
 *
 * `moderation.bloque` EST ORIENTÉ, PAS SYMÉTRIQUE. Il ne vaut vrai que si
 * c'est MOI qui ai bloqué — car je ne peux débloquer que ce que j'ai bloqué.
 * Le drapeau `estBloque` du profil, lui, vaut vrai dans les deux sens et
 * commande l'écran, pas ce menu.
 */
export default function MenuModeration({ utilisateur, etat, surChangement, className = '' }) {
  const [confirmation, setConfirmation] = useState(null); // 'bloquer' | 'restreindre'
  const [signalementOuvert, setSignalementOuvert] = useState(false);

  const [motif, setMotif] = useState('');
  const [commentaire, setCommentaire] = useState('');

  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [succes, setSucces] = useState(null);

  if (!utilisateur?._id) return null;

  const bloque = Boolean(etat?.bloque);
  const restreint = Boolean(etat?.restreint);
  const aSignale = Boolean(etat?.aSignale);
  const nom = utilisateur.pseudo ? `@${utilisateur.pseudo}` : 'ce compte';

  /**
   * Exécute une action et prévient le parent.
   *
   * LE PARENT RECHARGE, LE MENU NE DEVINE PAS. Après un blocage, ce ne sont
   * pas seulement les entrées du menu qui changent : les publications
   * disparaissent, les compteurs bougent, le bouton « Suivre » n'a plus lieu
   * d'être. Mettre à jour l'état localement afficherait un menu juste
   * au-dessus d'une page fausse.
   */
  const executer = async (appel, message) => {
    setEnCours(true);
    setErreur(null);

    try {
      await appel();
      setConfirmation(null);
      setSignalementOuvert(false);
      setSucces(message);
      await surChangement?.();
    } catch (e) {
      setErreur(e?.response?.data?.message || "L'action n'a pas pu être effectuée");
    } finally {
      setEnCours(false);
    }
  };

  /* ------------------------------------------------------------------ *
   *  Entrées du menu
   * ------------------------------------------------------------------ */

  const entrees = [
    {
      cle: 'restriction',
      libelle: restreint ? 'Lever la restriction' : 'Restreindre',
      /*
       * LA DESCRIPTION EST INDISPENSABLE ICI, elle n'est pas décorative.
       * « Restreindre » ne veut rien dire par soi-même, et la différence avec
       * « Bloquer » est précisément ce que l'utilisateur doit comprendre
       * AVANT de cliquer — pas après.
       */
      description: restreint
        ? 'Ses messages et commentaires redeviendront normaux'
        : 'Sans le prévenir : ses messages iront dans les demandes',
      icone: '🔇',
      action: () =>
        restreint
          ? executer(
              () => moderationApi.leverRestriction(utilisateur._id),
              `Restriction levée sur ${nom}.`
            )
          : setConfirmation('restreindre'),
    },

    {
      cle: 'blocage',
      libelle: bloque ? 'Débloquer' : 'Bloquer',
      description: bloque
        ? 'Vous pourrez de nouveau voir son contenu'
        : 'Vous ne verrez plus rien l’un de l’autre',
      icone: '🚫',
      danger: !bloque,
      action: () =>
        bloque
          ? executer(() => moderationApi.debloquer(utilisateur._id), `${nom} a été débloqué.`)
          : setConfirmation('bloquer'),
    },

    { separateur: true },

    {
      cle: 'signalement',
      libelle: aSignale ? 'Signalement en cours' : 'Signaler ce compte',
      description: aSignale
        ? 'Votre signalement est entre les mains de la modération'
        : "Transmis à l'administration, jamais à la personne",
      icone: '⚑',
      danger: !aSignale,
      /*
       * SIGNALER DEUX FOIS EST INUTILE, ON DÉSACTIVE PLUTÔT QUE DE MASQUER.
       * Retirer l'entrée laisserait croire que l'action n'existe pas ; la
       * griser dit qu'elle existe et qu'elle est déjà faite.
       */
      desactive: aSignale,
      action: () => {
        setMotif('');
        setCommentaire('');
        setSignalementOuvert(true);
      },
    },
  ];

  /* ------------------------------------------------------------------ *
   *  Textes de confirmation
   * ------------------------------------------------------------------ */

  const textes = {
    bloquer: {
      titre: `Bloquer ${nom} ?`,
      /*
       * ON ANNONCE LA RUPTURE DES SUIVIS, ET QU'ELLE NE SE DÉFAIT PAS.
       * C'est la conséquence que personne n'anticipe et la première question
       * posée après coup. La dire avant évite un blocage regretté.
       */
      corps: [
        'Vous ne verrez plus son contenu et il ne verra plus le vôtre.',
        'Vos abonnements mutuels seront rompus et ils ne seront pas rétablis si vous le débloquez plus tard.',
        'Il ne pourra plus vous écrire, ni commenter vos publications.',
      ],
      avertissement: "Cette personne n'est pas prévenue, mais elle peut le constater.",
      bouton: 'Bloquer',
      appel: () => moderationApi.bloquer(utilisateur._id),
      message: `${nom} a été bloqué.`,
    },

    restreindre: {
      titre: `Restreindre ${nom} ?`,
      corps: [
        'Ses messages arriveront dans vos demandes, sans notification.',
        "Ses commentaires sous vos publications attendront votre approbation : lui seul et vous les verrez.",
        'Il continuera de voir votre profil et vos publications normalement.',
      ],
      avertissement: "Cette personne n'en sera jamais informée.",
      bouton: 'Restreindre',
      appel: () => moderationApi.restreindre(utilisateur._id),
      message: `${nom} a été restreint.`,
    },
  };

  const texte = confirmation ? textes[confirmation] : null;

  return (
    <>
      <MenuOptions entrees={entrees} libelle={`Options pour ${nom}`} className={className} />

      {/* ---------------- Confirmation : bloquer / restreindre ---------------- */}
      <Modal
        ouvert={Boolean(confirmation)}
        onFermer={() => !enCours && setConfirmation(null)}
        titre={texte?.titre}
        taille="sm"
      >
        {texte && (
          <div className="space-y-4 p-5">
            <ul className="space-y-2 text-sm leading-relaxed text-ardoise-700">
              {texte.corps.map((ligne) => (
                <li key={ligne} className="flex gap-2">
                  <span aria-hidden="true" className="text-ardoise-300">
                    •
                  </span>
                  <span>{ligne}</span>
                </li>
              ))}
            </ul>

            <p className="rounded-lg bg-ardoise-50 px-3 py-2 text-xs text-ardoise-500">
              {texte.avertissement}
            </p>

            {erreur && <Alert variante="erreur">{erreur}</Alert>}

            <div className="flex justify-end gap-2">
              <Button
                variante="secondaire"
                taille="sm"
                onClick={() => setConfirmation(null)}
                disabled={enCours}
              >
                Annuler
              </Button>

              <Button
                variante="danger"
                taille="sm"
                onClick={() => executer(texte.appel, texte.message)}
                disabled={enCours}
              >
                {enCours ? 'Un instant…' : texte.bouton}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ---------------------------- Signalement ---------------------------- */}
      <Modal
        ouvert={signalementOuvert}
        onFermer={() => !enCours && setSignalementOuvert(false)}
        titre={`Signaler ${nom}`}
        taille="sm"
      >
        <div className="space-y-4 p-5">
          <p className="text-sm leading-relaxed text-ardoise-600">
            Votre signalement est transmis à l’administration. La personne signalée n’en est
            pas informée et n’apprendra jamais qui l’a signalée.
          </p>

          <fieldset className="space-y-1.5">
            <legend className="mb-1.5 text-sm font-semibold text-ardoise-800">
              Motif du signalement
            </legend>

            {/*
              BOUTONS RADIO, PAS UNE LISTE DÉROULANTE. Les six motifs doivent
              être lus avant de choisir : un `select` les cache derrière un
              clic et pousse à prendre le premier venu.
            */}
            {MOTIFS_SIGNALEMENT.map((option) => (
              <label
                key={option.valeur}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-ardoise-700 hover:bg-ardoise-50"
              >
                <input
                  type="radio"
                  name="motif-signalement"
                  value={option.valeur}
                  checked={motif === option.valeur}
                  onChange={(e) => setMotif(e.target.value)}
                  /*
                   * LE BOUTON RADIO LUI-MEME, pas seulement son libelle.
                   * Le `label` qui l'entoure porte deja `cursor-pointer`, mais
                   * le curseur n'est pas herite par un controle de
                   * formulaire : viser le petit cercle affichait la fleche
                   * ordinaire alors que viser le texte affichait la main.
                   */
                  className="cursor-pointer accent-marque-500"
                />
                {option.libelle}
              </label>
            ))}
          </fieldset>

          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ardoise-800">
              Précisions <span className="font-normal text-ardoise-400">(facultatif)</span>
            </span>
            <textarea
              value={commentaire}
              onChange={(e) => setCommentaire(e.target.value.slice(0, 500))}
              rows={3}
              maxLength={500}
              placeholder="Ce qui vous a amené à signaler ce compte…"
              className="w-full rounded-lg border border-ardoise-200 px-3 py-2 text-sm text-ardoise-800 focus:border-marque-500 focus:outline-none focus:ring-1 focus:ring-marque-500"
            />
            <span className="mt-1 block text-right text-xs text-ardoise-400">
              {commentaire.length}/500
            </span>
          </label>

          {erreur && <Alert variante="erreur">{erreur}</Alert>}

          <div className="flex justify-end gap-2">
            <Button
              variante="secondaire"
              taille="sm"
              onClick={() => setSignalementOuvert(false)}
              disabled={enCours}
            >
              Annuler
            </Button>

            {/*
              LE BOUTON RESTE INERTE TANT QU'AUCUN MOTIF N'EST CHOISI.
              Le serveur refuserait de toute façon — le motif est une liste
              fermée — mais laisser cliquer pour afficher une erreur ferait
              porter à l'utilisateur une règle que l'interface connaît déjà.
            */}
            <Button
              variante="danger"
              taille="sm"
              disabled={enCours || !motif}
              onClick={() =>
                executer(
                  () =>
                    moderationApi.signaler(utilisateur._id, {
                      motif,
                      commentaire: commentaire.trim() || undefined,
                    }),
                  'Signalement transmis à la modération.'
                )
              }
            >
              {enCours ? 'Envoi…' : 'Signaler'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ------------------------------ Confirmation ------------------------------ */}
      {/*
        UN RETOUR VISIBLE APRÈS COUP. Restreindre et signaler ne changent
        RIEN à l'écran — c'est justement leur raison d'être. Sans ce message,
        l'utilisateur n'aurait aucun moyen de savoir que son action a abouti,
        et la referait.
      */}
      <Modal ouvert={Boolean(succes)} onFermer={() => setSucces(null)} taille="sm">
        <div className="space-y-4 p-6 text-center">
          <p className="text-sm text-ardoise-700">{succes}</p>
          <Button variante="secondaire" taille="sm" onClick={() => setSucces(null)}>
            Fermer
          </Button>
        </div>
      </Modal>
    </>
  );
}
