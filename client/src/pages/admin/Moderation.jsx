import { useState, useEffect, useCallback } from 'react';
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
 * DEUX FAMILLES DE DOSSIERS, PAS UNE LISTE UNIQUE.
 *
 * Un diplôme à vérifier et un compte signalé n'ont ni le même contenu, ni les
 * mêmes issues, ni la même urgence. Les mêler dans une seule file obligerait
 * à lire le type de chaque carte avant de savoir quoi en faire.
 */
const FAMILLES = [
  { cle: 'diplomes', libelle: 'Diplômes' },
  { cle: 'signalements', libelle: 'Signalements' },
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
};

/** Libellés des motifs, alignés sur l'énumération du modèle serveur. */
const LIBELLES_MOTIF = {
  spam: 'Spam ou publicité',
  harcelement: 'Harcèlement ou intimidation',
  contenu_inapproprie: 'Contenu inapproprié',
  usurpation: "Usurpation d'identité",
  fausse_qualification: 'Fausse qualification de coach',
  autre: 'Autre',
};

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

export default function Moderation() {
  const [famille, setFamille] = useState('diplomes');
  const [onglet, setOnglet] = useState('en_attente');
  const [dossiers, setDossiers] = useState([]);
  const [stats, setStats] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [enCours, setEnCours] = useState(null);
  const [message, setMessage] = useState(null);

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      // Les deux appels sont independants : en parallele.
      const [reponseDossiers, reponseStats] = await Promise.all([
        famille === 'diplomes'
          ? adminApi.diplomes({ statut: onglet })
          : adminApi.signalements({ statut: onglet }),
        adminApi.stats(),
      ]);
      setDossiers(reponseDossiers.data.elements);
      setStats(reponseStats.data.stats);
    } catch (erreur) {
      setMessage({ variante: 'erreur', texte: erreur.message });
    } finally {
      setChargement(false);
    }
  }, [famille, onglet]);

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
        memes noms d'un cote et de l'autre (« en_attente » contre « ouvert ») :
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
      {chargement ? (
        <div className="flex justify-center py-16">
          <Spinner taille="lg" className="text-marque-500" />
        </div>
      ) : dossiers.length === 0 ? (
        <div
          className="rounded-carte border border-dashed border-ardoise-300 p-10 text-center"
          data-test="liste-vide"
        >
          <p className="text-sm text-ardoise-500">
            {onglet === 'en_attente' || onglet === 'ouvert'
              ? 'Aucun dossier en attente. Tout est a jour.'
              : 'Aucun dossier dans cette categorie.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-3" data-test={`liste-${famille}`}>
          {dossiers.map((dossier) =>
            famille === 'diplomes' ? (
              <DossierCoach
                key={dossier._id}
                coach={dossier}
                onDecision={decider}
                enCours={enCours}
              />
            ) : (
              <DossierSignalement
                key={dossier._id}
                signalement={dossier}
                onDecision={deciderSignalement}
                enCours={enCours}
              />
            )
          )}
        </ul>
      )}
    </div>
  );
}
