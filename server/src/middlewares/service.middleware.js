import { timingSafeEqual } from 'node:crypto';

import { ApiError } from '../utils/ApiError.js';
import { config } from '../config/env.js';

/**
 * ===========================================================================
 *  AUTHENTIFICATION D'UN SERVICE AUTOMATISÉ
 * ===========================================================================
 *
 * POURQUOI UNE CLÉ, ET NON UN JETON D'ADMINISTRATEUR.
 *
 * L'orchestrateur n8n relève les tickets escaladés pour les annoncer sur
 * Telegram. La solution facile serait de lui donner un compte administrateur
 * — et elle serait dangereuse, parce que `admin.routes.js` permet aussi de
 * VÉRIFIER UN DIPLÔME, donc de décider qui a le droit de vendre, et de
 * DÉSACTIVER UN COMPTE. Un orchestrateur compromis, ou une injection de
 * prompt atteignant un composant qui détient ce jeton, pourrait certifier de
 * faux coachs. Le rayon d'explosion serait sans rapport avec le besoin.
 *
 * POURQUOI PAS UN JWT NON PLUS.
 * Un JWT modélise une SESSION HUMAINE : il porte une identité, tourne à
 * chaque usage, et se révoque par `refreshTokenVersion`. Rien de cela n'a de
 * sens pour un processus qui tourne en continu et n'a pas d'utilisateur
 * derrière lui. Une clé se révoque en changeant une variable d'environnement,
 * sans toucher au modèle `User`.
 *
 * CE QUE CETTE CLÉ OUVRE, ET RIEN D'AUTRE.
 * Ce middleware n'est monté que sur les deux routes de relève du support.
 * Elle ne donne accès à aucune autre partie de l'API — ni aux diplômes, ni
 * à la modération, ni aux comptes. C'est le principe : ne pas empêcher
 * l'incident, en borner la portée.
 *
 * LA COMPARAISON EST À TEMPS CONSTANT. Un `===` s'arrête au premier
 * caractère différent : le temps de réponse trahit alors combien de
 * caractères sont corrects, et permet de reconstruire la clé lettre par
 * lettre. `timingSafeEqual` compare toujours l'intégralité.
 * ===========================================================================
 */

/** En-tête portant la clé. Jamais un paramètre d'URL : ceux-là finissent dans les journaux. */
const ENTETE = 'x-service-key';

/**
 * Compare deux chaînes sans fuite de temps.
 *
 * `timingSafeEqual` exige des tampons de MÊME LONGUEUR — il lève sinon. On
 * compare donc d'abord les longueurs, ce qui divulgue la longueur de la clé
 * et rien de plus : une information sans valeur pour qui doit en deviner le
 * contenu.
 */
function egalesEnTempsConstant(recue, attendue) {
  const a = Buffer.from(String(recue));
  const b = Buffer.from(String(attendue));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Réserve une route à un service automatisé porteur de la clé.
 *
 * S'utilise SEUL, jamais après `protect` : il n'y a pas d'utilisateur derrière
 * un service, et `req.user` reste volontairement vide. Les contrôleurs
 * appelés par ce chemin ne doivent donc jamais le lire.
 */
export function serviceAutorise(req, res, next) {
  const attendue = config.support?.serviceKey;

  /*
   * PAS DE CLÉ CONFIGURÉE = ROUTE FERMÉE, jamais ouverte.
   *
   * L'inverse — laisser passer quand la variable est absente — est l'erreur
   * classique : la route fonctionne en développement, et part en production
   * grande ouverte le jour où quelqu'un oublie la variable.
   */
  if (!attendue) {
    return next(
      ApiError.internal(
        'SUPPORT_SERVICE_KEY absente : les routes de service sont fermées'
      )
    );
  }

  const recue = req.get(ENTETE);

  if (!recue || !egalesEnTempsConstant(recue, attendue)) {
    // 401 et non 403 : il n'y a pas d'identité établie à qui refuser un droit.
    return next(ApiError.unauthorized('Clé de service invalide'));
  }

  // Trace utile au diagnostic, sans jamais journaliser la clé elle-même.
  req.service = { nom: 'support' };
  next();
}

/* ================================================================== *
 *  L'AGENT QUI ÉCRIT UN TICKET
 * ================================================================== */

/** En-tête de la clé d'agent — distinct de celui de la relève. */
const ENTETE_AGENT = 'x-agent-key';

/**
 * Établit si c'est l'AGENT qui écrit, en plus de l'utilisateur.
 *
 * S'utilise APRÈS `protect`, et c'est la différence avec `serviceAutorise` :
 * le ticket appartient toujours à la personne du jeton. La clé d'agent ne
 * remplace pas cette identité, elle atteste une chose de plus — que la
 * réponse et les outils du ticket viennent bien de l'agent.
 *
 * Sans elle, n8n et l'utilisateur présentaient le même jeton : rien ne
 * distinguait une réponse de l'agent d'un texte tapé par l'utilisateur
 * lui-même, « l'agent m'a promis un remboursement » compris.
 *
 * TROIS CAS, ET LE TROISIÈME N'EST PAS SILENCIEUX :
 *
 *   pas d'en-tête        écriture directe de l'utilisateur — autorisée, mais
 *                        sans réponse ni outils (voir `support.enregistrer`)
 *   bonne clé            `req.agent` est posé
 *   en-tête, mauvaise    401. L'ignorer ferait passer une erreur de
 *   clé                  configuration de n8n pour des tickets sans agent :
 *                        les réponses disparaîtraient sans qu'aucune erreur
 *                        ne le signale
 */
export function agentIdentifie(req, res, next) {
  const recue = req.get(ENTETE_AGENT);
  if (!recue) return next();

  const attendue = config.support?.agentKey;
  if (!attendue) {
    // Même règle que la relève : pas de clé configurée, rien ne s'authentifie.
    return next(
      ApiError.internal("SUPPORT_AGENT_KEY absente : impossible d'authentifier l'agent")
    );
  }

  if (!egalesEnTempsConstant(recue, attendue)) {
    return next(ApiError.unauthorized("Clé d'agent invalide"));
  }

  req.agent = { nom: 'support' };
  next();
}

export default serviceAutorise;
