import { useState, useEffect, useCallback, useRef } from 'react';
import storyApi from '@/api/story.api';
import useAuth from '@/hooks/useAuth';
import Avatar from '@/components/ui/Avatar';
import StoryViewer from './StoryViewer';
import CapturePhoto from './CapturePhoto';
import Alert from '@/components/ui/Alert';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';

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
  const [choixOuvert, setChoixOuvert] = useState(false);
  const [cameraOuverte, setCameraOuverte] = useState(false);

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

  /*
   * VOIE UNIQUE DE PUBLICATION.
   * Le fichier importe et la photo prise a la camera arrivent tous deux ici :
   * une seule fonction envoie, gere l'erreur et recharge la barre. Deux
   * chemins d'envoi finiraient par diverger sur la gestion d'erreur.
   */
  const publierFichier = useCallback(
    async (fichier) => {
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
    },
    [charger]
  );

  const surFichierChoisi = (evenement) => {
    const fichier = evenement.target.files?.[0];
    // Le champ est vide avant l'envoi : sans cela, choisir deux fois le meme
    // fichier de suite ne declencherait pas de second `change`.
    evenement.target.value = '';
    publierFichier(fichier);
  };

  /** Le « + » propose les deux sources ; l'avatar ouvre mes stories. */
  const ouvrirAjout = () => {
    setErreur(null);
    setChoixOuvert(true);
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
            onChange={surFichierChoisi}
            className="lecteur-ecran-seulement"
            id="nouvelle-story"
          />

          {/*
            LE « + » EST UN BOUTON A PART, PAS UN ORNEMENT DE L'AVATAR.
            Imbrique dans l'autre bouton il produisait du HTML invalide, et
            surtout il devenait inatteignable des qu'une story existait :
            l'unique bouton ouvrait alors le lecteur, et rien ne permettait
            plus d'en publier une seconde.
          */}
          <div className="relative inline-block">
            <button
              onClick={() =>
                groupeMoi ? setIndexOuvert(groupes.indexOf(groupeMoi)) : ouvrirAjout()
              }
              disabled={envoi}
              className="block"
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
            </button>

            <button
              onClick={ouvrirAjout}
              disabled={envoi}
              data-test="ajouter-story"
              aria-label="Ajouter une story"
              className="absolute bottom-0 right-0 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-2 border-white bg-marque-500 text-sm font-bold leading-none text-white hover:bg-marque-600 disabled:opacity-60"
            >
              {envoi ? '…' : '+'}
            </button>
          </div>

          {/*
            `mx-auto` EST NECESSAIRE, `text-center` NE SUFFIT PAS.
            Le bloc avatar mesure 88 px, ce paragraphe 64 : `text-center`
            centre le texte DANS le paragraphe, mais la boite de 64 px reste
            calee a gauche des 88 px disponibles — soit un decalage de
            (88 - 64) / 2 = 12 px vers la gauche.
          */}
          <p className="mx-auto mt-1 w-16 truncate text-xs text-ardoise-600">Ma story</p>
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

            {/* Meme decalage que « Ma story » : voir le commentaire ci-dessus. */}
            <p className="mx-auto mt-1 w-16 truncate text-xs text-ardoise-600">
              {groupe.auteur.prenom}
            </p>
          </li>
        ))}

        {autres.length === 0 && !groupeMoi && (
          <li className="flex items-center px-2">
            <p className="text-xs text-ardoise-400">
              Aucune story. Suivez des coachs ou des utilisateurs pour en voir apparaitre ici.
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

      {/* ---------- Choix de la source ---------- */}
      <Modal
        ouvert={choixOuvert}
        onFermer={() => setChoixOuvert(false)}
        titre="Nouvelle story"
        taille="sm"
      >
        <div className="flex flex-col gap-3 p-5" data-test="choix-source-story">
          {/*
            Les deux sources sont de rang égal : même variante, aucune n'est
            mise en avant. Blanches au repos, marque au survol.
          */}
          <Button
            pleineLargeur
            variante="choix"
            data-test="source-fichier"
            onClick={() => {
              setChoixOuvert(false);
              champFichier.current?.click();
            }}
          >
            Importer un fichier
          </Button>

          <Button
            pleineLargeur
            variante="choix"
            data-test="source-camera"
            onClick={() => {
              setChoixOuvert(false);
              setCameraOuverte(true);
            }}
          >
            Prendre une photo
          </Button>

          <p className="text-center text-xs text-ardoise-500">
            Photo ou video depuis votre appareil, ou prise de vue immediate.
          </p>
        </div>
      </Modal>

      {/* ---------- Prise de vue ---------- */}
      <CapturePhoto
        ouvert={cameraOuverte}
        onFermer={() => setCameraOuverte(false)}
        onValider={publierFichier}
      />
    </section>
  );
}
