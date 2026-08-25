import { useState, useEffect, useCallback, useRef } from 'react';
import storyApi from '@/api/story.api';
import useAuth from '@/hooks/useAuth';
import Avatar from '@/components/ui/Avatar';
import StoryViewer from './StoryViewer';
import Alert from '@/components/ui/Alert';

/**
 * Barre de stories, en tete du fil d'actualite.
 *
 * Une pastille par auteur, pas par story : c'est le fonctionnement
 * d'Instagram, et un coach qui publie huit stories ne doit pas occuper toute
 * la barre.
 *
 * Le cercle colore signale du contenu non vu ; il devient gris une fois
 * toutes les stories de la personne consultees.
 */
export default function StoryBar() {
  const { utilisateur } = useAuth();

  const [groupes, setGroupes] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [indexOuvert, setIndexOuvert] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [envoi, setEnvoi] = useState(false);

  const champFichier = useRef(null);

  const charger = useCallback(async () => {
    try {
      const reponse = await storyApi.barre();
      setGroupes(reponse.data.groupes);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    charger();
  }, [charger]);

  const publier = async (evenement) => {
    const fichier = evenement.target.files?.[0];
    evenement.target.value = '';
    if (!fichier) return;

    setEnvoi(true);
    setErreur(null);
    try {
      await storyApi.creer(fichier);
      await charger();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnvoi(false);
    }
  };

  const groupeMoi = groupes.find((g) => g.estMoi);
  const autres = groupes.filter((g) => !g.estMoi);

  if (chargement) {
    return (
      <div className="flex gap-3 overflow-hidden rounded-carte border border-ardoise-200 bg-white p-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-16 w-16 shrink-0 animate-pulse rounded-full bg-ardoise-100" />
        ))}
      </div>
    );
  }

  return (
    <section className="rounded-carte border border-ardoise-200 bg-white p-4">
      {erreur && (
        <Alert variante="erreur" className="mb-3">
          {erreur}
        </Alert>
      )}

      {/* `overflow-x-auto` permet le defilement horizontal en mobile sans
          jamais faire deborder la page elle-meme. */}
      <ul className="flex gap-4 overflow-x-auto pb-1">
        {/* ---------- Ma story ---------- */}
        <li className="shrink-0 text-center">
          <input
            ref={champFichier}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
            onChange={publier}
            className="lecteur-ecran-seulement"
            id="nouvelle-story"
          />

          <button
            onClick={() =>
              groupeMoi
                ? setIndexOuvert(groupes.indexOf(groupeMoi))
                : champFichier.current?.click()
            }
            disabled={envoi}
            className="relative block"
            aria-label={groupeMoi ? 'Voir ma story' : 'Publier une story'}
          >
            <span
              className={`block rounded-full p-0.5 ${
                groupeMoi && !groupeMoi.toutesVues
                  ? 'bg-linear-to-tr from-marque-500 to-marque-300'
                  : 'bg-ardoise-200'
              }`}
            >
              <span className="block rounded-full bg-white p-0.5">
                <Avatar utilisateur={utilisateur} taille="lg" className="h-14 w-14" />
              </span>
            </span>

            <span className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-marque-500 text-sm font-bold leading-none text-white">
              {envoi ? '…' : '+'}
            </span>
          </button>

          <p className="mt-1 w-16 truncate text-xs text-ardoise-600">Ma story</p>
        </li>

        {/* ---------- Comptes suivis ---------- */}
        {autres.map((groupe) => (
          <li key={groupe.auteur._id} className="shrink-0 text-center">
            <button
              onClick={() => setIndexOuvert(groupes.indexOf(groupe))}
              aria-label={`Stories de ${groupe.auteur.prenom}`}
            >
              <span
                className={`block rounded-full p-0.5 ${
                  groupe.toutesVues
                    ? 'bg-ardoise-200'
                    : 'bg-linear-to-tr from-marque-500 via-marque-400 to-marque-300'
                }`}
              >
                <span className="block rounded-full bg-white p-0.5">
                  <Avatar utilisateur={groupe.auteur} taille="lg" className="h-14 w-14" />
                </span>
              </span>
            </button>

            <p className="mt-1 w-16 truncate text-xs text-ardoise-600">
              {groupe.auteur.prenom}
            </p>
          </li>
        ))}

        {autres.length === 0 && !groupeMoi && (
          <li className="flex items-center px-2">
            <p className="text-xs text-ardoise-400">
              Aucune story. Suivez des coachs pour en voir apparaitre ici.
            </p>
          </li>
        )}
      </ul>

      {indexOuvert !== null && (
        <StoryViewer
          groupes={groupes}
          indexGroupeInitial={indexOuvert}
          onFermer={() => {
            setIndexOuvert(null);
            charger(); // recharge pour actualiser les pastilles « vue »
          }}
        />
      )}
    </section>
  );
}
