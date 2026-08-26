import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Geolocalisation du navigateur.
 *
 * POURQUOI DISTINGUER LES TROIS ECHECS.
 * L'API renvoie trois codes d'erreur qui appellent trois reponses opposees :
 *
 *   PERMISSION_DENIED     l'utilisateur a refuse -> ne JAMAIS redemander
 *                         automatiquement ; proposer la saisie d'une ville
 *   POSITION_UNAVAILABLE  le materiel n'a pas su -> reessayer a du sens
 *   TIMEOUT               trop lent -> reessayer a du sens
 *
 * Les confondre derriere « position indisponible » conduit soit a harceler
 * quelqu'un qui a dit non, soit a abandonner quelqu'un qui aurait accepte.
 *
 * ORDRE DES COORDONNEES — le piege recurrent du projet.
 * Le navigateur expose `coords.latitude` puis `coords.longitude` ; GeoJSON,
 * donc MongoDB, attend `[longitude, latitude]`. Une inversion ne leve aucune
 * erreur : elle place le point ailleurs sur la planete. Ce hook renvoie donc
 * `lng` et `lat` NOMMES, jamais un tableau ordonne.
 */

const MESSAGES = {
  1: 'Vous avez refusé le partage de votre position.',
  2: 'Votre position n’a pas pu être déterminée.',
  3: 'La localisation a pris trop de temps.',
};

export default function usePosition({ automatique = false } = {}) {
  const [position, setPosition] = useState(null); // { lng, lat, precisionM }
  const [erreur, setErreur] = useState(null); // { code, message, refusee }
  const [chargement, setChargement] = useState(false);

  // Evite de mettre a jour l'etat d'un composant demonte : la geolocalisation
  // peut repondre plusieurs secondes apres un changement de page.
  const monte = useRef(true);
  useEffect(() => {
    monte.current = true;
    return () => {
      monte.current = false;
    };
  }, []);

  const demander = useCallback(() => {
    if (!navigator.geolocation) {
      setErreur({
        code: 0,
        message: 'Votre navigateur ne gère pas la géolocalisation.',
        refusee: false,
      });
      return;
    }

    setChargement(true);
    setErreur(null);

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (!monte.current) return;
        setPosition({
          lng: coords.longitude,
          lat: coords.latitude,
          precisionM: Math.round(coords.accuracy),
        });
        setChargement(false);
      },
      (e) => {
        if (!monte.current) return;
        setErreur({
          code: e.code,
          message: MESSAGES[e.code] || 'Localisation impossible.',
          // Le refus est le seul cas ou reproposer un bouton « réessayer »
          // serait deplace : le navigateur ne redemandera rien tant que
          // l'utilisateur n'aura pas change son choix lui-meme.
          refusee: e.code === 1,
        });
        setChargement(false);
      },
      {
        // Pas de haute precision : on affiche une carte de quartier, pas un
        // itineraire piéton. Le GPS fin viderait la batterie pour rien et
        // allongerait l'attente de plusieurs secondes.
        enableHighAccuracy: false,
        timeout: 10000,
        // Une position vieille de cinq minutes reste bonne pour chercher un
        // coach dans un rayon de 25 km.
        maximumAge: 300000,
      }
    );
  }, []);

  useEffect(() => {
    if (automatique) demander();
  }, [automatique, demander]);

  return { position, erreur, chargement, demander, definir: setPosition };
}
