import { useState, useEffect } from 'react';

/**
 * Retarde la propagation d'une valeur qui change vite.
 *
 * LE CALCUL QUI JUSTIFIE CE HOOK.
 * « natation » fait huit lettres. Sans délai, la barre de recherche envoie
 * huit requêtes pour une seule intention — dont sept dont personne ne verra
 * jamais le résultat. Multiplié par le nombre d'utilisateurs, c'est la route
 * la plus sollicitée du projet qui travaille à 90 % pour rien.
 *
 * Avec 300 ms, une frappe continue ne déclenche qu'un appel, à la pause. Le
 * réglage n'est pas arbitraire : en dessous de 200 ms, une frappe normale
 * passe encore à travers ; au-delà de 400 ms, l'interface donne l'impression
 * de traîner.
 *
 * POURQUOI LE NETTOYAGE EST L'ESSENTIEL DE CE CODE. `clearTimeout` au retour
 * de l'effet annule le minuteur en attente à chaque nouvelle frappe. Sans
 * lui, chaque lettre programmerait son propre déclenchement et les huit
 * requêtes partiraient quand même — avec 300 ms de retard, ce qui serait
 * pire que pas de délai du tout.
 *
 * @param {*} valeur
 * @param {number} delai en millisecondes
 */
export default function useDebounce(valeur, delai = 300) {
  const [valeurRetardee, setValeurRetardee] = useState(valeur);

  useEffect(() => {
    const minuteur = setTimeout(() => setValeurRetardee(valeur), delai);
    return () => clearTimeout(minuteur);
  }, [valeur, delai]);

  return valeurRetardee;
}
