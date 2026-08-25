import { Routes, Route, Navigate } from 'react-router-dom';

import ProtectedRoute from '@/routes/ProtectedRoute';
import PublicRoute from '@/routes/PublicRoute';
import { CoachRoute, AdminRoute } from '@/routes/RoleRoute';
import Layout from '@/components/layout/Layout';

import Login from '@/pages/auth/Login';
import Register from '@/pages/auth/Register';
import Home from '@/pages/Home';
import Profile from '@/pages/Profile';
import Settings from '@/pages/Settings';
import Demandes from '@/pages/Demandes';
import Diplome from '@/pages/coach/Diplome';
import Moderation from '@/pages/admin/Moderation';
import NotFound from '@/pages/NotFound';

/**
 * Table de routage de l'application.
 *
 * L'IMBRICATION DES ROUTES PORTE LA SECURITE ET LA MISE EN PAGE.
 *
 *   ProtectedRoute        exige une session
 *     Layout              ajoute la barre de navigation
 *       Home, Profile...  pages
 *       CoachRoute        restreint en plus aux coachs
 *       AdminRoute        restreint en plus aux administrateurs
 *
 * Une page ajoutee sous ces parents herite automatiquement de leur
 * protection et de leur mise en page. On ne peut pas oublier de proteger
 * une page : il faudrait volontairement la declarer ailleurs.
 *
 * Rappel : ces gardes ne sont qu'un confort d'affichage. La securite reelle
 * est assuree par les middlewares `protect` et `autoriser` du serveur.
 */
export default function App() {
  return (
    <Routes>
      {/* --- Visiteurs non connectes --- */}
      <Route element={<PublicRoute />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Route>

      {/* --- Utilisateurs connectes --- */}
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/home" element={<Home />} />
          <Route path="/profile/:identifiant" element={<Profile />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/demandes" element={<Demandes />} />

          {/* Reserve aux coachs */}
          <Route element={<CoachRoute />}>
            <Route path="/coach/diplome" element={<Diplome />} />
          </Route>

          {/* Reserve aux administrateurs */}
          <Route element={<AdminRoute />}>
            <Route path="/admin/moderation" element={<Moderation />} />
          </Route>

          {/*
            A venir :
              <Route path="/maps" element={<Maps />} />                 module 8
              <Route path="/search" element={<Search />} />             module 10
              <Route path="/messages" element={<Messages />} />         module 11
              <Route path="/notifications" element={<Notifications />} /> module 12
          */}
        </Route>
      </Route>

      {/* --- Redirections --- */}
      <Route path="/" element={<Navigate to="/home" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
