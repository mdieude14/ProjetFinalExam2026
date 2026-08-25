import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import storyApi from '@/api/story.api';
import Avatar from '@/components/ui/Avatar';
import Modal from '@/components/ui/Modal';

/** Duree d'affichage d'une story image, en millisecondes. */
const DUREE_IMAGE = 5000;

/**
 * Lecteur de stories plein ecran.
 *
 * Enchaine automatiquement les stories d'un auteur, puis passe a l'auteur
 * suivant. Navigation au clic (gauche / droite) et au clavier.
 *
 * DEUX PIEGES TRAITES ICI :
 *
 * 1. LE MINUTEUR DOIT ETRE NETTOYE A CHAQUE CHANGEMENT. Sans cela, changer
 *    rapidement de story empile les minuteurs et l'enchainement s'emballe.
 *
 * 2. LA VUE N'EST ENREGISTREE QU'UNE FOIS PAR STORY ET PAR SESSION. Le
 *    serveur est deja idempotent, mais revenir en arriere puis avancer
 *    declencherait des appels reseau inutiles.
 */
export default function StoryViewer({ groupes, indexGroupeInitial, onFermer }) {
  const [indexGroupe, setIndexGroupe] = useState(indexGroupeInitial);
  const [indexStory, setIndexStory] = useState(0);
  const [progression, setProgression] = useState(0);

  const minuteur = useRef(null);
  const vuesEnvoyees = useRef(new Set());

  const groupe = groupes[indexGroupe];
  const story = groupe?.stories?.[indexStory];

  /* ---------------- Navigation ---------------- */

  const suivante = useCallback(() => {
    if (!groupe) return;

    if (indexStory < groupe.stories.length - 1) {
      setIndexStory((i) => i + 1);
    } else if (indexGroupe < groupes.length - 1) {
      setIndexGroupe((i) => i + 1);
      setIndexStory(0);
    } else {
      onFermer();
    }
  }, [groupe, indexStory, indexGroupe, groupes.length, onFermer]);

  const precedente = useCallback(() => {
    if (indexStory > 0) {
      setIndexStory((i) => i - 1);
    } else if (indexGroupe > 0) {
      const precedent = groupes[indexGroupe - 1];
      setIndexGroupe((i) => i - 1);
      setIndexStory(precedent.stories.length - 1);
    }
  }, [indexStory, indexGroupe, groupes]);

  /* ---------------- Enregistrement de la vue ---------------- */

  useEffect(() => {
    if (!story || story.verrouille) return;
    if (vuesEnvoyees.current.has(story._id)) return;

    vuesEnvoyees.current.add(story._id);
    storyApi.marquerVue(story._id).catch(() => {
      // Echec sans consequence pour le spectateur : on ne l'interrompt pas
      // pour un compteur.
    });
  }, [story]);

  /* ---------------- Defilement automatique ---------------- */

  useEffect(() => {
    if (!story) return;

    setProgression(0);
    clearInterval(minuteur.current);

    // Les videos avancent avec leur propre lecture (evenement `ended`),
    // pas au minuteur : une video de 15 s ne doit pas etre coupee a 5 s.
    if (story.media?.type === 'video') return;

    const pas = 50;
    let ecoule = 0;

    minuteur.current = setInterval(() => {
      ecoule += pas;
      setProgression(Math.min(100, (ecoule / DUREE_IMAGE) * 100));
      if (ecoule >= DUREE_IMAGE) {
        clearInterval(minuteur.current);
        suivante();
      }
    }, pas);

    return () => clearInterval(minuteur.current);
  }, [story, suivante]);

  /* ---------------- Clavier ---------------- */

  useEffect(() => {
    const surTouche = (evenement) => {
      if (evenement.key === 'ArrowRight') suivante();
      if (evenement.key === 'ArrowLeft') precedente();
    };
    document.addEventListener('keydown', surTouche);
    return () => document.removeEventListener('keydown', surTouche);
  }, [suivante, precedente]);

  if (!story) return null;

  const heures = Math.floor((Date.now() - new Date(story.createdAt)) / 3600000);

  return (
    <Modal ouvert onFermer={onFermer} taille="plein" fondSombre>
      <div className="relative mx-auto flex h-full max-w-md flex-col">
        {/* ---------- Barres de progression ---------- */}
        <div className="flex gap-1 p-2">
          {groupe.stories.map((_, i) => (
            <div key={i} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30">
              <div
                className="h-full bg-white transition-[width] duration-75"
                style={{
                  width:
                    i < indexStory ? '100%' : i === indexStory ? `${progression}%` : '0%',
                }}
              />
            </div>
          ))}
        </div>

        {/* ---------- En-tete ---------- */}
        <div className="flex items-center gap-2.5 px-3 pb-2">
          <Avatar utilisateur={groupe.auteur} taille="sm" />
          <div className="min-w-0 flex-1">
            <Link
              to={`/profile/${groupe.auteur.pseudo}`}
              onClick={onFermer}
              className="truncate text-sm font-semibold text-white hover:underline"
            >
              {groupe.auteur.prenom} {groupe.auteur.nom}
            </Link>
            <p className="text-xs text-white/60">
              il y a {heures < 1 ? "moins d'1" : heures} h
              {story.vuesCount !== undefined && ` · ${story.vuesCount} vue${story.vuesCount > 1 ? 's' : ''}`}
            </p>
          </div>

          <button
            onClick={onFermer}
            aria-label="Fermer"
            className="px-2 text-2xl leading-none text-white/80 hover:text-white"
          >
            ×
          </button>
        </div>

        {/* ---------- Contenu ---------- */}
        <div className="relative flex flex-1 items-center justify-center overflow-hidden">
          {story.verrouille ? (
            <div className="px-8 text-center">
              <p className="text-4xl" aria-hidden="true">🔒</p>
              <p className="mt-3 text-sm font-semibold text-white">Story exclusive</p>
              <p className="mt-1 text-xs text-white/70">
                Reservee aux abonnes premium de {groupe.auteur.prenom}
              </p>
            </div>
          ) : story.media?.type === 'video' ? (
            <video
              key={story._id}
              src={story.media.url}
              autoPlay
              playsInline
              controls={false}
              onEnded={suivante}
              className="max-h-full max-w-full"
            />
          ) : (
            <img
              key={story._id}
              src={story.media?.url}
              alt=""
              className="max-h-full max-w-full object-contain"
            />
          )}

          {/* Zones de clic invisibles : gauche pour reculer, droite pour
              avancer. C'est la convention de toutes les applications de
              stories ; des fleches visibles encombreraient l'image. */}
          <button
            onClick={precedente}
            aria-label="Story précédente"
            className="absolute inset-y-0 left-0 w-1/3 cursor-default"
          />
          <button
            onClick={suivante}
            aria-label="Story suivante"
            className="absolute inset-y-0 right-0 w-2/3 cursor-default"
          />
        </div>

        {/* ---------- Legende ---------- */}
        {story.texte && (
          <p className="bg-black/40 px-4 py-3 text-center text-sm text-white">
            {story.texte}
          </p>
        )}
      </div>
    </Modal>
  );
}
