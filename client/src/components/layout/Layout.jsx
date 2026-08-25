import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';

/**
 * Coquille commune a toutes les pages connectees.
 *
 * Declaree comme route parente dans App.jsx, elle evite d'importer et de
 * placer la Navbar dans chaque page — et donc de l'oublier dans l'une d'elles.
 *
 * `pb-16 md:pb-0` reserve la hauteur de la barre de navigation mobile fixee
 * en bas de l'ecran : sans cette marge, le dernier element de chaque page
 * passerait sous la barre et deviendrait inatteignable.
 */
export default function Layout() {
  return (
    <div className="min-h-screen bg-ardoise-50">
      <Navbar />
      <main className="mx-auto max-w-4xl px-4 pb-16 pt-6 md:pb-8">
        <Outlet />
      </main>
    </div>
  );
}
