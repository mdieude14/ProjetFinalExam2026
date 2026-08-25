import { Navigate, Outlet, useLocation } from 'react-router-dom';
import useAuth from '@/hooks/useAuth';
import { EcranChargement } from '@/components/ui/Spinner';

/**
 * Route reservee a certains types de comptes.
 *
 * RAPPEL IMPORTANT : ceci est un CONFORT D'INTERFACE, PAS UNE SECURITE.
 * Tout ce qui s'execute dans le navigateur est modifiable par l'utilisateur.
 * La seule protection reelle est cote serveur, assuree par les middlewares
 * `autoriser()` et `coachCertifie` du module 2. Ce composant se contente
 * d'eviter d'afficher une page qui echouerait de toute facon en 403.
 */
function RoleRoute({ typesAutorises, redirection = '/home' }) {
  const { utilisateur, estConnecte, chargement } = useAuth();
  const emplacement = useLocation();

  if (chargement) {
    return <EcranChargement />;
  }

  if (!estConnecte) {
    return <Navigate to="/login" state={{ depuis: emplacement }} replace />;
  }

  if (!typesAutorises.includes(utilisateur.type)) {
    return <Navigate to={redirection} replace />;
  }

  return <Outlet />;
}

/** Pages reservees aux coachs : creation d'evenement, contenu premium... */
export function CoachRoute() {
  return <RoleRoute typesAutorises={['coach']} />;
}

/** Back-office de moderation : verification des diplomes. */
export function AdminRoute() {
  return <RoleRoute typesAutorises={['admin']} />;
}

export default RoleRoute;
