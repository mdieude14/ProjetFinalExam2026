import { useState, useRef } from 'react';
import useAuth from '@/hooks/useAuth';
import userApi from '@/api/user.api';
import { traiterErreurApi } from '@/utils/erreurs';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import { BadgeDiplome } from '@/components/ui/Badge';

/**
 * Diplome du coach — /coach/diplome
 *
 * Soumission et suivi de la verification. L'ecran s'adapte au statut :
 *
 *   non_soumis  formulaire de premiere soumission
 *   en_attente  message d'attente, formulaire verrouille
 *   refuse      motif affiche, nouvelle soumission possible
 *   verifie     confirmation, formulaire verrouille
 *
 * Afficher le formulaire dans les quatre cas obligerait l'utilisateur a
 * comprendre lui-meme pourquoi le serveur le refuse. Ici, l'interface dit
 * ce qui est possible a l'instant present.
 */
export default function Diplome() {
  const { utilisateur, majUtilisateur } = useAuth();
  const diplome = utilisateur.diplome || {};

  const [champs, setChamps] = useState({
    intitule: diplome.intitule || '',
    organisme: diplome.organisme || '',
  });
  const [erreurs, setErreurs] = useState({});
  const [message, setMessage] = useState(null);
  const [chargement, setChargement] = useState(false);

  const enAttente = diplome.statut === 'en_attente';
  const verifie = diplome.statut === 'verifie';
  const peutSoumettre = !enAttente && !verifie;

  /* ---------------- Justificatif ---------------- */
  const champJustificatif = useRef(null);
  const [chargementJustificatif, setChargementJustificatif] = useState(false);
  const [messageJustificatif, setMessageJustificatif] = useState(null);

  /**
   * Televersement du justificatif.
   *
   * Un NOUVEAU justificatif remet le dossier en file d'attente, meme s'il
   * avait deja ete refuse : l'examen precedent portait sur un autre document.
   * C'est le serveur qui applique cette regle ; on se contente de rafraichir
   * l'etat local avec ce qu'il renvoie.
   */
  const envoyerJustificatif = async (evenement) => {
    const fichier = evenement.target.files?.[0];
    evenement.target.value = '';
    if (!fichier) return;

    setChargementJustificatif(true);
    setMessageJustificatif(null);
    try {
      const reponse = await userApi.televerserJustificatif(fichier);
      majUtilisateur({ diplome: reponse.data.diplome });
      setMessageJustificatif({ variante: 'succes', texte: reponse.data.message });
    } catch (e) {
      setMessageJustificatif({ variante: 'erreur', texte: e.message });
    } finally {
      setChargementJustificatif(false);
    }
  };

  const soumettre = async (evenement) => {
    evenement.preventDefault();
    setErreurs({});
    setMessage(null);
    setChargement(true);

    try {
      const reponse = await userApi.soumettreDiplome(champs.intitule, champs.organisme);
      majUtilisateur({ diplome: reponse.data.diplome });
      setMessage({ variante: 'succes', texte: reponse.data.message });
    } catch (erreur) {
      const { parChamp, global } = traiterErreurApi(erreur);
      setErreurs(parChamp);
      if (global) setMessage({ variante: 'erreur', texte: global });
    } finally {
      setChargement(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-ardoise-900">Mon diplôme</h1>

      {/* ---------- Statut actuel ---------- */}
      <section className="rounded-carte border border-ardoise-200 bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <BadgeDiplome statut={diplome.statut || 'non_soumis'} />
          {diplome.intitule && (
            <span className="text-sm text-ardoise-600">
              {diplome.intitule}
              {diplome.organisme && ` — ${diplome.organisme}`}
            </span>
          )}
        </div>

        {verifie && (
          <Alert variante="succes" className="mt-4" titre="Diplôme vérifié">
            Le badge « coach certifié » est affiché sur votre profil. Il vous
            reste a finaliser votre compte Stripe et a fixer votre tarif pour
            proposer du contenu premium.
          </Alert>
        )}

        {enAttente && (
          <Alert variante="info" className="mt-4" titre="Vérification en cours">
            Un administrateur examine votre dossier. Vous serez notifie de la
            decision. En attendant, vous pouvez publier du contenu gratuit.
          </Alert>
        )}

        {diplome.statut === 'refuse' && (
          <Alert variante="erreur" className="mt-4" titre="Diplôme refusé">
            {diplome.motifRefus || 'Aucun motif précisé.'}
            <p className="mt-2 text-xs">
              Corrigez les informations ci-dessous et soumettez a nouveau.
            </p>
          </Alert>
        )}
      </section>

      {/* ---------- Formulaire ---------- */}
      <section className="rounded-carte border border-ardoise-200 bg-white p-5 sm:p-6">
        <h2 className="text-base font-bold text-ardoise-900">
          {diplome.statut === 'refuse' ? 'Soumettre a nouveau' : 'Informations du diplôme'}
        </h2>

        {message && (
          <Alert variante={message.variante} className="mt-4">
            {message.texte}
          </Alert>
        )}

        <form onSubmit={soumettre} noValidate className="mt-4 space-y-4">
          <Input
            libelle="Intitulé du diplôme"
            value={champs.intitule}
            onChange={(e) => setChamps((p) => ({ ...p, intitule: e.target.value }))}
            erreur={erreurs.intitule}
            placeholder="BPJEPS Activités de la Forme"
            disabled={!peutSoumettre}
            required
          />

          <Input
            libelle="Organisme délivreur"
            value={champs.organisme}
            onChange={(e) => setChamps((p) => ({ ...p, organisme: e.target.value }))}
            erreur={erreurs.organisme}
            placeholder="DRJSCS"
            disabled={!peutSoumettre}
            required
          />

          {/* ---------- Justificatif ---------- */}
          <div className="rounded-xl border border-ardoise-200 bg-ardoise-50 p-4">
            <p className="text-sm font-medium text-ardoise-800">Justificatif</p>
            <p className="mt-0.5 text-xs text-ardoise-500">
              Photo ou PDF de votre diplome, 10 Mo maximum. Ce document n&apos;est
              visible que par vous et par l&apos;équipe de modération.
            </p>

            <input
              ref={champJustificatif}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={envoyerJustificatif}
              className="lecteur-ecran-seulement"
              id="choix-justificatif"
            />

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variante="secondaire"
                taille="sm"
                onClick={() => champJustificatif.current?.click()}
                chargement={chargementJustificatif}
                disabled={verifie}
              >
                {diplome.url ? 'Remplacer le justificatif' : 'Téléverser un justificatif'}
              </Button>

              {diplome.url && (
                <a
                  href={diplome.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-marque-600 hover:underline"
                >
                  Voir le document envoye →
                </a>
              )}
            </div>

            {messageJustificatif && (
              <Alert variante={messageJustificatif.variante} className="mt-3">
                {messageJustificatif.texte}
              </Alert>
            )}
          </div>

          <Button type="submit" chargement={chargement} disabled={!peutSoumettre}>
            {diplome.statut === 'refuse' ? 'Soumettre a nouveau' : 'Soumettre pour vérification'}
          </Button>

          {!peutSoumettre && (
            <p className="text-xs text-ardoise-500">
              {verifie
                ? 'Votre diplôme est vérifié. Contactez le support pour le modifier.'
                : 'Une vérification est déjà en cours.'}
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
