import { useState } from 'react';
import followApi from '@/api/follow.api';
import Button from '@/components/ui/Button';

/**
 * Bouton de suivi — quatre états possibles.
 *
 *   soi         aucun bouton (on ne se suit pas soi-même)
 *   aucune      « Suivre »
 *   en_attente  « Demande envoyée » — cliquer annule la demande
 *   abonne      « Abonné » — cliquer se désabonne
 *
 * MISE À JOUR OPTIMISTE. L'état change avant la réponse du serveur, puis se
 * réaligne sur ce qu'il renvoie. Sur un profil public, le serveur répond
 * « accepte » ; sur un profil privé, « en_attente » — c'est lui qui tranche,
 * pas le front, qui ne connaît pas forcément la visibilité de la cible.
 *
 * Un échec restaure l'état précédent : sans cela, l'interface afficherait
 * « Abonné » alors que rien n'a été enregistré.
 */
export default function BoutonSuivre({
  identifiant,
  relationInitiale = 'aucune',
  onChangement,
  taille = 'sm',
  pleineLargeur = false,
}) {
  const [relation, setRelation] = useState(relationInitiale);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [survol, setSurvol] = useState(false);

  // Le propriétaire du profil ne voit aucun bouton.
  if (relation === 'soi') return null;

  const basculer = async () => {
    const precedente = relation;
    setChargement(true);
    setErreur(null);

    // État provisoire : on suppose l'acceptation, le serveur corrigera s'il
    // s'agit d'un profil privé.
    setRelation(precedente === 'aucune' ? 'abonne' : 'aucune');

    try {
      if (precedente === 'aucune') {
        const reponse = await followApi.suivre(identifiant);
        const nouvelle = reponse.data.relation; // « abonne » ou « en_attente »
        setRelation(nouvelle);
        onChangement?.(nouvelle, precedente);
      } else {
        await followApi.nePlusSuivre(identifiant);
        setRelation('aucune');
        onChangement?.('aucune', precedente);
      }
    } catch (e) {
      setRelation(precedente);
      setErreur(e.message);
    } finally {
      setChargement(false);
    }
  };

  const apparence = {
    aucune: { libelle: 'Suivre', variante: 'principal' },
    // Au survol, on annonce ce qui va se passer plutôt que l'état courant :
    // cliquer sur un bouton marqué « Abonné » sans autre indication laisse
    // craindre l'inverse de ce qu'il fait.
    abonne: {
      libelle: survol ? 'Se désabonner' : 'Abonné',
      variante: survol ? 'danger' : 'secondaire',
    },
    en_attente: {
      libelle: survol ? 'Annuler' : 'Demande envoyée',
      variante: 'secondaire',
    },
  }[relation] || { libelle: 'Suivre', variante: 'principal' };

  return (
    <div className={pleineLargeur ? 'w-full' : ''}>
      <Button
        variante={apparence.variante}
        taille={taille}
        chargement={chargement}
        pleineLargeur={pleineLargeur}
        onClick={basculer}
        onMouseEnter={() => setSurvol(true)}
        onMouseLeave={() => setSurvol(false)}
        // Le libellé change au survol : on fige un nom accessible stable
        // pour que les lecteurs d'écran n'annoncent pas deux choses.
        aria-label={
          relation === 'aucune'
            ? 'Suivre ce profil'
            : relation === 'abonne'
              ? 'Se désabonner de ce profil'
              : 'Annuler la demande de suivi'
        }
      >
        {apparence.libelle}
      </Button>

      {erreur && <p className="mt-1 text-xs text-erreur">{erreur}</p>}
    </div>
  );
}
