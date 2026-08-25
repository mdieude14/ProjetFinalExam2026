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

const ONGLETS = [
  { cle: 'en_attente', libelle: 'En attente' },
  { cle: 'verifie', libelle: 'Vérifiés' },
  { cle: 'refuse', libelle: 'Refusés' },
];

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

export default function Moderation() {
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
      const [reponseDiplomes, reponseStats] = await Promise.all([
        adminApi.diplomes({ statut: onglet }),
        adminApi.stats(),
      ]);
      setDossiers(reponseDiplomes.data.elements);
      setStats(reponseStats.data.stats);
    } catch (erreur) {
      setMessage({ variante: 'erreur', texte: erreur.message });
    } finally {
      setChargement(false);
    }
  }, [onglet]);

  useEffect(() => {
    charger();
  }, [charger]);

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
          <Indicateur libelle="Inscrits (7 j)" valeur={stats?.inscriptions7j} />
        </div>
      </section>

      {message && <Alert variante={message.variante}>{message.texte}</Alert>}

      {/* ---------- Onglets ---------- */}
      <div className="flex gap-1 rounded-xl border border-ardoise-200 bg-white p-1">
        {ONGLETS.map((o) => (
          <button
            key={o.cle}
            onClick={() => setOnglet(o.cle)}
            aria-pressed={onglet === o.cle}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
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
        <div className="rounded-carte border border-dashed border-ardoise-300 p-10 text-center">
          <p className="text-sm text-ardoise-500">
            {onglet === 'en_attente'
              ? 'Aucun dossier en attente. Tout est a jour.'
              : 'Aucun dossier dans cette categorie.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {dossiers.map((coach) => (
            <DossierCoach
              key={coach._id}
              coach={coach}
              onDecision={decider}
              enCours={enCours}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
