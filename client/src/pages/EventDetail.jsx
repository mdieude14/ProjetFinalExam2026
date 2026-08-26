import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';

import eventApi from '@/api/event.api';
import useAuth from '@/hooks/useAuth';
import CarteEvenements from '@/components/map/CarteEvenements';
import { formaterPlage, delaiAvant, versChampLocal, versISO } from '@/utils/dates';
import { traiterErreurApi } from '@/utils/erreurs';
import Avatar from '@/components/ui/Avatar';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';

/**
 * Fiche d'un événement — /evenements/:id
 *
 * TROIS LECTURES DU MÊME ÉCRAN, SELON QUI REGARDE :
 *
 *   un visiteur       ce qui se passe, où, et s'il reste de la place
 *   un inscrit        sa place, et de quoi se désister
 *   l'organisateur    la liste de ses participants, et de quoi corriger
 *                     ou annuler
 *
 * C'EST LE SERVEUR QUI TRANCHE, PAS CET ÉCRAN. `participants` n'arrive dans
 * la réponse que si l'appelant est l'organisateur ou un administrateur ;
 * l'adresse exacte d'un événement réservé n'arrive qu'aux abonnés. Le front
 * affiche ce qu'il a reçu — il ne masque rien qu'il aurait quand même
 * téléchargé, ce qui ne protégerait de personne sachant ouvrir un onglet
 * réseau.
 */

/** Un participant dans la liste réservée à l'organisateur. */
function Participant({ inscription }) {
  const personne = inscription.utilisateur;
  if (!personne) return null;

  return (
    <li className="flex items-start gap-3 border-b border-ardoise-100 py-2.5 last:border-0">
      <Link to={`/profile/${personne.pseudo}`} className="shrink-0">
        <Avatar utilisateur={personne} taille="sm" />
      </Link>

      <div className="min-w-0 flex-1">
        <Link
          to={`/profile/${personne.pseudo}`}
          className="text-sm font-semibold text-ardoise-900 hover:underline"
        >
          {personne.prenom ? `${personne.prenom} ${personne.nom}` : personne.pseudo}
        </Link>
        <p className="truncate text-xs text-ardoise-400">@{personne.pseudo}</p>

        {/* Le mot laissé à l'inscription : contrainte, niveau, question. */}
        {inscription.message && (
          <p className="mt-1 text-xs text-ardoise-600">« {inscription.message} »</p>
        )}
      </div>
    </li>
  );
}

export default function EventDetail() {
  const { id } = useParams();
  const { utilisateur } = useAuth();

  const [evenement, setEvenement] = useState(null);
  const [monInscription, setMonInscription] = useState(null);
  const [participants, setParticipants] = useState(null);

  const [chargement, setChargement] = useState(true);
  const [action, setAction] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [message, setMessage] = useState(null);

  const [motInscription, setMotInscription] = useState('');
  const [annulationOuverte, setAnnulationOuverte] = useState(false);
  const [motifAnnulation, setMotifAnnulation] = useState('');
  const [editionOuverte, setEditionOuverte] = useState(false);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      const reponse = await eventApi.detail(id);
      setEvenement(reponse.data.evenement);
      setMonInscription(reponse.data.monInscription ?? null);
      setParticipants(reponse.data.participants ?? null);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setChargement(false);
    }
  }, [id]);

  useEffect(() => {
    charger();
  }, [charger]);

  if (chargement) return <Spinner className="mx-auto my-12" />;

  if (!evenement) {
    return (
      <div className="space-y-3">
        <Alert variante="erreur">{erreur || 'Événement introuvable.'}</Alert>
        <Link to="/evenements" className="text-sm font-semibold text-marque-600 hover:underline">
          ← Retour aux événements
        </Link>
      </div>
    );
  }

  const organisateur = evenement.organisateur;
  const estOrganisateur =
    utilisateur && String(utilisateur._id) === String(organisateur?._id || organisateur);
  const estInscrit = monInscription?.statut === 'inscrit';

  /* ----------------------------- Actions ----------------------------- */

  const sInscrire = async () => {
    setAction(true);
    setErreur(null);
    try {
      await eventApi.sInscrire(id, motInscription || undefined);
      setMotInscription('');
      setMessage({ variante: 'succes', texte: 'Votre place est réservée.' });
      // On relit la fiche entière plutôt que de bricoler le compteur
      // localement : d'autres inscriptions ont pu tomber entre-temps, et un
      // compteur inventé côté client mentirait sur les places restantes.
      await charger();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setAction(false);
    }
  };

  const seDesinscrire = async () => {
    setAction(true);
    setErreur(null);
    try {
      await eventApi.seDesinscrire(id);
      setMessage({ variante: 'info', texte: 'Votre place a été libérée.' });
      await charger();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setAction(false);
    }
  };

  const annuler = async () => {
    setAction(true);
    setErreur(null);
    try {
      await eventApi.annuler(id, motifAnnulation || undefined);
      setAnnulationOuverte(false);
      setMessage({
        variante: 'alerte',
        texte: 'Événement annulé. Les inscrits en sont informés sur cette page.',
      });
      await charger();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setAction(false);
    }
  };

  /* ------------------------- Bouton d'inscription ------------------------- */

  /**
   * UNE FONCTION QUI REND DU BALISAGE, PAS UN COMPOSANT — la distinction est
   * invisible à la lecture et pourtant décisive ici.
   *
   * Déclaré à l'intérieur du rendu, un composant reçoit une identité neuve à
   * chaque passage : React démonte l'ancien et monte le nouveau. Le champ
   * « un mot pour l'organisateur » perdrait donc le focus à CHAQUE frappe,
   * puisque chaque frappe met à jour l'état du parent. Appelée comme une
   * simple fonction, elle produit les mêmes éléments sans créer de type de
   * composant, et le champ reste monté.
   */
  function rendreParticipation() {
    if (estOrganisateur) {
      return (
        <p className="text-sm text-ardoise-500">
          Vous organisez cet événement : vous y êtes déjà attendu.
        </p>
      );
    }

    if (evenement.statut === 'annule') {
      return <p className="text-sm text-erreur">Cet événement a été annulé.</p>;
    }

    if (evenement.estPasse) {
      return <p className="text-sm text-ardoise-500">Cet événement est terminé.</p>;
    }

    if (estInscrit) {
      return (
        <div className="space-y-2">
          <Alert variante="succes">Vous êtes inscrit à cet événement.</Alert>
          <Button variante="secondaire" chargement={action} onClick={seDesinscrire}>
            Me désinscrire
          </Button>
        </div>
      );
    }

    /*
     * ÉVÉNEMENT RÉSERVÉ ET VISITEUR NON ABONNÉ.
     * `detailsVerrouilles` est le signal explicite du serveur. On explique ce
     * qui manque et on mène à l'abonnement, plutôt que d'afficher un bouton
     * qui répondrait 403 : un refus sans explication ressemble à une panne.
     */
    if (evenement.type === 'prive' && evenement.detailsVerrouilles) {
      return (
        <div className="space-y-2">
          <Alert variante="info">
            Cet événement est réservé aux abonnés premium de ce coach.
          </Alert>
          {organisateur?.pseudo && (
            <Link to={`/profile/${organisateur.pseudo}`}>
              <Button>Voir l’offre de {organisateur.prenom || organisateur.pseudo}</Button>
            </Link>
          )}
        </div>
      );
    }

    if (evenement.estComplet) {
      return (
        <Alert variante="alerte">
          Cet événement est complet. Une place peut se libérer si quelqu&apos;un
          se désiste.
        </Alert>
      );
    }

    return (
      <div className="space-y-2">
        <Textarea
          libelle="Un mot pour l’organisateur (facultatif)"
          value={motInscription}
          onChange={(e) => setMotInscription(e.target.value)}
          maxLength={300}
          rows={2}
          placeholder="Niveau, contrainte, question…"
        />
        <Button chargement={action} onClick={sInscrire}>
          Je participe
        </Button>
      </div>
    );
  }

  /* -------------------------------- Rendu -------------------------------- */

  const delai = evenement.statut === 'annule' ? null : delaiAvant(evenement.dateDebut);

  return (
    <div className="space-y-4">
      <Link to="/evenements" className="text-sm text-ardoise-500 hover:underline">
        ← Tous les événements
      </Link>

      {message && <Alert variante={message.variante}>{message.texte}</Alert>}
      {erreur && <Alert variante="erreur">{erreur}</Alert>}

      <article className="overflow-hidden rounded-carte border border-ardoise-200 bg-white">
        {evenement.image?.url && (
          <img
            src={evenement.image.url}
            alt=""
            className="h-48 w-full object-cover sm:h-64"
          />
        )}

        <div className="space-y-4 p-4 sm:p-6">
          <header className="space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="text-2xl font-bold text-ardoise-900">{evenement.titre}</h1>

              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {evenement.type === 'prive' && <Badge variante="marque">Premium</Badge>}
                {evenement.statut === 'annule' && <Badge variante="erreur">Annulé</Badge>}
                {evenement.estPasse && <Badge variante="neutre">Terminé</Badge>}
                {evenement.estComplet && evenement.statut !== 'annule' && (
                  <Badge variante="attente">Complet</Badge>
                )}
              </div>
            </div>

            {organisateur?.pseudo && (
              <Link
                to={`/profile/${organisateur.pseudo}`}
                className="inline-flex items-center gap-2 text-sm text-ardoise-600 hover:underline"
              >
                <Avatar utilisateur={organisateur} taille="xs" />
                <span>
                  {organisateur.prenom
                    ? `${organisateur.prenom} ${organisateur.nom}`
                    : organisateur.pseudo}
                </span>
                {organisateur.estCertifie && (
                  <span className="text-marque-600" title="Coach certifié">
                    ✓
                  </span>
                )}
              </Link>
            )}
          </header>

          {/*
            L'ANNULATION EST DITE EN HAUT, PAS EN NOTE DE BAS DE PAGE.
            Un inscrit qui ouvre la fiche doit apprendre l'annulation avant
            de relire l'horaire d'un rendez-vous qui n'aura pas lieu.
          */}
          {evenement.statut === 'annule' && (
            <Alert variante="erreur" titre="Événement annulé">
              {evenement.motifAnnulation || 'Aucun motif n’a été précisé.'}
            </Alert>
          )}

          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-medium text-ardoise-500">Quand</dt>
              <dd className="text-ardoise-900">
                {formaterPlage(evenement.dateDebut, evenement.dateFin)}
                {delai && <span className="text-ardoise-400"> · {delai}</span>}
              </dd>
            </div>

            <div>
              <dt className="font-medium text-ardoise-500">Où</dt>
              <dd className="text-ardoise-900">
                {evenement.lieu?.adresse && <span>{evenement.lieu.adresse}<br /></span>}
                {evenement.lieu?.codePostal} {evenement.lieu?.ville}
                {evenement.detailsVerrouilles && (
                  <span className="mt-0.5 block text-xs text-marque-600">
                    Adresse exacte réservée aux abonnés
                  </span>
                )}
              </dd>
            </div>

            {evenement.sport && (
              <div>
                <dt className="font-medium text-ardoise-500">Discipline</dt>
                <dd className="text-ardoise-900">{evenement.sport}</dd>
              </div>
            )}

            <div>
              <dt className="font-medium text-ardoise-500">Participants</dt>
              <dd className="text-ardoise-900">
                {evenement.capaciteMax === null
                  ? `${evenement.inscritsCount} inscrit${evenement.inscritsCount > 1 ? 's' : ''} · sans limite`
                  : `${evenement.inscritsCount} / ${evenement.capaciteMax}` +
                    (evenement.estComplet
                      ? ' · complet'
                      : ` · ${evenement.placesRestantes} place${
                          evenement.placesRestantes > 1 ? 's' : ''
                        } restante${evenement.placesRestantes > 1 ? 's' : ''}`)}
              </dd>
            </div>
          </dl>

          {evenement.description && (
            <p className="whitespace-pre-line text-sm text-ardoise-700">
              {evenement.description}
            </p>
          )}

          <div className="border-t border-ardoise-100 pt-4">
            {rendreParticipation()}
          </div>
        </div>
      </article>

      {/* --------------------------- Situation --------------------------- */}
      {evenement.lieu?.localisation?.coordinates && (
        <CarteEvenements
          centre={{
            lng: evenement.lieu.localisation.coordinates[0],
            lat: evenement.lieu.localisation.coordinates[1],
          }}
          rayonM={2000}
          evenements={[evenement]}
          hauteur="40vh"
        />
      )}

      {/* ------------------- Réservé à l'organisateur ------------------- */}
      {estOrganisateur && (
        <section className="rounded-carte border border-ardoise-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-bold text-ardoise-900">
              Participants{participants ? ` (${participants.length})` : ''}
            </h2>

            {evenement.statut !== 'annule' && (
              <div className="flex gap-2">
                <Button
                  variante="secondaire"
                  taille="sm"
                  onClick={() => setEditionOuverte(true)}
                >
                  Modifier
                </Button>
                <Button
                  variante="danger"
                  taille="sm"
                  onClick={() => setAnnulationOuverte(true)}
                >
                  Annuler l’événement
                </Button>
              </div>
            )}
          </div>

          {/*
            La liste ne quitte jamais le cercle de l'organisateur : elle
            révèle qui pratique quoi, où et quand — ce qu'aucun inscrit n'a
            accepté de rendre public en s'inscrivant. Le serveur ne l'envoie
            qu'à lui, cet écran ne fait que l'afficher.
          */}
          {participants?.length ? (
            <ul className="mt-3">
              {participants.map((inscription) => (
                <Participant key={inscription._id} inscription={inscription} />
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-ardoise-500">
              Personne ne s&apos;est encore inscrit.
            </p>
          )}
        </section>
      )}

      {/* -------------------------- Annulation -------------------------- */}
      <Modal
        ouvert={annulationOuverte}
        onFermer={() => setAnnulationOuverte(false)}
        titre="Annuler cet événement"
        taille="md"
      >
        <div className="space-y-4 p-5">
          {/*
            ANNULER N'EST PAS SUPPRIMER, et il faut le dire ici : c'est le
            moment où l'organisateur se demande ce qu'il advient des inscrits.
          */}
          <Alert variante="alerte">
            L&apos;événement reste visible, avec la mention « annulé » et votre
            motif.{' '}
            {evenement.inscritsCount > 0 &&
              (evenement.inscritsCount === 1
                ? '1 personne inscrite le constatera sur cette page.'
                : `${evenement.inscritsCount} personnes inscrites le constateront sur cette page.`)}
          </Alert>

          <Textarea
            libelle="Motif (facultatif, mais lu par les inscrits)"
            value={motifAnnulation}
            onChange={(e) => setMotifAnnulation(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Météo, blessure, nombre d’inscrits insuffisant…"
          />

          <div className="flex justify-end gap-2">
            <Button variante="secondaire" onClick={() => setAnnulationOuverte(false)}>
              Revenir
            </Button>
            <Button variante="danger" chargement={action} onClick={annuler}>
              Confirmer l’annulation
            </Button>
          </div>
        </div>
      </Modal>

      {/* -------------------------- Modification -------------------------- */}
      <Modal
        ouvert={editionOuverte}
        onFermer={() => setEditionOuverte(false)}
        titre="Modifier l’événement"
        taille="lg"
      >
        <FormulaireEdition
          evenement={evenement}
          surEnregistre={async () => {
            setEditionOuverte(false);
            setMessage({ variante: 'succes', texte: 'Événement mis à jour.' });
            await charger();
          }}
          surAnnuler={() => setEditionOuverte(false)}
        />
      </Modal>
    </div>
  );
}

/**
 * Modification par l'organisateur.
 *
 * L'AFFICHE N'EST PAS MODIFIABLE ICI — et c'est un choix, pas un oubli.
 * La route `PATCH` accepte du JSON, pas du multipart : remplacer l'image
 * supposerait de téléverser la nouvelle, de supprimer l'ancienne chez
 * Cloudinary et de gérer l'échec entre les deux. Cela mérite son propre
 * traitement plutôt qu'un ajout discret dans un formulaire d'édition.
 *
 * ON N'ENVOIE QUE CE QUI A CHANGÉ. Renvoyer tout le formulaire écraserait
 * des champs que l'organisateur n'a pas touchés — et, pour la capacité,
 * déclencherait le refus « des personnes sont déjà inscrites » alors que
 * rien n'a bougé.
 */
function FormulaireEdition({ evenement, surEnregistre, surAnnuler }) {
  const initial = {
    titre: evenement.titre || '',
    description: evenement.description || '',
    sport: evenement.sport || '',
    dateDebut: versChampLocal(evenement.dateDebut),
    dateFin: versChampLocal(evenement.dateFin),
    ville: evenement.lieu?.ville || '',
    adresse: evenement.lieu?.adresse || '',
    capaciteMax: evenement.capaciteMax ?? '',
  };

  const [champs, setChamps] = useState(initial);
  const [erreurs, setErreurs] = useState({});
  const [erreurGlobale, setErreurGlobale] = useState(null);
  const [envoi, setEnvoi] = useState(false);

  const modifier = (nom) => (e) =>
    setChamps((precedents) => ({ ...precedents, [nom]: e.target.value }));

  const enregistrer = async (e) => {
    e.preventDefault();
    setErreurs({});
    setErreurGlobale(null);
    setEnvoi(true);

    const changements = {};
    for (const [nom, valeur] of Object.entries(champs)) {
      if (valeur === initial[nom]) continue;

      if (nom === 'dateDebut' || nom === 'dateFin') changements[nom] = versISO(valeur);
      else if (nom === 'ville' || nom === 'adresse') {
        changements.lieu = { ...(changements.lieu || {}), [nom]: valeur };
      } else if (nom === 'capaciteMax') {
        // Champ vidé = « plus de limite ». `null` le dit explicitement à
        // l'API, là où `''` serait rejeté comme entier invalide.
        changements.capaciteMax = valeur === '' ? null : Number(valeur);
      } else changements[nom] = valeur;
    }

    if (Object.keys(changements).length === 0) {
      setEnvoi(false);
      return surAnnuler?.();
    }

    try {
      await eventApi.modifier(evenement._id, changements);
      await surEnregistre?.();
    } catch (erreur) {
      const { parChamp, global } = traiterErreurApi(erreur);
      setErreurs(parChamp);
      setErreurGlobale(global);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <form onSubmit={enregistrer} className="space-y-4 p-5" noValidate>
      {erreurGlobale && <Alert variante="erreur">{erreurGlobale}</Alert>}

      <Input
        libelle="Titre"
        value={champs.titre}
        onChange={modifier('titre')}
        erreur={erreurs.titre}
      />

      <Textarea
        libelle="Description"
        value={champs.description}
        onChange={modifier('description')}
        erreur={erreurs.description}
        maxLength={2000}
        rows={4}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          libelle="Début"
          type="datetime-local"
          value={champs.dateDebut}
          onChange={modifier('dateDebut')}
          erreur={erreurs.dateDebut}
        />
        <Input
          libelle="Fin"
          type="datetime-local"
          value={champs.dateFin}
          onChange={modifier('dateFin')}
          erreur={erreurs.dateFin}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          libelle="Ville"
          value={champs.ville}
          onChange={modifier('ville')}
          erreur={erreurs['lieu.ville']}
        />
        <Input
          libelle="Sport"
          value={champs.sport}
          onChange={modifier('sport')}
          erreur={erreurs.sport}
        />
      </div>

      <Input
        libelle="Adresse du rendez-vous"
        value={champs.adresse}
        onChange={modifier('adresse')}
        erreur={erreurs['lieu.adresse']}
      />

      <Input
        libelle="Nombre de places"
        type="number"
        min="1"
        max="10000"
        value={champs.capaciteMax}
        onChange={modifier('capaciteMax')}
        erreur={erreurs.capaciteMax}
        placeholder="Sans limite"
        aide={`Impossible de descendre sous ${evenement.inscritsCount} inscrit${
          evenement.inscritsCount > 1 ? 's' : ''
        }.`}
      />

      <div className="flex justify-end gap-2">
        <Button type="button" variante="secondaire" onClick={surAnnuler}>
          Annuler
        </Button>
        <Button type="submit" chargement={envoi}>
          Enregistrer
        </Button>
      </div>
    </form>
  );
}
