/**
 * ===========================================================================
 *  SCRUTAGE TELEGRAM — recevoir les réponses sans ouvrir aucune porte
 * ===========================================================================
 *
 * CE QUE CE SERVICE REMPLACE, ET POURQUOI
 *
 * Jusqu'ici, recevoir une réponse sur Telegram demandait que n8n présente une
 * adresse HTTPS publique : le déclencheur `telegramTrigger` appelle
 * `setWebhook`, et Telegram refuse tout ce qui n'est pas public. D'où un
 * tunnel à ouvrir, une adresse qui menait à l'éditeur n8n, et une fenêtre
 * d'exposition à surveiller.
 *
 * UN APPEL SORTANT N'A BESOIN D'AUCUNE ADRESSE. Telegram garde les messages
 * en attente et les rend à qui les demande (`getUpdates`). Le sens de la
 * conversation s'inverse, et avec lui tout le problème : plus de tunnel, plus
 * d'adresse publique, plus d'éditeur n8n joignable de l'extérieur.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI C'EST LE BACK-END QUI SCRUTE, ET NON n8n
 * ---------------------------------------------------------------------------
 *
 * Trois façons d'amener le jeton du bot jusqu'à un appel HTTP ont été
 * mesurées dans l'image, et deux sont fermées :
 *
 *   1. UN JUSTIFICATIF n8n — impossible. Telegram ne lit le jeton que dans le
 *      CHEMIN de l'URL (`/bot<jeton>/getUpdates`) : ni en-tête, ni paramètre
 *      de requête. Aucun type de justificatif ne peut l'écrire là.
 *      `TelegramApi.credentials.js` n'a d'ailleurs aucun bloc `authenticate`,
 *      et aucun nœud n'expose `getUpdates` — la seule occurrence du mot dans
 *      `Telegram.node.js` est une ligne commentée.
 *   2. `$env` DANS UNE EXPRESSION — fermé, et volontairement :
 *      `N8N_BLOCK_ENV_ACCESS_IN_NODE=true` (docker-compose.yml). L'ouvrir
 *      livrerait `N8N_ENCRYPTION_KEY` à n'importe quelle expression, donc la
 *      clé qui déchiffre TOUS les justificatifs — Anthropic, SMTP, Gmail, et
 *      le bot lui-même.
 *   3. LE BACK-END SCRUTE — retenu. Le jeton vit dans `server/.env`, qui est
 *      déjà ignoré par git ; l'appel part en TLS vers api.telegram.org ; n8n
 *      garde son bac à sable intact.
 *
 * ET LE FLUX n8n NE CHANGE PAS D'UN OCTET EN AVAL. Le scrutateur remet chaque
 * message dans la forme exacte que produisait le déclencheur (`{ message }`),
 * donc `Préparer la question` et les quatre voies qui suivent ne voient aucune
 * différence. C'était la condition posée : même comportement qu'avec le
 * tunnel ouvert.
 *
 * ---------------------------------------------------------------------------
 * CINQ DÉCISIONS QUI COMPTENT
 * ---------------------------------------------------------------------------
 *
 *   • LE JETON N'ATTEINT JAMAIS UN JOURNAL. Il vaut le bot entier : qui le
 *     lit peut écrire à la place du support. L'URL le contient, donc l'URL ne
 *     s'imprime jamais telle quelle — `masquer()` est appliqué à tout, et un
 *     test vérifie qu'aucune trace ne le laisse passer.
 *   • `deleteWebhook` D'ABORD, SANS JETER LA FILE. Telegram refuse
 *     `getUpdates` (409) tant qu'un webhook est posé. On le retire donc au
 *     démarrage — mais avec `drop_pending_updates: false`, car les réponses
 *     déjà envoyées et non livrées attendent dans cette file, et elles sont
 *     exactement ce qu'on vient chercher.
 *   • L'AVANCE NE SE CONFIRME QU'APRÈS UNE REMISE RÉUSSIE. Confirmer avant,
 *     c'est perdre le message si n8n ne répond pas : Telegram ne le rendra
 *     plus jamais. On s'arrête donc au premier échec et on reprend là au tour
 *     suivant.
 *   • UNE MISE À JOUR SANS MESSAGE SE CONFIRME QUAND MÊME. Sinon elle reste
 *     en tête de file et bloque tout ce qui la suit, indéfiniment.
 *   • LA FRONTIÈRE DE LA LIVRAISON EST « n8n A ACCEPTÉ », pas « le workflow a
 *     fini ». C'est le même contrat qu'avec le webhook de Telegram, et c'est
 *     ce qui permet au scrutateur de ne pas attendre une rédaction de Claude
 *     pour aller chercher le message suivant.
 * ===========================================================================
 */

const ATTENTE_DEFAUT = 50; // secondes d'attente longue côté Telegram
const REPRISE_DEFAUT = 5000; // ms avant de retenter après une panne
const MARGE_MS = 10000; // au-delà de l'attente longue, on considère la requête perdue

/**
 * Masque le jeton partout où il pourrait apparaître.
 *
 * Appliqué à TOUT ce qui sort vers un journal, y compris les messages
 * d'erreur de `fetch`, qui citent volontiers l'URL complète.
 */
export const masquer = (texte) => String(texte ?? '').replace(/\/bot[^/\s"']+/g, '/bot•••');

/**
 * Fabrique un scrutateur.
 *
 * Toutes les dépendances externes sont injectables : la suite de tests fait
 * tourner la vraie boucle contre une fausse API Telegram et un faux n8n, sans
 * jeton réel et sans réseau.
 */
export function creerScrutateur({
  jeton,
  base = 'https://api.telegram.org',
  webhook,
  cleService,
  attente = ATTENTE_DEFAUT,
  reprise = REPRISE_DEFAUT,
  fetchHttp = fetch,
  journal = console,
} = {}) {
  let actif = false;
  let offset = 0;
  let enCours = null; // la requête longue en vol, pour pouvoir l'interrompre
  let reveiller = null; // la pause de reprise en cours, pour pouvoir l'écourter
  let boucle = null;
  const compte = { tours: 0, transmis: 0, ignores: 0, echecs: 0 };

  const dire = (texte) => journal.log(`[TELEGRAM] ${masquer(texte)}`);
  const alerter = (texte) => journal.error(`[TELEGRAM] ${masquer(texte)}`);

  /** Un appel à l'API du bot, toujours interruptible. */
  const appeler = async (methode, parametres = {}) => {
    const url = new URL(`${base}/bot${jeton}/${methode}`);
    for (const [cle, valeur] of Object.entries(parametres)) url.searchParams.set(cle, valeur);

    const controleur = new AbortController();
    enCours = controleur;
    const minuteur = setTimeout(() => controleur.abort(), attente * 1000 + MARGE_MS);
    try {
      const reponse = await fetchHttp(url.toString(), { signal: controleur.signal });
      const corps = await reponse.json().catch(() => null);
      return { statut: reponse.status, corps };
    } finally {
      clearTimeout(minuteur);
      enCours = null;
    }
  };

  /**
   * Remet un message à n8n.
   *
   * L'enveloppe est `{ message }` — la forme même qu'émettait le déclencheur
   * Telegram. Le nœud `Déballer la mise à jour` la ressort du corps HTTP, et
   * tout l'aval reste identique.
   */
  const transmettre = async (message) => {
    try {
      const reponse = await fetchHttp(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-service-key': cleService },
        body: JSON.stringify({ message }),
      });
      if (!reponse.ok) {
        /*
         * 404 mérite sa propre phrase : c'est le cas de loin le plus probable,
         * et son remède n'a rien d'évident. n8n n'enregistre le chemin d'un
         * webhook que pour un workflow ACTIF ; un workflow importé revient
         * toujours inactif.
         */
        alerter(
          reponse.status === 404
            ? 'n8n ne connaît pas ce chemin de webhook (404). Le workflow ' +
                '`ccAgentTelegr01` est-il actif ? Un import le remet toujours à l’arrêt.'
            : `n8n a refusé la remise (${reponse.status}). Le message reste en file.`
        );
        return false;
      }
      return true;
    } catch (erreur) {
      alerter(`n8n est injoignable : ${erreur.message}. Le message reste en file.`);
      return false;
    }
  };

  /** Un tour : demander, remettre, confirmer. Rend le délai avant le tour suivant. */
  const unTour = async () => {
    compte.tours += 1;
    let reponse;
    try {
      reponse = await appeler('getUpdates', {
        timeout: attente,
        allowed_updates: '["message"]',
        ...(offset ? { offset } : {}),
      });
    } catch (erreur) {
      if (!actif) return 0; // interruption demandée : ce n'est pas une panne
      compte.echecs += 1;
      alerter(`Telegram est injoignable : ${erreur.message}`);
      return reprise;
    }

    if (reponse.statut === 409) {
      /*
       * 409 = un webhook est encore posé. Message exact de Telegram, et cause
       * exacte : deux façons de recevoir ne peuvent pas coexister.
       */
      compte.echecs += 1;
      alerter(
        'Telegram refuse le scrutage : un webhook est encore posé (409). ' +
          'Le flux `ccAgentTelegr01` utilise-t-il encore `telegramTrigger` ? ' +
          'Il doit partir sur le nœud `Webhook`.'
      );
      return reprise;
    }

    if (reponse.statut !== 200 || !reponse.corps?.ok) {
      compte.echecs += 1;
      alerter(
        `Telegram a répondu ${reponse.statut} : ${reponse.corps?.description ?? 'sans détail'}`
      );
      return reprise;
    }

    const majs = Array.isArray(reponse.corps.result) ? reponse.corps.result : [];
    let confirme = null;

    for (const maj of majs) {
      if (!maj?.message) {
        // Rien à traiter — mais à confirmer, sinon elle bloque la file.
        compte.ignores += 1;
        confirme = maj?.update_id ?? confirme;
        continue;
      }
      const remis = await transmettre(maj.message);
      if (!remis) break; // on s'arrête net : la suite sera redemandée au tour suivant
      compte.transmis += 1;
      confirme = maj.update_id;
    }

    if (confirme !== null && confirme !== undefined) offset = confirme + 1;
    return 0;
  };

  /**
   * Pause avant de retenter, écourtée par l'arrêt.
   *
   * ELLE N'EST PAS « unref » ET C'EST VOLONTAIRE. Un minuteur détaché
   * laisserait Node vider sa file d'événements pendant la pause et sortir en
   * croyant n'avoir plus rien à faire : la boucle s'arrêterait d'elle-même,
   * sans un mot, après la première panne réseau. L'arrêt propre, lui, passe
   * par `reveiller()` — pas par le détachement.
   */
  const dormir = (ms) =>
    new Promise((resoudre) => {
      const t = setTimeout(() => {
        reveiller = null;
        resoudre();
      }, ms);
      reveiller = () => {
        clearTimeout(t);
        reveiller = null;
        resoudre();
      };
    });

  const tourner = async () => {
    while (actif) {
      const pause = await unTour();
      if (pause > 0 && actif) await dormir(pause);
    }
  };

  return {
    /**
     * Démarre le scrutage.
     *
     * Le retrait du webhook précède le premier `getUpdates`, sans quoi
     * Telegram répondrait 409 autant de fois qu'on insisterait.
     */
    async demarrer() {
      if (actif) return;
      if (!jeton) {
        dire('Scrutage inactif : TELEGRAM_BOT_TOKEN absent de server/.env.');
        return;
      }
      if (!cleService) {
        alerter('Scrutage inactif : SUPPORT_SERVICE_KEY absente — n8n refuserait la remise.');
        return;
      }

      actif = true;
      try {
        const retrait = await appeler('deleteWebhook', { drop_pending_updates: 'false' });
        if (retrait.statut !== 200 || !retrait.corps?.ok) {
          alerter(
            `Le retrait du webhook a échoué (${retrait.statut}). ` +
              'Telegram refusera le scrutage tant qu’un webhook est posé.'
          );
        }
      } catch (erreur) {
        alerter(`Le retrait du webhook a échoué : ${erreur.message}`);
      }

      dire('Scrutage actif — les réponses arrivent sans tunnel ni adresse publique.');
      boucle = tourner();
    },

    /**
     * Arrête le scrutage.
     *
     * L'attente longue dure jusqu'à 50 s : sans interruption de la requête en
     * vol, un arrêt propre du serveur traînerait d'autant.
     */
    async arreter() {
      if (!actif) return;
      actif = false;
      enCours?.abort(); // la requête longue en vol
      reveiller?.(); // ou la pause qui suit une panne
      await boucle?.catch(() => {});
      boucle = null;
      dire('Scrutage arrêté.');
    },

    /** Lecture seule, pour les tests et pour un diagnostic. */
    etat: () => ({ actif, offset, ...compte }),
  };
}
