import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import userApi from '@/api/user.api';
import postApi from '@/api/post.api';
import PostCard from '@/components/post/PostCard';
import BoutonSuivre from '@/components/profile/BoutonSuivre';
import BoutonAbonnement from '@/components/profile/BoutonAbonnement';
import BoutonMessage from '@/components/profile/BoutonMessage';
import ModaleAbonnes from '@/components/profile/ModaleAbonnes';
import Avatar from '@/components/ui/Avatar';
import Badge, { BadgeDiplome } from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import Spinner from '@/components/ui/Spinner';

/**
 * Page de profil — /profile/:identifiant
 *
 * L'identifiant accepte un pseudo ou un ObjectId : le serveur resout les
 * deux. Les URL lisibles (/profile/julie.sport) sont partageables et
 * memorisables, ce qui compte sur un reseau social.
 *
 * LE POINT IMPORTANT : LA CONFIDENTIALITE
 * Le serveur renvoie `contenuVisible` et `relation`. La page ne recalcule
 * jamais ces regles — elle se contente de les appliquer. Dupliquer la
 * logique d'acces cote client, c'est prendre le risque qu'elle diverge de
 * celle du serveur, et donner un faux sentiment de securite.
 */

/**
 * Statistique du profil.
 *
 * Rendue cliquable quand `onClick` est fourni — c'est le cas des compteurs
 * d'abonnés et d'abonnements, qui ouvrent la liste correspondante. Le nombre
 * de publications, lui, n'a pas de liste à ouvrir : il reste inerte, et
 * n'est alors pas rendu comme un bouton pour ne pas suggérer une action
 * qui n'existe pas.
 */
function Stat({ valeur, libelle, onClick }) {
  const contenu = (
    <>
      <p className="text-lg font-bold text-ardoise-900 tabular-nums">{valeur ?? 0}</p>
      <p className="text-xs text-ardoise-500">{libelle}</p>
    </>
  );

  if (!onClick) return <div className="text-center">{contenu}</div>;

  return (
    <button
      onClick={onClick}
      className="rounded-lg text-center transition-colors hover:bg-ardoise-50"
    >
      {contenu}
    </button>
  );
}

export default function Profile() {
  const { identifiant } = useParams();

  const [donnees, setDonnees] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  const [posts, setPosts] = useState([]);
  const [curseurPosts, setCurseurPosts] = useState(null);
  const [aSuivante, setASuivante] = useState(false);
  const [chargementPosts, setChargementPosts] = useState(true);

  const [listeOuverte, setListeOuverte] = useState(null); // 'abonnes' | 'abonnements'
  const ouvrirListe = (onglet) => setListeOuverte(onglet);

  /**
   * Chargement des publications, independant de celui du profil.
   *
   * Deux appels separes plutot qu'un seul : l'en-tete du profil s'affiche
   * des sa reception, sans attendre les publications. Sur une connexion
   * lente, l'utilisateur voit immediatement de qui il s'agit.
   */
  const chargerPosts = useCallback(
    async (curseurCourant = null) => {
      setChargementPosts(true);
      try {
        const reponse = await postApi.parUtilisateur(identifiant, {
          curseur: curseurCourant,
        });
        setPosts((precedents) =>
          curseurCourant ? [...precedents, ...reponse.data.elements] : reponse.data.elements
        );
        setCurseurPosts(reponse.data.curseurSuivant);
        setASuivante(reponse.data.aSuivante);
      } catch {
        // Un profil prive renvoie une liste vide, pas une erreur :
        // l'en-tete reste affiche avec le message « compte prive ».
        setPosts([]);
      } finally {
        setChargementPosts(false);
      }
    },
    [identifiant]
  );

  /**
   * Rechargement apres un changement d'abonnement premium.
   *
   * S'ABONNER OU RESILIER CHANGE CE QUE LE SERVEUR ACCEPTE DE RENVOYER.
   * Les publications premium sont verrouillees cote serveur : leurs medias
   * et leur description sont retires de la reponse HTTP, pas seulement
   * masques a l'ecran. Un abonnement qui commence — ou qui s'arrete — ne
   * peut donc pas se refleter en modifiant l'etat local : il faut redemander
   * les publications pour obtenir la version deverrouillee (ou reverrouillee).
   *
   * On repart du debut de la liste, sans curseur : les elements deja charges
   * portent l'ancien niveau d'acces et doivent etre remplaces.
   */
  const rechargerApresAbonnement = useCallback(() => {
    setCurseurPosts(null);
    chargerPosts(null);
  }, [chargerPosts]);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur(null);

    userApi
      .profil(identifiant)
      .then((reponse) => {
        if (!annule) setDonnees(reponse.data);
      })
      .catch((e) => {
        if (!annule) setErreur(e.message || 'Profil introuvable');
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });

    return () => {
      annule = true;
    };
    // La dependance sur `identifiant` est essentielle : sans elle, naviguer
    // d'un profil a un autre laisserait les donnees du precedent affichees.
  }, [identifiant]);

  useEffect(() => {
    chargerPosts();
  }, [chargerPosts]);

  /**
   * Réaction à un changement de relation depuis le bouton de suivi.
   *
   * DEUX EFFETS À DISTINGUER :
   *
   * 1. LE COMPTEUR. Il n'évolue que pour un abonnement réellement accepté.
   *    Une demande en attente ne compte pas — même règle que côté serveur,
   *    sinon l'affichage divergerait de la base dès la première demande sur
   *    un profil privé.
   *
   * 2. L'ACCÈS AU CONTENU. Sur un profil privé, devenir abonné révèle les
   *    publications, et se désabonner les masque à nouveau. Il faut donc
   *    recharger depuis le serveur : lui seul décide de ce qui est visible,
   *    et le front n'a pas les publications en réserve pour les afficher
   *    de sa propre initiative.
   */
  const surChangementRelation = useCallback(
    (nouvelle, precedente) => {
      const gagne = nouvelle === 'abonne' && precedente !== 'abonne';
      const perdu = precedente === 'abonne' && nouvelle !== 'abonne';

      setDonnees((precedentes) => {
        if (!precedentes) return precedentes;
        const delta = gagne ? 1 : perdu ? -1 : 0;
        return {
          ...precedentes,
          relation: nouvelle,
          profil: {
            ...precedentes.profil,
            stats: {
              ...precedentes.profil.stats,
              followersCount: Math.max(
                0,
                (precedentes.profil.stats?.followersCount || 0) + delta
              ),
            },
          },
        };
      });

      // Sur un profil public, le contenu était déjà visible : inutile de
      // recharger. Sur un profil privé, l'accès vient de changer.
      if ((gagne || perdu) && donnees?.profil?.visibilite === 'prive') {
        userApi
          .profil(identifiant)
          .then((reponse) => setDonnees(reponse.data))
          .catch(() => {});
        chargerPosts();
      }
    },
    [identifiant, chargerPosts, donnees?.profil?.visibilite]
  );

  if (chargement) {
    return (
      <div className="flex justify-center py-20">
        <Spinner taille="lg" className="text-marque-500" />
      </div>
    );
  }

  if (erreur) {
    return (
      <Alert variante="erreur" titre="Profil introuvable">
        {erreur}
      </Alert>
    );
  }

  const { profil, relation, contenuVisible, estPriveNonAccessible } = donnees;
  const estMoi = relation === 'soi';
  const estCoach = profil.type === 'coach';

  return (
    <div className="space-y-4">
      {/* ---------- En-tete du profil ---------- */}
      <section className="rounded-carte border border-ardoise-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Avatar utilisateur={profil} taille="xl" className="mx-auto sm:mx-0" />

          <div className="min-w-0 flex-1 text-center sm:text-left">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <h1 className="text-xl font-bold text-ardoise-900">
                {profil.prenom} {profil.nom}
              </h1>

              {profil.estCertifie && <Badge variante="succes">✓ Certifié</Badge>}
              {profil.visibilite === 'prive' && <Badge variante="neutre">Privé</Badge>}
              {estCoach && !profil.estCertifie && <Badge variante="marque">Coach</Badge>}
            </div>

            <p className="mt-0.5 text-sm text-ardoise-500">
              @{profil.pseudo}
              {profil.ville && ` · ${profil.ville}`}
            </p>

            {profil.bio && (
              <p className="mt-3 text-sm leading-relaxed text-ardoise-700">{profil.bio}</p>
            )}

            {profil.sports?.length > 0 && (
              <ul className="mt-3 flex flex-wrap justify-center gap-1.5 sm:justify-start">
                {profil.sports.map((sport) => (
                  <li key={sport}>
                    <Badge variante="neutre">{sport}</Badge>
                  </li>
                ))}
              </ul>
            )}

            {/* Actions : editer si c'est moi, suivre sinon */}
            <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
              {estMoi ? (
                <Link to="/settings">
                  <Button variante="secondaire" taille="sm">
                    Modifier mon profil
                  </Button>
                </Link>
              ) : (
                <div className="space-y-2">
                  <BoutonSuivre
                    identifiant={profil.pseudo}
                    relationInitiale={relation}
                    onChangement={surChangementRelation}
                  />

                  {/*
                    L'abonnement premium est DISTINCT du suivi gratuit : on
                    peut suivre un coach sans payer, et payer sans suivre. Le
                    composant ne s'affiche de lui-meme que si le coach vend
                    reellement quelque chose.
                  */}
                  <BoutonAbonnement
                    coach={profil}
                    estMoi={estMoi}
                    surChangement={rechargerApresAbonnement}
                  />

                  {/*
                    Point d entree de la messagerie (module 11). Sans lui, on
                    pouvait repondre a un fil existant mais jamais en ouvrir
                    un : la fonctionnalite etait complete et pourtant
                    inatteignable.
                  */}
                  <BoutonMessage profil={profil} estMoi={estMoi} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ---------- Statistiques ---------- */}
        <div className="mt-5 grid grid-cols-3 gap-2 border-t border-ardoise-100 pt-4">
          <Stat valeur={profil.stats?.postsCount} libelle="Publications" />
          <Stat
            valeur={profil.stats?.followersCount}
            libelle="Abonnés"
            onClick={() => ouvrirListe('abonnes')}
          />
          <Stat
            valeur={profil.stats?.followingCount}
            libelle="Abonnements"
            onClick={() => ouvrirListe('abonnements')}
          />
        </div>
      </section>

      <ModaleAbonnes
        ouvert={listeOuverte !== null}
        onFermer={() => setListeOuverte(null)}
        identifiant={profil.pseudo}
        onglet={listeOuverte || 'abonnes'}
        estMonProfil={estMoi}
      />

      {/* ---------- Bloc coach ---------- */}
      {estCoach && (
        <section className="rounded-carte border border-ardoise-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-bold text-ardoise-900">Qualification</h2>

          <div className="flex flex-wrap items-center gap-2">
            <BadgeDiplome statut={profil.diplome?.statut} />
            {profil.diplome?.intitule && (
              <span className="text-sm text-ardoise-600">
                {profil.diplome.intitule}
                {profil.diplome.organisme && ` — ${profil.diplome.organisme}`}
              </span>
            )}
          </div>

          {/* Le motif de refus n'est renvoye qu'au proprietaire :
              versionPublique ne le contient pas. */}
          {estMoi && profil.diplome?.motifRefus && (
            <Alert variante="erreur" className="mt-3" titre="Motif du refus">
              {profil.diplome.motifRefus}
            </Alert>
          )}

          {/* Offre premium : uniquement si le coach peut reellement vendre */}
          {profil.premium?.actif && profil.premium?.prixMensuel && (
            <div className="mt-4 rounded-xl border border-marque-200 bg-marque-50 p-4">
              <p className="text-sm font-semibold text-marque-800">Abonnement premium</p>
              <p className="mt-1 text-2xl font-bold text-marque-700">
                {(profil.premium.prixMensuel / 100).toFixed(2)} €
                <span className="text-sm font-normal text-marque-600"> / mois</span>
              </p>
              {profil.premium.description && (
                <p className="mt-2 text-sm text-marque-800">{profil.premium.description}</p>
              )}
              <Button taille="sm" className="mt-3" disabled title="Disponible au module 7">
                S&apos;abonner
              </Button>
            </div>
          )}
        </section>
      )}

      {/* ---------- Contenu ---------- */}
      {estPriveNonAccessible ? (
        <section className="rounded-carte border border-ardoise-200 bg-white p-10 text-center">
          <p className="text-3xl" aria-hidden="true">🔒</p>
          <h2 className="mt-3 text-base font-bold text-ardoise-900">Ce compte est privé</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ardoise-500">
            Suivez {profil.prenom} pour voir ses publications. La demande devra
            être acceptée.
          </p>
        </section>
      ) : chargementPosts && posts.length === 0 ? (
        <div className="flex justify-center py-12">
          <Spinner taille="lg" className="text-marque-500" />
        </div>
      ) : posts.length === 0 ? (
        <section className="rounded-carte border border-dashed border-ardoise-300 p-10 text-center">
          <p className="text-3xl" aria-hidden="true">📷</p>
          <p className="mt-3 text-sm text-ardoise-500">
            {estMoi
              ? "Vous n'avez encore rien publie."
              : `${profil.prenom} n'a encore rien publie.`}
          </p>
          {estMoi && (
            <Link to="/home" className="mt-3 inline-block">
              <Button variante="secondaire" taille="sm">
                Publier
              </Button>
            </Link>
          )}
        </section>
      ) : (
        <>
          <div className="space-y-4">
            {posts.map((post) => (
              <PostCard
                key={post._id}
                post={post}
                onSupprime={(id) => setPosts((p) => p.filter((x) => x._id !== id))}
              />
            ))}
          </div>

          {aSuivante && (
            <div className="flex justify-center pt-2">
              <Button
                variante="secondaire"
                taille="sm"
                chargement={chargementPosts}
                onClick={() => chargerPosts(curseurPosts)}
              >
                Voir plus de publications
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
