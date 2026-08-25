import { useContext } from 'react';
import { AuthContext } from '@/context/AuthContext';

/**
 * Accede a l'etat d'authentification global.
 *
 *   const { utilisateur, estConnecte, deconnexion } = useAuth();
 *
 * Le test explicite sur `null` transforme une erreur obscure — « impossible
 * de lire la propriete utilisateur de null », survenant loin de sa cause —
 * en un message qui designe directement le probleme : un composant place
 * hors du AuthProvider.
 */
export function useAuth() {
  const contexte = useContext(AuthContext);

  if (contexte === null) {
    throw new Error(
      'useAuth doit être utilise a l’interieur d’un <AuthProvider>. ' +
        'Vérifiez que le composant est bien place dans l’arbre de main.jsx.'
    );
  }

  return contexte;
}

export default useAuth;
