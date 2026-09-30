import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import adminApi from '@/api/admin.api';
import Avatar from '@/components/ui/Avatar';
import Badge, { BadgeDiplome } from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import Textarea from '@/components/ui/Textarea';
import Spinner from '@/components/ui/Spinner';

/**
 * Back-office de moderation — /admin/moderation
 *
 * L'administrateur y verifie les diplomes des coachs. C'est la decision la
 * plus lourde de la plateforme : elle conditionne le badge « certifie » et,
 * a terme, le droit de vendre des abonnements.
 *
 * DEUX GARDE-FOUS D'INTERFACE
 *  - Le refus exige la saisie d'un motif avant que le bouton s'active. Le
 *    serveur l'impose deja ; l'interface evite l'aller-retour inutile et,
 *    surtout, rappelle que le coach lira ce texte.
 *  - Apres chaque decision, la liste est rechargee depuis le serveur plutot
 *    que modifiee localement. C'est un peu moins fluide, mais l'affichage
 *    reflete toujours l'etat reel, y compris si un second administrateur
 *    travaille en meme temps.
 */

/**
 * TROIS FAMILLES DE DOSSIERS, PAS UNE LISTE UNIQUE.
 *
 * Un diplôme à vérifier, un compte signalé et une demande remontée par
 * l'agent de support n'ont ni le même contenu, ni les mêmes issues, ni la
 * même urgence. Les mêler dans une seule file obligerait à lire le type de
 * chaque carte avant de savoir quoi en faire.
 */
const FAMILLES = [
  { cle: 'diplomes', libelle: 'Diplômes' },
  { cle: 'signalements', libelle: 'Signalements' },
  { cle: 'support', libelle: 'Support' },
];

const ONGLETS = {
  diplomes: [
    { cle: 'en_attente', libelle: 'En attente' },
    { cle: 'verifie', libelle: 'Vérifiés' },
    { cle: 'refuse', libelle: 'Refusés' },
  ],
  signalements: [
    { cle: 'ouvert', libelle: 'Ouverts' },
    { cle: 'traite', libelle: 'Traités' },
    { cle: 'rejete', libelle: 'Rejetés' },
  ],
  /*
   * « Non escaladés » n'appelle aucune action : c'est l'onglet d'audit.
   * Relire ce que l'agent a répondu seul est le seul moyen de savoir s'il
   * répond bien — et s'il escalade quand il le devrait.
   */
  support: [
    { cle: 'escalade', libelle: 'À traiter' },
    { cle: 'clos', libelle: 'Instruits' },
    { cle: 'resolu', libelle: 'Non escaladés' },
  ],
};

/** Chargement de la file de chaque famille, pour un statut donné. */
const CHARGEURS = {
  diplomes: (statut) => adminApi.diplomes({ statut }),
  signalements: (statut) => adminApi.signalements({ statut }),
  support: (statut) => adminApi.tickets({ statut }),
};

/** Onglets dont la liste vide signifie « rien en attente ». */
const ONGLETS_EN_ATTENTE = ['en_attente', 'ouvert', 'escalade'];

/** Libellés des motifs, alignés sur l'énumération du modèle serveur. */
const LIBELLES_MOTIF = {
  spam: 'Spam ou publicité',
  harcelement: 'Harcèlement ou intimidation',
  contenu_inapproprie: 'Contenu inapproprié',
  usurpation: "Usurpation d'identité",
  fausse_qualification: 'Fausse qualification de coach',
  autre: 'Autre',
};

/** Libellés des intentions, alignés sur l'énumération du modèle `Ticket`. */
const LIBELLES_INTENTION = {
  usage: 'Question d’usage',
  contextuel: 'Question sur son compte',
  decision: 'Demande de décision',
  hors_sujet: 'Hors sujet',
};

/** Motifs d'escalade automatique, alignés sur le service serveur. */
const LIBELLES_ESCALADE = {
  remboursement: 'Remboursement',
  litige_diplome: 'Litige sur un diplôme',
  contestation_moderation: 'Contestation de modération',
  signalement_grave: 'Signalement grave',
  // Motifs posés par le serveur quand aucun motif n'est fourni.
  'demande de décision': 'Demande de décision',
  'demande sans agent': 'Écrite sans passer par l’agent',
};

const LIBELLES_ROLE = { utilisateur: 'Sportif', coach: 'Coach', admin: 'Administrateur' };

/** Date et heure : deux demandes de support arrivent souvent le même jour. */
const dateHeure = (valeur) =>
  valeur
    ? new Date(valeur).toLocaleString('fr-FR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

/** Tuile d'indicateur du tableau de bord. */
function Indicateur({ libelle, valeur, accent = false }) {
  return (
    <div
      className={`rounded-xl p-3 ${
        accent ? 'bg-marque-50 ring-1 ring-marque-200' : 'bg-ardoise-50'
      }`}
    >
      <p className="text-xs text-ardoise-500">{libelle}</p>
      <p
        className={`mt-0.5 text-xl font-bold tabular-nums ${
          accent ? 'text-marque-700' : 'text-ardoise-900'
        }`}
      >
        {valeur ?? '—'}
      </p>
    </div>
  );
}

/** Carte d'un dossier de coach. */
function DossierCoach({ coach, onDecision, enCours }) {
  const [modeRefus, setModeRefus] = useState(false);
  const [motif, setMotif] = useState('');

  return (
    <li className="rounded-carte border border-ardoise-200 bg-white p-5">
      <div className="flex flex-wrap items-start gap-4">
        <Avatar utilisateur={coach} taille="lg" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/profile/${coach.pseudo}`}
              className="font-bold text-ardoise-900 hover:text-marque-600 hover:underline"
            >
              {coach.prenom} {coach.nom}
            </Link>
            <BadgeDiplome statut={coach.diplome?.statut} />
            {!coach.isActive && <Badge variante="erreur">Compte désactivé</Badge>}
          </div>

          <p className="mt-0.5 text-sm text-ardoise-500">
            @{coach.pseudo} · {coach.email}
            {coach.ville && ` · ${coach.ville}`}
          </p>

          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="text-ardoise-500">Diplôme :</dt>
              <dd className="font-medium text-ardoise-900">
                {coach.diplome?.intitule || '—'}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ardoise-500">Organisme :</dt>
              <dd className="font-medium text-ardoise-900">
                {coach.diplome?.organisme || '—'}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ardoise-500">Soumis le :</dt>
              <dd className="text-ardoise-700">
                {coach.diplome?.dateSoumission
                  ? new Date(coach.diplome.dateSoumission).toLocaleDateString('fr-FR', {
                      day: '2-digit', month: 'long', year: 'numeric',
                    })
                  : '—'}
              </dd>
            </div>
          </dl>

          {/* Le justificatif n'est visible que de l'administrateur :
              versionAdmin le renvoie, versionPublique jamais. */}
          {coach.diplome?.url ? (
            <a
              href={coach.diplome.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-sm font-medium text-marque-600 hover:underline"
            >
              Ouvrir le justificatif →
            </a>
          ) : (
            <p className="mt-3 text-xs text-alerte">
              Aucun justificatif téléversé (téléversement disponible au module 5)
            </p>
          )}

          {/* Historique de decision, pour les dossiers deja traites */}
          {coach.diplome?.dateVerification && (
            <p className="mt-3 text-xs text-ardoise-500">
              Traite le{' '}
              {new Date(coach.diplome.dateVerification).toLocaleDateString('fr-FR')}
              {coach.diplome.verifiePar?.pseudo && ` par @${coach.diplome.verifiePar.pseudo}`}
            </p>
          )}

          {coach.diplome?.motifRefus && (
            <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-800">
              Motif : {coach.diplome.motifRefus}
            </p>
          )}

          {/* Actions, uniquement sur les dossiers en attente */}
          {coach.diplome?.statut === 'en_attente' && (
            <div className="mt-4 border-t border-ardoise-100 pt-4">
              {!modeRefus ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    taille="sm"
                    chargement={enCours === coach._id}
                    onClick={() => onDecision(coach._id, 'verifie')}
                  >
                    Valider le diplôme
                  </Button>
                  <Button variante="danger" taille="sm" onClick={() => setModeRefus(true)}>
                    Refuser
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <Textarea
                    libelle="Motif du refus"
                    value={motif}
                    onChange={(e) => setMotif(e.target.value)}
                    maxLength={500}
                    rows={2}
                    aide="Ce texte sera lu par le coach : soyez precis sur ce qu’il doit corriger."
                    placeholder="Document illisible, diplôme non reconnu, informations incoherentes..."
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variante="danger"
                      taille="sm"
                      disabled={motif.trim().length === 0}
                      chargement={enCours === coach._id}
                      onClick={() => onDecision(coach._id, 'refuse', motif)}
                    >
                      Confirmer le refus
                    </Button>
                    <Button
                      variante="fantome"
                      taille="sm"
                      onClick={() => { setModeRefus(false); setMotif(''); }}
                    >
                      Annuler
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Carte d'un signalement.
 *
 * LE MOTIF ET LES PRÉCISIONS SONT MIS EN AVANT, avant même les deux comptes.
 * C'est ce que l'administrateur doit lire pour décider s'il ouvre le profil
 * visé : afficher d'abord les identités le ferait juger la personne avant de
 * savoir ce qui lui est reproché.
 *
 * LE SIGNALEUR EST AFFICHÉ — mais UNIQUEMENT ici. Il permet de repérer un
 * compte qui signale tout le monde, ce qui est en soi un signal. Cette
 * information ne sort jamais de ce back-office.
 */
function DossierSignalement({ signalement, onDecision, enCours }) {
  const [commentaire, setCommentaire] = useState('');
  const { cible, signaleur } = signalement;

  const date = (valeur) =>
    valeur
      ? new Date(valeur).toLocaleDateString('fr-FR', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        })
      : '—';

  return (
    <li className="rounded-carte border border-ardoise-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variante="erreur">
            {LIBELLES_MOTIF[signalement.motif] || signalement.motif}
          </Badge>
          {signalement.statut !== 'ouvert' && (
            <Badge variante="neutre">
              {signalement.statut === 'traite' ? 'Traité' : 'Rejeté'}
            </Badge>
          )}
        </div>

        <p className="text-xs text-ardoise-400">Déposé le {date(signalement.createdAt)}</p>
      </div>

      {/*
        LES PRÉCISIONS SONT AFFICHÉES TELLES QUELLES, sans troncature.
        Elles sont bornées à 500 caractères côté serveur ; les couper ici
        obligerait à ouvrir la base pour lire la fin d'une alerte.
      */}
      {signalement.commentaire ? (
        <blockquote className="mt-3 rounded-lg border-l-4 border-erreur/40 bg-ardoise-50 px-3 py-2 text-sm leading-relaxed text-ardoise-700">
          {signalement.commentaire}
        </blockquote>
      ) : (
        <p className="mt-3 text-xs italic text-ardoise-400">
          Aucune précision n’a été fournie par le signaleur.
        </p>
      )}

      <div className="mt-4 grid gap-3 border-t border-ardoise-100 pt-4 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ardoise-400">
            Compte signalé
          </p>
          <div className="flex items-center gap-2.5">
            <Avatar utilisateur={cible} taille="sm" />
            <div className="min-w-0">
              <Link
                to={`/profile/${cible?.pseudo}`}
                className="block truncate text-sm font-bold text-ardoise-900 hover:text-marque-600 hover:underline"
              >
                {cible?.prenom} {cible?.nom}
              </Link>
              <span className="block truncate text-xs text-ardoise-500">
                @{cible?.pseudo}
                {cible?.isActive === false && ' · désactivé'}
              </span>
            </div>
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ardoise-400">
            Signalé par
          </p>
          <div className="flex items-center gap-2.5">
            <Avatar utilisateur={signaleur} taille="sm" />
            <div className="min-w-0">
              <Link
                to={`/profile/${signaleur?.pseudo}`}
                className="block truncate text-sm font-medium text-ardoise-700 hover:text-marque-600 hover:underline"
              >
                {signaleur?.prenom} {signaleur?.nom}
              </Link>
              <span className="block truncate text-xs text-ardoise-500">
                @{signaleur?.pseudo}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Historique, pour les dossiers déjà instruits */}
      {signalement.traiteLe && (
        <p className="mt-3 text-xs text-ardoise-500">
          Instruit le {date(signalement.traiteLe)}
          {signalement.traitePar?.pseudo && ` par @${signalement.traitePar.pseudo}`}
        </p>
      )}

      {signalement.decision && (
        <p className="mt-2 rounded-lg bg-ardoise-50 p-2 text-xs text-ardoise-700">
          Décision : {signalement.decision}
        </p>
      )}

      {/* Actions, uniquement sur les dossiers ouverts */}
      {signalement.statut === 'ouvert' && (
        <div className="mt-4 space-y-3 border-t border-ardoise-100 pt-4">
          <Textarea
            libelle="Note d’instruction (facultative)"
            value={commentaire}
            onChange={(e) => setCommentaire(e.target.value)}
            maxLength={500}
            rows={2}
            aide="Interne au back-office : ni le signaleur ni la personne signalée ne la liront."
            placeholder="Compte désactivé, avertissement envoyé, alerte non fondée…"
          />

          <div className="flex flex-wrap gap-2">
            {/*
              « Traiter » et « Rejeter » classent tous deux le dossier — la
              différence est la trace laissée. Un compte trois fois signalé
              puis trois fois blanchi n'est pas un compte jamais signalé, et
              c'est l'historique qui permet de le voir.
            */}
            <Button
              variante="danger"
              taille="sm"
              chargement={enCours === signalement._id}
              onClick={() => onDecision(signalement._id, 'traiter', commentaire)}
            >
              Traiter (fondé)
            </Button>
            <Button
              variante="secondaire"
              taille="sm"
              chargement={enCours === signalement._id}
              onClick={() => onDecision(signalement._id, 'rejeter', commentaire)}
            >
              Rejeter (non fondé)
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Carte d'un ticket de support.
 *
 * L'ORDRE SUIT CE QU'IL FAUT LIRE POUR DÉCIDER : pourquoi le dossier est
 * remonté, ce qui a été demandé, puis la réponse DÉJÀ transmise. Ce dernier
 * point n'est pas un détail : dans le parcours normal, l'utilisateur a lu
 * cette réponse, et une décision qui la contredirait sans le savoir le
 * laisserait devant deux messages incompatibles.
 *
 * « RÉPONSE DE L'AGENT » SEULEMENT QUAND LE SERVEUR L'ATTESTE. La création
 * d'un ticket n'exigeait que le jeton de l'utilisateur — celui avec lequel
 * n8n agit, mais que l'utilisateur détient aussi : n'importe qui pouvait
 * écrire « l'agent m'a promis un remboursement ». Désormais `ecritParAgent`
 * n'est vrai que si la clé d'agent a été présentée, et sans elle le serveur
 * ne conserve ni réponse ni outils. Une demande directe porte un badge qui le
 * dit ; l'écran n'affirme toujours que ce que le serveur garantit.
 *
 * LES OUTILS CONSULTÉS SONT AFFICHÉS, PAS LEURS RÉSULTATS — le ticket ne les
 * enregistre pas. Un statut 403 ou 404 dit à l'administrateur que l'agent
 * n'a pas pu voir quelque chose ; ce qu'il y avait à voir, il le vérifie
 * lui-même, avec ses propres droits.
 */
function DossierTicket({ ticket, onDecision, onBrouillon, onEnvoyer, enCours }) {
  const [decision, setDecision] = useState('');
  const { auteur } = ticket;

  // Aligné sur le validateur serveur : entre 3 et 2000 caractères.
  const decisionValide = decision.trim().length >= 3;

  /*
   * LE BROUILLON DU COURRIEL, ET L'ÉCART ENTRE L'ÉCRAN ET LA BASE.
   *
   * `enregistre` est ce que le serveur détient ; `brouillon` est ce qui est
   * affiché. L'envoi expédie le PREMIER — c'est ce qui garantit qu'un texte
   * relu est bien celui qui part. Tant que les deux diffèrent, envoyer
   * expédierait autre chose que ce qu'on a sous les yeux : le bouton reste
   * donc fermé, et l'écran dit pourquoi.
   *
   * L'état initial vient du dossier : un brouillon dicté au bot Telegram
   * s'ouvre ici tel quel, prêt à être corrigé au clavier.
   */
  const enregistre = (ticket.brouillonReponse ?? '').trim();
  const [brouillon, setBrouillon] = useState(ticket.brouillonReponse ?? '');
  const [confirmeEnvoi, setConfirmeEnvoi] = useState(false);

  const brouillonValide = brouillon.trim().length >= 10;
  const aDesModificationsNonEnregistrees = brouillon.trim() !== enregistre;
  const envoiPossible = enregistre.length >= 10 && !aDesModificationsNonEnregistrees;

  return (
    <li className="rounded-carte border border-ardoise-200 bg-white p-5" data-test="dossier-ticket">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {ticket.intention && (
            <Badge variante={ticket.intention === 'decision' ? 'attente' : 'neutre'}>
              {LIBELLES_INTENTION[ticket.intention] || ticket.intention}
            </Badge>
          )}
          {!ticket.ecritParAgent && (
            <span data-test="badge-demande-directe">
              <Badge variante="neutre">Demande directe, sans agent</Badge>
            </span>
          )}
          {ticket.statut === 'clos' && <Badge variante="succes">Instruit</Badge>}
          {ticket.statut === 'resolu' && <Badge variante="marque">Non escaladé</Badge>}
        </div>

        <p className="text-xs text-ardoise-400">Posée le {dateHeure(ticket.createdAt)}</p>
      </div>

      {ticket.motifEscalade && (
        <p className="mt-3 text-sm font-semibold text-alerte">
          Remonté : {LIBELLES_ESCALADE[ticket.motifEscalade] || ticket.motifEscalade}
        </p>
      )}

      {/* La question entière : bornée côté serveur, la couper obligerait à
          ouvrir la base pour en lire la fin — même règle que les précisions
          d'un signalement. */}
      <blockquote className="mt-3 rounded-lg border-l-4 border-marque-300 bg-ardoise-50 px-3 py-2 text-sm leading-relaxed text-ardoise-800">
        {ticket.question}
      </blockquote>

      {ticket.origine && (
        <p className="mt-1.5 text-xs text-ardoise-500">
          Posée depuis <code className="rounded bg-ardoise-100 px-1 py-0.5">{ticket.origine}</code>
        </p>
      )}

      {ticket.reponse && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ardoise-400">
            {/* Sans attestation, une réponse ne peut venir que d'un ticket
                antérieur à la clé d'agent : elle est dite non authentifiée. */}
            {ticket.ecritParAgent ? 'Réponse de l’agent' : 'Réponse non authentifiée'}
          </p>
          <p className="whitespace-pre-wrap text-sm text-ardoise-700">{ticket.reponse}</p>
        </div>
      )}

      {ticket.outils?.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ardoise-400">
            {ticket.ecritParAgent ? 'Outils consultés par l’agent' : 'Outils déclarés, non authentifiés'}
          </p>
          <ul className="space-y-0.5 text-xs">
            {ticket.outils.map((appel, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-ardoise-100 px-1 py-0.5 text-ardoise-700">
                  {appel.outil}
                </code>
                {appel.statut != null && (
                  <span
                    className={
                      appel.statut >= 400 ? 'font-semibold text-erreur' : 'text-ardoise-500'
                    }
                  >
                    {appel.statut}
                  </span>
                )}
                {appel.dureeMs != null && (
                  <span className="text-ardoise-400">{appel.dureeMs} ms</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2.5 border-t border-ardoise-100 pt-4">
        <Avatar utilisateur={auteur} taille="sm" />
        <div className="min-w-0">
          <Link
            to={`/profile/${auteur?.pseudo}`}
            className="block truncate text-sm font-bold text-ardoise-900 hover:text-marque-600 hover:underline"
          >
            {auteur?.prenom} {auteur?.nom}
          </Link>
          <span className="block truncate text-xs text-ardoise-500">
            @{auteur?.pseudo} · {LIBELLES_ROLE[ticket.roleAuteur] || ticket.roleAuteur}
          </span>
        </div>
      </div>

      {/* Historique, pour les dossiers déjà instruits */}
      {ticket.traiteLe && (
        <p className="mt-3 text-xs text-ardoise-500">
          Instruit le {dateHeure(ticket.traiteLe)}
          {ticket.traitePar?.pseudo && ` par @${ticket.traitePar.pseudo}`}
        </p>
      )}

      {ticket.decision && (
        <p className="mt-2 whitespace-pre-wrap rounded-lg bg-ardoise-50 p-2 text-xs text-ardoise-700">
          Décision : {ticket.decision}
        </p>
      )}

      {/* Réponse déjà partie : on la montre, et on dit par quel canal */}
      {ticket.reponseEnvoyeeLe && (
        <div
          className="mt-3 rounded-carte border border-succes/30 bg-succes/5 p-3"
          data-test="reponse-envoyee"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-succes">
            Réponse envoyée par courriel le {dateHeure(ticket.reponseEnvoyeeLe)}
          </p>
          {/*
            LE CANAL EST DIT, PARCE QU'IL CHANGE CE QUI S'EST PASSÉ. En mode
            « boîte », rien n'est parti sur Internet : le courriel a été déposé
            dans un fichier du serveur. Afficher « envoyé » sans le préciser
            laisserait croire que la personne a reçu quelque chose.
          */}
          {ticket.reponseCanal === 'boite' && (
            <p className="mt-1 text-xs text-alerte">
              Aucun envoi réel n’est configuré sur cette installation : le courriel a été déposé
              dans la boîte locale du serveur.
            </p>
          )}
          <p className="mt-2 whitespace-pre-wrap text-sm text-ardoise-700">
            {ticket.reponseExploitant}
          </p>
        </div>
      )}

      {/* Action, uniquement sur les dossiers remontés et non instruits */}
      {ticket.statut === 'escalade' && (
        <div className="mt-4 space-y-3 border-t border-ardoise-100 pt-4">
          {/*
            RÉPONDRE PAR COURRIEL — la même mécanique que sur Telegram, au
            clavier. Le brouillon vit dans le dossier, pas dans cet écran :
            commencer ici et finir sur le téléphone, ou l'inverse, revient au
            même. Rien ne part avant la validation explicite.
          */}
          <div className="space-y-3 rounded-carte bg-ardoise-50 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-ardoise-900">Répondre par courriel</p>
              {auteur?.email && (
                <p className="text-xs text-ardoise-500" data-test="destinataire-courriel">
                  à {auteur.email}
                </p>
              )}
            </div>

            <Textarea
              libelle="Brouillon"
              value={brouillon}
              onChange={(e) => { setBrouillon(e.target.value); setConfirmeEnvoi(false); }}
              maxLength={4000}
              rows={6}
              aide={
                ticket.brouillonLe
                  ? `Brouillon enregistré le ${dateHeure(ticket.brouillonLe)}. Ce texte partira tel quel dans le corps du courriel.`
                  : 'Ce texte partira tel quel dans le corps du courriel, signature comprise.'
              }
              placeholder={'Bonjour Bob,\n\n…\n\nL’équipe CoachConnect'}
              data-test="brouillon-reponse"
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variante="secondaire"
                taille="sm"
                disabled={!brouillonValide || !aDesModificationsNonEnregistrees}
                chargement={enCours === `brouillon:${ticket._id}`}
                onClick={() => onBrouillon(ticket._id, brouillon)}
                data-test="enregistrer-brouillon"
              >
                Enregistrer le brouillon
              </Button>

              {/*
                DEUX CLICS POUR ENVOYER, ET CE N'EST PAS DE LA DÉFIANCE. Un
                courriel parti ne se rattrape pas, et le dossier se clôt dans
                le même geste : la confirmation nomme le destinataire, pour
                qu'une erreur de dossier saute aux yeux avant le départ.
              */}
              {!confirmeEnvoi ? (
                <Button
                  taille="sm"
                  disabled={!envoiPossible}
                  onClick={() => setConfirmeEnvoi(true)}
                  data-test="preparer-envoi"
                >
                  Envoyer la réponse
                </Button>
              ) : (
                <>
                  <Button
                    taille="sm"
                    chargement={enCours === `envoi:${ticket._id}`}
                    onClick={() => onEnvoyer(ticket._id)}
                    data-test="confirmer-envoi"
                  >
                    Confirmer l’envoi à {auteur?.email ?? 'l’auteur'}
                  </Button>
                  <Button
                    variante="secondaire"
                    taille="sm"
                    onClick={() => setConfirmeEnvoi(false)}
                    data-test="annuler-envoi"
                  >
                    Annuler
                  </Button>
                </>
              )}
            </div>

            {aDesModificationsNonEnregistrees && enregistre.length >= 10 && (
              <p className="text-xs font-medium text-alerte" data-test="avis-brouillon-modifie">
                Vos modifications ne sont pas enregistrées. C’est le brouillon enregistré qui
                partirait : enregistrez-le d’abord.
              </p>
            )}
          </div>

          {/*
            CLORE SANS COURRIEL — l'issue d'origine, conservée. Tous les
            dossiers n'appellent pas une réponse écrite : une décision courte,
            lue dans le widget, suffit parfois. Les deux voies closent le
            dossier ; elles ne s'additionnent pas.
          */}
          <Textarea
            libelle="Décision"
            value={decision}
            onChange={(e) => setDecision(e.target.value)}
            maxLength={2000}
            rows={3}
            aide="Ce texte sera lu par l’auteur de la demande : dites ce qui a été fait, ou pourquoi rien ne le sera."
            placeholder="Remboursement accordé, visible sous 5 à 10 jours…"
          />

          {/*
            UN SEUL BOUTON ICI, « CLORE ». L'API accepte aussi « resolu », mais
            pour un dossier remonté, instruire revient à le clore avec une
            décision : deux boutons feraient choisir à l'administrateur entre
            deux statuts dont la nuance ne le concerne pas.
          */}
          <Button
            variante="secondaire"
            taille="sm"
            disabled={!decisionValide}
            chargement={enCours === ticket._id}
            onClick={() => onDecision(ticket._id, decision)}
          >
            Clore sans courriel
          </Button>
        </div>
      )}
    </li>
  );
}

export default function Moderation() {
  const [famille, setFamille] = useState('diplomes');
  const [onglet, setOnglet] = useState('en_attente');
  const [stats, setStats] = useState(null);
  const [enAttenteSupport, setEnAttenteSupport] = useState(0);
  const [chargement, setChargement] = useState(true);
  const [enCours, setEnCours] = useState(null);
  const [message, setMessage] = useState(null);

  /*
   * LES DOSSIERS PORTENT LA CLÉ DE CE QU'ILS REPRÉSENTENT.
   *
   * Changer de famille met à jour `famille` immédiatement, mais la nouvelle
   * liste n'arrive qu'après l'appel réseau. Entre les deux, un rendu montrait
   * la liste « Signalements » remplie avec les DIPLÔMES de l'onglet précédent,
   * passés au composant d'un signalement. Invisible tant qu'aucun diplôme
   * n'attendait ; réel dès qu'un seul attendait.
   *
   * Une liste n'est donc affichée que si sa clé correspond à ce que l'écran
   * demande — sinon c'est le chargement qui s'affiche.
   */
  const [dossiers, setDossiers] = useState({ cle: null, elements: [] });
  const cleCourante = `${famille}:${onglet}`;

  /*
   * UNE RÉPONSE DÉPASSÉE EST IGNORÉE. Deux clics rapides lancent deux appels,
   * et rien ne garantit qu'ils reviennent dans l'ordre : sans ce compteur, le
   * plus lent écraserait le plus récent.
   */
  const derniereRequete = useRef(0);

  const charger = useCallback(async () => {
    const numero = ++derniereRequete.current;
    const cle = `${famille}:${onglet}`;
    setChargement(true);
    try {
      // Les trois appels sont independants : en parallele.
      const [reponseDossiers, reponseStats, reponseSupport] = await Promise.all([
        CHARGEURS[famille](onglet),
        adminApi.stats(),
        adminApi.statsSupport(),
      ]);
      if (numero !== derniereRequete.current) return;
      setDossiers({ cle, elements: reponseDossiers.data.elements });
      setStats(reponseStats.data.stats);
      setEnAttenteSupport(reponseSupport.data.enAttente ?? 0);
    } catch (erreur) {
      if (numero !== derniereRequete.current) return;
      setMessage({ variante: 'erreur', texte: erreur.message });
    } finally {
      if (numero === derniereRequete.current) setChargement(false);
    }
  }, [famille, onglet]);

  const listeAJour = dossiers.cle === cleCourante;

  useEffect(() => {
    charger();
  }, [charger]);

  /**
   * Instruction d'un signalement.
   *
   * FONCTION SEPAREE DE `decider`, malgre la ressemblance. Les deux appellent
   * des routes differentes, avec des valeurs de decision differentes
   * (« verifie »/« refuse » contre « traiter »/« rejeter »). Les fusionner
   * derriere un `if` ferait porter a une seule fonction deux contrats que
   * rien ne relie.
   */
  const deciderSignalement = async (idSignalement, decision, commentaire) => {
    setEnCours(idSignalement);
    setMessage(null);
    try {
      const reponse = await adminApi.deciderSignalement(idSignalement, decision, commentaire);
      setMessage({ variante: 'succes', texte: reponse.data.message });
      await charger();
    } catch (erreur) {
      setMessage({ variante: 'erreur', texte: erreur.message });
    } finally {
      setEnCours(null);
    }
  };

  /**
   * Instruction d'un ticket de support.
   *
   * UN 409 RECHARGE LA FILE. Il signifie qu'un autre administrateur a instruit
   * ce dossier entre l'affichage et le clic : la carte à l'écran est périmée,
   * et la laisser en place inviterait à recommencer. Le serveur a refusé
   * d'écraser sa décision ; l'écran doit maintenant la montrer.
   */
  const trancherTicket = async (idTicket, decision) => {
    setEnCours(idTicket);
    setMessage(null);
    try {
      const reponse = await adminApi.trancherTicket(idTicket, decision);
      setMessage({ variante: 'succes', texte: reponse.data.message });
      await charger();
    } catch (erreur) {
      setMessage({ variante: 'erreur', texte: erreur.message });
      if (erreur.statut === 409) await charger();
    } finally {
      setEnCours(null);
    }
  };

  /**
   * Le brouillon du courriel, enregistré sans partir.
   *
   * LA FILE N'EST PAS RECHARGÉE, et c'est délibéré : l'administrateur est en
   * train d'écrire, et relire la file remplacerait les cartes — donc les
   * champs — au milieu d'une phrase. Seul le dossier concerné est rafraîchi,
   * avec ce que le serveur a réellement retenu.
   */
  const enregistrerBrouillon = async (idTicket, texte) => {
    setEnCours(`brouillon:${idTicket}`);
    setMessage(null);
    try {
      const reponse = await adminApi.enregistrerBrouillon(idTicket, texte);
      setDossiers((etat) => ({
        ...etat,
        elements: etat.elements.map((t) => (t._id === idTicket ? { ...t, ...reponse.data.dossier } : t)),
      }));
      setMessage({ variante: 'succes', texte: 'Brouillon enregistré. Rien n’est encore parti.' });
    } catch (erreur) {
      setMessage({ variante: 'erreur', texte: erreur.message });
      // 409 : une réponse est partie entre-temps. La carte est périmée.
      if (erreur.statut === 409) await charger();
    } finally {
      setEnCours(null);
    }
  };

  /**
   * Validation : le brouillon en base part, et le dossier se clôt.
   *
   * LA FILE EST RECHARGÉE ICI, elle. Le dossier quitte « À traiter » pour
   * « Instruits » : le laisser à l'écran inviterait à le traiter deux fois.
   */
  const envoyerReponse = async (idTicket) => {
    setEnCours(`envoi:${idTicket}`);
    setMessage(null);
    try {
      const reponse = await adminApi.envoyerReponse(idTicket);
      setMessage({
        variante: 'succes',
        texte:
          reponse.data.canal === 'boite'
            ? 'Dossier clos. Aucun envoi réel n’est configuré : le courriel a été déposé dans la boîte locale.'
            : 'Réponse envoyée, dossier clos.',
      });
      await charger();
    } catch (erreur) {
      setMessage({ variante: 'erreur', texte: erreur.message });
      if (erreur.statut === 409) await charger();
    } finally {
      setEnCours(null);
    }
  };

  const decider = async (idCoach, decision, motif) => {
    setEnCours(idCoach);
    setMessage(null);
    try {
      const reponse = await adminApi.deciderDiplome(idCoach, decision, motif);
      setMessage({ variante: 'succes', texte: reponse.data.message });
      await charger(); // rechargement depuis le serveur, pas de mise a jour locale
    } catch (erreur) {
      setMessage({ variante: 'erreur', texte: erreur.message });
    } finally {
      setEnCours(null);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ardoise-900">Modération</h1>

      {/* ---------- Tableau de bord ---------- */}
      <section className="rounded-carte border border-ardoise-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-bold text-ardoise-900">Plateforme</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Indicateur libelle="Membres" valeur={stats?.total} />
          <Indicateur libelle="Coachs" valeur={stats?.coachs} />
          <Indicateur libelle="Certifies" valeur={stats?.coachsCertifies} />
          <Indicateur libelle="A traiter" valeur={stats?.diplomesEnAttente} accent />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Indicateur libelle="Sportifs" valeur={stats?.utilisateurs} />
          <Indicateur libelle="Refusés" valeur={stats?.diplomesRefuses} />
          <Indicateur libelle="Désactivés" valeur={stats?.comptesDesactives} />
          <Indicateur
            libelle="Signalements"
            valeur={stats?.signalementsOuverts}
            accent={stats?.signalementsOuverts > 0}
          />
        </div>
      </section>

      {message && <Alert variante={message.variante}>{message.texte}</Alert>}

      {/* ---------- Familles ---------- */}
      {/*
        CHANGER DE FAMILLE REINITIALISE L'ONGLET. Les statuts n'ont pas les
        memes noms d'une famille a l'autre (« en_attente », « ouvert »,
        « escalade ») :
        conserver l'onglet courant demanderait au serveur un statut qui
        n'existe pas, et la liste reviendrait vide sans explication.
      */}
      <div className="flex gap-2 border-b border-ardoise-200">
        {FAMILLES.map((f) => (
          <button
            key={f.cle}
            onClick={() => {
              setFamille(f.cle);
              setOnglet(ONGLETS[f.cle][0].cle);
              setMessage(null);
            }}
            aria-pressed={famille === f.cle}
            data-test={`famille-${f.cle}`}
            className={`-mb-px cursor-pointer border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
              famille === f.cle
                ? 'border-marque-500 text-marque-600'
                : 'border-transparent text-ardoise-500 hover:text-ardoise-800'
            }`}
          >
            {f.libelle}
            {f.cle === 'signalements' && stats?.signalementsOuverts > 0 && (
              <span className="ml-2 rounded-full bg-erreur px-1.5 py-0.5 text-xs font-bold text-white">
                {stats.signalementsOuverts}
              </span>
            )}
            {f.cle === 'support' && enAttenteSupport > 0 && (
              <span
                className="ml-2 rounded-full bg-erreur px-1.5 py-0.5 text-xs font-bold text-white"
                data-test="compteur-support"
              >
                {enAttenteSupport}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ---------- Onglets ---------- */}
      <div className="flex gap-1 rounded-xl border border-ardoise-200 bg-white p-1">
        {ONGLETS[famille].map((o) => (
          <button
            key={o.cle}
            onClick={() => setOnglet(o.cle)}
            aria-pressed={onglet === o.cle}
            className={`flex-1 cursor-pointer rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              onglet === o.cle
                ? 'bg-marque-500 text-white'
                : 'text-ardoise-600 hover:bg-ardoise-50'
            }`}
          >
            {o.libelle}
          </button>
        ))}
      </div>

      {/* ---------- Dossiers ---------- */}
      {chargement || !listeAJour ? (
        <div className="flex justify-center py-16">
          <Spinner taille="lg" className="text-marque-500" />
        </div>
      ) : dossiers.elements.length === 0 ? (
        <div
          className="rounded-carte border border-dashed border-ardoise-300 p-10 text-center"
          data-test="liste-vide"
        >
          <p className="text-sm text-ardoise-500">
            {ONGLETS_EN_ATTENTE.includes(onglet)
              ? 'Aucun dossier en attente. Tout est a jour.'
              : 'Aucun dossier dans cette categorie.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-3" data-test={`liste-${famille}`}>
          {dossiers.elements.map((dossier) => {
            if (famille === 'diplomes') {
              return (
                <DossierCoach
                  key={dossier._id}
                  coach={dossier}
                  onDecision={decider}
                  enCours={enCours}
                />
              );
            }
            if (famille === 'signalements') {
              return (
                <DossierSignalement
                  key={dossier._id}
                  signalement={dossier}
                  onDecision={deciderSignalement}
                  enCours={enCours}
                />
              );
            }
            return (
              <DossierTicket
                key={dossier._id}
                ticket={dossier}
                onDecision={trancherTicket}
                onBrouillon={enregistrerBrouillon}
                onEnvoyer={envoyerReponse}
                enCours={enCours}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
