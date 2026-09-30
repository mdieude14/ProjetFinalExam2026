import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';

import useAuth from '@/hooks/useAuth';
import { supportApi, supportDisponible } from '@/api/support.api';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

/**
 * ===========================================================================
 *  WIDGET DE SUPPORT — module 15
 * ===========================================================================
 *
 * Une pastille en bas à droite, un panneau de conversation au clic.
 *
 * TROIS CONDITIONS POUR QU'IL S'AFFICHE, et chacune évite un défaut précis :
 *
 *   une session ouverte   l'agent répond à partir des données de la personne ;
 *                         sans jeton il n'aurait rien à consulter
 *   une URL d'agent       absente, le widget est MASQUÉ et non cassé — le
 *                         support est une couche en plus, pas une dépendance
 *   hors back-office      un administrateur y instruit les dossiers ; lui
 *                         proposer le widget mélangerait les deux rôles
 *
 * L'ORIGINE EST TRANSMISE AVEC LA QUESTION. La même phrase n'appelle pas la
 * même réponse selon qu'elle est tapée depuis « Mon diplôme » ou depuis le
 * fil d'actualité, et l'agent n'a aucun autre moyen de le savoir.
 * ===========================================================================
 */
/** Le jour, sans l'heure : « répondu le 24 septembre » se suffit à lui-même. */
const dateCourte = (valeur) =>
  new Date(valeur).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

/** De quoi reconnaître SA demande parmi plusieurs, sans réécrire le dossier. */
const extrait = (question, max = 60) =>
  question.length > max ? `${question.slice(0, max - 1).trimEnd()}…` : question;

export default function WidgetSupport() {
  const { utilisateur } = useAuth();
  const { pathname } = useLocation();

  const [ouvert, setOuvert] = useState(false);
  const [saisie, setSaisie] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [echanges, setEchanges] = useState([]);
  const [avis, setAvis] = useState([]);

  const boutonRef = useRef(null);
  const champRef = useRef(null);
  const filRef = useRef(null);
  const avisDemande = useRef(false);

  /* ------------------------- Conditions d'affichage ------------------------ */

  const masque =
    !utilisateur || !supportDisponible() || pathname.startsWith('/admin');

  /*
   * PAS SUR LA MESSAGERIE, EN DESSOUS DE `lg`. Une conversation y occupe tout
   * l'écran et sa zone de saisie est en bas à droite : le bouton flottant
   * recouvrait « Envoyer » à 375 px — mesuré. Aucune position fixe ne convient
   * à tous les écrans ; l'assistance reste accessible depuis toutes les
   * autres pages. Masqué en CSS (`hidden lg:flex`), sans écouter la taille
   * de la fenêtre : sur ordinateur, rien n'est recouvert et il reste visible.
   */
  const affichage = pathname.startsWith('/messages') ? 'hidden lg:flex' : 'flex';

  /* ------------------------------ Fermeture ------------------------------ */

  /*
   * ÉCHAP EST POSÉ SUR LE DOCUMENT, PAS SUR LE PANNEAU.
   *
   * Le défaut rencontré au module 14 sur le menu « ⋯ » : un écouteur porté
   * par le panneau ne reçoit la touche que si le focus y est déjà. Ouvert à
   * la souris, le focus reste sur le bouton — et Échap ne fermait rien.
   */
  useEffect(() => {
    if (!ouvert) return undefined;

    const surTouche = (e) => {
      if (e.key !== 'Escape') return;
      setOuvert(false);
      boutonRef.current?.focus();
    };

    document.addEventListener('keydown', surTouche);
    return () => document.removeEventListener('keydown', surTouche);
  }, [ouvert]);

  /* Le champ prend le focus à l'ouverture : on vient pour écrire. */
  useEffect(() => {
    if (ouvert) champRef.current?.focus();
  }, [ouvert]);

  /* Le fil se déroule vers le bas à chaque échange. */
  useEffect(() => {
    filRef.current?.scrollTo({ top: filRef.current.scrollHeight, behavior: 'smooth' });
  }, [echanges, envoi]);

  /* ------------------------ Réponses de l'équipe ------------------------ */

  /*
   * « UNE RÉPONSE VOUS A ÉTÉ ENVOYÉE PAR E-MAIL. »
   *
   * Un dossier remonté se termine par un courriel écrit par l'équipe, dans la
   * boîte de la personne. Sans cet avis, quelqu'un qui revient ici verrait sa
   * question sans suite, et n'aurait aucune raison d'aller regarder ses
   * courriels — le dossier serait traité, et elle l'ignorerait.
   *
   * LE TEXTE N'EST PAS RECOPIÉ ICI, seulement son existence. Il vit dans la
   * boîte de réception ; en tenir un second exemplaire obligerait à garder
   * les deux cohérents pour rien, et le serveur ne l'expose d'ailleurs pas à
   * l'auteur.
   *
   * À LA PREMIÈRE OUVERTURE, PAS AU MONTAGE. Le widget est présent sur toutes
   * les pages : interroger le serveur à chaque navigation coûterait une
   * requête par écran visité, pour un avis que la plupart n'ouvriront jamais.
   *
   * L'ÉCHEC EST SILENCIEUX. Le support est une couche en plus : une panne de
   * cette relecture ne doit pas empêcher de poser une question.
   */
  useEffect(() => {
    if (!ouvert || avisDemande.current) return undefined;
    avisDemande.current = true;

    let vivant = true;

    (async () => {
      try {
        const reponse = await supportApi.mesTickets({ limite: 20 });
        const aAnnoncer = (reponse.data?.elements ?? []).filter(
          (dossier) => dossier.reponseEnvoyeeLe && !dossier.vueParAuteurLe
        );

        if (!vivant || aAnnoncer.length === 0) return;
        setAvis(aAnnoncer);

        /*
         * MARQUÉ VU DÈS L'AFFICHAGE, et le sens de l'échec est le bon : si le
         * marquage échoue, l'avis reparaîtra à la prochaine ouverture. Mieux
         * vaut le redire une fois de trop que de le perdre.
         *
         * `allSettled` et non `all` : un dossier qui refuserait le marquage ne
         * doit pas emporter les autres.
         */
        await Promise.allSettled(aAnnoncer.map((dossier) => supportApi.marquerVu(dossier._id)));
      } catch (erreur) {
        console.error('[SUPPORT] Relecture des dossiers impossible :', erreur?.message);
      }
    })();

    return () => { vivant = false; };
  }, [ouvert]);

  /* ------------------------------- Envoi ------------------------------- */

  const envoyer = useCallback(
    async (e) => {
      e.preventDefault();

      const question = saisie.trim();
      if (!question || envoi) return;

      setSaisie('');
      setEchanges((liste) => [...liste, { role: 'moi', texte: question }]);
      setEnvoi(true);

      try {
        const reponse = await supportApi.demander(question, pathname);

        /*
         * ON NE SUPPOSE PAS LA FORME DE LA RÉPONSE.
         * Elle vient d'un workflow n8n, que l'on peut modifier sans toucher à
         * ce fichier : trois noms de champ plausibles.
         *
         * AUCUN DES TROIS = UNE PANNE, PAS UNE RÉPONSE. Le repli d'origine
         * affichait « un conseiller va prendre le relais » — une promesse que
         * rien ne tenait : lors du premier essai de l'agent, une erreur réseau
         * a arrêté le workflow, le widget a reçu un 200 vide, et AUCUN ticket
         * n'existait. Seul le workflow sait si une escalade a été enregistrée ;
         * le widget, lui, doit dire que le service est indisponible.
         */
        const texte = reponse?.data?.reponse ?? reponse?.data?.message ?? reponse?.data?.output;
        if (typeof texte !== 'string' || !texte.trim()) {
          throw new Error('Réponse de l’agent vide ou inattendue');
        }

        setEchanges((liste) => [
          ...liste,
          { role: 'agent', texte, escalade: Boolean(reponse?.data?.escalade) },
        ]);
      } catch (erreur) {
        /*
         * UN ÉCHEC DE L'AGENT N'EST PAS UNE ERREUR DE L'UTILISATEUR.
         * On ne montre ni code HTTP ni message technique : on dit ce qui se
         * passe ensuite. Le détail part en console pour le diagnostic.
         */
        console.error('[SUPPORT] Échec de l’agent :', erreur?.message);
        setEchanges((liste) => [
          ...liste,
          {
            role: 'agent',
            texte:
              'Le service d’assistance est momentanément indisponible. ' +
              'Réessayez dans un instant, ou écrivez-nous directement.',
            erreur: true,
          },
        ]);
      } finally {
        setEnvoi(false);
      }
    },
    [saisie, envoi, pathname]
  );

  if (masque) return null;

  /* ------------------------------- Rendu ------------------------------- */

  return (
    <>
      {/*
        Le panneau est monté AVANT le bouton dans le DOM mais positionné
        au-dessus : un lecteur d'écran rencontre ainsi la conversation avant
        le bouton qui l'a ouverte.
      */}
      {ouvert && (
        <div
          role="dialog"
          aria-label="Assistance CoachConnect"
          data-test="widget-support-panneau"
          className={`fixed bottom-36 right-5 z-40 ${affichage} h-[28rem] w-[min(22rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-carte border border-ardoise-200 bg-white shadow-xl lg:bottom-24`}
        >
          <header className="flex items-center justify-between border-b border-ardoise-100 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-ardoise-900">Assistance</p>
              <p className="text-xs text-ardoise-500">
                {utilisateur.type === 'coach' ? 'Espace coach' : 'Espace sportif'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setOuvert(false); boutonRef.current?.focus(); }}
              aria-label="Fermer l’assistance"
              className="cursor-pointer rounded-lg px-2 py-1 text-xl leading-none text-ardoise-400 hover:bg-ardoise-100 hover:text-ardoise-700"
            >
              ×
            </button>
          </header>

          <div ref={filRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {avis.map((dossier) => (
              <div
                key={dossier._id}
                data-test="avis-reponse-courriel"
                className="rounded-carte border border-succes/30 bg-succes/5 px-3 py-3"
              >
                <p className="text-sm font-medium text-ardoise-900">
                  Une réponse vous a été envoyée par e-mail.
                </p>
                <p className="mt-1 text-xs leading-relaxed text-ardoise-600">
                  Notre équipe a répondu le {dateCourte(dossier.reponseEnvoyeeLe)} à votre demande
                  {dossier.question ? ` « ${extrait(dossier.question)} »` : ''} (réf.{' '}
                  {dossier.reference}). Le message est dans votre boîte de réception.
                </p>
              </div>
            ))}

            {echanges.length === 0 && (
              /*
                UN ÉTAT VIDE EXPLIQUE, il ne se contente pas d'être vide —
                le principe posé au module 13 pour les listes sans résultat.
              */
              <div className="rounded-carte bg-ardoise-50 px-3 py-3 text-sm text-ardoise-600">
                <p className="font-medium text-ardoise-800">Posez votre question.</p>
                <p className="mt-1 text-xs leading-relaxed">
                  {utilisateur.type === 'coach'
                    ? 'Vérification de diplôme, compte de paiement, tarif, événements…'
                    : 'Abonnements, contenu premium, événements, messagerie…'}
                </p>
              </div>
            )}

            {echanges.map((echange, i) => (
              <div
                key={i}
                className={echange.role === 'moi' ? 'flex justify-end' : 'flex justify-start'}
              >
                <p
                  data-test={`support-${echange.role}`}
                  className={`max-w-[85%] whitespace-pre-wrap rounded-carte px-3 py-2 text-sm ${
                    echange.role === 'moi'
                      ? 'bg-marque-500 text-white'
                      : echange.erreur
                        ? 'bg-erreur/10 text-erreur'
                        : 'bg-ardoise-100 text-ardoise-800'
                  }`}
                >
                  {echange.texte}
                </p>
              </div>
            ))}

            {envoi && (
              <div className="flex items-center gap-2 text-xs text-ardoise-500">
                <Spinner taille="sm" />
                <span>L’assistant consulte votre dossier…</span>
              </div>
            )}
          </div>

          <form onSubmit={envoyer} className="border-t border-ardoise-100 p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={champRef}
                value={saisie}
                onChange={(e) => setSaisie(e.target.value)}
                /*
                 * ENTRÉE ENVOIE, MAJ+ENTRÉE VA À LA LIGNE — la convention de
                 * la messagerie du module 11. Deux comportements différents
                 * pour un même geste dans une même application seraient une
                 * source d'erreur permanente.
                 */
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) envoyer(e);
                }}
                rows={2}
                maxLength={2000}
                placeholder="Votre question…"
                aria-label="Votre question"
                data-test="support-saisie"
                className="min-h-[2.75rem] flex-1 resize-none rounded-carte border border-ardoise-200 px-3 py-2 text-sm focus:border-marque-500 focus:outline-none"
              />
              <Button
                type="submit"
                variante="principal"
                taille="sm"
                disabled={!saisie.trim() || envoi}
                data-test="support-envoyer"
              >
                Envoyer
              </Button>
            </div>
          </form>
        </div>
      )}

      <button
        ref={boutonRef}
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
        aria-label={ouvert ? 'Fermer l’assistance' : 'Ouvrir l’assistance'}
        data-test="widget-support-bouton"
        /*
         * AU-DESSUS DE LA BARRE DE NAVIGATION MOBILE. Sous `lg`, cette barre
         * est fixée en bas de l'écran (4 rem). Posé à `bottom-5`, le bouton
         * recouvrait son dernier onglet : sur téléphone et tablette,
         * « Notifications » devenait impossible à toucher — mesuré à 375 et
         * 768 px, invisible à 1280 où la barre n'existe pas.
         */
        className={`fixed bottom-20 right-5 z-40 ${affichage} h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-marque-500 text-white shadow-lg transition-colors hover:bg-marque-600 active:bg-marque-700 lg:bottom-5`}
      >
        {/* Un pictogramme SEUL ne suffit pas : le libellé accessible est
            porté par aria-label, conformément au module 13. */}
        <span aria-hidden="true" className="text-2xl leading-none">
          {ouvert ? '×' : '?'}
        </span>
      </button>
    </>
  );
}
