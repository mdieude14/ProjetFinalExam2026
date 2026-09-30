import axios from 'axios';

import api from './axios';
import { obtenirAccessToken } from './axios';

/**
 * ===========================================================================
 *  SUPPORT — deux destinataires, et ils ne se ressemblent pas
 * ===========================================================================
 *
 * Le widget parle à DEUX serveurs différents, et c'est volontaire :
 *
 *   n8n   reçoit la question et fait travailler l'agent
 *   API   sert à relire ses propres tickets
 *
 * POURQUOI LE WIDGET N'APPELLE PAS L'API POUR POSER SA QUESTION.
 * C'est l'agent qui décide quoi consulter pour répondre — et c'est lui qui
 * écrira le ticket, avec la trace des outils appelés. Faire transiter la
 * question par l'API d'abord obligerait celle-ci à connaître l'orchestrateur,
 * donc à dépendre de lui : l'application cesserait de fonctionner sans n8n,
 * pour une couche qui doit rester optionnelle.
 *
 * LE JETON PART VERS n8n, ET C'EST TOUTE LA SÉCURITÉ DU MODULE.
 * L'agent s'en sert pour appeler l'API en se faisant passer pour l'utilisateur
 * — pas pour plus. Il ne peut donc structurellement pas voir plus que la
 * personne qui l'interroge : un compte bloqué reste masqué, un contenu premium
 * reste absent, sans une ligne de code supplémentaire.
 *
 * `axios` DIRECT ET NON L'INSTANCE DU PROJET pour joindre n8n. L'instance
 * partagée porte l'intercepteur de renouvellement de jeton, qui rejouerait un
 * appel vers n8n après un 401 venu de n8n — un comportement pensé pour l'API,
 * et qui n'a aucun sens ici.
 * ===========================================================================
 */

/**
 * URL du webhook n8n.
 *
 * ABSENTE = WIDGET MASQUÉ, jamais un widget qui échoue. Le support automatisé
 * est une couche en plus : sans elle, l'application se comporte exactement
 * comme avant.
 */
export const URL_AGENT = import.meta.env.VITE_SUPPORT_WEBHOOK_URL || null;

/** Le support est-il configuré sur cette installation ? */
export const supportDisponible = () => Boolean(URL_AGENT);

export const supportApi = {
  /**
   * Pose une question à l'agent.
   *
   * @param {string} question  ce que l'utilisateur a tapé
   * @param {string} origine   l'écran d'où il la pose — la même phrase
   *                           n'appelle pas la même réponse depuis « Mon
   *                           diplôme » ou depuis le fil
   */
  demander: (question, origine) =>
    axios.post(
      URL_AGENT,
      { question, origine },
      {
        headers: { Authorization: `Bearer ${obtenirAccessToken()}` },
        // Un agent qui consulte plusieurs outils met quelques secondes ;
        // le défaut d'axios laisserait l'appel pendre indéfiniment si n8n
        // ne répondait pas du tout.
        timeout: 45000,
      }
    ),

  /** Ses propres échanges — servi par l'API, pas par n8n. */
  mesTickets: (params = {}) => api.get('/support/tickets', { params }),

  unTicket: (id) => api.get(`/support/tickets/${id}`),

  /**
   * « J'ai vu qu'une réponse m'était partie par courriel. »
   *
   * SANS CETTE TRACE, L'AVIS SE RÉAFFICHERAIT À CHAQUE OUVERTURE du widget,
   * des semaines après la réponse. Le serveur n'accepte le marquage que de
   * l'auteur du dossier, et seulement si une réponse lui est bien partie.
   */
  marquerVu: (id) => api.post(`/support/tickets/${id}/vu`),

  /*
   * Rattachement d'une conversation Telegram — servi par l'API, derrière la
   * session. C'est ici, et seulement ici, qu'un code de rattachement naît.
   */
  etatTelegram: () => api.get('/support/telegram'),
  codeTelegram: () => api.post('/support/telegram/code'),
  delierTelegram: () => api.delete('/support/telegram'),
};

/**
 * Nom du bot Telegram de cette installation, sans « @ ».
 *
 * ABSENT = SECTION MASQUÉE, comme pour le widget : le canal Telegram est une
 * couche en plus, et une installation sans bot n'a rien à rattacher.
 */
export const BOT_TELEGRAM = import.meta.env.VITE_TELEGRAM_BOT || null;

export default supportApi;
