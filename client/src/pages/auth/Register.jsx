import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useAuth from '@/hooks/useAuth';
import { traiterErreurApi, evaluerMotDePasse } from '@/utils/erreurs';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';

/**
 * Page d'inscription — /register
 *
 * Le formulaire s'adapte au type de compte choisi : les champs de diplome
 * n'apparaissent que pour un coach. Afficher des champs inutiles allonge le
 * formulaire et fait abandonner les visiteurs.
 */

/** Carte de selection du type de compte. */
function ChoixType({ valeur, actuel, titre, description, onSelect }) {
  const selectionne = valeur === actuel;

  return (
    <button
      type="button"
      onClick={() => onSelect(valeur)}
      // aria-pressed communique l'etat de selection aux lecteurs d'ecran ;
      // la bordure coloree seule ne leur dit rien.
      aria-pressed={selectionne}
      className={[
        'flex-1 rounded-xl border-2 p-4 text-left transition-colors',
        selectionne
          ? 'border-marque-500 bg-marque-50'
          : 'border-ardoise-200 bg-white hover:border-ardoise-300',
      ].join(' ')}
    >
      <span
        className={`block text-sm font-bold ${
          selectionne ? 'text-marque-700' : 'text-ardoise-800'
        }`}
      >
        {titre}
      </span>
      <span className="mt-1 block text-xs leading-snug text-ardoise-500">
        {description}
      </span>
    </button>
  );
}

export default function Register() {
  const { inscription } = useAuth();
  const naviguer = useNavigate();

  const [champs, setChamps] = useState({
    type: 'utilisateur',
    prenom: '',
    nom: '',
    pseudo: '',
    email: '',
    password: '',
    ville: '',
    diplomeIntitule: '',
    diplomeOrganisme: '',
  });

  const [erreurs, setErreurs] = useState({});
  const [erreurGlobale, setErreurGlobale] = useState(null);
  const [chargement, setChargement] = useState(false);
  const [coordonnees, setCoordonnees] = useState(null);
  const [etatGeo, setEtatGeo] = useState('inactif'); // inactif | encours | ok | refuse

  const estCoach = champs.type === 'coach';
  const robustesse = evaluerMotDePasse(champs.password);

  const modifier = (champ) => (evenement) => {
    setChamps((precedent) => ({ ...precedent, [champ]: evenement.target.value }));
    if (erreurs[champ]) setErreurs((p) => ({ ...p, [champ]: null }));
  };

  /**
   * Geolocalisation du navigateur, facultative.
   *
   * PIEGE A CONNAITRE : l'API renvoie `coords.latitude` puis
   * `coords.longitude`, alors que GeoJSON — donc MongoDB — attend
   * [longitude, latitude]. L'inversion se fait ici, une bonne fois,
   * et le commentaire explique pourquoi.
   */
  const localiser = () => {
    if (!navigator.geolocation) {
      setEtatGeo('refuse');
      return;
    }

    setEtatGeo('encours');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoordonnees([position.coords.longitude, position.coords.latitude]);
        setEtatGeo('ok');
      },
      () => setEtatGeo('refuse'),
      { timeout: 10000, enableHighAccuracy: false }
    );
  };

  const soumettre = async (evenement) => {
    evenement.preventDefault();
    setErreurs({});
    setErreurGlobale(null);
    setChargement(true);

    // On construit le corps attendu par l'API plutot que d'envoyer l'etat
    // brut du formulaire : les champs de diplome y sont a plat, alors que
    // le back-end les attend imbriques.
    const donnees = {
      type: champs.type,
      prenom: champs.prenom,
      nom: champs.nom,
      pseudo: champs.pseudo,
      email: champs.email,
      password: champs.password,
      ville: champs.ville || undefined,
    };

    if (coordonnees) {
      donnees.localisation = { coordinates: coordonnees };
    }

    if (estCoach && (champs.diplomeIntitule || champs.diplomeOrganisme)) {
      donnees.diplome = {
        intitule: champs.diplomeIntitule,
        organisme: champs.diplomeOrganisme,
      };
    }

    try {
      await inscription(donnees);
      naviguer('/home', { replace: true });
    } catch (erreur) {
      const { parChamp, global } = traiterErreurApi(erreur);
      // Le serveur nomme les champs imbriques « diplome.intitule ».
      // On les remappe vers les noms plats du formulaire.
      if (parChamp['diplome.intitule']) parChamp.diplomeIntitule = parChamp['diplome.intitule'];
      if (parChamp['diplome.organisme']) parChamp.diplomeOrganisme = parChamp['diplome.organisme'];
      setErreurs(parChamp);
      setErreurGlobale(global);
    } finally {
      setChargement(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ardoise-50 px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-ardoise-900">
            Coach<span className="text-marque-500">Connect</span>
          </h1>
          <p className="mt-2 text-sm text-ardoise-500">
            Rejoignez la communauté et trouvez votre coach
          </p>
        </div>

        <div className="rounded-carte border border-ardoise-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="mb-6 text-xl font-bold text-ardoise-900">Créer un compte</h2>

          {erreurGlobale && (
            <Alert variante="erreur" className="mb-5">
              {erreurGlobale}
            </Alert>
          )}

          <form onSubmit={soumettre} noValidate className="space-y-4">
            {/* Type de compte */}
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-ardoise-700">
                Je suis...
              </legend>
              <div className="flex gap-3">
                <ChoixType
                  valeur="utilisateur"
                  actuel={champs.type}
                  titre="Sportif"
                  description="Je cherche un coach et des événements"
                  onSelect={(v) => setChamps((p) => ({ ...p, type: v }))}
                />
                <ChoixType
                  valeur="coach"
                  actuel={champs.type}
                  titre="Coach"
                  description="Je propose des séances et des programmes"
                  onSelect={(v) => setChamps((p) => ({ ...p, type: v }))}
                />
              </div>
            </fieldset>

            {/* Identite — cote a cote des la largeur « small » */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                libelle="Prénom"
                value={champs.prenom}
                onChange={modifier('prenom')}
                erreur={erreurs.prenom}
                autoComplete="given-name"
                required
              />
              <Input
                libelle="Nom"
                value={champs.nom}
                onChange={modifier('nom')}
                erreur={erreurs.nom}
                autoComplete="family-name"
                required
              />
            </div>

            <Input
              libelle="Pseudo"
              value={champs.pseudo}
              onChange={modifier('pseudo')}
              erreur={erreurs.pseudo}
              aide="Lettres, chiffres, point, tiret et underscore"
              placeholder="julie.sport"
              autoComplete="username"
              required
            />

            <Input
              libelle="Email"
              type="email"
              value={champs.email}
              onChange={modifier('email')}
              erreur={erreurs.email}
              placeholder="julie@exemple.fr"
              autoComplete="email"
              required
            />

            {/* Mot de passe et indicateur de robustesse */}
            <div>
              <Input
                libelle="Mot de passe"
                type="password"
                value={champs.password}
                onChange={modifier('password')}
                erreur={erreurs.password}
                autoComplete="new-password"
                required
              />

              {champs.password && (
                <div className="mt-2">
                  <div className="flex gap-1" aria-hidden="true">
                    {Array.from({ length: robustesse.total }).map((_, index) => (
                      <span
                        key={index}
                        className={`h-1 flex-1 rounded-full ${
                          index < robustesse.score
                            ? robustesse.estValide
                              ? 'bg-succes'
                              : 'bg-alerte'
                            : 'bg-ardoise-200'
                        }`}
                      />
                    ))}
                  </div>
                  <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                    {robustesse.criteres.map((critere) => (
                      <li
                        key={critere.libelle}
                        className={`text-xs ${
                          critere.valide ? 'text-succes' : 'text-ardoise-400'
                        }`}
                      >
                        {critere.valide ? '✓' : '○'} {critere.libelle}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <Input
              libelle="Ville"
              value={champs.ville}
              onChange={modifier('ville')}
              erreur={erreurs.ville}
              placeholder="Lyon"
              autoComplete="address-level2"
            />

            {/* Champs coach, affiches uniquement si pertinents */}
            {estCoach && (
              <fieldset className="space-y-4 rounded-xl border border-ardoise-200 bg-ardoise-50 p-4">
                <legend className="px-1 text-sm font-semibold text-ardoise-700">
                  Votre diplôme
                </legend>

                <Alert variante="info">
                  Votre diplôme sera vérifié par notre équipe. Le badge
                  « coach certifié » et la possibilité de proposer du contenu
                  premium seront débloqués après validation.
                </Alert>

                <Input
                  libelle="Intitulé du diplôme"
                  value={champs.diplomeIntitule}
                  onChange={modifier('diplomeIntitule')}
                  erreur={erreurs.diplomeIntitule}
                  placeholder="BPJEPS Activités de la Forme"
                />

                <Input
                  libelle="Organisme délivreur"
                  value={champs.diplomeOrganisme}
                  onChange={modifier('diplomeOrganisme')}
                  erreur={erreurs.diplomeOrganisme}
                  placeholder="DRJSCS"
                />

                <p className="text-xs text-ardoise-500">
                  Le justificatif sera à téléverser depuis votre profil.
                </p>
              </fieldset>
            )}

            {/* Geolocalisation facultative */}
            <div className="rounded-xl border border-ardoise-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ardoise-700">
                    Position (facultatif)
                  </p>
                  <p className="mt-0.5 text-xs text-ardoise-500">
                    {estCoach
                      ? 'Permet aux sportifs de vous trouver sur la carte'
                      : 'Permet de vous proposer les coachs de votre ville'}
                  </p>
                </div>

                <Button
                  variante="secondaire"
                  taille="sm"
                  onClick={localiser}
                  chargement={etatGeo === 'encours'}
                  disabled={etatGeo === 'ok'}
                >
                  {etatGeo === 'ok' ? 'Position enregistree' : 'Me localiser'}
                </Button>
              </div>

              {etatGeo === 'refuse' && (
                <p className="mt-2 text-xs text-alerte">
                  Position indisponible. Vous pourrez l&apos;ajouter plus tard
                  depuis votre profil.
                </p>
              )}
            </div>

            <Button type="submit" pleineLargeur taille="lg" chargement={chargement}>
              {chargement ? 'Creation du compte...' : 'Créer mon compte'}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-ardoise-500">
            Déjà inscrit ?{' '}
            <Link
              to="/login"
              className="font-semibold text-marque-600 hover:text-marque-700 hover:underline"
            >
              Se connecter
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
