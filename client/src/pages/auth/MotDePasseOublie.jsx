import { useState } from 'react';
import { Link } from 'react-router-dom';
import authApi from '@/api/auth.api';
import { traiterErreurApi } from '@/utils/erreurs';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';

/**
 * Mot de passe oublié — /mot-de-passe-oublie
 *
 * LA CONFIRMATION NE DIT PAS SI L'ADRESSE A UN COMPTE. Le serveur répond la
 * même chose dans les deux cas, et l'écran reprend son message tel quel :
 * « aucun compte ne correspond » permettrait de vérifier, adresse par
 * adresse, qui est inscrit sur la plateforme.
 *
 * LE FORMULAIRE DISPARAÎT UNE FOIS LA DEMANDE ENVOYÉE. Le laisser affiché
 * invite à cliquer de nouveau en attendant l'e-mail — et chaque nouvelle
 * demande invalide le lien de la précédente. On propose plutôt une nouvelle
 * demande explicite, pour qui s'est trompé d'adresse.
 */
export default function MotDePasseOublie() {
  const [email, setEmail] = useState('');
  const [erreurs, setErreurs] = useState({});
  const [erreurGlobale, setErreurGlobale] = useState(null);
  const [chargement, setChargement] = useState(false);
  const [confirmation, setConfirmation] = useState(null);

  const soumettre = async (evenement) => {
    evenement.preventDefault();
    setErreurs({});
    setErreurGlobale(null);
    setChargement(true);

    try {
      const reponse = await authApi.demanderReinitialisation(email);
      setConfirmation(reponse.data.message);
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
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-ardoise-900">
            Coach<span className="text-marque-500">Connect</span>
          </h1>
        </div>

        <div className="rounded-carte border border-ardoise-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="mb-2 text-xl font-bold text-ardoise-900">Mot de passe oublié</h2>

          {confirmation ? (
            <div data-test="confirmation-demande">
              <Alert variante="succes" className="mt-4">
                {confirmation}
              </Alert>
              <p className="mt-4 text-sm leading-relaxed text-ardoise-600">
                Le lien reçu est valable 30 minutes et ne sert qu’une fois.
              </p>
              <button
                type="button"
                onClick={() => {
                  setConfirmation(null);
                  setEmail('');
                }}
                className="mt-4 cursor-pointer text-sm font-semibold text-marque-600 hover:text-marque-700 hover:underline"
              >
                Faire une nouvelle demande
              </button>
            </div>
          ) : (
            <>
              <p className="mb-6 text-sm leading-relaxed text-ardoise-500">
                Saisissez l’adresse e-mail de votre compte : nous vous enverrons un lien pour
                choisir un nouveau mot de passe.
              </p>

              {erreurGlobale && (
                <Alert variante="erreur" className="mb-5">
                  {erreurGlobale}
                </Alert>
              )}

              <form onSubmit={soumettre} noValidate className="space-y-4">
                <Input
                  libelle="Adresse e-mail"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (erreurs.email) setErreurs({});
                  }}
                  erreur={erreurs.email}
                  placeholder="julie@exemple.fr"
                  autoComplete="email"
                  autoFocus
                  required
                />

                <Button type="submit" pleineLargeur taille="lg" chargement={chargement}>
                  {chargement ? 'Envoi...' : 'Recevoir le lien'}
                </Button>
              </form>
            </>
          )}

          <p className="mt-6 text-center text-sm text-ardoise-500">
            <Link
              to="/login"
              className="font-semibold text-marque-600 hover:text-marque-700 hover:underline"
            >
              ← Retour à la connexion
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
