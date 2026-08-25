import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { AuthProvider } from '@/context/AuthContext';
import App from './App';
import './index.css';

/**
 * Point d'entree du front-end.
 *
 * L'ORDRE D'IMBRICATION EST SIGNIFIANT :
 *
 *   BrowserRouter        fournit le routage
 *     AuthProvider       peut alors utiliser les hooks de navigation
 *       App              consomme les deux
 *
 * Inverser les deux premiers casserait toute redirection declenchee depuis
 * le contexte d'authentification.
 *
 * StrictMode monte puis demonte chaque composant une fois en developpement,
 * afin de reveler les effets mal nettoyes. C'est la raison du drapeau
 * `annule` dans AuthContext : sans lui, la restauration de session
 * s'executerait deux fois et provoquerait un avertissement.
 */
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
