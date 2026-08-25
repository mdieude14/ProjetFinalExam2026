import { Navigate, Outlet, useLocation } from 'react-router-dom';
import useAuth from '@/hooks/useAuth';
import { EcranChargement } from '@/components/ui/Spinner';

/**
 * Route reservee aux utilisateurs connectes.
 *
 * S'utilise comme route parente dans App.jsx :
 *
 *   <Route element={<ProtectedRoute />}>
 *     <Route path="/home" element={<Home />} />
 *     <Route path="/messages" element={<Messages />} />
 *   </Route>
 *
 * DEUX SUBTILITES
 *
 * 1. L'ATTENTE DU CHARGEMENT EST OBLIGATOIRE.
 *    Au demarrage, AuthContext interroge le serveur pour savoir qui est
 *    connecte. Pendant ces quelques centaines de millisecondes,
 *    `utilisateur` vaut null sans que cela signifie « non connecte ».
 *    Rediriger tout de suite ejecterait vers /login un utilisateur
 *    parfaitement authentifie, a chaque rafraichissement de page.
 *
 * 2. LA PAGE DEMANDEE EST MEMORISEE.
 *    On transmet l'emplacement courant dans `state`. Apres connexion, la
 *    page Login y renvoie l'utilisateur. Quelqu'un qui ouvre un lien vers
 *    une conversation precise revient donc sur cette conversation, et non
 *    sur un accueil generique.
 */
export default function ProtectedRoute() {
  const { estConnecte, chargement } = useAuth();
  const emplacement = useLocation();

  if (chargement) {
    return <EcranChargement message="Vérification de votre session..." />;
  }

  if (!estConnecte) {
    // `replace` remplace l'entree dans l'historique : le bouton « retour »
    // ne ramene pas sur la page protegee, ce qui creerait une boucle.
    return <Navigate to="/login" state={{ depuis: emplacement }} replace />;
  }

  return <Outlet />;
}
