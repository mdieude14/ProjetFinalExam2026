import axios from 'axios';

/**
 * ===========================================================================
 *  CLIENT HTTP CENTRALISE
 * ===========================================================================
 *
 * OU EST STOCKE L'ACCESS TOKEN ?
 * Dans une simple variable de module, donc en memoire vive.
 *
 * Pas dans localStorage, pas dans sessionStorage : ces deux espaces sont
 * lisibles par n'importe quel script de la page. Une seule faille XSS — une
 * dependance npm compromise, un commentaire mal echappe — et le jeton part
 * chez un tiers.
 *
 * La contrepartie est qu'un rechargement de page (F5) vide la variable.
 * Ce n'est pas un probleme : le refresh token vit dans un cookie httpOnly
 * que le navigateur conserve, et AuthContext rejoue /auth/refresh au
 * demarrage pour reconstituer la session. L'utilisateur ne voit rien.
 * ===========================================================================
 */

let accessToken = null;

/** Callback appele quand la session est definitivement perdue. */
let surSessionExpiree = null;

export function definirAccessToken(token) {
  accessToken = token;
}

export function obtenirAccessToken() {
  return accessToken;
}

/**
 * Enregistre la reaction a une session expiree.
 * AuthContext y branche le vidage de son etat, ce qui provoque la
 * redirection vers /login par les routes protegees.
 */
export function definirGestionnaireSessionExpiree(callback) {
  surSessionExpiree = callback;
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',

  // Indispensable : sans cette option, le navigateur n'envoie pas le cookie
  // httpOnly du refresh token, et le renouvellement de session echouerait
  // systematiquement.
  withCredentials: true,

  /**
   * PAS DE Content-Type GLOBAL — c'est volontaire.
   *
   * Le fixer ici a « application/json » l'imposerait aussi aux envois de
   * fichiers. Or un FormData doit partir en
   * `multipart/form-data; boundary=----XYZ`, et seule la couche navigateur
   * peut generer cette frontiere. Avec un en-tete JSON force, le serveur
   * recoit un corps multipart annonce comme du JSON : Multer ne trouve aucun
   * fichier et l'envoi echoue silencieusement.
   *
   * Sans en-tete par defaut, Axios choisit correctement tout seul :
   * JSON pour un objet, multipart pour un FormData.
   */
  timeout: 20000,
});

/* ==================================================================
 *  INTERCEPTEUR DE REQUETE
 * ================================================================== */

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

/* ==================================================================
 *  RENOUVELLEMENT AVEC MUTUALISATION DES APPELS
 * ==================================================================
 *
 * LE PROBLEME A RESOUDRE
 * La page d'accueil declenche souvent plusieurs requetes en parallele : le
 * fil d'actualite, les stories, le compteur de notifications. Si l'access
 * token vient d'expirer, les trois echouent en 401 simultanement.
 *
 * Sans precaution, chacune appellerait /auth/refresh de son cote. Or le
 * back-end fait tourner le refresh token a chaque appel : le premier
 * invaliderait le cookie que les deux autres s'appretent a utiliser, et
 * l'utilisateur serait deconnecte alors que tout allait bien.
 *
 * LA SOLUTION
 * On conserve la promesse du renouvellement en cours. Les requetes qui
 * echouent pendant ce temps ne relancent rien : elles attendent cette meme
 * promesse. Un seul appel reseau, un seul jeton tourne, trois requetes
 * rejouees.
 */

let renouvellementEnCours = null;

function renouvelerSession() {
  if (!renouvellementEnCours) {
    renouvellementEnCours = api
      .post('/auth/refresh')
      .then((reponse) => {
        definirAccessToken(reponse.data.accessToken);
        return reponse.data.accessToken;
      })
      .finally(() => {
        // Liberation du verrou : la prochaine expiration pourra relancer
        // un renouvellement. Les appelants gardent leur reference a la
        // promesse, ils ne sont pas affectes par cette remise a zero.
        renouvellementEnCours = null;
      });
  }
  return renouvellementEnCours;
}

/* ==================================================================
 *  INTERCEPTEUR DE REPONSE
 * ================================================================== */

api.interceptors.response.use(
  (reponse) => reponse,

  async (erreur) => {
    const requete = erreur.config;
    const statut = erreur.response?.status;

    // Erreur reseau, serveur eteint ou delai depasse : pas de reponse HTTP.
    if (!erreur.response) {
      return Promise.reject({
        ...erreur,
        message: 'Serveur injoignable. Vérifiez votre connexion.',
      });
    }

    const estRouteAuthSensible =
      requete?.url?.includes('/auth/refresh') ||
      requete?.url?.includes('/auth/login') ||
      requete?.url?.includes('/auth/register');

    /**
     * Conditions pour tenter un renouvellement :
     *   - le serveur repond 401 (jeton absent, invalide ou expire)
     *   - la requete n'a pas deja ete rejouee (`_dejaRejouee`), sans quoi un
     *     401 persistant provoquerait une boucle infinie
     *   - ce n'est pas /auth/refresh lui-meme, ni login, ni register : un 401
     *     y signifie « identifiants faux » ou « session morte », pas
     *     « jeton expire ». Le renouvellement n'aurait aucun sens.
     */
    if (statut === 401 && !requete._dejaRejouee && !estRouteAuthSensible) {
      requete._dejaRejouee = true;

      try {
        const nouveauToken = await renouvelerSession();
        requete.headers.Authorization = `Bearer ${nouveauToken}`;
        return api(requete); // rejeu transparent pour l'appelant
      } catch {
        // Le refresh token est expire ou revoque : la session est perdue.
        definirAccessToken(null);
        surSessionExpiree?.();
        return Promise.reject(erreur);
      }
    }

    /**
     * Normalisation du message d'erreur.
     * Le back-end renvoie toujours { succes, message, details }. On remonte
     * ces champs au premier niveau pour que les composants ecrivent
     * `erreur.message` sans fouiller dans `erreur.response.data`.
     */
    const donnees = erreur.response.data;
    return Promise.reject({
      ...erreur,
      statut,
      message: donnees?.message || 'Une erreur est survenue',
      details: donnees?.details || null,
    });
  }
);

export default api;
