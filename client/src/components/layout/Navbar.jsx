import { useState, useEffect } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import useAuth from '@/hooks/useAuth';
import followApi from '@/api/follow.api';
import Avatar from '@/components/ui/Avatar';

/**
 * Barre de navigation des pages connectees.
 *
 * STRATEGIE RESPONSIVE : deux dispositions, un seul composant.
 *   - Desktop : liens horizontaux dans l'en-tete.
 *   - Mobile  : barre fixe en bas de l'ecran, a portee de pouce.
 *
 * C'est le schema d'Instagram et de la plupart des applications sociales :
 * en haut, une main doit traverser tout l'ecran ; en bas, le pouce y est deja.
 */

const LIENS = [
  { to: '/home', libelle: 'Accueil', icone: '⌂' },
  { to: '/maps', libelle: 'Carte', icone: '◎', bientot: true },
  { to: '/search', libelle: 'Recherche', icone: '⌕', bientot: true },
  { to: '/messages', libelle: 'Messages', icone: '✉', bientot: true },
];

function LienNav({ to, libelle, icone, bientot, mobile }) {
  // Les pages pas encore developpees restent visibles mais inertes :
  // elles montrent la structure de l'application sans mener a une 404.
  if (bientot) {
    return (
      <span
        title="Bientot disponible"
        className={
          mobile
            ? 'flex flex-1 flex-col items-center gap-0.5 py-2 text-ardoise-300'
            : 'px-3 py-2 text-sm text-ardoise-300'
        }
      >
        <span aria-hidden="true" className={mobile ? 'text-lg' : ''}>{icone}</span>
        <span className={mobile ? 'text-[10px]' : 'ml-1.5'}>{libelle}</span>
      </span>
    );
  }

  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          mobile
            ? 'flex flex-1 flex-col items-center gap-0.5 py-2'
            : 'rounded-lg px-3 py-2 text-sm font-medium',
          isActive
            ? 'text-marque-600'
            : 'text-ardoise-500 hover:text-ardoise-800',
        ].join(' ')
      }
    >
      <span aria-hidden="true" className={mobile ? 'text-lg' : ''}>{icone}</span>
      <span className={mobile ? 'text-[10px]' : 'ml-1.5'}>{libelle}</span>
    </NavLink>
  );
}

export default function Navbar() {
  const { utilisateur, deconnexion, estAdmin, estCoach } = useAuth();
  const naviguer = useNavigate();
  const emplacement = useLocation();
  const [menuOuvert, setMenuOuvert] = useState(false);
  const [nbDemandes, setNbDemandes] = useState(0);

  /**
   * Compteur de demandes de suivi en attente.
   *
   * Rafraîchi à chaque changement de page plutôt qu'à intervalle régulier :
   * un `setInterval` interrogerait le serveur en permanence, y compris sur
   * un onglet laissé ouvert toute la journée. La navigation est un moment
   * naturel de mise à jour, et le module 12 remplacera ce mécanisme par des
   * notifications temps réel via Socket.io.
   *
   * Un profil public n'a jamais de demande en attente : on n'interroge pas.
   */
  useEffect(() => {
    if (utilisateur?.visibilite !== 'prive') {
      setNbDemandes(0);
      return;
    }

    let annule = false;
    followApi
      .nombreDemandes()
      .then((reponse) => {
        if (!annule) setNbDemandes(reponse.data.nombre);
      })
      .catch(() => {
        // Échec sans conséquence : on n'affiche simplement pas de pastille.
      });

    return () => {
      annule = true;
    };
  }, [emplacement.pathname, utilisateur?.visibilite]);

  const seDeconnecter = async () => {
    setMenuOuvert(false);
    await deconnexion();
    naviguer('/login', { replace: true });
  };

  return (
    <>
      {/* ---------- En-tete ---------- */}
      <header className="sticky top-0 z-20 border-b border-ardoise-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/home" className="text-lg font-extrabold tracking-tight text-ardoise-900">
            Coach<span className="text-marque-500">Connect</span>
          </Link>

          {/* Liens horizontaux, masques sous 768 px */}
          <nav className="hidden items-center gap-1 md:flex" aria-label="Navigation principale">
            {LIENS.map((lien) => (
              <LienNav key={lien.to} {...lien} />
            ))}
          </nav>

          {/* Menu du compte */}
          <div className="relative">
            <button
              onClick={() => setMenuOuvert((v) => !v)}
              aria-expanded={menuOuvert}
              aria-haspopup="menu"
              className="relative flex items-center gap-2 rounded-full p-0.5 hover:bg-ardoise-100"
            >
              <Avatar utilisateur={utilisateur} taille="sm" />

              {/* Pastille signalant des demandes à traiter : sans elle, rien
                  n'indique qu'il y a quelque chose à faire dans un menu fermé. */}
              {nbDemandes > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-marque-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
                  {nbDemandes > 9 ? '9+' : nbDemandes}
                </span>
              )}

              <span className="lecteur-ecran-seulement">
                Menu du compte
                {nbDemandes > 0 && ` — ${nbDemandes} demande${nbDemandes > 1 ? 's' : ''} en attente`}
              </span>
            </button>

            {menuOuvert && (
              <>
                {/* Zone de clic couvrant la page : fermer en cliquant
                    ailleurs est un reflexe attendu. */}
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setMenuOuvert(false)}
                  aria-hidden="true"
                />

                <div
                  role="menu"
                  className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-ardoise-200 bg-white py-1 shadow-lg"
                >
                  <div className="border-b border-ardoise-100 px-4 py-2.5">
                    <p className="truncate text-sm font-semibold text-ardoise-900">
                      {utilisateur.prenom} {utilisateur.nom}
                    </p>
                    <p className="truncate text-xs text-ardoise-500">@{utilisateur.pseudo}</p>
                  </div>

                  <Link
                    to={`/profile/${utilisateur.pseudo}`}
                    onClick={() => setMenuOuvert(false)}
                    className="block px-4 py-2 text-sm text-ardoise-700 hover:bg-ardoise-50"
                    role="menuitem"
                  >
                    Mon profil
                  </Link>

                  <Link
                    to="/demandes"
                    onClick={() => setMenuOuvert(false)}
                    className="flex items-center justify-between px-4 py-2 text-sm text-ardoise-700 hover:bg-ardoise-50"
                    role="menuitem"
                  >
                    Demandes de suivi
                    {nbDemandes > 0 && (
                      <span className="ml-2 rounded-full bg-marque-500 px-2 py-0.5 text-xs font-bold text-white">
                        {nbDemandes}
                      </span>
                    )}
                  </Link>

                  <Link
                    to="/settings"
                    onClick={() => setMenuOuvert(false)}
                    className="block px-4 py-2 text-sm text-ardoise-700 hover:bg-ardoise-50"
                    role="menuitem"
                  >
                    Paramètres
                  </Link>

                  {estCoach && (
                    <Link
                      to="/coach/diplome"
                      onClick={() => setMenuOuvert(false)}
                      className="block px-4 py-2 text-sm text-ardoise-700 hover:bg-ardoise-50"
                      role="menuitem"
                    >
                      Mon diplôme
                    </Link>
                  )}

                  {estAdmin && (
                    <Link
                      to="/admin/moderation"
                      onClick={() => setMenuOuvert(false)}
                      className="block px-4 py-2 text-sm font-medium text-marque-600 hover:bg-marque-50"
                      role="menuitem"
                    >
                      Modération
                    </Link>
                  )}

                  <button
                    onClick={seDeconnecter}
                    className="block w-full border-t border-ardoise-100 px-4 py-2 text-left text-sm text-erreur hover:bg-red-50"
                    role="menuitem"
                  >
                    Déconnexion
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ---------- Barre inferieure, mobile uniquement ---------- */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-ardoise-200 bg-white md:hidden"
        aria-label="Navigation mobile"
      >
        {LIENS.map((lien) => (
          <LienNav key={lien.to} {...lien} mobile />
        ))}
      </nav>
    </>
  );
}
