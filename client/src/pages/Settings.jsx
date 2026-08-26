import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuth from '@/hooks/useAuth';
import Avatar from '@/components/ui/Avatar';
import userApi from '@/api/user.api';
import authApi from '@/api/auth.api';
import geoApi from '@/api/geo.api';
import { traiterErreurApi, evaluerMotDePasse } from '@/utils/erreurs';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';

/**
 * Parametres du compte — /settings
 *
 * Regroupe quatre operations independantes, chacune dans sa propre carte
 * avec son propre etat de chargement et son propre message.
 *
 * POURQUOI PAS UN SEUL GROS FORMULAIRE ?
 * Ces actions n'ont ni la meme criticite ni les memes consequences : changer
 * sa bio est anodin, changer son mot de passe deconnecte tous les autres
 * appareils, desactiver son compte est presque irreversible. Les separer rend
 * la portee de chaque bouton evidente, et evite qu'une modification de bio
 * declenche par megarde une action lourde.
 */

/** Carte de section, avec son titre et sa description. */
function Section({ titre, description, children }) {
  return (
    <section className="rounded-carte border border-ardoise-200 bg-white p-5 sm:p-6">
      <h2 className="text-base font-bold text-ardoise-900">{titre}</h2>
      {description && <p className="mt-1 text-sm text-ardoise-500">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function Settings() {
  const { utilisateur, majUtilisateur, deconnexion, estCoach } = useAuth();
  const naviguer = useNavigate();

  /* ---------------- Photo de profil ---------------- */
  const champAvatar = useRef(null);
  const [chargementAvatar, setChargementAvatar] = useState(false);
  const [messageAvatar, setMessageAvatar] = useState(null);

  const changerAvatar = async (evenement) => {
    const fichier = evenement.target.files?.[0];
    // Reinitialise le champ : sans cela, reselectionner le meme fichier
    // apres un echec ne declencherait pas d'evenement.
    evenement.target.value = '';
    if (!fichier) return;

    setChargementAvatar(true);
    setMessageAvatar(null);
    try {
      const reponse = await userApi.changerAvatar(fichier);
      majUtilisateur({ avatar: reponse.data.avatar });
      setMessageAvatar({ variante: 'succes', texte: reponse.data.message });
    } catch (e) {
      setMessageAvatar({ variante: 'erreur', texte: e.message });
    } finally {
      setChargementAvatar(false);
    }
  };

  /* ---------------- Profil ---------------- */
  const [profil, setProfil] = useState({
    prenom: utilisateur.prenom || '',
    nom: utilisateur.nom || '',
    pseudo: utilisateur.pseudo || '',
    bio: utilisateur.bio || '',
    ville: utilisateur.ville || '',
    sports: (utilisateur.sports || []).join(', '),
  });
  const [erreursProfil, setErreursProfil] = useState({});
  const [messageProfil, setMessageProfil] = useState(null);
  const [chargementProfil, setChargementProfil] = useState(false);

  const enregistrerProfil = async (evenement) => {
    evenement.preventDefault();
    setErreursProfil({});
    setMessageProfil(null);
    setChargementProfil(true);

    try {
      const reponse = await userApi.modifier({
        prenom: profil.prenom,
        nom: profil.nom,
        pseudo: profil.pseudo,
        bio: profil.bio,
        ville: profil.ville,
        // Champ texte libre converti en tableau : plus simple a saisir
        // qu'une interface a etiquettes, et suffisant a ce stade.
        sports: profil.sports
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });

      // Le contexte est mis a jour sans nouvel appel reseau : la Navbar et
      // les autres composants abonnes refletent le changement aussitot.
      majUtilisateur(reponse.data.profil);
      setMessageProfil({ variante: 'succes', texte: 'Profil enregistre' });
    } catch (erreur) {
      const { parChamp, global } = traiterErreurApi(erreur);
      setErreursProfil(parChamp);
      if (global) setMessageProfil({ variante: 'erreur', texte: global });
    } finally {
      setChargementProfil(false);
    }
  };

  /* ---------------- Visibilite ---------------- */
  const [chargementVisibilite, setChargementVisibilite] = useState(false);
  const [messageVisibilite, setMessageVisibilite] = useState(null);

  const basculerVisibilite = async () => {
    const nouvelle = utilisateur.visibilite === 'public' ? 'prive' : 'public';
    setChargementVisibilite(true);
    setMessageVisibilite(null);

    try {
      const reponse = await userApi.changerVisibilite(nouvelle);
      majUtilisateur({ visibilite: nouvelle });
      setMessageVisibilite({ variante: 'succes', texte: reponse.data.message });
    } catch (erreur) {
      setMessageVisibilite({ variante: 'erreur', texte: erreur.message });
    } finally {
      setChargementVisibilite(false);
    }
  };

  /* ---------------- Carte publique (coachs) ---------------- */

  const [carteVisible, setCarteVisible] = useState(Boolean(utilisateur.carteVisible));
  const [messageCarte, setMessageCarte] = useState(null);
  const [bascule, setBascule] = useState(false);

  /**
   * Consentement a figurer sur la carte publique des coachs.
   *
   * ON N'INVERSE PAS L'ETAT LOCAL AVANT LA REPONSE DU SERVEUR.
   * C'est un cas ou la mise a jour optimiste serait nuisible : le serveur
   * refuse l'activation tant qu'aucune position n'est enregistree, et
   * afficher « vous etes sur la carte » avant sa reponse ferait croire a un
   * succes la ou il y a un refus. Pour un reglage de confidentialite, un
   * affichage faux est pire qu'un affichage lent.
   */
  const basculerCarte = async (valeur) => {
    setBascule(true);
    setMessageCarte(null);
    try {
      const reponse = await geoApi.definirCarteVisible(valeur);
      setCarteVisible(reponse.data.carteVisible);
      majUtilisateur({ carteVisible: reponse.data.carteVisible });
      setMessageCarte({ variante: 'succes', texte: reponse.data.message });
    } catch (e) {
      setMessageCarte({ variante: 'erreur', texte: e.message });
    } finally {
      setBascule(false);
    }
  };

  /* ---------------- Position ---------------- */
  const [etatGeo, setEtatGeo] = useState('inactif');
  const [messageGeo, setMessageGeo] = useState(null);

  const localiser = () => {
    if (!navigator.geolocation) {
      setMessageGeo({ variante: 'erreur', texte: 'Geolocalisation indisponible' });
      return;
    }

    setEtatGeo('encours');
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          // GeoJSON attend [longitude, latitude] ; le navigateur fournit
          // l'inverse. La conversion se fait ici.
          await userApi.changerLocalisation(
            [position.coords.longitude, position.coords.latitude],
            profil.ville || undefined
          );
          setMessageGeo({ variante: 'succes', texte: 'Position enregistree' });
        } catch (erreur) {
          setMessageGeo({ variante: 'erreur', texte: erreur.message });
        } finally {
          setEtatGeo('inactif');
        }
      },
      () => {
        setEtatGeo('inactif');
        setMessageGeo({
          variante: 'alerte',
          texte: 'Position refusée ou indisponible',
        });
      },
      { timeout: 10000 }
    );
  };

  /* ---------------- Mot de passe ---------------- */
  const [mdp, setMdp] = useState({ ancien: '', nouveau: '' });
  const [erreursMdp, setErreursMdp] = useState({});
  const [messageMdp, setMessageMdp] = useState(null);
  const [chargementMdp, setChargementMdp] = useState(false);
  const robustesse = evaluerMotDePasse(mdp.nouveau);

  const changerMotDePasse = async (evenement) => {
    evenement.preventDefault();
    setErreursMdp({});
    setMessageMdp(null);
    setChargementMdp(true);

    try {
      const reponse = await authApi.changerMotDePasse(mdp.ancien, mdp.nouveau);
      setMdp({ ancien: '', nouveau: '' });
      setMessageMdp({ variante: 'succes', texte: reponse.data.message });
    } catch (erreur) {
      const { parChamp, global } = traiterErreurApi(erreur);
      setErreursMdp({
        ancien: parChamp.ancienPassword,
        nouveau: parChamp.nouveauPassword,
      });
      if (global) setMessageMdp({ variante: 'erreur', texte: global });
    } finally {
      setChargementMdp(false);
    }
  };

  /* ---------------- Zone sensible ---------------- */
  const [confirmation, setConfirmation] = useState('');
  const [chargementDesactivation, setChargementDesactivation] = useState(false);

  const desactiver = async () => {
    setChargementDesactivation(true);
    try {
      await userApi.desactiverCompte();
      await deconnexion();
      naviguer('/login', { replace: true });
    } catch {
      setChargementDesactivation(false);
    }
  };

  const deconnecterPartout = async () => {
    await authApi.deconnexionGlobale();
    await deconnexion();
    naviguer('/login', { replace: true });
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ardoise-900">Paramètres</h1>

      {/* ============ PHOTO DE PROFIL ============ */}
      <Section
        titre="Photo de profil"
        description="Format JPEG, PNG ou WebP. 10 Mo maximum."
      >
        {messageAvatar && (
          <Alert variante={messageAvatar.variante} className="mb-4">
            {messageAvatar.texte}
          </Alert>
        )}

        <div className="flex items-center gap-4">
          <Avatar utilisateur={utilisateur} taille="lg" />

          <div>
            <input
              ref={champAvatar}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={changerAvatar}
              className="lecteur-ecran-seulement"
              id="choix-avatar"
            />
            <Button
              variante="secondaire"
              taille="sm"
              onClick={() => champAvatar.current?.click()}
              chargement={chargementAvatar}
            >
              {utilisateur.avatar?.url ? 'Changer la photo' : 'Ajouter une photo'}
            </Button>
            <p className="mt-1.5 text-xs text-ardoise-500">
              L&apos;ancienne photo est automatiquement supprimee du stockage.
            </p>
          </div>
        </div>
      </Section>

      {/* ============ PROFIL ============ */}
      <Section titre="Profil public" description="Ces informations sont visibles sur votre page.">
        {messageProfil && (
          <Alert variante={messageProfil.variante} className="mb-4">
            {messageProfil.texte}
          </Alert>
        )}

        <form onSubmit={enregistrerProfil} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              libelle="Prénom"
              value={profil.prenom}
              onChange={(e) => setProfil((p) => ({ ...p, prenom: e.target.value }))}
              erreur={erreursProfil.prenom}
            />
            <Input
              libelle="Nom"
              value={profil.nom}
              onChange={(e) => setProfil((p) => ({ ...p, nom: e.target.value }))}
              erreur={erreursProfil.nom}
            />
          </div>

          <Input
            libelle="Pseudo"
            value={profil.pseudo}
            onChange={(e) => setProfil((p) => ({ ...p, pseudo: e.target.value }))}
            erreur={erreursProfil.pseudo}
            aide="Change l’adresse de votre profil : /profile/votre-pseudo"
          />

          <Textarea
            libelle="Bio"
            value={profil.bio}
            onChange={(e) => setProfil((p) => ({ ...p, bio: e.target.value }))}
            erreur={erreursProfil.bio}
            maxLength={300}
            rows={3}
            placeholder="Parlez de votre pratique sportive..."
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              libelle="Ville"
              value={profil.ville}
              onChange={(e) => setProfil((p) => ({ ...p, ville: e.target.value }))}
              erreur={erreursProfil.ville}
            />
            <Input
              libelle="Sports"
              value={profil.sports}
              onChange={(e) => setProfil((p) => ({ ...p, sports: e.target.value }))}
              erreur={erreursProfil.sports}
              aide="Separes par des virgules"
              placeholder="course, natation, yoga"
            />
          </div>

          <Button type="submit" chargement={chargementProfil}>
            Enregistrer
          </Button>
        </form>
      </Section>

      {/* ============ VISIBILITE ============ */}
      <Section
        titre="Confidentialité"
        description="Un profil privé reste identifiable, mais son contenu n’est visible que par vos abonnés’acceptes."
      >
        {messageVisibilite && (
          <Alert variante={messageVisibilite.variante} className="mb-4">
            {messageVisibilite.texte}
          </Alert>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ardoise-50 p-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ardoise-900">
              Profil {utilisateur.visibilite === 'prive' ? 'privé' : 'public'}
            </p>
            <p className="mt-0.5 text-xs text-ardoise-500">
              {utilisateur.visibilite === 'prive'
                ? 'Les nouvelles demandes d’abonnement doivent être approuvees'
                : 'Tout le monde peut voir vos publications'}
            </p>
          </div>

          <Button
            variante="secondaire"
            taille="sm"
            onClick={basculerVisibilite}
            chargement={chargementVisibilite}
          >
            Passer en {utilisateur.visibilite === 'prive' ? 'public' : 'privé'}
          </Button>
        </div>
      </Section>

      {/* ============ POSITION ============ */}
      <Section
        titre="Position"
        description="Utilisee pour vous proposer les coachs de votre ville et vous placer sur la carte."
      >
        {messageGeo && (
          <Alert variante={messageGeo.variante} className="mb-4">
            {messageGeo.texte}
          </Alert>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ardoise-50 p-4">
          <p className="text-sm text-ardoise-600">
            {utilisateur.localisation?.coordinates
              ? 'Position enregistree'
              : 'Aucune position enregistree'}
          </p>
          <Button
            variante="secondaire"
            taille="sm"
            onClick={localiser}
            chargement={etatGeo === 'encours'}
          >
            Mettre a jour ma position
          </Button>
        </div>
      </Section>

      {/* ============ CARTE PUBLIQUE — coachs seulement ============ */}
      {estCoach && (
        <Section
          titre="Apparaître sur la carte"
          description="Permet aux sportifs de vous trouver en cherchant un coach près de chez eux."
        >
          {messageCarte && (
            <Alert variante={messageCarte.variante} className="mb-4">
              {messageCarte.texte}
            </Alert>
          )}

          <div className="rounded-xl bg-ardoise-50 p-4">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={carteVisible}
                disabled={bascule}
                onChange={(e) => basculerCarte(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-ardoise-300"
              />
              <span className="text-sm">
                <span className="font-medium text-ardoise-800">
                  Afficher mon profil sur la carte des coachs
                </span>
                <span className="mt-1 block text-xs text-ardoise-500">
                  Votre position n&apos;est jamais publiée telle quelle : elle est
                  arrondie à environ 110 mètres avant d&apos;être affichée. Elle
                  situe votre quartier, pas votre adresse.
                </span>
                <span className="mt-1 block text-xs text-ardoise-500">
                  Désactivé par défaut. Vous pouvez le retirer à tout moment.
                </span>
              </span>
            </label>
          </div>
        </Section>
      )}

      {/* ============ MOT DE PASSE ============ */}
      <Section
        titre="Mot de passe"
        description="Le changer deconnectera automatiquement tous vos autres appareils."
      >
        {messageMdp && (
          <Alert variante={messageMdp.variante} className="mb-4">
            {messageMdp.texte}
          </Alert>
        )}

        <form onSubmit={changerMotDePasse} noValidate className="space-y-4">
          <Input
            libelle="Mot de passe actuel"
            type="password"
            value={mdp.ancien}
            onChange={(e) => setMdp((p) => ({ ...p, ancien: e.target.value }))}
            erreur={erreursMdp.ancien}
            autoComplete="current-password"
          />

          <div>
            <Input
              libelle="Nouveau mot de passe"
              type="password"
              value={mdp.nouveau}
              onChange={(e) => setMdp((p) => ({ ...p, nouveau: e.target.value }))}
              erreur={erreursMdp.nouveau}
              autoComplete="new-password"
            />

            {mdp.nouveau && (
              <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
                {robustesse.criteres.map((critere) => (
                  <li
                    key={critere.libelle}
                    className={`text-xs ${critere.valide ? 'text-succes' : 'text-ardoise-400'}`}
                  >
                    {critere.valide ? '✓' : '○'} {critere.libelle}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Button
            type="submit"
            chargement={chargementMdp}
            disabled={!robustesse.estValide || !mdp.ancien}
          >
            Changer le mot de passe
          </Button>
        </form>
      </Section>

      {/* ============ ZONE SENSIBLE ============ */}
      <Section
        titre="Zone sensible"
        description="Ces actions ont des consequences immediates sur votre compte."
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ardoise-200 p-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ardoise-900">
                Deconnecter tous les appareils
              </p>
              <p className="mt-0.5 text-xs text-ardoise-500">
                Utile si vous pensez qu’une session est restée ouverte ailleurs
              </p>
            </div>
            <Button variante="secondaire" taille="sm" onClick={deconnecterPartout}>
              Tout deconnecter
            </Button>
          </div>

          <div className="rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-900">Desactiver mon compte</p>
            <p className="mt-0.5 text-xs text-red-700">
              Votre profil deviendra invisible et vous ne pourrez plus vous
              connecter. Vos publications et messages sont conserves.
              Contactez le support pour reactiver.
            </p>

            {/* Confirmation par saisie : un simple bouton se clique par
                reflexe, taper un mot exige une intention consciente. */}
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="min-w-[200px] flex-1">
                <Input
                  libelle="Tapez DESACTIVER pour confirmer"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  placeholder="DESACTIVER"
                />
              </div>
              <Button
                variante="danger"
                onClick={desactiver}
                disabled={confirmation !== 'DESACTIVER'}
                chargement={chargementDesactivation}
              >
                Desactiver
              </Button>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
