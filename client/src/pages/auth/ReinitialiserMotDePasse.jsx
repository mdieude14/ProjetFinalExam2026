import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import authApi from '@/api/auth.api';
import useAuth from '@/hooks/useAuth';
import { traiterErreurApi } from '@/utils/erreurs';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import IndicateurRobustesse from '@/components/ui/IndicateurRobustesse';

/**
 * Nouveau mot de passe — /reinitialiser-mot-de-passe?jeton=…
 *
 * LE JETON QUITTE LA BARRE D'ADRESSE DÈS L'OUVERTURE. Il est lu une fois,
 * gardé en mémoire, puis retiré de l'URL : il ne reste ni dans l'historique
 * du navigateur, ni sur une capture d'écran, ni dans l'en-tête `Referer`
 * d'un lien suivi depuis la page.
 *
 * CETTE PAGE N'EST DERRIÈRE AUCUNE GARDE. Une personne encore connectée —
 * sur ce navigateur ou ailleurs — doit pouvoir suivre le lien reçu : placée
 * sous `PublicRoute`, elle serait renvoyée vers l'accueil sans explication.
 *
 * APRÈS LA RÉINITIALISATION, RETOUR À LA CONNEXION. Le serveur n'ouvre
 * aucune session : la personne saisit son nouveau mot de passe, première
 * preuve qu'elle le connaît. Si une session était ouverte ici, elle est
 * fermée d'abord — le serveur l'a déjà révoquée, et `PublicRoute`
 * renverrait sinon un « connecté » vers l'accueil au lieu de la connexion.
 */
export default function ReinitialiserMotDePasse() {
  const naviguer = useNavigate();
  const { estConnecte, deconnexion } = useAuth();
  const [parametres, setParametres] = useSearchParams();

  // Lu une seule fois, à l'ouverture : la valeur survit au retrait de l'URL.
  const [jeton] = useState(() => parametres.get('jeton') || '');

  const [champs, setChamps] = useState({ nouveauPassword: '', confirmation: '' });
  const [erreurs, setErreurs] = useState({});
  const [erreurGlobale, setErreurGlobale] = useState(null);
  const [chargement, setChargement] = useState(false);

  useEffect(() => {
    if (parametres.has('jeton')) setParametres({}, { replace: true });
  }, [parametres, setParametres]);

  const modifier = (champ) => (evenement) => {
    setChamps((precedent) => ({ ...precedent, [champ]: evenement.target.value }));
    if (erreurs[champ]) setErreurs((precedent) => ({ ...precedent, [champ]: null }));
  };

  const soumettre = async (evenement) => {
    evenement.preventDefault();
    setErreurs({});
    setErreurGlobale(null);

    /*
     * LA CONFIRMATION EST VÉRIFIÉE ICI, ET SEULEMENT ICI. Le serveur n'a pas à
     * la recevoir : elle protège contre une faute de frappe, pas contre un
     * attaquant. Une faute non détectée enfermerait la personne dehors avec
     * un mot de passe qu'elle n'a jamais voulu.
     */
    if (champs.nouveauPassword !== champs.confirmation) {
      setErreurs({ confirmation: 'Les deux mots de passe ne correspondent pas' });
      return;
    }

    setChargement(true);
    try {
      const reponse = await authApi.reinitialiserMotDePasse(jeton, champs.nouveauPassword);
      if (estConnecte) await deconnexion();
      naviguer('/login', { replace: true, state: { message: reponse.data.message } });
    } catch (erreur) {
      const { parChamp, global } = traiterErreurApi(erreur);
      // Une erreur sur le jeton n'a pas de champ où s'afficher.
      setErreurGlobale(parChamp.jeton || global);
      setErreurs(parChamp);
    } finally {
      setChargement(false);
    }
  };

  const lienRedemande = (
    <Link
      to="/mot-de-passe-oublie"
      className="font-semibold text-marque-600 hover:text-marque-700 hover:underline"
    >
      Faire une nouvelle demande
    </Link>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-ardoise-50 px-4 py-10">
      {/* Défense supplémentaire : aucune page quittée depuis ici ne reçoit l'adresse. */}
      <meta name="referrer" content="no-referrer" />

      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-ardoise-900">
            Coach<span className="text-marque-500">Connect</span>
          </h1>
        </div>

        <div className="rounded-carte border border-ardoise-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="mb-6 text-xl font-bold text-ardoise-900">Nouveau mot de passe</h2>

          {!jeton ? (
            <div data-test="lien-incomplet">
              <Alert variante="erreur">
                Ce lien est incomplet. Ouvrez celui de l’e-mail reçu, ou refaites une demande.
              </Alert>
              <p className="mt-4 text-sm">{lienRedemande}</p>
            </div>
          ) : (
            <>
              {erreurGlobale && (
                <div className="mb-5" data-test="erreur-reinitialisation">
                  <Alert variante="erreur">{erreurGlobale}</Alert>
                  <p className="mt-2 text-sm">{lienRedemande}</p>
                </div>
              )}

              <form onSubmit={soumettre} noValidate className="space-y-4">
                <div>
                  <Input
                    libelle="Nouveau mot de passe"
                    name="nouveauPassword"
                    type="password"
                    value={champs.nouveauPassword}
                    onChange={modifier('nouveauPassword')}
                    erreur={erreurs.nouveauPassword}
                    autoComplete="new-password"
                    autoFocus
                    required
                  />
                  <IndicateurRobustesse motDePasse={champs.nouveauPassword} />
                </div>

                <Input
                  libelle="Confirmer le mot de passe"
                  name="confirmation"
                  type="password"
                  value={champs.confirmation}
                  onChange={modifier('confirmation')}
                  erreur={erreurs.confirmation}
                  autoComplete="new-password"
                  required
                />

                <Button type="submit" pleineLargeur taille="lg" chargement={chargement}>
                  {chargement ? 'Enregistrement...' : 'Enregistrer le mot de passe'}
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
