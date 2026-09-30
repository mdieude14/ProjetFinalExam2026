/**
 * ===========================================================================
 *  WORKFLOW n8n — LA RELÈVE DES ESCALADES SUR TELEGRAM (module 15)
 * ===========================================================================
 *
 *   node docker/n8n/workflows/construire-releve-telegram.mjs
 *
 * Écrit `releve-telegram.json` à côté de ce fichier, prêt à importer :
 *
 *   docker exec coachconnect-n8n n8n import:workflow --input=/workflows/releve-telegram.json
 *
 * POURQUOI UN SECOND WORKFLOW, ET NON UN BRANCHEMENT DANS CELUI DE L'AGENT.
 * L'agent répond à quelqu'un qui attend devant son écran. Lui ajouter un envoi
 * Telegram allongerait cette attente d'un appel réseau, et lierait deux pannes
 * qui n'ont rien à voir : Telegram indisponible ferait échouer une réponse qui,
 * elle, était prête. La relève est donc un processus séparé, qui passe
 * régulièrement ramasser ce qui n'a pas encore été annoncé.
 *
 * CE QUE FAIT LE WORKFLOW
 *
 *   1  toutes les minutes      déclencheur planifié
 *   2  relever la file         GET /support/service/a-notifier, clé de SERVICE
 *                              — rend AUSSI les conversations de l'équipe
 *   3  préparer les annonces   un message par ticket ET par destination ;
 *                              aucun ticket, ou aucune destination : on s'arrête
 *   4  annoncer                Telegram sendMessage, un envoi par élément
 *   5  retenir les confirmés   ceux dont Telegram a accusé réception, dédoublonnés
 *   6  marquer                 POST /support/service/notifies
 *
 * AU MOINS UNE FOIS, JAMAIS ZÉRO. Le marquage est séparé de la relève, et
 * n'emporte que les envois dont Telegram a renvoyé un `message_id`. Si un
 * envoi échoue, son ticket reste non annoncé et repassera au tour suivant.
 * Le risque assumé est donc le doublon, jamais l'escalade perdue — un
 * conseiller qui reçoit deux fois le même dossier s'en aperçoit, un dossier
 * jamais annoncé ne se remarque pas.
 *
 * CE QUI PART VERS TELEGRAM, ET POURQUOI L'ADRESSE EN FAIT PARTIE.
 *
 * Telegram est un service tiers. L'annonce ne portait d'abord que de quoi
 * trier — pseudo, rôle, motif, écran, extrait — sans nom, ni prénom, ni
 * adresse. Depuis le 24 septembre, l'exploitant ne fait plus que trier : il
 * RÉPOND depuis Telegram, et la réponse part par courriel. Il lui faut donc
 * l'adresse sous les yeux, et la demande entière.
 *
 * C'EST UN ARBITRAGE ASSUMÉ, demandé par le porteur du projet : l'adresse d'un
 * utilisateur transite désormais par Telegram. Le nom et le prénom, eux, n'y
 * passent toujours pas, et le dossier complet se lit dans le back-office.
 *
 * LA CLÉ UTILISÉE EST CELLE DE SERVICE, PAS CELLE D'AGENT. Les deux sont
 * distinctes et l'API refuse de démarrer si elles sont égales : la clé d'agent
 * atteste qu'une réponse vient de l'agent, la clé de service ouvre la relève
 * de la file. Une suite de tests vérifie qu'échanger l'une pour l'autre est
 * refusé (`server/tests/support.mjs`).
 * ===========================================================================
 */

import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* ================================================================== *
 *  CODE DES NŒUDS
 *
 *  Chaque fonction est le corps d'un nœud Code de n8n : `$input`, `$(…)`
 *  sont fournis par n8n à l'exécution. Elles ne sont jamais appelées ici —
 *  mais elles sont exportées, pour que la suite de tests puisse les
 *  exercer avec des entrées fabriquées.
 * ================================================================== */

/* eslint-disable no-undef */

export function preparerAnnonces() {
  /*
   * CONFIGURATION — le seul endroit à adapter.
   *
   * Pas de variable d'environnement : leur accès est bloqué dans les nœuds
   * (N8N_BLOCK_ENV_ACCESS_IN_NODE=true). Un nœud Code qui lit l'environnement
   * peut aussi lire N8N_ENCRYPTION_KEY, celle qui déchiffre tous les
   * identifiants.
   *
   * L'IDENTIFIANT DE CONVERSATION N'EST PAS ICI NON PLUS, mais pour une autre
   * raison qu'avant : il ne se configure plus du tout. L'API le sert, avec la
   * file — voir « LA DESTINATION VIENT DE L'API » plus bas.
   */
  const CONFIG = {
    backOffice: 'http://localhost:5173/admin/moderation',
    /*
     * MILLE DEUX CENTS SIGNES, ET NON TROIS CENTS. L'exploitant ne fait plus
     * que trier depuis Telegram : il y RÉPOND. Il lui faut donc la demande
     * entière, pas un aperçu. Telegram plafonne un message à 4096 signes, d'où
     * cette borne, qui laisse la place aux en-têtes et à la consigne.
     */
    extraitMax: 1200,
  };

  const reponse = $input.first().json;

  /*
   * L'APPEL A-T-IL ABOUTI ? `neverError` laisse passer les codes d'erreur, et
   * `continueRegularOutput` laisse passer les pannes réseau sous la forme
   * d'un élément `{ error }`. Dans les deux cas, on ne sait pas ce qu'il y a
   * dans la file : on ne marque rien et on repassera.
   */
  if (reponse.error || reponse.statusCode !== 200) return [];

  const tickets = Array.isArray(reponse.body?.tickets) ? reponse.body.tickets : [];
  if (tickets.length === 0) return [];

  /*
   * LA DESTINATION VIENT DE L'API, ET NON D'UN CHAMP DE L'ÉDITEUR.
   *
   * Elle était auparavant saisie à la main dans le nœud Telegram. Un
   * `import:workflow` REMPLACE le workflow par le fichier du dépôt : la
   * régénération du 24 septembre a effacé cette saisie, n8n a classé le nœud
   * « en défaut » et a REFUSÉ D'EXÉCUTER le workflow — pendant des heures,
   * sans qu'aucune alerte ne le dise. Les escalades s'accumulaient, le
   * téléphone restait muet.
   *
   * Ce sont désormais les conversations rattachées à un compte de l'ÉQUIPE
   * qui reçoivent, telles que l'API les rend. Régénérer ce workflow ne peut
   * plus rien détruire, et rattacher un second administrateur n'exige aucune
   * modification ici.
   *
   * AUCUNE DESTINATION = ON NE MARQUE RIEN. La file reste intacte et repartira
   * au prochain rattachement ; le serveur, lui, l'écrit dans son journal.
   */
  const destinations = Array.isArray(reponse.body?.destinations)
    ? reponse.body.destinations
        .map((d) => String(d?.conversation ?? ''))
        .filter((c) => /^[1-9]\d{0,19}$/.test(c))
    : [];

  if (destinations.length === 0) return [];

  /*
   * ÉCHAPPEMENT HTML — Telegram interprète `parse_mode: HTML`. Une question
   * contenant « <b> » ou « & » casserait le message, et Telegram refuserait
   * l'envoi entier. Trois caractères suffisent pour ce mode.
   */
  const echapper = (texte) =>
    String(texte ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  /*
   * DATE FORMATÉE À LA MAIN. `toLocaleString('fr-FR')` dépend des données de
   * localisation embarquées dans l'image Node ; sur une image réduite, il
   * retombe silencieusement sur l'anglais. Six champs numériques ne coûtent
   * rien et ne dépendent de rien.
   */
  const deuxChiffres = (n) => String(n).padStart(2, '0');
  const dateFr = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'date inconnue';
    return `${deuxChiffres(d.getDate())}/${deuxChiffres(d.getMonth() + 1)}/${d.getFullYear()} ` +
           `à ${deuxChiffres(d.getHours())} h ${deuxChiffres(d.getMinutes())}`;
  };

  const roles = { coach: 'coach', utilisateur: 'sportif', admin: 'administrateur' };

  return tickets
    // Un ticket sans identifiant ne pourrait pas être marqué ensuite : l'annoncer
    // le ferait réannoncer à chaque passage, indéfiniment.
    .filter((ticket) => typeof ticket._id === 'string' && ticket._id.length > 0)
    .flatMap((ticket) => {
      const pseudo = ticket.auteur?.pseudo ?? 'compte supprimé';
      const role = roles[ticket.roleAuteur] ?? ticket.roleAuteur ?? 'inconnu';

      const question = String(ticket.question ?? '');
      const extrait = question.length > CONFIG.extraitMax
        ? `${question.slice(0, CONFIG.extraitMax)}…`
        : question;

      /*
       * LA RÉFÉRENCE EST LA CLÉ DE LA RÉPONSE. Quand l'exploitant répondra à ce
       * message, Telegram joindra le texte cité : c'est en y relisant « Réf. »
       * que le bot saura de quel dossier il s'agit. Elle doit donc figurer en
       * clair, et sous une forme reconnaissable.
       */
      const reference = ticket.reference ?? String(ticket._id).slice(-8);

      const lignes = [
        '🔔 <b>Escalade support</b> — CoachConnect',
        '',
        `👤 @${echapper(pseudo)} (${echapper(role)})`,
        `✉️ ${echapper(ticket.auteur?.email ?? 'adresse inconnue')}`,
        `📌 Motif : ${echapper(ticket.motifEscalade ?? 'non précisé')}`,
        `🖥 Écran : ${echapper(ticket.origine || 'non précisé')}`,
        `🕒 Reçu le ${echapper(dateFr(ticket.escaladeLe ?? ticket.createdAt))}`,
        `🏷️ Réf. ${echapper(reference)}`,
        '',
        `<blockquote>${echapper(extrait)}</blockquote>`,
        '',
        `➡️ <a href="${CONFIG.backOffice}">Ouvrir le back-office</a>`,
        '',
        '↩️ <b>Répondez à ce message</b> avec ce que vous voulez dire : je rédigerai le courriel, et rien ne partira sans votre validation.',
      ];

      /*
       * UN ENVOI PAR DESTINATION. Deux administrateurs rattachés reçoivent
       * chacun le dossier : le premier disponible répond, et l'API refuse la
       * seconde validation — il n'y a jamais deux courriels pour un dossier.
       */
      const texte = lignes.join('\n');
      return destinations.map((chatId) => ({ json: { idTicket: ticket._id, reference, chatId, texte } }));
    });
}

export function retenirConfirmes() {
  /*
   * ON NE MARQUE QUE SUR PREUVE POSITIVE.
   *
   * L'absence d'erreur ne suffit pas : un nœud peut rendre un élément vide
   * sans avoir rien envoyé. On exige le `message_id` que Telegram renvoie
   * pour chaque message accepté. Tout le reste retourne dans la file.
   *
   * L'APPARIEMENT SE FAIT PAR `pairedItem`, que n8n renseigne pour relier un
   * élément de sortie à son élément d'entrée. L'index de position servirait
   * tant que les deux listes ont la même longueur — ce qui cesse d'être vrai
   * dès qu'un nœud filtre. Mieux vaut lire le lien que n8n fournit.
   */
  const annonces = $('Préparer les annonces').all();
  const resultats = $input.all();

  const ids = [];

  for (let i = 0; i < resultats.length; i += 1) {
    const sortie = resultats[i];
    const charge = sortie.json ?? {};

    if (charge.error) continue;

    // Selon la version du nœud, Telegram rend soit `result`, soit son contenu.
    const identifiantMessage = charge.message_id ?? charge.result?.message_id;
    if (!identifiantMessage) continue;

    const origine = typeof sortie.pairedItem === 'number'
      ? sortie.pairedItem
      : sortie.pairedItem?.item;
    const annonce = annonces[origine ?? i];

    if (annonce?.json?.idTicket) ids.push(annonce.json.idTicket);
  }

  /*
   * DÉDOUBLONNAGE : UN DOSSIER, UN IDENTIFIANT.
   *
   * Depuis que l'annonce part vers chaque administrateur rattaché, un même
   * dossier produit autant d'envois que de destinations. Sans ce passage, deux
   * administrateurs rempliraient la liste de doublons et la borne de cinquante
   * serait atteinte avec vingt-cinq dossiers seulement.
   *
   * UN SEUL ENVOI RÉUSSI SUFFIT À MARQUER. L'équipe a été jointe ; réannoncer
   * le dossier au tour suivant ne servirait qu'à sonner deux fois chez celui
   * qui l'a déjà reçu.
   */
  const uniques = [...new Set(ids)];

  // Sans identifiant confirmé, l'exécution s'arrête ici : rien à marquer.
  if (uniques.length === 0) return [];

  // Borne du validateur de l'API : 50 identifiants par appel.
  return [{ json: { ids: uniques.slice(0, 50), nombre: uniques.length } }];
}

/* eslint-enable no-undef */

/* ================================================================== *
 *  ASSEMBLAGE DU WORKFLOW
 * ================================================================== */

/** Corps d'une fonction, désindenté. */
function corpsDe(fonction) {
  const source = fonction.toString();
  const lignes = source.slice(source.indexOf('{') + 1, source.lastIndexOf('}')).split('\n');
  while (lignes.length && !lignes[0].trim()) lignes.shift();
  while (lignes.length && !lignes[lignes.length - 1].trim()) lignes.pop();
  const retrait = Math.min(...lignes.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  return lignes.map((l) => l.slice(retrait)).join('\n');
}

/** Identifiant stable dérivé du nom : réimporter ne duplique pas les nœuds. */
function idDe(nom) {
  const h = createHash('sha256').update(`coachconnect-releve:${nom}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const position = (colonne, ligne = 0) => [colonne * 260, ligne * 200];

const API = 'http://host.docker.internal:5000/api';

const IDENTIFIANT_CLE_SERVICE = { id: 'ccCleServiceSup1', name: 'Clé de service — CoachConnect' };
const IDENTIFIANT_TELEGRAM = { id: 'ccTelegramBot001', name: 'Bot Telegram — CoachConnect' };

/*
 * PLUS AUCUNE CONVERSATION À RENSEIGNER ICI, ET C'EST UNE LEÇON PAYÉE.
 *
 * Ce fichier portait une constante `CONVERSATION`, vide par défaut, à remplir
 * dans l'interface de n8n — nœud « Annoncer sur Telegram », champ « Chat ID ».
 * Le commentaire affirmait qu'un champ vide ne faisait rien perdre : « Telegram
 * refuse l'envoi, aucun ticket n'est marqué, la file repassera ».
 *
 * C'ÉTAIT FAUX. n8n ne va pas jusqu'à l'envoi : un paramètre requis vide met le
 * nœud « en défaut », et le workflow est REFUSÉ AVANT exécution
 * (`WorkflowHasIssuesError`). Le 24 septembre, régénérer ce workflow a effacé
 * la saisie de l'exploitant : la relève a échoué toutes les minutes pendant des
 * heures, sans qu'aucune escalade ne parte et sans que rien ne l'annonce.
 *
 * La destination est désormais servie par l'API, avec la file — les
 * conversations rattachées à un compte de l'équipe. Régénérer ce workflow ne
 * peut plus rien détruire.
 */

const reponseComplete = { response: { response: { fullResponse: true, neverError: true } } };

/*
 * `neverError` NE COUVRE QUE LES CODES HTTP : une panne réseau arrêterait
 * l'exécution. `continueRegularOutput` la transforme en élément `{ error }`,
 * que le nœud suivant traite comme un échec — et, ici, comme une raison de
 * ne rien marquer.
 */
const continuerSurErreur = { onError: 'continueRegularOutput' };

const noeudCode = (nom, fonction, pos) => ({
  parameters: { jsCode: corpsDe(fonction) },
  id: idDe(nom),
  name: nom,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: pos,
});

const noeuds = [
  {
    parameters: {
      rule: {
        /*
         * UNE MINUTE : une escalade est une personne qui attend. L'intervalle
         * ne coûte rien — la relève ne fait travailler aucun modèle, et un
         * passage à vide s'arrête au premier nœud, sans aucun envoi.
         */
        interval: [{ field: 'minutes', minutesInterval: 1 }],
      },
    },
    id: idDe('Toutes les minutes'),
    name: 'Toutes les minutes',
    type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2,
    position: position(0),
  },
  {
    parameters: {
      url: `${API}/support/service/a-notifier`,
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendQuery: true,
      // Borne du validateur de la relève : 50 au maximum.
      queryParameters: { parameters: [{ name: 'limite', value: '20' }] },
      options: { ...reponseComplete, timeout: 15000 },
    },
    id: idDe('Relever la file'),
    name: 'Relever la file',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.3,
    ...continuerSurErreur,
    position: position(1),
    credentials: { httpHeaderAuth: IDENTIFIANT_CLE_SERVICE },
  },
  /*
   * PAS DE NŒUD « Y A-T-IL QUELQUE CHOSE ? ». Un nœud Code qui ne rend aucun
   * élément arrête la branche : les nœuds suivants ne s'exécutent pas du tout.
   * Un test explicite serait un nœud de plus à lire, pour le même effet.
   */
  noeudCode('Préparer les annonces', preparerAnnonces, position(2)),
  {
    parameters: {
      /*
       * LA DESTINATION EST PORTÉE PAR L'ÉLÉMENT, comme le texte. Rien à
       * saisir, rien qu'une régénération puisse effacer.
       */
      chatId: '={{ $json.chatId }}',
      text: '={{ $json.texte }}',
      additionalFields: {
        parse_mode: 'HTML',
        // Le lien du back-office ne doit pas déclencher d'aperçu : il pointe
        // vers une page authentifiée, dont Telegram ne verrait qu'une erreur.
        disable_web_page_preview: true,
        appendAttribution: false,
      },
    },
    id: idDe('Annoncer sur Telegram'),
    name: 'Annoncer sur Telegram',
    type: 'n8n-nodes-base.telegram',
    typeVersion: 1.2,
    ...continuerSurErreur,
    position: position(3),
    credentials: { telegramApi: IDENTIFIANT_TELEGRAM },
  },
  noeudCode('Retenir les envois confirmés', retenirConfirmes, position(4)),
  {
    parameters: {
      method: 'POST',
      url: `${API}/support/service/notifies`,
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ ids: $json.ids }) }}',
      options: { ...reponseComplete, timeout: 15000 },
    },
    id: idDe('Marquer comme annoncés'),
    name: 'Marquer comme annoncés',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.3,
    ...continuerSurErreur,
    position: position(5),
    credentials: { httpHeaderAuth: IDENTIFIANT_CLE_SERVICE },
  },
];

const vers = (...noms) => noms.map((node) => ({ node, type: 'main', index: 0 }));

const connexions = {
  'Toutes les minutes': { main: [vers('Relever la file')] },
  'Relever la file': { main: [vers('Préparer les annonces')] },
  'Préparer les annonces': { main: [vers('Annoncer sur Telegram')] },
  'Annoncer sur Telegram': { main: [vers('Retenir les envois confirmés')] },
  'Retenir les envois confirmés': { main: [vers('Marquer comme annoncés')] },
};

const workflow = {
  id: 'ccReleveTelegr01',
  name: 'CoachConnect — relève des escalades sur Telegram',
  // Exigé par la base de n8n : sans lui, l'import échoue sur une contrainte
  // NOT NULL. Dérivé du contenu, il change dès que le workflow change.
  versionId: idDe(JSON.stringify(noeuds)),
  active: false,
  nodes: noeuds,
  connections: connexions,
  settings: { executionOrder: 'v1' },
  pinData: {},
};

/*
 * ÉCRITURE SEULEMENT SI L'ON EXÉCUTE CE FICHIER.
 *
 * La suite de tests IMPORTE ce module pour exercer les deux fonctions de
 * nœud avec des entrées fabriquées. Sans ce garde, un simple `import`
 * réécrirait le JSON du workflow — un effet de bord invisible, qui ferait
 * apparaître un fichier modifié après un `npm test`.
 */
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const sortie = fileURLToPath(new URL('./releve-telegram.json', import.meta.url));
  writeFileSync(sortie, `${JSON.stringify(workflow, null, 2)}\n`);
  console.log(`Workflow écrit : ${sortie} (${noeuds.length} nœuds)`);
}

/** Le workflow assemblé — la suite de tests en vérifie la structure. */
export const workflowReleve = workflow;
