import { Link } from 'react-router-dom';
import Button from '@/components/ui/Button';

/** Page 404 — route inconnue. */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ardoise-50 px-4 text-center">
      <p className="text-6xl font-extrabold text-marque-500">404</p>
      <h1 className="text-xl font-bold text-ardoise-900">Page introuvable</h1>
      <p className="max-w-sm text-sm text-ardoise-500">
        Cette page n&apos;existe pas ou a ete deplacee.
      </p>
      <Link to="/home" className="mt-2">
        <Button>Retour a l&apos;accueil</Button>
      </Link>
    </div>
  );
}
