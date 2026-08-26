import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

import ProtectedRoute from '@/routes/ProtectedRoute';
import PublicRoute from '@/routes/PublicRoute';
import { CoachRoute, AdminRoute } from '@/routes/RoleRoute';
import Layout from '@/components/layout/Layout';
import { EcranChargement } from '@/components/ui/Spinner';

import Login from '@/pages/auth/Login';
import Register from '@/pages/auth/Register';
import Home from '@/pages/Home';
import Profile from '@/pages/Profile';
import Settings from '@/pages/Settings';
import Demandes from '@/pages/Demandes';
import Diplome from '@/pages/coach/Diplome';
import Premium from '@/pages/coach/Premium';
import Abonnements from '@/pages/Abonnements';
import Search from '@/pages/Search';
import Messages from '@/pages/Messages';
/**
 * La carte est chargee A LA DEMANDE, contrairement aux autres pages.
 *
 * POURQUOI ELLE SEULE. Leaflet et react-leaflet pesent a eux deux pres de
 * 50 ko compresses — soit un tiers du poids de l'application. Or la carte
 * n'est qu'une page parmi une dizaine : la placer dans le paquet principal
 * ferait payer ce tiers a TOUS les visiteurs des le premier ecran, y compris
 * a ceux qui n'ouvriront jamais /carte.
 *
 * `lazy()` la sort dans un fichier separe, telecharge au moment ou l'on
 * navigue vers elle. Le `Suspense` plus bas couvre le court instant du
 * telechargement.
 */
const Carte = lazy(() => import('@/pages/Carte'));

/*
 * Les deux ecrans d'evenements affichent eux aussi une carte Leaflet : ils
 * relevent donc exactement du meme raisonnement, et sont charges a la
 * demande pour la meme raison. Les declarer en import statique annulerait
 * le benefice obtenu sur /carte, puisque le paquet principal embarquerait
 * de nouveau Leaflet par cette porte-la.
 */
const Events = lazy(() => import('@/pages/Events'));
const EventDetail = lazy(() => import('@/pages/EventDetail'));

import PaymentSuccess from '@/pages/PaymentSuccess';
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
          <Route path="/abonnements" element={<Abonnements />} />
          <Route path="/recherche" element={<Search />} />
          <Route path="/messages" element={<Messages />} />
          <Route
            path="/carte"
            element={
              <Suspense fallback={<EcranChargement message="Chargement de la carte…" />}>
                <Carte />
              </Suspense>
            }
          />

          <Route
            path="/evenements"
            element={
              <Suspense fallback={<EcranChargement message="Chargement des événements…" />}>
                <Events />
              </Suspense>
            }
          />
          <Route
            path="/evenements/:id"
            element={
              <Suspense fallback={<EcranChargement message="Chargement de l’événement…" />}>
                <EventDetail />
              </Suspense>
            }
          />

          {/*
            Adresse de retour de Stripe Checkout (`success_url`).
            Elle exige une session : sans quoi un visiteur non connecte
            atterrirait sur une page incapable de lire ses abonnements.
          */}
          <Route path="/paiement/succes" element={<PaymentSuccess />} />

          {/* Reserve aux coachs */}
          <Route element={<CoachRoute />}>
            <Route path="/coach/diplome" element={<Diplome />} />
            <Route path="/coach/premium" element={<Premium />} />
          </Route>

          {/* Reserve aux administrateurs */}
          <Route element={<AdminRoute />}>
            <Route path="/admin/moderation" element={<Moderation />} />
          </Route>

          {/*
            A venir :
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
