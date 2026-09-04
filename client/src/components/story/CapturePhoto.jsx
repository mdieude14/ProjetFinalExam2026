import { useState, useEffect, useRef, useCallback } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import Spinner from '@/components/ui/Spinner';

/**
 * Prise de photo par la camera de l'appareil, pour publier une story.
 *
 * TROIS PIEGES QUE CE COMPOSANT TRAITE EXPLICITEMENT.
 *
 * 1. LE FLUX DOIT ETRE COUPE. `getUserMedia` allume la camera ; tant que les
 *    pistes ne sont pas arretees, le voyant de l'appareil reste allume meme
 *    apres la fermeture de la fenetre. Fermer la modale ne suffit pas : React
 *    demonte le <video>, pas le flux. On coupe donc a la fermeture ET au
 *    demontage.
 *
 * 2. LA CAMERA N'EST PAS TOUJOURS DISPONIBLE, et chaque cause appelle une
 *    consigne differente : permission refusee, aucun appareil, camera deja
 *    utilisee par un autre logiciel, ou page servie sans HTTPS. Un message
 *    unique « impossible d'acceder a la camera » laisserait l'utilisateur
 *    sans rien a faire.
 *
 * 3. LA PHOTO EST BORNEE EN TAILLE. Une camera 4K produirait un JPEG que le
 *    serveur refuserait (10 Mo max) apres un televersement complet — l'echec
 *    arriverait donc apres l'attente. On redimensionne avant d'encoder.
 */

/** Cote le plus long de la photo produite. Au-dela, rien n'est gagne pour une story. */
const COTE_MAX = 1920;

/** Qualite JPEG : au-dessus, le poids double sans difference visible. */
const QUALITE = 0.9;

export default function CapturePhoto({ ouvert, onFermer, onValider }) {
  const [flux, setFlux] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [demarrage, setDemarrage] = useState(false);
  const [photo, setPhoto] = useState(null); // { url, fichier }
  const [orientation, setOrientation] = useState('user');
  const [plusieursCameras, setPlusieursCameras] = useState(false);

  const video = useRef(null);
  const fluxRef = useRef(null);

  /* ---------------------------------------------------------------- *
   *  Ouverture et fermeture du flux
   * ---------------------------------------------------------------- */

  const couper = useCallback(() => {
    fluxRef.current?.getTracks().forEach((piste) => piste.stop());
    fluxRef.current = null;
    setFlux(null);
  }, []);

  const demarrer = useCallback(
    async (orientationVoulue) => {
      setErreur(null);
      setDemarrage(true);

      /*
       * `mediaDevices` est absent hors contexte securise : en production, la
       * page doit etre servie en HTTPS. En developpement, `localhost` est
       * considere comme sur, la camera fonctionne donc sans certificat.
       */
      if (!navigator.mediaDevices?.getUserMedia) {
        setDemarrage(false);
        setErreur(
          "La camera n'est accessible que sur une page securisee (HTTPS). " +
            'Importez un fichier depuis votre appareil.'
        );
        return;
      }

      couper();

      try {
        const obtenu = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: orientationVoulue, width: { ideal: 1280 } },
          audio: false,
        });
        fluxRef.current = obtenu;
        setFlux(obtenu);

        /*
         * On ne propose le basculement avant/arriere que s'il y a vraiment
         * plusieurs cameras. `enumerateDevices` ne nomme les appareils
         * qu'une fois la permission accordee : l'appel vient donc apres.
         */
        const appareils = await navigator.mediaDevices.enumerateDevices();
        setPlusieursCameras(
          appareils.filter((a) => a.kind === 'videoinput').length > 1
        );
      } catch (e) {
        const messages = {
          NotAllowedError:
            "L'acces a la camera a ete refuse. Autorisez-le dans les " +
            'reglages du navigateur, ou importez un fichier.',
          NotFoundError: "Aucune camera detectee sur cet appareil.",
          NotReadableError:
            'La camera est deja utilisee par un autre logiciel. Fermez-le ' +
            'puis reessayez.',
          OverconstrainedError:
            "Aucune camera ne correspond a l'orientation demandee.",
        };
        setErreur(messages[e.name] || "Impossible d'ouvrir la camera.");
      } finally {
        setDemarrage(false);
      }
    },
    [couper]
  );

  /* La camera s'ouvre a l'affichage de la fenetre, se coupe a sa fermeture. */
  useEffect(() => {
    if (!ouvert) {
      couper();
      setPhoto(null);
      setErreur(null);
      return;
    }
    demarrer(orientation);
    // `orientation` est volontairement hors dependances : son changement
    // passe par `basculer()`, qui relance le flux lui-meme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert]);

  /* Filet de securite : si le composant disparait sans passer par onFermer. */
  useEffect(() => couper, [couper]);

  /* Le flux est branche sur la balise video une fois celle-ci montee. */
  useEffect(() => {
    if (video.current && flux) video.current.srcObject = flux;
  }, [flux]);

  const basculer = () => {
    const suivante = orientation === 'user' ? 'environment' : 'user';
    setOrientation(suivante);
    demarrer(suivante);
  };

  /* ---------------------------------------------------------------- *
   *  Capture
   * ---------------------------------------------------------------- */

  const capturer = () => {
    const source = video.current;
    // `videoWidth` vaut 0 tant que la premiere image n'est pas arrivee :
    // capturer avant produirait une image noire.
    if (!source?.videoWidth) return;

    const echelle = Math.min(1, COTE_MAX / Math.max(source.videoWidth, source.videoHeight));
    const largeur = Math.round(source.videoWidth * echelle);
    const hauteur = Math.round(source.videoHeight * echelle);

    const toile = document.createElement('canvas');
    toile.width = largeur;
    toile.height = hauteur;
    const contexte = toile.getContext('2d');

    /*
     * L'apercu de la camera frontale est mirote — c'est ce que tout le monde
     * attend en se voyant. La photo l'est donc aussi : sinon le resultat ne
     * correspond pas a ce que l'on vient de cadrer.
     */
    if (orientation === 'user') {
      contexte.translate(largeur, 0);
      contexte.scale(-1, 1);
    }
    contexte.drawImage(source, 0, 0, largeur, hauteur);

    toile.toBlob(
      (donnees) => {
        if (!donnees) {
          setErreur("La photo n'a pas pu etre encodee.");
          return;
        }
        const fichier = new File([donnees], `story-${Date.now()}.jpg`, {
          type: 'image/jpeg',
          lastModified: Date.now(),
        });
        setPhoto({ url: URL.createObjectURL(donnees), fichier });
        couper(); // plus besoin de la camera pendant la relecture
      },
      'image/jpeg',
      QUALITE
    );
  };

  const reprendre = () => {
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto(null);
    demarrer(orientation);
  };

  const valider = () => {
    if (!photo) return;
    onValider(photo.fichier);
    URL.revokeObjectURL(photo.url);
    setPhoto(null);
    onFermer();
  };

  /* Les URL d'objet sont liberees : sans cela le blob reste en memoire. */
  useEffect(() => {
    return () => {
      if (photo) URL.revokeObjectURL(photo.url);
    };
  }, [photo]);

  return (
    <Modal ouvert={ouvert} onFermer={onFermer} titre="Prendre une photo" taille="md">
      <div className="p-5" data-test="capture-photo">
        {erreur && (
          <Alert variante="erreur" className="mb-4">
            {erreur}
          </Alert>
        )}

        <div className="relative overflow-hidden rounded-carte bg-ardoise-900">
          {/* Rapport 9:16 : le cadre de prise de vue montre ce que la story
              affichera reellement, plutot qu'un cadrage large recadre ensuite. */}
          <div className="aspect-[9/16] w-full">
            {photo ? (
              <img
                src={photo.url}
                alt="Photo prise a l'instant"
                className="h-full w-full object-cover"
                data-test="apercu-photo"
              />
            ) : (
              <video
                ref={video}
                autoPlay
                playsInline
                muted
                data-test="flux-camera"
                className={`h-full w-full object-cover ${
                  orientation === 'user' ? 'scale-x-[-1]' : ''
                }`}
              />
            )}
          </div>

          {demarrage && (
            <div className="absolute inset-0 flex items-center justify-center bg-ardoise-900/70">
              <Spinner />
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          {photo ? (
            <>
              <Button variante="secondaire" onClick={reprendre} data-test="reprendre">
                Reprendre
              </Button>
              <Button onClick={valider} data-test="valider-photo">
                Publier cette photo
              </Button>
            </>
          ) : (
            <>
              {plusieursCameras ? (
                <Button variante="secondaire" onClick={basculer} data-test="changer-camera">
                  Changer de camera
                </Button>
              ) : (
                <span />
              )}
              {/*
                `cursor-pointer` explicite : depuis Tailwind 4, le preflight
                pose `cursor: default` sur les boutons. Le `disabled:` de la
                base du composant reste prioritaire, le curseur redevient donc
                « interdit » tant que la camera n'est pas prete.
              */}
              <Button
                onClick={capturer}
                disabled={!flux || demarrage}
                data-test="declencher"
                className="cursor-pointer"
              >
                Prendre la photo
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
