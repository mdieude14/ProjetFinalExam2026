import { Link } from 'react-router-dom';

import Avatar from '@/components/ui/Avatar';
import Badge from '@/components/ui/Badge';
import { formaterPlage, delaiAvant } from '@/utils/dates';
import { formaterDistance } from '@/utils/distance';

/**
 * Carte d'un evenement dans une liste.
 *
 * CE QUE LA CARTE DOIT REPONDRE SANS QU'ON L'OUVRE : quand, ou, reste-t-il
 * de la place. Ce sont les trois questions qui decident d'y aller, et les
 * seules qui meritent d'occuper une liste. Le reste — description, affiche en
 * grand, participants — attend la fiche detaillee.
 *
 * L'ETAT EST DIT PAR UN MOT, JAMAIS PAR LA SEULE COULEUR. « Complet »,
 * « Annulé », « Réservé aux abonnés » : une pastille grise sans libelle ne
 * dirait rien a un utilisateur daltonien ni a un lecteur d'ecran.
 */

/** Pastille d'etat, ou `null` quand l'evenement est simplement ouvert. */
function EtatEvenement({ evenement }) {
  if (evenement.statut === 'annule') {
    return <Badge variante="erreur">Annulé</Badge>;
  }

  if (evenement.estPasse) {
    return <Badge variante="neutre">Terminé</Badge>;
  }

  if (evenement.estComplet) {
    return <Badge variante="attente">Complet</Badge>;
  }

  return null;
}

/**
 * Places restantes, formulees selon ce qui est reellement connu.
 *
 * SANS CAPACITE, ON ANNONCE LE NOMBRE D'INSCRITS, PAS « PLACES ILLIMITEES ».
 * Le second est vrai mais inutile : ce qui renseigne, c'est de savoir si l'on
 * sera trois ou quarante.
 */
function Places({ evenement }) {
  if (evenement.statut === 'annule') return null;

  if (evenement.capaciteMax === null) {
    return (
      <span className="text-ardoise-600">
        {evenement.inscritsCount} inscrit{evenement.inscritsCount > 1 ? 's' : ''}
      </span>
    );
  }

  if (evenement.estComplet) {
    return <span className="font-medium text-ardoise-500">Plus de place</span>;
  }

  // Les dernieres places sont signalees : c'est l'information qui pousse a
  // decider maintenant plutot que « plus tard ».
  const peu = evenement.placesRestantes <= 3;

  return (
    <span className={peu ? 'font-semibold text-marque-600' : 'text-ardoise-600'}>
      {evenement.placesRestantes} place{evenement.placesRestantes > 1 ? 's' : ''} sur{' '}
      {evenement.capaciteMax}
    </span>
  );
}

export default function EventCard({ evenement, actif = false, surSurvol }) {
  const organisateur = evenement.organisateur;
  const nomOrganisateur =
    organisateur?.prenom ? `${organisateur.prenom} ${organisateur.nom}` : organisateur?.pseudo;

  const delai = evenement.statut === 'annule' ? null : delaiAvant(evenement.dateDebut);

  return (
    <article
      onMouseEnter={() => surSurvol?.(evenement)}
      className={`overflow-hidden rounded-carte border bg-white transition-colors ${
        actif ? 'border-marque-400 bg-marque-50' : 'border-ardoise-200'
      }`}
    >
      <Link to={`/evenements/${evenement._id}`} className="block">
        {evenement.image?.url && (
          <img
            src={evenement.image.url}
            /*
             * ALT VIDE, ET C'EST LE BON CHOIX ICI — contrairement au media
             * d'une publication. Le titre de l'evenement est annonce juste
             * en dessous, dans le meme lien : decrire l'affiche ferait
             * entendre deux fois la meme information.
             */
            alt=""
            loading="lazy"
            className="h-32 w-full object-cover sm:h-40"
          />
        )}

        <div className="p-3.5">
          <div className="flex items-start justify-between gap-3">
            <h3 className="min-w-0 font-semibold text-ardoise-900">{evenement.titre}</h3>
            <div className="flex shrink-0 items-center gap-1.5">
              {evenement.type === 'prive' && <Badge variante="marque">Premium</Badge>}
              <EtatEvenement evenement={evenement} />
            </div>
          </div>

          <p className="mt-1 text-sm text-ardoise-700">
            {formaterPlage(evenement.dateDebut, evenement.dateFin)}
            {delai && <span className="text-ardoise-400"> · {delai}</span>}
          </p>

          <p className="mt-0.5 truncate text-sm text-ardoise-500">
            {/* L'adresse n'est presente que si le visiteur y a droit ; sinon
                la ville seule, ce qui suffit a situer sans tout devoiler. */}
            {evenement.lieu?.adresse ? `${evenement.lieu.adresse}, ` : ''}
            {evenement.lieu?.ville}
            {evenement.distanceM !== undefined &&
              ` · à ${formaterDistance(evenement.distanceM)}`}
          </p>

          {evenement.detailsVerrouilles && (
            <p className="mt-1 text-xs text-marque-600">
              Adresse exacte réservée aux abonnés de ce coach
            </p>
          )}

          <div className="mt-2.5 flex items-center justify-between gap-3 text-xs">
            <span className="flex min-w-0 items-center gap-1.5 text-ardoise-500">
              {organisateur && <Avatar utilisateur={organisateur} taille="xs" />}
              <span className="truncate">{nomOrganisateur}</span>
              {organisateur?.estCertifie && (
                <span className="shrink-0 text-marque-600" title="Coach certifié">
                  ✓
                </span>
              )}
            </span>

            <span className="shrink-0">
              {evenement.sport && (
                <span className="mr-2 text-ardoise-400">{evenement.sport}</span>
              )}
              <Places evenement={evenement} />
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}
