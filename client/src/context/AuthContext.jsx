import { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import authApi from '@/api/auth.api';
import {
  definirAccessToken,
  definirGestionnaireSessionExpiree,
} from '@/api/axios';

/**
 * ===========================================================================
 *  ETAT D'AUTHENTIFICATION GLOBAL
 * ===========================================================================
 *
 * Un seul endroit sait qui est connecte. Toute l'application y accede par le
 * hook useAuth, sans passer l'utilisateur de composant en composant.
 *
 * LE POINT DELICAT : LA RESTAURATION DE SESSION
 * L'access token vit en memoire, donc un rechargement de page (F5) le perd.
 * Le refresh token, lui, est dans un cookie httpOnly que React ne peut ni
 * lire ni meme detecter.
 *
 * Au demarrage, le front ne peut donc pas savoir si quelqu'un est connecte :
 * il doit le demander au serveur. D'ou l'etat `chargement`, vrai tant que la
 * reponse n'est pas arrivee.
 *
 * Cet etat est essentiel : sans lui, les routes protegees verraient
 * `utilisateur === null` pendant les 200 ms de la requete et redirigeraient
 * vers /login un utilisateur parfaitement connecte, a chaque rafraichissement.
 * ===========================================================================
 */

// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [utilisateur, setUtilisateur] = useState(null);
  const [chargement, setChargement] = useState(true);

  /* ---------------------------------------------------------------- *
   *  Restauration de la session au demarrage
   * ---------------------------------------------------------------- */

  useEffect(() => {
    let annule = false;

    async function restaurer() {
      try {
        // Le cookie httpOnly part automatiquement grace a withCredentials.
        // S'il est absent ou expire, le serveur repond 401 et l'on bascule
        // simplement en visiteur anonyme.
        const reponse = await authApi.renouveler();
        definirAccessToken(reponse.data.accessToken);
        if (!annule) setUtilisateur(reponse.data.utilisateur);
      } catch {
        if (!annule) {
          definirAccessToken(null);
          setUtilisateur(null);
        }
      } finally {
        if (!annule) setChargement(false);
      }
    }

    restaurer();

    // Evite un avertissement React si le composant est demonte avant la fin
    // de la requete (frequent avec le StrictMode en developpement, qui monte
    // puis demonte chaque composant une fois).
    return () => {
      annule = true;
    };
  }, []);

  /* ---------------------------------------------------------------- *
   *  Reaction a une session perdue en cours d'utilisation
   * ---------------------------------------------------------------- */

  useEffect(() => {
    // L'intercepteur Axios previent le contexte quand le renouvellement
    // echoue definitivement — par exemple apres une deconnexion globale
    // declenchee depuis un autre appareil.
    definirGestionnaireSessionExpiree(() => setUtilisateur(null));
    return () => definirGestionnaireSessionExpiree(null);
  }, []);

  /* ---------------------------------------------------------------- *
   *  Actions
   * ---------------------------------------------------------------- */

  const connexion = useCallback(async (identifiant, motDePasse) => {
    const reponse = await authApi.connexion(identifiant, motDePasse);
    definirAccessToken(reponse.data.accessToken);
    setUtilisateur(reponse.data.utilisateur);
    return reponse.data.utilisateur;
  }, []);

  const inscription = useCallback(async (donnees) => {
    const reponse = await authApi.inscription(donnees);
    definirAccessToken(reponse.data.accessToken);
    setUtilisateur(reponse.data.utilisateur);
    return reponse.data.utilisateur;
  }, []);

  const deconnexion = useCallback(async () => {
    try {
      await authApi.deconnexion();
    } catch {
      // Meme si l'appel echoue (serveur injoignable), on vide l'etat local :
      // l'utilisateur a demande a partir, l'interface doit obeir.
    } finally {
      definirAccessToken(null);
      setUtilisateur(null);
    }
  }, []);

  /**
   * Met a jour l'utilisateur en memoire apres une modification de profil,
   * sans repasser par le serveur.
   */
  const majUtilisateur = useCallback((champs) => {
    setUtilisateur((precedent) => (precedent ? { ...precedent, ...champs } : precedent));
  }, []);

  /**
   * useMemo evite de recreer l'objet de contexte a chaque rendu.
   * Sans lui, tous les composants abonnes au contexte se redessineraient
   * meme lorsque rien n'a change.
   */
  const valeur = useMemo(
    () => ({
      utilisateur,
      chargement,
      estConnecte: Boolean(utilisateur),
      estCoach: utilisateur?.type === 'coach',
      estAdmin: utilisateur?.type === 'admin',
      connexion,
      inscription,
      deconnexion,
      majUtilisateur,
    }),
    [utilisateur, chargement, connexion, inscription, deconnexion, majUtilisateur]
  );

  return <AuthContext.Provider value={valeur}>{children}</AuthContext.Provider>;
}
