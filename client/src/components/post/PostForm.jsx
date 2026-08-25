import { useState, useRef, useEffect } from 'react';
import postApi from '@/api/post.api';
import useAuth from '@/hooks/useAuth';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import { traiterErreurApi } from '@/utils/erreurs';

/**
 * Formulaire de publication.
 *
 * MEMES LIMITES QUE LE SERVEUR, VERIFIEES AVANT L'ENVOI.
 * Le serveur reste seul juge, mais rejeter localement une video de 150 Mo
 * evite de la televerser pendant deux minutes pour recevoir une erreur.
 * Les valeurs ci-dessous doivent rester alignees sur
 * server/src/middlewares/upload.middleware.js.
 */
const MO = 1024 * 1024;
const TAILLE_MAX_IMAGE = 10 * MO;
const TAILLE_MAX_VIDEO = 100 * MO;
const MAX_FICHIERS = 10;

const TYPES_ACCEPTES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
];

export default function PostForm({ onPublie }) {
  const { utilisateur } = useAuth();

  const [fichiers, setFichiers] = useState([]);
  const [apercus, setApercus] = useState([]);
  const [titre, setTitre] = useState('');
  const [description, setDescription] = useState('');
  const [estPremium, setEstPremium] = useState(false);
  const [progression, setProgression] = useState(0);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [erreurs, setErreurs] = useState({});

  const champFichier = useRef(null);
  const peutMonetiser = utilisateur?.peutMonetiser;

  /**
   * Libere les URL d'apercu quand le composant disparait.
   *
   * `URL.createObjectURL` reserve de la memoire tant que l'URL n'est pas
   * revoquee. Sans ce nettoyage, publier vingt fois de suite retient vingt
   * fichiers en memoire jusqu'au rechargement de la page — une fuite
   * silencieuse, invisible en developpement sur de petites images.
   */
  useEffect(() => {
    return () => apercus.forEach((a) => URL.revokeObjectURL(a.url));
  }, [apercus]);

  const choisirFichiers = (evenement) => {
    setErreur(null);
    const selection = Array.from(evenement.target.files || []);
    if (selection.length === 0) return;

    if (fichiers.length + selection.length > MAX_FICHIERS) {
      setErreur(`Maximum ${MAX_FICHIERS} medias par publication`);
      return;
    }

    for (const fichier of selection) {
      if (!TYPES_ACCEPTES.includes(fichier.type)) {
        setErreur(`« ${fichier.name} » : format non accepte`);
        return;
      }
      const estVideo = fichier.type.startsWith('video/');
      const limite = estVideo ? TAILLE_MAX_VIDEO : TAILLE_MAX_IMAGE;
      if (fichier.size > limite) {
        setErreur(
          `« ${fichier.name} » depasse ${Math.round(limite / MO)} Mo ` +
            `(${(fichier.size / MO).toFixed(1)} Mo)`
        );
        return;
      }
    }

    setFichiers((precedents) => [...precedents, ...selection]);
    setApercus((precedents) => [
      ...precedents,
      ...selection.map((f) => ({
        url: URL.createObjectURL(f),
        type: f.type.startsWith('video/') ? 'video' : 'image',
        nom: f.name,
      })),
    ]);

    // Reinitialise le champ : sans cela, reselectionner le meme fichier
    // ne declencherait pas d'evenement `change`.
    evenement.target.value = '';
  };

  const retirer = (index) => {
    URL.revokeObjectURL(apercus[index].url);
    setFichiers((p) => p.filter((_, i) => i !== index));
    setApercus((p) => p.filter((_, i) => i !== index));
  };

  const publier = async (evenement) => {
    evenement.preventDefault();
    if (fichiers.length === 0) {
      setErreur('Ajoutez au moins un média');
      return;
    }

    setEnvoi(true);
    setErreur(null);
    setErreurs({});
    setProgression(0);

    try {
      const reponse = await postApi.creer(
        fichiers,
        { titre, description, estPremium },
        setProgression
      );

      apercus.forEach((a) => URL.revokeObjectURL(a.url));
      setFichiers([]);
      setApercus([]);
      setTitre('');
      setDescription('');
      setEstPremium(false);

      onPublie?.(reponse.data.post);
    } catch (e) {
      const { parChamp, global } = traiterErreurApi(e);
      setErreurs(parChamp);
      setErreur(global || e.message);
    } finally {
      setEnvoi(false);
      setProgression(0);
    }
  };

  return (
    <form
      onSubmit={publier}
      className="rounded-carte border border-ardoise-200 bg-white p-4 sm:p-5"
    >
      <h2 className="mb-3 text-sm font-bold text-ardoise-900">Nouvelle publication</h2>

      {erreur && (
        <Alert variante="erreur" className="mb-3">
          {erreur}
        </Alert>
      )}

      {/* ---------- Apercus ---------- */}
      {apercus.length > 0 && (
        <ul className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {apercus.map((apercu, index) => (
            <li key={apercu.url} className="relative aspect-square overflow-hidden rounded-xl bg-ardoise-100">
              {apercu.type === 'video' ? (
                <video src={apercu.url} className="h-full w-full object-cover" muted />
              ) : (
                <img src={apercu.url} alt="" className="h-full w-full object-cover" />
              )}

              <button
                type="button"
                onClick={() => retirer(index)}
                aria-label={`Retirer ${apercu.nom}`}
                className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-sm leading-tight text-white hover:bg-black/80"
              >
                ×
              </button>

              {apercu.type === 'video' && (
                <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">
                  video
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* ---------- Selection de fichiers ---------- */}
      <input
        ref={champFichier}
        type="file"
        multiple
        accept={TYPES_ACCEPTES.join(',')}
        onChange={choisirFichiers}
        className="lecteur-ecran-seulement"
        id="choix-medias"
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variante="secondaire"
          taille="sm"
          onClick={() => champFichier.current?.click()}
          disabled={fichiers.length >= MAX_FICHIERS}
        >
          Ajouter des medias
        </Button>
        <span className="text-xs text-ardoise-500">
          {fichiers.length}/{MAX_FICHIERS} · images 10 Mo, videos 100 Mo
        </span>
      </div>

      <div className="space-y-3">
        <Input
          libelle="Titre (facultatif)"
          value={titre}
          onChange={(e) => setTitre(e.target.value)}
          erreur={erreurs.titre}
          maxLength={150}
          placeholder="Séance du jour"
        />

        <Textarea
          libelle="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          erreur={erreurs.description}
          maxLength={2000}
          rows={3}
          placeholder="Decrivez votre publication..."
        />
      </div>

      {/* ---------- Contenu premium ---------- */}
      {utilisateur?.type === 'coach' && (
        <div className="mt-3 rounded-xl border border-ardoise-200 p-3">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={estPremium}
              onChange={(e) => setEstPremium(e.target.checked)}
              disabled={!peutMonetiser}
              className="mt-0.5 h-4 w-4 accent-marque-500 disabled:opacity-40"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ardoise-800">
                Contenu premium
              </span>
              <span className="block text-xs text-ardoise-500">
                {peutMonetiser
                  ? 'Visible uniquement par vos abonnés payants'
                  : 'Nécessite un diplôme vérifié, un compte Stripe actif et un tarif défini'}
              </span>
            </span>
          </label>
        </div>
      )}

      {/* ---------- Progression ---------- */}
      {envoi && progression > 0 && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-ardoise-200">
            <div
              className="h-full bg-marque-500 transition-all duration-200"
              style={{ width: `${progression}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-ardoise-500">Envoi : {progression} %</p>
        </div>
      )}

      <Button type="submit" chargement={envoi} className="mt-4" pleineLargeur>
        {envoi ? 'Publication...' : 'Publier'}
      </Button>
    </form>
  );
}
