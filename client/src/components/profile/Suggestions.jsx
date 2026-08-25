import { useState, useEffect } from 'react';
import followApi from '@/api/follow.api';
import ListeUtilisateurs from './ListeUtilisateurs';
import Spinner from '@/components/ui/Spinner';

/**
 * Bloc de coachs suggérés.
 *
 * Affiché quand le fil d'actualité est vide. Un nouvel inscrit arrive sur un
 * écran sans contenu et sans indication de ce qu'il doit faire : c'est la
 * première cause d'abandon sur un réseau social. Proposer trois coachs de sa
 * ville transforme un cul-de-sac en point de départ.
 *
 * Le composant se retire tout seul s'il n'a rien à proposer — un titre
 * « Coachs à suivre » au-dessus d'une liste vide est pire que rien.
 */
export default function Suggestions({ limite = 5, titre = 'Coachs à suivre' }) {
  const [coachs, setCoachs] = useState([]);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    let annule = false;

    followApi
      .suggestions(limite)
      .then((reponse) => {
        if (!annule) setCoachs(reponse.data.suggestions);
      })
      .catch(() => {
        if (!annule) setCoachs([]);
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });

    return () => {
      annule = true;
    };
  }, [limite]);

  if (chargement) {
    return (
      <section className="rounded-carte border border-ardoise-200 bg-white p-5">
        <div className="flex justify-center py-6">
          <Spinner className="text-marque-500" />
        </div>
      </section>
    );
  }

  if (coachs.length === 0) return null;

  return (
    <section className="rounded-carte border border-ardoise-200 bg-white p-5">
      <h2 className="text-sm font-bold text-ardoise-900">{titre}</h2>
      <p className="mt-0.5 text-xs text-ardoise-500">
        Coachs certifiés, proches de chez vous en priorité.
      </p>

      <div className="mt-2">
        <ListeUtilisateurs utilisateurs={coachs} />
      </div>
    </section>
  );
}
