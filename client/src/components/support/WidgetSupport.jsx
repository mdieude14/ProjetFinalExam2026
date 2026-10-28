import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';

import useAuth from '@/hooks/useAuth';
import { supportApi, supportDisponible } from '@/api/support.api';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

/**
 * ===========================================================================
 *  WIDGET DE SUPPORT — module 15
 * ===========================================================================
 *
 * Une pastille en bas à droite, un panneau de conversation au clic.
 *
 * TROIS CONDITIONS POUR QU'IL S'AFFICHE, et chacune évite un défaut précis :
 *
 *   une session ouverte   l'agent répond à partir des données de la personne ;
 *                         sans jeton il n'aurait rien à consulter
 *   une URL d'agent       absente, le widget est MASQUÉ et non cassé — le
 *                         support est une couche en plus, pas une dépendance
 *   hors back-office      un administrateur y traite les dossiers ; lui
 *                         proposer le widget mélangerait les deux rôles
 *
 * L'ORIGINE EST TRANSMISE AVEC LA QUESTION. La même phrase n'appelle pas la
 * même réponse selon qu'elle est tapée depuis « Mon diplôme » ou depuis le
 * fil d'actualité, et l'agent n'a aucun autre moyen de le savoir.
 *
 * ---------------------------------------------------------------------------
 *  DEUX PARCOURS PROPOSÉS, AUCUN IMPOSÉ
 * ---------------------------------------------------------------------------
 *
 * L'état vide d'origine disait « Posez votre question » : exact, et inutile à
 * qui ne sait pas ce que l'assistant peut consulter. Il annonce désormais ce
 * qu'il sait faire — par profil, car un coach et un sportif n'ont ni les
 * mêmes écrans ni les mêmes ennuis — puis propose deux entrées :
 *
 *   support   une réclamation, un litige : un formulaire OBJET + MESSAGE
 *   usage     « comment fait-on pour… » : la zone de saisie libre
 *
 * ET LA ZONE LIBRE RESTE OUVERTE SANS CHOIX. Les options orientent, elles ne
 * barrent pas le passage : quelqu'un qui sait déjà quoi écrire n'a pas à
 * traverser un menu pour le faire.
 *
 * LE PARCOURS EST UNE INDICATION, PAS UNE DÉCISION. Il part dans la requête à
 * côté de la question, et c'est le classifieur de l'agent qui tranche
 * l'intention — un champ rempli par le client ne peut pas décider d'une
 * escalade, sans quoi il suffirait de cocher « support » pour créer un ticket.
 * ===========================================================================
 */

/** Le jour, sans l'heure : « répondu le 24 septembre » se suffit à lui-même. */
const dateCourte = (valeur) =>
  new Date(valeur).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

/** De quoi reconnaître SA demande parmi plusieurs, sans réécrire le dossier. */
const extrait = (question, max = 60) =>
  question.length > max ? `${question.slice(0, max - 1).trimEnd()}…` : question;

/**
 * CE QUE L'ASSISTANT SAIT FAIRE — ÉCRIT ICI, PAS DANS LE JSX.
 *
 * Ces listes vont bouger : chaque module livré ajoute une chose que l'agent
 * peut consulter. Les tenir en haut du fichier permet de les corriger sans
 * relire le rendu, et de voir d'un coup d'œil ce qui est annoncé à chaque
 * profil — deux textes séparés dans le JSX auraient divergé au premier ajout.
 *
 * DEUX PROFILS ET NON UN TEXTE COMMUN : un sportif n'a pas de diplôme à faire
 * vérifier ni de versements à recevoir, un coach ne souscrit pas d'abonnement
 * premium. Annoncer à chacun ce qu'il ne peut pas faire, c'est l'inviter à
 * poser une question sans réponse.
 *
 * COURT, ET PAS PAR GOÛT DU STYLE : MESURÉ. La première rédaction faisait
 * 373 px au large et 409 px à 375 px, pour un fil qui en montre 294. Le
 * message dépassait donc le panneau À LUI SEUL. Chaque détail tient
 * désormais sur deux lignes au plus — et c'est la contrainte à respecter en
 * ajoutant une capacité.
 */
const PRESENTATION = {
  sportif: {
    accueil: (prenom) => `Bonjour ${prenom}, je suis l’assistant CoachConnect.`,
    role: 'Voici ce que je peux faire pour vous :',
    capacites: [
      {
        titre: 'Utiliser l’application',
        detail: 'publier un post ou une story, suivre un profil, passer en privé, chercher un coach',
      },
      {
        titre: 'Abonnements premium',
        detail: 'souscrire, résilier, accéder au contenu exclusif d’un coach',
      },
      {
        titre: 'Événements',
        detail: 's’inscrire, se désinscrire, places restantes',
      },
      {
        titre: 'Messagerie et notifications',
        detail: 'demandes de discussion, profils suivis',
      },
    ],
  },
  coach: {
    accueil: (prenom) => `Bonjour ${prenom}, je suis l’assistant CoachConnect.`,
    role: 'Voici ce que je peux faire pour vous :',
    capacites: [
      { titre: 'Diplôme', detail: 'vérification, statut de votre compte' },
      { titre: 'Paiements', detail: 'compte Stripe, versements' },
      { titre: 'Programme premium', detail: 'tarif, contenu, abonnés premium' },
      { titre: 'Événements', detail: 'création, gestion, capacité' },
      { titre: 'Visibilité', detail: 'publications privées, profil' },
    ],
  },
};

/**
 * LA PHRASE DE TRANSPARENCE, LA MÊME POUR LES DEUX PROFILS.
 *
 * Elle dit deux choses qu'on ne devine pas : que l'assistant LIT le compte de
 * la personne, et que certaines demandes sortent de son pouvoir. Sans la
 * seconde, une demande de remboursement ressemble à une question comme une
 * autre — et le silence de l'agent passerait pour une panne.
 */
const TRANSPARENCE =
  'Je consulte votre compte pour répondre. Une décision humaine comme un ' +
  'remboursement, un litige ou un signalement est transmise à l’équipe, ' +
  'qui vous répond par e-mail.';

/** Les deux entrées proposées sous la présentation. */
const PARCOURS = [
  {
    cle: 'support',
    titre: 'Contacter le support client',
    sous: 'Un problème, une réclamation, une demande à l’équipe',
  },
  {
    cle: 'usage',
    titre: 'Question d’utilisation',
    sous: 'Comment faire quelque chose sur CoachConnect',
  },
];

/** Le rappel du mode choisi, au-dessus de la zone de saisie. */
const ETIQUETTE_PARCOURS = {
  support: 'Support client',
  usage: 'Question d’utilisation',
};

/**
 * LES MÊMES BORNES QUE LE SERVEUR, ET C'EST VOLONTAIRE.
 *
 * La validation n8n porte sur `question`, entre 3 et 2000 caractères. Les
 * répéter ici ne remplace pas la sienne — elle reste la seule qui compte —
 * mais évite d'envoyer un appel qu'on sait d'avance refusé, et de le faire
 * payer au modèle.
 */
const BORNES = { objet: { min: 3, max: 120 }, message: { min: 3, max: 2000 } };

/**
 * UNE SEULE FONCTION DE VALIDATION, LUE À DEUX MOMENTS : pour désactiver le
 * bouton, et pour écrire sous les champs. Deux règles séparées auraient fini
 * par se contredire — un bouton actif au-dessus d'un message d'erreur.
 */
function validerSupport(objet, message) {
  const fautes = {};

  if (objet.length < BORNES.objet.min) {
    fautes.objet = `L’objet doit faire au moins ${BORNES.objet.min} caractères.`;
  } else if (objet.length > BORNES.objet.max) {
    fautes.objet = `L’objet ne doit pas dépasser ${BORNES.objet.max} caractères.`;
  }

  if (message.length < BORNES.message.min) {
    fautes.message = `Le message doit faire au moins ${BORNES.message.min} caractères.`;
  } else if (message.length > BORNES.message.max) {
    fautes.message = `Le message ne doit pas dépasser ${BORNES.message.max} caractères.`;
  }

  return fautes;
}

export default function WidgetSupport() {
  const { utilisateur } = useAuth();
  const { pathname } = useLocation();

  const [ouvert, setOuvert] = useState(false);
  const [saisie, setSaisie] = useState('');
  const [objet, setObjet] = useState('');
  const [parcours, setParcours] = useState(null);
  const [touche, setTouche] = useState({});
  const [envoi, setEnvoi] = useState(false);
  const [echanges, setEchanges] = useState([]);
  const [avis, setAvis] = useState([]);

  const boutonRef = useRef(null);
  const champRef = useRef(null);
  const objetRef = useRef(null);
  const filRef = useRef(null);
  const avisDemande = useRef(false);

  /* ------------------------- Conditions d'affichage ------------------------ */

  const masque =
    !utilisateur || !supportDisponible() || pathname.startsWith('/admin');

  /*
   * PAS SUR LA MESSAGERIE, EN DESSOUS DE `lg`. Une conversation y occupe tout
   * l'écran et sa zone de saisie est en bas à droite : le bouton flottant
   * recouvrait « Envoyer » à 375 px — mesuré. Aucune position fixe ne convient
   * à tous les écrans ; l'assistance reste accessible depuis toutes les
   * autres pages. Masqué en CSS (`hidden lg:flex`), sans écouter la taille
   * de la fenêtre : sur ordinateur, rien n'est recouvert et il reste visible.
   */
  const affichage = pathname.startsWith('/messages') ? 'hidden lg:flex' : 'flex';

  /* ------------------------------- Parcours ------------------------------- */

  /** Retour aux options : le mode, l'objet et les erreurs déjà vues tombent. */
  const reinitialiserParcours = useCallback(() => {
    setParcours(null);
    setObjet('');
    setTouche({});
  }, []);

  /*
   * UNE SEULE FERMETURE, APPELÉE PAR LA CROIX ET PAR ÉCHAP. Deux gestes qui
   * doivent faire la même chose finissent par diverger si on les écrit deux
   * fois — et depuis que la fermeture remet le parcours à zéro, elle fait
   * plus que `setOuvert(false)`.
   *
   * FERMÉ SANS AVOIR RIEN ENVOYÉ = ON REPART DES OPTIONS. Avec un échange au
   * fil, le parcours est au contraire CONSERVÉ : la conversation reprend là
   * où elle s'est arrêtée, et reproposer le menu reviendrait à faire croire
   * que ce qui précède n'a pas compté.
   */
  const fermer = useCallback(() => {
    setOuvert(false);
    boutonRef.current?.focus();
    if (echanges.length === 0) reinitialiserParcours();
  }, [echanges.length, reinitialiserParcours]);

  /* ------------------------------ Fermeture ------------------------------ */

  /*
   * ÉCHAP EST POSÉ SUR LE DOCUMENT, PAS SUR LE PANNEAU.
   *
   * Le défaut rencontré au module 14 sur le menu « ⋯ » : un écouteur porté
   * par le panneau ne reçoit la touche que si le focus y est déjà. Ouvert à
   * la souris, le focus reste sur le bouton — et Échap ne fermait rien.
   */
  useEffect(() => {
    if (!ouvert) return undefined;

    const surTouche = (e) => {
      if (e.key !== 'Escape') return;
      fermer();
    };

    document.addEventListener('keydown', surTouche);
    return () => document.removeEventListener('keydown', surTouche);
  }, [ouvert, fermer]);

  /*
   * LE FOCUS SUIT L'ÉCRAN DU WIDGET, PAS SEULEMENT L'OUVERTURE.
   *
   * Le panneau change de zone de saisie selon le parcours : choisir « support »
   * remplace la zone libre par un formulaire. Sans ce passage, le focus restait
   * sur le bouton-carte qui vient de disparaître — et au clavier, plus rien ne
   * répondait jusqu'à une tabulation à l'aveugle.
   */
  useEffect(() => {
    if (!ouvert) return;
    if (parcours === 'support') objetRef.current?.focus();
    else champRef.current?.focus();
  }, [ouvert, parcours]);

  /*
   * LE FIL SE DÉROULE VERS LE BAS À CHAQUE ÉCHANGE — MAIS PAS AVANT LE PREMIER.
   *
   * Tant que rien n'a été envoyé, le fil contient la présentation et les deux
   * options : y envoyer la vue en bas ferait défiler la salutation hors de
   * l'écran avant qu'elle n'ait été lue.
   */
  useEffect(() => {
    if (echanges.length === 0 && !envoi) return;
    filRef.current?.scrollTo({ top: filRef.current.scrollHeight, behavior: 'smooth' });
  }, [echanges, envoi]);

  /* ------------------------ Réponses de l'équipe ------------------------ */

  /*
   * « UNE RÉPONSE VOUS A ÉTÉ ENVOYÉE PAR E-MAIL. »
   *
   * Un dossier remonté se termine par un courriel écrit par l'équipe, dans la
   * boîte de la personne. Sans cet avis, quelqu'un qui revient ici verrait sa
   * question sans suite, et n'aurait aucune raison d'aller regarder ses
   * courriels — le dossier serait traité, et elle l'ignorerait.
   *
   * LE TEXTE N'EST PAS RECOPIÉ ICI, seulement son existence. Il vit dans la
   * boîte de réception ; en tenir un second exemplaire obligerait à garder
   * les deux cohérents pour rien, et le serveur ne l'expose d'ailleurs pas à
   * l'auteur.
   *
   * À LA PREMIÈRE OUVERTURE, PAS AU MONTAGE. Le widget est présent sur toutes
   * les pages : interroger le serveur à chaque navigation coûterait une
   * requête par écran visité, pour un avis que la plupart n'ouvriront jamais.
   *
   * L'ÉCHEC EST SILENCIEUX. Le support est une couche en plus : une panne de
   * cette relecture ne doit pas empêcher de poser une question.
   */
  useEffect(() => {
    if (!ouvert || avisDemande.current) return undefined;
    avisDemande.current = true;

    let vivant = true;

    (async () => {
      try {
        const reponse = await supportApi.mesTickets({ limite: 20 });
        const aAnnoncer = (reponse.data?.elements ?? []).filter(
          (dossier) => dossier.reponseEnvoyeeLe && !dossier.vueParAuteurLe
        );

        if (!vivant || aAnnoncer.length === 0) return;
        setAvis(aAnnoncer);

        /*
         * MARQUÉ VU DÈS L'AFFICHAGE, et le sens de l'échec est le bon : si le
         * marquage échoue, l'avis reparaîtra à la prochaine ouverture. Mieux
         * vaut le redire une fois de trop que de le perdre.
         *
         * `allSettled` et non `all` : un dossier qui refuserait le marquage ne
         * doit pas emporter les autres.
         */
        await Promise.allSettled(aAnnoncer.map((dossier) => supportApi.marquerVu(dossier._id)));
      } catch (erreur) {
        console.error('[SUPPORT] Relecture des dossiers impossible :', erreur?.message);
      }
    })();

    return () => { vivant = false; };
  }, [ouvert]);

  /* ------------------------------- Envoi ------------------------------- */

  /*
   * UN SEUL CHEMIN D'ENVOI POUR LES DEUX FORMULAIRES.
   *
   * La zone libre et le formulaire structuré ne remplissent pas les mêmes
   * champs, mais ils ont le même traitement d'erreur, la même lecture de la
   * réponse et le même repli d'indisponibilité. Les dupliquer, c'était
   * s'assurer qu'un correctif n'arriverait un jour que dans l'un des deux.
   *
   * `objet` PART DANS SON PROPRE CHAMP, il n'est PAS collé à la question :
   * la validation n8n porte sur `question`, et un objet concaténé ferait
   * dépasser la borne des 2000 caractères sans que personne ne voie pourquoi.
   */
  const transmettre = useCallback(
    async (question, sujet) => {
      setEchanges((liste) => [...liste, { role: 'moi', texte: question, objet: sujet }]);
      setEnvoi(true);

      try {
        const reponse = await supportApi.demander({
          question,
          origine: pathname,
          parcours,
          objet: sujet,
        });

        /*
         * ON NE SUPPOSE PAS LA FORME DE LA RÉPONSE.
         * Elle vient d'un workflow n8n, que l'on peut modifier sans toucher à
         * ce fichier : trois noms de champ plausibles.
         *
         * AUCUN DES TROIS = UNE PANNE, PAS UNE RÉPONSE. Le repli d'origine
         * affichait « un conseiller va prendre le relais » — une promesse que
         * rien ne tenait : lors du premier essai de l'agent, une erreur réseau
         * a arrêté le workflow, le widget a reçu un 200 vide, et AUCUN ticket
         * n'existait. Seul le workflow sait si une escalade a été enregistrée ;
         * le widget, lui, doit dire que le service est indisponible.
         */
        const texte = reponse?.data?.reponse ?? reponse?.data?.message ?? reponse?.data?.output;
        if (typeof texte !== 'string' || !texte.trim()) {
          throw new Error('Réponse de l’agent vide ou inattendue');
        }

        setEchanges((liste) => [
          ...liste,
          { role: 'agent', texte, escalade: Boolean(reponse?.data?.escalade) },
        ]);
      } catch (erreur) {
        /*
         * UN ÉCHEC DE L'AGENT N'EST PAS UNE ERREUR DE L'UTILISATEUR.
         * On ne montre ni code HTTP ni message technique : on dit ce qui se
         * passe ensuite. Le détail part en console pour le diagnostic.
         */
        console.error('[SUPPORT] Échec de l’agent :', erreur?.message);
        setEchanges((liste) => [
          ...liste,
          {
            role: 'agent',
            texte:
              'Le service d’assistance est momentanément indisponible. ' +
              'Réessayez dans un instant, ou écrivez-nous directement.',
            erreur: true,
          },
        ]);
      } finally {
        setEnvoi(false);
      }
    },
    [pathname, parcours]
  );

  /** La zone libre : tout le message tient dans la saisie, sans objet. */
  const envoyer = useCallback(
    (e) => {
      e.preventDefault();

      const question = saisie.trim();
      if (!question || envoi) return;

      setSaisie('');
      transmettre(question, null);
    },
    [saisie, envoi, transmettre]
  );

  /*
   * LE FORMULAIRE STRUCTURÉ : validé AVANT de partir, et les deux champs sont
   * alors marqués « touchés » — c'est ce qui fait apparaître les messages sous
   * les champs quand quelqu'un soumet avec Entrée depuis l'objet, sans avoir
   * jamais visité la zone du message.
   */
  const envoyerSupport = useCallback(
    (e) => {
      e.preventDefault();

      const sujet = objet.trim();
      const question = saisie.trim();

      const fautes = validerSupport(sujet, question);
      setTouche({ objet: true, message: true });
      if (Object.keys(fautes).length > 0 || envoi) return;

      setSaisie('');
      setObjet('');
      setTouche({});
      transmettre(question, sujet);
    },
    [objet, saisie, envoi, transmettre]
  );

  if (masque) return null;

  /* ------------------------------- Rendu ------------------------------- */

  const profil = PRESENTATION[utilisateur.type === 'coach' ? 'coach' : 'sportif'];

  const fautes = validerSupport(objet.trim(), saisie.trim());
  const supportValide = Object.keys(fautes).length === 0;
  const afficheObjet = Boolean(touche.objet && fautes.objet);
  const afficheMessage = Boolean(touche.message && fautes.message);

  return (
    <>
      {/*
        Le panneau est monté AVANT le bouton dans le DOM mais positionné
        au-dessus : un lecteur d'écran rencontre ainsi la conversation avant
        le bouton qui l'a ouverte.
      */}
      {ouvert && (
        <div
          role="dialog"
          aria-label="Assistance CoachConnect"
          data-test="widget-support-panneau"
          /*
           * LA HAUTEUR N'EST PLUS FIXE, ET C'EST UNE MESURE QUI L'A DÉCIDÉ.
           * À 28 rem, le fil montrait 294 px pour 546 px de contenu. 34 rem
           * lui en rend 96 de plus. Le `min()` est le garde-fou : sur un écran
           * court, le panneau se réduit au lieu de passer sous l'en-tête —
           * 11 rem couvrent l'écart au bas de l'écran (`bottom-36`) et une
           * marge en haut.
           */
          className={`fixed bottom-36 right-5 z-40 ${affichage} h-[min(34rem,calc(100dvh-11rem))] w-[min(22rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-carte border border-ardoise-200 bg-white shadow-xl lg:bottom-24`}
        >
          <header className="flex items-center justify-between border-b border-ardoise-100 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-ardoise-900">Assistance</p>
              <p className="text-xs text-ardoise-500">
                {utilisateur.type === 'coach' ? 'Espace coach' : 'Espace sportif'}
              </p>
            </div>
            <button
              type="button"
              onClick={fermer}
              aria-label="Fermer l’assistance"
              className="cursor-pointer rounded-lg px-2 py-1 text-xl leading-none text-ardoise-400 hover:bg-ardoise-100 hover:text-ardoise-700"
            >
              ×
            </button>
          </header>

          <div ref={filRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {avis.map((dossier) => (
              <div
                key={dossier._id}
                data-test="avis-reponse-courriel"
                className="rounded-carte border border-succes/30 bg-succes/5 px-3 py-3"
              >
                <p className="text-sm font-medium text-ardoise-900">
                  Une réponse vous a été envoyée par e-mail.
                </p>
                <p className="mt-1 text-xs leading-relaxed text-ardoise-600">
                  Notre équipe a répondu le {dateCourte(dossier.reponseEnvoyeeLe)} à votre demande
                  {dossier.question ? ` « ${extrait(dossier.question)} »` : ''} (réf.{' '}
                  {dossier.reference}). Le message est dans votre boîte de réception.
                </p>
              </div>
            ))}

            {/*
              UN ÉTAT VIDE EXPLIQUE, il ne se contente pas d'être vide — le
              principe posé au module 13 pour les listes sans résultat. Ici il
              va plus loin : il annonce ce que l'assistant peut consulter, car
              personne ne devine qu'il lit le compte de la personne.

              PRÉSENTATION ET OPTIONS DISPARAISSENT AU PREMIER ENVOI. Une fois
              la conversation commencée, elles ne renseignent plus rien et
              repousseraient le fil hors de l'écran.
            */}
            {echanges.length === 0 && (
              <div
                data-test="support-presentation"
                className="rounded-carte bg-ardoise-50 px-3 py-3 text-ardoise-600"
              >
                <p className="text-sm font-medium text-ardoise-800">
                  {profil.accueil(utilisateur.prenom)}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed">{profil.role}</p>

                <ul className="mt-2 space-y-1">
                  {profil.capacites.map((capacite) => (
                    <li key={capacite.titre} className="text-xs leading-snug">
                      <span className="font-medium text-ardoise-800">{capacite.titre}</span>
                      {' : '}
                      {capacite.detail}
                    </li>
                  ))}
                </ul>

                <p className="mt-2 border-t border-ardoise-200 pt-2 text-xs leading-relaxed text-ardoise-500">
                  {TRANSPARENCE}
                </p>
              </div>
            )}

            {echanges.map((echange, i) => (
              <div
                key={i}
                className={echange.role === 'moi' ? 'flex justify-end' : 'flex justify-start'}
              >
                <p
                  data-test={`support-${echange.role}`}
                  className={`max-w-[85%] whitespace-pre-wrap rounded-carte px-3 py-2 text-sm ${
                    echange.role === 'moi'
                      ? 'bg-marque-500 text-white'
                      : echange.erreur
                        ? 'bg-erreur/10 text-erreur'
                        : 'bg-ardoise-100 text-ardoise-800'
                  }`}
                >
                  {/*
                    L'OBJET EN TÊTE DE BULLE, quand la demande vient du
                    formulaire : sans lui, le fil n'en garderait aucune trace
                    alors qu'il est parti au support, et la personne ne
                    retrouverait pas de quoi elle a parlé.
                  */}
                  {echange.objet && (
                    <span className="mb-1 block font-semibold">{echange.objet}</span>
                  )}
                  {echange.texte}
                </p>
              </div>
            ))}

            {envoi && (
              <div className="flex items-center gap-2 text-xs text-ardoise-500">
                <Spinner taille="sm" />
                <span>L’assistant consulte votre dossier…</span>
              </div>
            )}
          </div>

          <div className="border-t border-ardoise-100 p-3">
            {/*
              LES OPTIONS SONT HORS DU FIL, ET C'EST UNE MESURE QUI L'A DÉCIDÉ.

              Placées sous le message, elles commençaient à 397 px du haut d'un
              fil qui en montre 294 : INVISIBLES SANS DÉFILER, alors que ce sont
              elles qui ouvrent le parcours. Et le défaut serait revenu à chaque
              capacité ajoutée à la présentation.

              La règle qui en sort : un MESSAGE défile, une COMMANDE non. Les
              options sont des commandes, elles vivent donc dans la zone basse,
              avec la saisie. Elles disparaissent au premier envoi, comme la
              présentation, et dès qu'un parcours est choisi — la pastille les
              remplace alors, et « Changer » les ramène.
            */}
            {echanges.length === 0 && !parcours && (
              <div className="mb-3 space-y-2">
                {PARCOURS.map((option) => (
                  <button
                    key={option.cle}
                    type="button"
                    onClick={() => { setParcours(option.cle); setTouche({}); }}
                    aria-label={option.titre}
                    data-test={`support-option-${option.cle}`}
                    className="w-full cursor-pointer rounded-carte border border-ardoise-200 bg-white px-3 py-2 text-left transition-colors hover:border-marque-500 hover:bg-marque-50"
                  >
                    <span className="block text-sm font-semibold text-ardoise-800">
                      {option.titre}
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-ardoise-500">
                      {option.sous}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/*
              LA PASTILLE RAPPELLE LE MODE, ET « CHANGER » EN SORT. Le
              formulaire structuré ne ressemble pas à la zone libre : sans ce
              rappel, quelqu'un qui revient sur le panneau ne saurait pas
              pourquoi il a deux champs, ni comment retrouver les options.
            */}
            {parcours && (
              <div className="mb-2 flex items-center justify-between gap-2">
                <span
                  data-test="support-pastille-parcours"
                  className="rounded-full bg-marque-50 px-2 py-0.5 text-xs font-medium text-marque-700"
                >
                  {ETIQUETTE_PARCOURS[parcours]}
                </span>
                <button
                  type="button"
                  onClick={reinitialiserParcours}
                  aria-label="Changer de parcours"
                  data-test="support-changer-parcours"
                  className="cursor-pointer rounded-lg px-2 py-0.5 text-xs text-ardoise-500 underline hover:text-marque-600"
                >
                  Changer
                </button>
              </div>
            )}

            {parcours === 'support' ? (
              <form onSubmit={envoyerSupport} data-test="support-formulaire" className="space-y-2">
                <div>
                  <input
                    ref={objetRef}
                    type="text"
                    value={objet}
                    onChange={(e) => setObjet(e.target.value)}
                    onBlur={() => setTouche((t) => ({ ...t, objet: true }))}
                    maxLength={BORNES.objet.max}
                    placeholder="Objet (ex. : prélèvement en double)"
                    aria-label="Objet de votre demande"
                    aria-invalid={afficheObjet ? 'true' : undefined}
                    aria-describedby={afficheObjet ? 'support-erreur-objet' : undefined}
                    data-test="support-objet"
                    className="w-full rounded-carte border border-ardoise-200 px-3 py-2 text-sm focus:border-marque-500 focus:outline-none"
                  />
                  {afficheObjet && (
                    <p
                      id="support-erreur-objet"
                      data-test="support-erreur-objet"
                      className="mt-1 text-xs text-erreur"
                    >
                      {fautes.objet}
                    </p>
                  )}
                </div>

                <div>
                  <textarea
                    value={saisie}
                    onChange={(e) => setSaisie(e.target.value)}
                    onBlur={() => setTouche((t) => ({ ...t, message: true }))}
                    /* Entrée envoie, Maj+Entrée va à la ligne — ici aussi. */
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) envoyerSupport(e);
                    }}
                    rows={3}
                    maxLength={BORNES.message.max}
                    placeholder="Décrivez votre demande…"
                    aria-label="Votre message"
                    aria-invalid={afficheMessage ? 'true' : undefined}
                    aria-describedby={
                      afficheMessage
                        ? 'support-erreur-message support-compteur'
                        : 'support-compteur'
                    }
                    data-test="support-message"
                    className="w-full resize-none rounded-carte border border-ardoise-200 px-3 py-2 text-sm focus:border-marque-500 focus:outline-none"
                  />
                  <div className="mt-1 flex items-start justify-between gap-2">
                    {afficheMessage ? (
                      <p
                        id="support-erreur-message"
                        data-test="support-erreur-message"
                        className="text-xs text-erreur"
                      >
                        {fautes.message}
                      </p>
                    ) : (
                      <span />
                    )}
                    <span
                      id="support-compteur"
                      data-test="support-compteur"
                      className="shrink-0 text-xs text-ardoise-400"
                    >
                      {saisie.length} / {BORNES.message.max}
                    </span>
                  </div>
                </div>

                <Button
                  type="submit"
                  variante="principal"
                  taille="sm"
                  pleineLargeur
                  disabled={!supportValide || envoi}
                  aria-label="Envoyer au support"
                  data-test="support-envoyer-formulaire"
                >
                  Envoyer au support
                </Button>
              </form>
            ) : (
              <form onSubmit={envoyer}>
                {/*
                  LE CHAMP ET LE BOUTON DANS UN SEUL CADRE.

                  `items-end` alignait bien leurs bas, mais une zone de deux
                  lignes (58 px) posée contre un bouton de 32 px donnait deux
                  blocs de poids très différents. Les réunir sous une bordure
                  commune, qui s'allume au focus, règle la question sans faire
                  grossir le bouton : les deux ne forment plus qu'une seule
                  commande, et la zone de texte n'a plus de bordure propre à
                  faire concurrencer celle du cadre.
                */}
                <div className="flex items-end gap-2 rounded-carte border border-ardoise-200 bg-white p-1.5 transition-colors focus-within:border-marque-500">
                  <textarea
                    ref={champRef}
                    value={saisie}
                    onChange={(e) => setSaisie(e.target.value)}
                    /*
                     * ENTRÉE ENVOIE, MAJ+ENTRÉE VA À LA LIGNE — la convention de
                     * la messagerie du module 11. Deux comportements différents
                     * pour un même geste dans une même application seraient une
                     * source d'erreur permanente.
                     */
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) envoyer(e);
                    }}
                    rows={2}
                    maxLength={BORNES.message.max}
                    placeholder={
                      parcours === 'usage'
                        ? 'Décrivez ce que vous voulez faire…'
                        : 'Votre question…'
                    }
                    aria-label="Votre question"
                    data-test="support-saisie"
                    /*
                     * `min-w-0` N'EST PAS DÉCORATIF : la largeur minimale d'une
                     * `textarea` vient de son attribut `cols` (20 par défaut,
                     * soit ~180 px). Sans lui, à 375 px, `flex-1` ne pouvait
                     * plus la réduire et le bouton sortait du panneau — que
                     * `overflow-hidden` aurait masqué sans rien signaler.
                     */
                    className="min-h-[2.25rem] min-w-0 flex-1 resize-none border-0 bg-transparent px-1.5 py-1.5 text-sm text-ardoise-800 placeholder:text-ardoise-400 focus:outline-none"
                  />
                  <Button
                    type="submit"
                    variante="principal"
                    taille="sm"
                    disabled={!saisie.trim() || envoi}
                    data-test="support-envoyer"
                    className="shrink-0"
                  >
                    Envoyer
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      <button
        ref={boutonRef}
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
        aria-label={ouvert ? 'Fermer l’assistance' : 'Ouvrir l’assistance'}
        data-test="widget-support-bouton"
        /*
         * AU-DESSUS DE LA BARRE DE NAVIGATION MOBILE. Sous `lg`, cette barre
         * est fixée en bas de l'écran (4 rem). Posé à `bottom-5`, le bouton
         * recouvrait son dernier onglet : sur téléphone et tablette,
         * « Notifications » devenait impossible à toucher — mesuré à 375 et
         * 768 px, invisible à 1280 où la barre n'existe pas.
         */
        className={`fixed bottom-20 right-5 z-40 ${affichage} h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-marque-500 text-white shadow-lg transition-colors hover:bg-marque-600 active:bg-marque-700 lg:bottom-5`}
      >
        {/* Un pictogramme SEUL ne suffit pas : le libellé accessible est
            porté par aria-label, conformément au module 13. */}
        <span aria-hidden="true" className="text-2xl leading-none">
          {ouvert ? '×' : '?'}
        </span>
      </button>
    </>
  );
}
