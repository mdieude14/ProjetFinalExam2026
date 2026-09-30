import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import WidgetSupport from '@/components/support/WidgetSupport';

/**
 * Coquille commune a toutes les pages connectees.
 *
 * Declaree comme route parente dans App.jsx, elle evite d'importer et de
 * placer la Navbar dans chaque page — et donc de l'oublier dans l'une d'elles.
 *
 * `pb-16 lg:pb-8` reserve la hauteur de la barre de navigation mobile fixee
 * en bas de l'ecran : sans cette marge, le dernier element de chaque page
 * passerait sous la barre et deviendrait inatteignable.
 *
 * LE WIDGET DE SUPPORT EST MONTE ICI, ET HORS DU `<main>`. Il est positionne
 * en `fixed` : le placer dans le flux de la page n'aurait aucun effet sur son
 * rendu, mais le ferait remonter dans l'ordre de lecture d'un lecteur
 * d'ecran, avant le contenu de la page. Il decide lui-meme de s'afficher ou
 * non — sans session, sans URL d'agent, ou dans le back-office, il ne rend
 * rien.
 */
export default function Layout() {
  return (
    <div className="min-h-screen bg-ardoise-50">
      <Navbar />
      <main className="mx-auto max-w-4xl px-4 pb-16 pt-6 lg:pb-8">
        <Outlet />
      </main>
      <WidgetSupport />
    </div>
  );
}
