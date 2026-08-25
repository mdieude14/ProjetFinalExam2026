import { Navigate, Outlet } from 'react-router-dom';
import useAuth from '@/hooks/useAuth';
import { EcranChargement } from '@/components/ui/Spinner';

/**
 * Route reservee aux visiteurs NON connectes : /login et /register.
 *
 * C'est la symetrie de ProtectedRoute. Sans elle, un utilisateur deja
 * connecte qui clique sur un lien vers /login reverrait le formulaire de
 * connexion — situation deroutante, et source de bugs si la soumission
 * ecrase la session en cours.
 */
export default function PublicRoute() {
  const { estConnecte, chargement } = useAuth();

  if (chargement) {
    return <EcranChargement />;
  }

  if (estConnecte) {
    return <Navigate to="/home" replace />;
  }

  return <Outlet />;
}
