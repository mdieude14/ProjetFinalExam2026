import { useState } from 'react';

import eventApi from '@/api/event.api';
import usePosition from '@/hooks/usePosition';
import { versISO } from '@/utils/dates';
import { traiterErreurApi } from '@/utils/erreurs';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';

/**
 * Formulaire de creation d'un evenement.
 *
 * RESERVE AUX COACHS CERTIFIES — le serveur le verifie, et c'est lui qui fait
 * foi. L'appelant n'affiche ce formulaire qu'aux coachs certifies pour ne pas
 * proposer une action qui finira refusee, mais ce filtre d'interface n'est
 * qu'une politesse : il ne protege rien.
 *
 * LES DATES PASSENT PAR `datetime-local`, QUI TRAVAILLE EN HEURE LOCALE.
 * L'API, elle, attend de l'ISO en UTC. La conversion se fait a l'envoi, dans
 * `versISO()`. L'oublier decale toutes les seances de l'ecart horaire — deux
 * heures en ete, en France — sans le moindre message d'erreur.
 */

/** Dans N heures, arrondi a l'heure, au format attendu par `datetime-local`. */
function dansNHeures(n) {
  const d = new Date(Date.now() + n * 3600000);
  d.setMinutes(0, 0, 0);
  const decalage = d.getTimezoneOffset() * 60000;
  return new Date(d - decalage).toISOString().slice(0, 16);
}

export default function EventForm({ surCree, surAnnuler }) {
  const {
    position,
    erreur: erreurPosition,
    chargement: localisationEnCours,
    demander,
  } = usePosition();

  const [champs, setChamps] = useState({
    titre: '',
    description: '',
    sport: '',
    type: 'public',
    // Pre-remplies a demain : la date de debut doit etre dans le futur, et
    // un formulaire vide invite a saisir une date deja passee, refusee a
    // l'envoi pour une raison que rien n'annoncait.
    dateDebut: dansNHeures(24),
    dateFin: dansNHeures(26),
    ville: '',
    adresse: '',
    codePostal: '',
    capaciteMax: '',
  });

  const [affiche, setAffiche] = useState(null);
  const [apercu, setApercu] = useState(null);
  const [utiliserPosition, setUtiliserPosition] = useState(false);
  const [erreurs, setErreurs] = useState({});
  const [erreurGlobale, setErreurGlobale] = useState(null);
  const [envoi, setEnvoi] = useState(false);

  const modifier = (nom) => (evenement) => {
    const valeur = evenement.target.value;
    setChamps((precedents) => {
      const suivants = { ...precedents, [nom]: valeur };

      /*
       * LA DATE DE FIN SUIT LA DATE DE DEBUT.
       * Reculer le debut au-dela de la fin deja saisie produit un creneau
       * inverse, refuse par le serveur. Plutot que d'attendre le refus, on
       * decale la fin pour conserver la meme duree — c'est ce que
       * l'utilisateur voulait dans l'immense majorite des cas.
       */
      if (nom === 'dateDebut' && precedents.dateFin <= valeur) {
        const duree = new Date(precedents.dateFin) - new Date(precedents.dateDebut);
        const fin = new Date(new Date(valeur).getTime() + (duree > 0 ? duree : 7200000));
        const decalage = fin.getTimezoneOffset() * 60000;
        suivants.dateFin = new Date(fin - decalage).toISOString().slice(0, 16);
      }

      return suivants;
    });
  };

  const choisirAffiche = (evenement) => {
    const fichier = evenement.target.files?.[0];
    if (!fichier) return;

    setAffiche(fichier);

    // `URL.createObjectURL` evite de lire tout le fichier en base64 pour un
    // simple apercu. L'URL precedente est liberee : sans cela, chaque essai
    // laisse un objet en memoire jusqu'au rechargement de la page.
    setApercu((precedent) => {
      if (precedent) URL.revokeObjectURL(precedent);
      return URL.createObjectURL(fichier);
    });
  };

  const soumettre = async (evenement) => {
    evenement.preventDefault();
    setErreurs({});
    setErreurGlobale(null);
    setEnvoi(true);

    try {
      const reponse = await eventApi.creer({
        ...champs,
        dateDebut: versISO(champs.dateDebut),
        dateFin: versISO(champs.dateFin),
        affiche,
        ...(utiliserPosition && position
          ? { longitude: position.lng, latitude: position.lat }
          : {}),
      });

      surCree?.(reponse.data.evenement);
    } catch (e) {
      const { parChamp, global } = traiterErreurApi(e);
      setErreurs(parChamp);
      setErreurGlobale(global);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <form onSubmit={soumettre} className="space-y-4 p-5" noValidate>
      {erreurGlobale && <Alert variante="erreur">{erreurGlobale}</Alert>}

      <Input
        libelle="Titre"
        value={champs.titre}
        onChange={modifier('titre')}
        erreur={erreurs.titre}
        placeholder="Sortie course à pied — 10 km"
        required
      />

      <Textarea
        libelle="Description"
        value={champs.description}
        onChange={modifier('description')}
        erreur={erreurs.description}
        maxLength={2000}
        rows={4}
        aide="Niveau attendu, matériel à prévoir, point de rendez-vous précis."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          libelle="Sport"
          value={champs.sport}
          onChange={modifier('sport')}
          erreur={erreurs.sport}
          placeholder="Course à pied"
        />

        <label className="w-full text-sm">
          <span className="mb-1.5 block font-medium text-ardoise-700">Visibilité</span>
          <select
            value={champs.type}
            onChange={modifier('type')}
            className="w-full rounded-xl border border-ardoise-200 bg-white px-4 py-2.5 text-sm"
          >
            <option value="public">Ouvert à tous</option>
            <option value="prive">Réservé à mes abonnés premium</option>
          </select>
          <span className="mt-1.5 block text-xs text-ardoise-500">
            Un événement réservé reste visible de tous, mais son adresse exacte
            et l&apos;inscription sont limitées aux abonnés.
          </span>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          libelle="Début"
          type="datetime-local"
          value={champs.dateDebut}
          onChange={modifier('dateDebut')}
          erreur={erreurs.dateDebut}
          required
        />

        <Input
          libelle="Fin"
          type="datetime-local"
          value={champs.dateFin}
          onChange={modifier('dateFin')}
          erreur={erreurs.dateFin}
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          libelle="Ville"
          value={champs.ville}
          onChange={modifier('ville')}
          erreur={erreurs['lieu.ville']}
          placeholder="Lyon"
          required
        />

        <Input
          libelle="Code postal"
          value={champs.codePostal}
          onChange={modifier('codePostal')}
          erreur={erreurs['lieu.codePostal']}
          placeholder="69003"
        />
      </div>

      <Input
        libelle="Adresse du rendez-vous"
        value={champs.adresse}
        onChange={modifier('adresse')}
        erreur={erreurs['lieu.adresse']}
        placeholder="Entrée du parc de la Tête d’Or"
      />

      {/* ---------------- Position sur la carte ---------------- */}
      <div className="rounded-xl border border-ardoise-200 p-3.5">
        <p className="text-sm font-medium text-ardoise-700">Position sur la carte</p>
        <p className="mt-0.5 text-xs text-ardoise-500">
          Facultative. Sans elle, l&apos;événement reste listé mais n&apos;apparaît
          pas dans les recherches « autour de moi ».
        </p>

        {position && utiliserPosition ? (
          <p className="mt-2 text-xs text-ardoise-600">
            Position enregistrée : {position.lat.toFixed(4)}, {position.lng.toFixed(4)}{' '}
            <button
              type="button"
              onClick={() => setUtiliserPosition(false)}
              className="ml-1 font-semibold text-marque-600 hover:underline"
            >
              retirer
            </button>
          </p>
        ) : (
          <Button
            type="button"
            variante="secondaire"
            taille="sm"
            className="mt-2"
            chargement={localisationEnCours}
            /*
             * `demander()` ne rend pas de promesse : la position arrive plus
             * tard, par l'etat du hook. On note donc l'INTENTION ici, et le
             * rendu ci-dessus n'affiche la position qu'une fois les deux
             * reunies. L'attendre avec `await` ne donnerait qu'une fausse
             * impression de sequence.
             */
            onClick={() => {
              setUtiliserPosition(true);
              demander();
            }}
          >
            Utiliser ma position actuelle
          </Button>
        )}

        {utiliserPosition && erreurPosition && (
          <p className="mt-2 text-xs text-alerte">
            {erreurPosition.message} L&apos;événement sera créé sans position :
            il restera visible dans la liste et par ville.
          </p>
        )}
      </div>

      {/* ---------------- Capacité ---------------- */}
      <Input
        libelle="Nombre de places"
        type="number"
        min="1"
        max="10000"
        value={champs.capaciteMax}
        onChange={modifier('capaciteMax')}
        erreur={erreurs.capaciteMax}
        placeholder="Sans limite"
        aide="Laissez vide pour ne pas limiter le nombre de participants."
      />

      {/* ---------------- Affiche ---------------- */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ardoise-700">
          Affiche
        </label>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={choisirAffiche}
          className="block w-full text-sm text-ardoise-600 file:mr-3 file:rounded-lg file:border-0 file:bg-ardoise-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-ardoise-700"
        />

        {apercu && (
          <img
            src={apercu}
            alt="Aperçu de l’affiche"
            className="mt-2 h-32 w-full rounded-xl object-cover"
          />
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        {surAnnuler && (
          <Button type="button" variante="secondaire" onClick={surAnnuler}>
            Annuler
          </Button>
        )}
        <Button type="submit" chargement={envoi}>
          Créer l’événement
        </Button>
      </div>
    </form>
  );
}
