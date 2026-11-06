/**
 * ===========================================================================
 *  LE JETON D'ENVOI EST-IL ENCORE VIVANT ?
 * ===========================================================================
 *
 *   cd server && node scripts/verifier-envoi.mjs
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE SCRIPT EXISTE
 * ---------------------------------------------------------------------------
 *
 * Le jeton OAuth de Gmail expire au bout de SEPT JOURS : c'est une règle du
 * mode Test de l'application Google, pas un incident. Le 2 novembre 2026 il
 * est mort à 13 h 44, et personne ne l'a su avant qu'un utilisateur attende
 * une réponse — le back-office affichant `invalid_grant` à l'exploitant, le
 * flux courriel échouant vingt-sept fois de suite, et la campagne restant à
 * 2106/2106 parce qu'aucune de ses vérifications ne regardait là.
 *
 * `verifierSmtp()` existait déjà et n'était appelée par personne. Ce script
 * est le fil qui manquait, et il sert à trois endroits :
 *
 *   - à la main, pour répondre en une seconde à « mon jeton est-il mort ? » ;
 *   - dans les prérequis de campagne, qui ne peuvent PAS importer le service
 *     directement : `config/env.js` lit le `.env` du RÉPERTOIRE COURANT et
 *     appelle `process.exit(1)` s'il n'en trouve pas. Lancé depuis la racine
 *     du dépôt, un tel import TUERAIT la campagne. D'où un processus séparé,
 *     avec `server/` pour répertoire courant ;
 *   - après une réémission, pour vérifier que le nouveau jeton est pris.
 *
 * IL N'ENVOIE RIEN. `verifierSmtp()` authentifie et raccroche : on peut donc
 * l'appeler à chaque campagne sans écrire à personne.
 *
 * SORTIE : code 0 si l'envoi peut fonctionner, 1 sinon — pour qu'il serve
 * aussi dans un enchaînement.
 *
 * LA DÉCISION EST UNE FONCTION PURE, `verdictEnvoi()`, exportée pour que la
 * suite de tests exerce ses trois branches sans réseau ni jeton. Le reste du
 * fichier ne fait que lire l'état réel et imprimer.
 * ===========================================================================
 */

import { pathToFileURL } from 'node:url';

/**
 * Traduit un état d'envoi en verdict imprimable et en code de sortie.
 *
 * @param {{ mode: string, ok?: boolean, raison?: string }} etat
 * @returns {{ code: 0|1, lignes: string[] }}
 */
export function verdictEnvoi({ mode, ok = false, raison = '' }) {
  /*
   * « AUCUNE AUTHENTIFICATION » N'EST PAS UNE PANNE. Sans identifiants, le
   * projet dépose les messages dans `server/.boite-mails/` au lieu de les
   * envoyer : c'est le mode de développement voulu, et il ne doit pas faire
   * échouer un contrôle — sinon le contrôle crierait sur une machine neuve.
   */
  if (mode === 'aucun') {
    return {
      code: 0,
      lignes: ['DEPOT : aucune authentification configuree, les messages sont deposes sur disque'],
    };
  }

  if (ok) return { code: 0, lignes: [`VIVANT : ${mode}`] };

  const lignes = [`MORT : ${mode} : ${raison}`];

  /*
   * ON NOMME LE REMÈDE, et seulement quand on reconnaît la cause. Personne ne
   * devine « réémettre un jeton OAuth » en lisant « invalid_grant » ; mais
   * suggérer cette réémission sur un port bloqué ou un certificat intercepté
   * enverrait au contraire chercher au mauvais endroit.
   */
  if (/invalid_grant/i.test(raison)) {
    lignes.push(
      'CAUSE : jeton de rafraichissement expire ou revoque (mode Test = 7 jours)',
      'REMEDE : node server/scripts/autoriser-gmail.mjs, consentement dans Chrome,',
      '         puis REDEMARRER le back-end (nodemon ne surveille pas .env)'
    );
  }

  return { code: 1, lignes };
}

/* ------------------------------------------------------------------ *
 *  Lancé directement : on lit l'état réel et on imprime.
 *
 *  Le garde empêche l'import depuis la suite de tests de déclencher un
 *  appel réseau et un `process.exit`.
 * ------------------------------------------------------------------ */
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { verifierSmtp, modeEnvoi } = await import('../src/services/mail.service.js');

  const mode = modeEnvoi();
  const etat = mode === 'aucun' ? { ok: false } : await verifierSmtp();
  const verdict = verdictEnvoi({ mode, ok: etat.ok, raison: etat.raison });

  for (const ligne of verdict.lignes) console.log(ligne);
  process.exit(verdict.code);
}
