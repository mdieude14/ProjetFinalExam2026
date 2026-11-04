/**
 * ===========================================================================
 *  SCRUTAGE TELEGRAM — module 15
 * ===========================================================================
 *
 *   npm run test:scrutage
 *
 * CE QUE CETTE SUITE DÉFEND.
 *
 * Le canal entrant ne passe plus par une adresse publique : le back-end va
 * chercher les messages chez Telegram (`getUpdates`) et les remet à n8n en
 * local. Trois propriétés méritent une suite à elles seules, parce que leur
 * violation est SILENCIEUSE :
 *
 *   1. UN MESSAGE NE DOIT JAMAIS ÊTRE PERDU. Telegram ne rend une mise à jour
 *      qu'une fois : la confirmer avant de l'avoir remise, c'est l'effacer
 *      d'un bout à l'autre du système sans que personne le sache. La suite
 *      prouve que l'avance ne se confirme qu'après une remise réussie, et
 *      qu'un lot à moitié remis reprend là où il s'était arrêté.
 *   2. LA FILE NE DOIT JAMAIS SE BLOQUER. Une mise à jour sans message — une
 *      photo, une réaction — qu'on ne confirmerait pas resterait en tête de
 *      file et empêcherait TOUT le reste de passer, indéfiniment.
 *   3. LE JETON NE DOIT JAMAIS ATTEINDRE UN JOURNAL. Il vaut le bot entier.
 *      Il voyage dans le CHEMIN de l'URL, donc chaque message d'erreur qui
 *      cite l'URL est une fuite — et `fetch` cite l'URL volontiers. La suite
 *      force les chemins d'erreur et vérifie qu'aucun ne le laisse passer.
 *
 * LA BOUCLE RÉELLE EST EXERCÉE, pas une imitation : seules l'API de Telegram
 * et celle de n8n sont remplacées. Aucun jeton, aucun réseau.
 * ===========================================================================
 */

import { creerScrutateur, masquer } from '../src/services/telegram-scrutage.service.js';

const resultats = [];
let sectionCourante = '';
const section = (nom) => { sectionCourante = nom; };
const ok = (libelle, condition, detail = '') =>
  resultats.push({ section: sectionCourante, libelle, ok: Boolean(condition), detail });

function afficher(interrompu) {
  let derniere = null;
  for (const r of resultats) {
    if (r.section !== derniere) { console.log(`\n--- ${r.section} ---`); derniere = r.section; }
    console.log(`${r.ok ? 'OK   ' : 'ECHEC'} ${r.libelle}${r.detail ? '  -> ' + r.detail : ''}`);
  }
  const echecs = resultats.filter((r) => !r.ok).length;
  console.log(
    `\n${resultats.length - echecs}/${resultats.length} vérifications réussies` +
      (interrompu ? `\nINTERROMPU : ${interrompu}` : '')
  );
  return echecs;
}

process.on('uncaughtException', (e) => { afficher(e.message); process.exit(1); });
process.on('unhandledRejection', (e) => { afficher(e?.message || e); process.exit(1); });

/* ------------------------------------------------------------------ *
 *  LE JETON D'ÉPREUVE
 *
 *  Reconnaissable exprès : toute trace dans un journal se verrait à l'œil
 *  nu, et c'est ce que vérifie la dernière section.
 * ------------------------------------------------------------------ */
const JETON = '123456789:JETON-SECRET-QUI-NE-DOIT-JAMAIS-S-IMPRIMER';
const CLE = 'cle-de-service-de-test';
const WEBHOOK = 'http://localhost:5678/webhook/telegram-support';

const reponseJson = (corps, statut = 200) => ({
  ok: statut < 400,
  status: statut,
  json: async () => corps,
});

const message = (id, texte = 'bonjour') => ({
  update_id: id,
  message: { chat: { id: 77, type: 'private' }, text: texte, from: { id: 77 } },
});

/**
 * Monte une scène : une fausse API Telegram, un faux n8n, et un journal
 * capturé.
 *
 * `lots` est la suite des réponses de `getUpdates`, un élément par tour. Une
 * fois épuisés, le faux Telegram se comporte comme une vraie attente longue
 * sans trafic : il ne répond pas, jusqu'à l'interruption. La boucle se fige
 * donc dans un état connu, ce qui rend les comptages d'appels stables.
 */
function scene(options = {}) {
  const { lots = [], n8nRepond = () => 200 } = options;

  /*
   * `jeton` ET `cleService` SE LISENT PAR PRÉSENCE DE LA CLÉ, pas par valeur
   * par défaut. Une valeur par défaut de paramètre se réapplique quand on
   * passe `undefined` — donc un test qui veut éprouver l'absence du jeton
   * recevrait le vrai. L'absence dans `.env` vaut `undefined` : c'est cette
   * valeur-là qu'il faut pouvoir transmettre.
   */
  const jeton = 'jeton' in options ? options.jeton : JETON;
  const cleService = 'cleService' in options ? options.cleService : CLE;

  const appels = [];
  const traces = [];
  let tour = 0;
  let signalerEpuisement;
  const epuise = new Promise((resoudre) => { signalerEpuisement = resoudre; });

  const fetchHttp = async (url, options = {}) => {
    const u = String(url);
    appels.push({ url: u, options });

    if (u.includes('/deleteWebhook')) return reponseJson({ ok: true, result: true });

    if (u.includes('/getUpdates')) {
      if (tour >= lots.length) {
        signalerEpuisement();
        return new Promise((_, rejeter) => {
          options.signal?.addEventListener('abort', () => {
            const e = new Error(`fetch failed sur ${u}`); // cite l'URL, comme le vrai fetch
            e.name = 'AbortError';
            rejeter(e);
          });
        });
      }
      const lot = lots[tour];
      tour += 1;
      if (lot instanceof Error) throw lot;
      if (typeof lot?.statut === 'number') return reponseJson(lot.corps ?? {}, lot.statut);
      return reponseJson({ ok: true, result: lot });
    }

    const statut = n8nRepond(JSON.parse(options.body ?? '{}'));
    if (statut instanceof Error) throw statut;
    return reponseJson({}, statut);
  };

  const journal = {
    log: (t) => traces.push(t),
    error: (t) => traces.push(t),
  };

  const scrutateur = creerScrutateur({
    jeton,
    base: 'https://api.telegram.org',
    webhook: WEBHOOK,
    cleService,
    attente: 0,
    reprise: 5,
    fetchHttp,
    journal,
  });

  return { appels, traces, scrutateur, epuise };
}

/** Joue une scène jusqu'à épuisement des lots, puis arrête proprement. */
async function jouer(options) {
  const s = scene(options);
  await s.scrutateur.demarrer();
  await s.epuise;
  await s.scrutateur.arreter();
  return s;
}

const demandes = (appels, motif) => appels.filter((a) => a.url.includes(motif));
const remises = (appels) => appels.filter((a) => a.url === WEBHOOK);
const offsetDe = (appel) => new URL(appel.url).searchParams.get('offset');

/* ================================================================== *
 *  1 — LE DÉFAUT SÛR : SANS JETON, RIEN NE PART
 * ================================================================== */

section('Sans jeton, aucun appel');

{
  const s = scene({ jeton: undefined });
  await s.scrutateur.demarrer();
  ok('**sans jeton, le scrutateur ne fait AUCUN appel** — ni Telegram, ni n8n',
    s.appels.length === 0, `${s.appels.length} appel(s)`);
  ok('et il le dit, au lieu de se taire',
    s.traces.some((t) => t.includes('TELEGRAM_BOT_TOKEN')), s.traces[0]);
  ok('il ne se déclare pas actif', s.scrutateur.etat().actif === false);
  await s.scrutateur.arreter();
}

{
  const s = scene({ cleService: undefined });
  await s.scrutateur.demarrer();
  ok('**sans clé de service, rien ne part non plus** — n8n refuserait la remise',
    s.appels.length === 0, `${s.appels.length} appel(s)`);
  ok('et la cause nommée est la bonne',
    s.traces.some((t) => t.includes('SUPPORT_SERVICE_KEY')), s.traces[0]);
  await s.scrutateur.arreter();
}

/* ================================================================== *
 *  2 — L'ORDRE DU DÉMARRAGE
 * ================================================================== */

section('Le webhook est retiré avant toute demande');

{
  const s = await jouer({ lots: [[message(1)]] });
  const premier = s.appels[0];

  ok('**`deleteWebhook` précède le premier `getUpdates`** — sinon Telegram répond 409 sans fin',
    premier.url.includes('/deleteWebhook'), premier.url.split('/').pop().split('?')[0]);

  ok('**la file en attente n’est PAS jetée** — les réponses déjà envoyées y dorment',
    new URL(premier.url).searchParams.get('drop_pending_updates') === 'false');

  const demande = demandes(s.appels, '/getUpdates')[0];
  ok('la demande ne réclame que les messages',
    new URL(demande.url).searchParams.get('allowed_updates') === '["message"]');
  ok('la demande porte une attente longue',
    new URL(demande.url).searchParams.has('timeout'));
  ok('**le premier tour ne porte pas d’offset** — Telegram rend alors tout ce qui attend',
    new URL(demande.url).searchParams.has('offset') === false);
}

/* ================================================================== *
 *  3 — LA REMISE À n8n
 * ================================================================== */

section('Ce qui arrive à n8n');

{
  const s = await jouer({ lots: [[message(10, 'ma réponse')]] });
  const remise = remises(s.appels)[0];

  ok('la remise part en POST sur le webhook local', remise?.options.method === 'POST');

  ok('**elle porte la clé de service** — c’est le seul rempart sur un port joignable du réseau local',
    remise?.options.headers['x-service-key'] === CLE);

  const corps = JSON.parse(remise.options.body);
  ok('**l’enveloppe est `{ message }`, la forme même du déclencheur** — l’aval ne change pas',
    JSON.stringify(Object.keys(corps)) === '["message"]');
  ok('le texte traverse intact', corps.message.text === 'ma réponse');
  ok('la conversation traverse intacte', corps.message.chat.id === 77);

  ok('l’état compte la remise', s.scrutateur.etat().transmis === 1);
}

/* ================================================================== *
 *  4 — L'AVANCE : LA PROPRIÉTÉ QUI PERD DES MESSAGES QUAND ELLE CASSE
 * ================================================================== */

section('L’avance ne se confirme qu’après une remise réussie');

{
  const s = await jouer({ lots: [[message(10)], [message(11)]] });
  const suite = demandes(s.appels, '/getUpdates');

  ok('**le deuxième tour confirme la première mise à jour** — sinon elle reviendrait sans fin',
    offsetDe(suite[1]) === '11', offsetDe(suite[1]));
  ok('et le troisième confirme la deuxième',
    offsetDe(suite[2]) === '12', offsetDe(suite[2]));
}

{
  const s = await jouer({ lots: [[message(10)], []], n8nRepond: () => 500 });
  const suite = demandes(s.appels, '/getUpdates');

  ok('**n8n refuse : l’avance NE bouge PAS** — le message sera redemandé, pas perdu',
    suite[1] && offsetDe(suite[1]) === null, String(offsetDe(suite[1])));
  ok('et le refus est annoncé, avec son code',
    s.traces.some((t) => t.includes('500')));
}

{
  const s = await jouer({ lots: [[message(10)], []], n8nRepond: () => 404 });
  ok('**un 404 nomme la cause réelle** — un workflow importé revient toujours inactif',
    s.traces.some((t) => t.includes('actif')), s.traces.find((t) => t.includes('404')));
}

{
  const s = await jouer({
    lots: [[message(10), message(11), message(12)], []],
    n8nRepond: (corps) => (corps.message.text === 'refus' ? 500 : 200),
  });
  ok('un lot entier passe quand tout va bien', remises(s.appels).length === 3);
  ok('l’avance va jusqu’au dernier du lot',
    offsetDe(demandes(s.appels, '/getUpdates')[1]) === '13');
}

{
  let numero = 0;
  const s = await jouer({
    lots: [[message(20), message(21), message(22)], []],
    n8nRepond: () => { numero += 1; return numero === 2 ? 500 : 200; },
  });

  ok('**un lot à moitié remis s’arrête net** — on ne saute pas par-dessus un échec',
    remises(s.appels).length === 2, `${remises(s.appels).length} remise(s)`);
  ok('**et l’avance s’arrête au dernier remis** — le reste du lot revient au tour suivant',
    offsetDe(demandes(s.appels, '/getUpdates')[1]) === '21',
    offsetDe(demandes(s.appels, '/getUpdates')[1]));
}

/* ================================================================== *
 *  5 — LA FILE NE DOIT JAMAIS SE BLOQUER
 * ================================================================== */

section('Une mise à jour sans message se confirme quand même');

{
  const s = await jouer({
    lots: [[{ update_id: 30 }, { update_id: 31, edited_message: { text: 'x' } }], []],
  });

  ok('rien n’est remis à n8n', remises(s.appels).length === 0);
  ok('**mais l’avance passe par-dessus** — sinon elle bloquerait toute la file à jamais',
    offsetDe(demandes(s.appels, '/getUpdates')[1]) === '32',
    offsetDe(demandes(s.appels, '/getUpdates')[1]));
  ok('l’état les compte comme ignorées', s.scrutateur.etat().ignores === 2);
}

{
  const s = await jouer({ lots: [[{ update_id: 40 }, message(41)], []] });
  ok('une mise à jour vide n’empêche pas la suivante d’être remise',
    remises(s.appels).length === 1
    && JSON.parse(remises(s.appels)[0].options.body).message.text === 'bonjour');
}

/* ================================================================== *
 *  6 — CE QUE DIT LE SCRUTATEUR QUAND TELEGRAM REFUSE
 * ================================================================== */

section('Les refus de Telegram, et leur cause');

{
  const s = await jouer({ lots: [{ statut: 409, corps: { ok: false, description: 'Conflict' } }, []] });
  ok('**un 409 nomme le webhook encore posé** — c’est la seule cause, et son remède n’est pas devinable',
    s.traces.some((t) => t.includes('webhook') && t.includes('409')),
    s.traces.find((t) => t.includes('409')));
  ok('le flux à corriger est nommé',
    s.traces.some((t) => t.includes('ccAgentTelegr01')));
}

{
  const s = await jouer({
    lots: [{ statut: 200, corps: { ok: false, description: 'Unauthorized' } }, []],
  });
  ok('un jeton refusé par Telegram est annoncé avec sa description',
    s.traces.some((t) => t.includes('Unauthorized')));
  ok('et il compte comme un échec', s.scrutateur.etat().echecs >= 1);
}

{
  const s = await jouer({ lots: [new Error('getaddrinfo ENOTFOUND api.telegram.org'), []] });
  ok('**une panne de réseau ne tue pas la boucle** — elle reprend au tour suivant',
    demandes(s.appels, '/getUpdates').length >= 2,
    `${demandes(s.appels, '/getUpdates').length} tour(s)`);
  ok('et la panne est tracée', s.traces.some((t) => t.includes('ENOTFOUND')));
}

/* ================================================================== *
 *  7 — L'ARRÊT
 * ================================================================== */

section('L’arrêt interrompt l’attente longue');

{
  const s = scene({ lots: [[message(1)]] });
  await s.scrutateur.demarrer();
  await s.epuise;

  const depart = Date.now();
  await s.scrutateur.arreter();
  const duree = Date.now() - depart;

  ok('**l’arrêt n’attend pas la fin de l’attente longue** — sinon l’arrêt du serveur traînerait 50 s',
    duree < 1000, `${duree} ms`);
  ok('le scrutateur se déclare arrêté', s.scrutateur.etat().actif === false);

  const avant = s.appels.length;
  await new Promise((r) => setTimeout(r, 50));
  ok('et plus aucun appel ne part après l’arrêt', s.appels.length === avant);
}

/* ================================================================== *
 *  8 — LE JETON NE DOIT JAMAIS ATTEINDRE UN JOURNAL
 * ================================================================== */

section('Le jeton reste hors des traces');

ok('`masquer` remplace le jeton dans une URL',
  masquer('https://api.telegram.org/bot123:ABC/getUpdates')
    === 'https://api.telegram.org/bot•••/getUpdates');

ok('il le remplace aussi au milieu d’une phrase',
  masquer('fetch failed sur https://api.telegram.org/bot123:ABC/getUpdates?offset=2').includes('bot•••'));

ok('masquer ne touche pas un texte sans jeton',
  masquer('rien à masquer ici') === 'rien à masquer ici');

{
  /*
   * ON FORCE TOUS LES CHEMINS D'ERREUR DANS UNE SEULE SCÈNE : c'est là que
   * les fuites se produisent, parce qu'un message d'erreur de `fetch` cite
   * l'URL complète — jeton compris.
   */
  const s = await jouer({
    lots: [
      new Error(`fetch failed sur https://api.telegram.org/bot${JETON}/getUpdates`),
      { statut: 409, corps: { ok: false, description: 'Conflict' } },
      { statut: 200, corps: { ok: false, description: 'Unauthorized' } },
      [message(50)],
      [],
    ],
    n8nRepond: () => 500,
  });

  const tout = s.traces.join('\n');
  ok('**aucune trace ne contient le jeton**, sur aucun des chemins d’erreur',
    !tout.includes(JETON) && !tout.includes('JETON-SECRET'),
    `${s.traces.length} trace(s) examinée(s)`);
  ok('et le masque a bien servi', tout.includes('bot•••'));
  ok('les traces restent utilisables malgré le masque',
    tout.includes('409') && tout.includes('Unauthorized') && tout.includes('500'));
}

/* ================================================================== *
 *  9 — PERFORMANCE
 * ================================================================== */

section('Performance');

{
  const cent = Array.from({ length: 100 }, (_, i) => message(1000 + i, `message ${i}`));
  const depart = Date.now();
  const s = await jouer({ lots: [cent, []] });
  const duree = Date.now() - depart;

  ok('cent mises à jour sont remises en un seul tour', remises(s.appels).length === 100);
  ok('**l’ordre est préservé** — deux réponses au même dossier ne doivent pas s’inverser',
    JSON.parse(remises(s.appels)[0].options.body).message.text === 'message 0'
    && JSON.parse(remises(s.appels)[99].options.body).message.text === 'message 99');
  ok('cent remises tiennent en moins de 500 ms', duree < 500, `${duree} ms`);
  ok('l’avance confirme les cent d’un coup',
    offsetDe(demandes(s.appels, '/getUpdates')[1]) === '1100');
}

{
  /*
   * LA BOUCLE NE DOIT PAS MONOPOLISER LE PROCESSUS. Le back-end sert des
   * requêtes HTTP pendant qu'elle tourne : si l'attente longue bloquait la
   * boucle d'événements, l'API deviendrait muette.
   */
  const s = scene({ lots: [[message(1)]] });
  await s.scrutateur.demarrer();
  await s.epuise;

  let tics = 0;
  const minuteur = setInterval(() => { tics += 1; }, 5);
  await new Promise((r) => setTimeout(r, 100));
  clearInterval(minuteur);
  await s.scrutateur.arreter();

  /*
   * LE SEUIL DISTINGUE ZÉRO DE PLUSIEURS, et rien de plus. Un `await` sur une
   * requête réseau laisse la file libre : on relève une dizaine de tics. Une
   * boucle bloquée en relèverait zéro ou un. Exiger un débit précis ferait
   * échouer la vérification sur une machine chargée sans qu'aucune propriété
   * n'ait cassé — c'est la leçon de l'animation échantillonnée.
   */
  ok('**la boucle d’événements reste libre pendant l’attente longue** — l’API continue de servir',
    tics >= 3, `${tics} tic(s) en 100 ms`);
}

process.exit(afficher() > 0 ? 1 : 0);
