import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import postApi from '@/api/post.api';
import useAuth from '@/hooks/useAuth';
import StoryBar from '@/components/story/StoryBar';
import Suggestions from '@/components/profile/Suggestions';
import PostForm from '@/components/post/PostForm';
import PostCard from '@/components/post/PostCard';
import Alert from '@/components/ui/Alert';
import Spinner from '@/components/ui/Spinner';
import Button from '@/components/ui/Button';

/**
 * Fil d'actualite — /home
 *
 * DEFILEMENT INFINI PAR IntersectionObserver.
 * Une sentinelle invisible est placee sous la liste ; des qu'elle entre dans
 * la fenetre, la page suivante est demandee.
 *
 * On prefere cette approche a un ecouteur sur `scroll` : ce dernier se
 * declenche des dizaines de fois par seconde et impose de calculer soi-meme
 * les positions, ce qui saccade sur mobile. L'observateur est gere par le
 * navigateur et ne reveille le code qu'au franchissement du seuil.
 */
export default function Home() {
  const { utilisateur, estCoach } = useAuth();

  const [posts, setPosts] = useState([]);
  const [curseur, setCurseur] = useState(null);
  const [aSuivante, setASuivante] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [chargementSuite, setChargementSuite] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);

  const sentinelle = useRef(null);

  const charger = useCallback(async (curseurCourant = null) => {
    const premierePage = !curseurCourant;
    if (premierePage) setChargement(true);
    else setChargementSuite(true);

    try {
      const reponse = await postApi.feed({ curseur: curseurCourant });
      setPosts((precedents) =>
        premierePage ? reponse.data.elements : [...precedents, ...reponse.data.elements]
      );
      setCurseur(reponse.data.curseurSuivant);
      setASuivante(reponse.data.aSuivante);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setChargement(false);
      setChargementSuite(false);
    }
  }, []);

  useEffect(() => {
    charger();
  }, [charger]);

  /* ---------------- Defilement infini ---------------- */

  useEffect(() => {
    if (!aSuivante || chargementSuite) return;

    const cible = sentinelle.current;
    if (!cible) return;

    const observateur = new IntersectionObserver(
      (entrees) => {
        if (entrees[0].isIntersecting) charger(curseur);
      },
      // `rootMargin` declenche le chargement 300 px AVANT que la sentinelle
      // soit visible : la suite est prete quand l'utilisateur y arrive,
      // et le fil ne s'interrompt jamais.
      { rootMargin: '300px' }
    );

    observateur.observe(cible);
    return () => observateur.disconnect();
  }, [aSuivante, chargementSuite, curseur, charger]);

  /* ---------------- Actions ---------------- */

  const surPublication = (post) => {
    setPosts((precedents) => [post, ...precedents]);
    setFormulaireOuvert(false);
  };

  const surSuppression = (id) => {
    setPosts((precedents) => precedents.filter((p) => p._id !== id));
  };

  /* ---------------- Rappels d'action ---------------- */

  const diplome = utilisateur.diplome || {};
  const aFaire = [];
  if (estCoach && diplome.statut === 'non_soumis') {
    aFaire.push({
      texte: 'Soumettez votre diplôme pour obtenir le badge « coach certifié »',
      lien: '/coach/diplome',
      libelleLien: 'Soumettre',
      variante: 'alerte',
    });
  }
  if (estCoach && diplome.statut === 'refuse') {
    aFaire.push({
      texte: `Diplôme refusé : ${diplome.motifRefus || 'motif non precise'}`,
      lien: '/coach/diplome',
      libelleLien: 'Corriger',
      variante: 'erreur',
    });
  }
  if (!utilisateur.avatar?.url) {
    aFaire.push({
      texte: 'Ajoutez une photo de profil',
      lien: '/settings',
      libelleLien: 'Ajouter',
      variante: 'info',
    });
  }

  return (
    <div className="space-y-4">
      <StoryBar />

      {aFaire.map((action) => (
        <Alert key={action.texte} variante={action.variante}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{action.texte}</span>
            <Link to={action.lien} className="shrink-0 font-semibold underline hover:no-underline">
              {action.libelleLien}
            </Link>
          </div>
        </Alert>
      ))}

      {/* ---------- Publication ---------- */}
      {formulaireOuvert ? (
        <PostForm onPublie={surPublication} />
      ) : (
        <button
          onClick={() => setFormulaireOuvert(true)}
          className="w-full rounded-carte border border-ardoise-200 bg-white p-4 text-left text-sm text-ardoise-400 hover:border-ardoise-300"
        >
          Partagez votre séance, {utilisateur.prenom}...
        </button>
      )}

      {erreur && <Alert variante="erreur">{erreur}</Alert>}

      {/* ---------- Fil ---------- */}
      {chargement ? (
        <div className="flex justify-center py-16">
          <Spinner taille="lg" className="text-marque-500" />
        </div>
      ) : posts.length === 0 ? (
        <>
          <div className="rounded-carte border border-dashed border-ardoise-300 p-10 text-center">
            <p className="text-3xl" aria-hidden="true">📭</p>
            <p className="mt-3 text-sm font-semibold text-ardoise-800">
              Votre fil est vide
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-ardoise-500">
              Publiez votre première séance, ou suivez des coachs pour voir leurs
              publications apparaitre ici.
            </p>
            <Button
              variante="secondaire"
              taille="sm"
              className="mt-4"
              onClick={() => setFormulaireOuvert(true)}
            >
              Publier
            </Button>
          </div>

          {/* Sur un fil vide, la suggestion n'est pas un ornement : c'est la
              seule action qui remplira le fil. */}
          <Suggestions />
        </>
      ) : (
        <>
          <div className="space-y-4">
            {posts.map((post) => (
              <PostCard key={post._id} post={post} onSupprime={surSuppression} />
            ))}
          </div>

          {/* Sentinelle du defilement infini */}
          <div ref={sentinelle} className="h-4" aria-hidden="true" />

          {chargementSuite && (
            <div className="flex justify-center py-4">
              <Spinner className="text-marque-500" />
            </div>
          )}

          {!aSuivante && posts.length > 0 && (
            <p className="py-4 text-center text-xs text-ardoise-400">
              Vous avez tout vu.
            </p>
          )}
        </>
      )}
    </div>
  );
}
