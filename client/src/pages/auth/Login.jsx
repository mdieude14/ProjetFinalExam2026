import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import useAuth from '@/hooks/useAuth';
import { traiterErreurApi } from '@/utils/erreurs';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';

/**
 * Page de connexion — /login
 *
 * Le champ « identifiant » accepte indifferemment un email ou un pseudo,
 * comme le back-end. Imposer a l'utilisateur de se souvenir de la forme
 * exacte sous laquelle il s'est inscrit est une friction inutile.
 */
export default function Login() {
  const { connexion } = useAuth();
  const naviguer = useNavigate();
  const emplacement = useLocation();

  const [champs, setChamps] = useState({ identifiant: '', password: '' });
  const [erreurs, setErreurs] = useState({});
  const [erreurGlobale, setErreurGlobale] = useState(null);
  const [chargement, setChargement] = useState(false);

  // Page que l'utilisateur voulait atteindre avant d'etre redirige ici
  // par ProtectedRoute. A defaut, le fil d'actualite.
  const destination = emplacement.state?.depuis?.pathname || '/home';

  const modifier = (champ) => (evenement) => {
    setChamps((precedent) => ({ ...precedent, [champ]: evenement.target.value }));
    // L'erreur disparait des que l'utilisateur corrige : laisser un message
    // rouge sous un champ qu'il est en train de reecrire est deroutant.
    if (erreurs[champ]) {
      setErreurs((precedent) => ({ ...precedent, [champ]: null }));
    }
  };

  const soumettre = async (evenement) => {
    evenement.preventDefault();
    setErreurs({});
    setErreurGlobale(null);
    setChargement(true);

    try {
      await connexion(champs.identifiant, champs.password);
      naviguer(destination, { replace: true });
    } catch (erreur) {
      const { parChamp, global } = traiterErreurApi(erreur);
      setErreurs(parChamp);
      setErreurGlobale(global);
    } finally {
      setChargement(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ardoise-50 px-4 py-10">
      <div className="w-full max-w-md">
        {/* En-tete */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-ardoise-900">
            Coach<span className="text-marque-500">Connect</span>
          </h1>
          <p className="mt-2 text-sm text-ardoise-500">
            Retrouvez votre communauté sportive
          </p>
        </div>

        {/* Carte du formulaire */}
        <div className="rounded-carte border border-ardoise-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="mb-6 text-xl font-bold text-ardoise-900">Connexion</h2>

          {erreurGlobale && (
            <Alert variante="erreur" className="mb-5">
              {erreurGlobale}
            </Alert>
          )}

          {/* noValidate desactive les bulles natives du navigateur, dont le
              style est incoherent d'un navigateur a l'autre et qui ne sont
              pas traduites. La validation reste assuree par le serveur. */}
          <form onSubmit={soumettre} noValidate className="space-y-4">
            <Input
              libelle="Email ou pseudo"
              name="identifiant"
              value={champs.identifiant}
              onChange={modifier('identifiant')}
              erreur={erreurs.identifiant}
              placeholder="julie@exemple.fr"
              autoComplete="username"
              autoFocus
              required
            />

            <Input
              libelle="Mot de passe"
              name="password"
              type="password"
              value={champs.password}
              onChange={modifier('password')}
              erreur={erreurs.password}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />

            <Button
              type="submit"
              pleineLargeur
              taille="lg"
              chargement={chargement}
              className="mt-2"
            >
              {chargement ? 'Connexion...' : 'Se connecter'}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-ardoise-500">
            Pas encore de compte ?{' '}
            <Link
              to="/register"
              className="font-semibold text-marque-600 hover:text-marque-700 hover:underline"
            >
              Créer un compte
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
