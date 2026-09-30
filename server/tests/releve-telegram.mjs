/**
 * ===========================================================================
 *  RELÈVE DES ESCALADES SUR TELEGRAM — module 15
 * ===========================================================================
 *
 *   npm run test:releve
 *
 * CE QUE CETTE SUITE DÉFEND.
 *
 * Un workflow n8n ne s'exécute pas dans une suite de tests : il vit dans un
 * conteneur, déclenché par une horloge, et parle à un service tiers. Ce qui
 * se vérifie ici, ce sont les DEUX ENDROITS OÙ IL DÉCIDE — et ils sont tous
 * deux en JavaScript, dans des nœuds Code :
 *
 *   « Préparer les annonces »          ce qui part vers Telegram
 *   « Retenir les envois confirmés »   ce qui est réputé annoncé
 *
 * Le second est le plus important du module. Marquer un ticket qui n'a PAS
 * été annoncé, c'est perdre une escalade en silence : personne ne la reverra,
 * et personne ne saura qu'elle a existé. La suite prouve donc qu'on ne marque
 * que sur preuve positive — le `message_id` renvoyé par Telegram — et jamais
 * sur la simple absence d'erreur.
 *
 * Le premier garde une frontière de confidentialité, redessinée le 24
 * septembre : l'exploitant répond désormais depuis Telegram, et la réponse
 * part par courriel — l'adresse de l'auteur y figure donc, arbitrage assumé.
 * Le nom et le prénom, eux, n'y passent toujours pas, et les vérifications en
 * gras échoueraient si quelqu'un les y ajoutait.
 *
 * POURQUOI L'IMPORT DANS n8n N'EST PAS DANS CETTE SUITE. `n8n import:workflow`
 * réécrit le workflow en base, avec `active: false`. Lancer les tests
 * désactiverait donc la relève en production silencieusement. L'import reste
 * un geste de déploiement, fait une fois, à la main.
 * ===========================================================================
 */

import { preparerAnnonces, retenirConfirmes, workflowReleve }
  from '../../docker/n8n/workflows/construire-releve-telegram.mjs';

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
 *  Fausse mécanique n8n
 *
 *  Les nœuds Code lisent `$input` et `$('Nom du nœud')`, que n8n injecte à
 *  l'exécution. On les fournit ici pour exercer les fonctions telles quelles,
 *  sans les recopier — une copie finirait par diverger de l'original.
 * ------------------------------------------------------------------ */

const flux = (elements) => ({ first: () => elements[0], all: () => elements });

/** Exécute un nœud Code avec les entrées données. */
function executer(fonction, { entree = [], nœuds = {} } = {}) {
  globalThis.$input = flux(entree);
  globalThis.$ = (nom) => flux(nœuds[nom] ?? []);
  try {
    return fonction();
  } finally {
    delete globalThis.$input;
    delete globalThis.$;
  }
}

/** Une réponse de la relève, telle que le nœud HTTP la rend. */
/**
 * Réponse de `GET /support/service/a-notifier`.
 *
 * ELLE PORTE MAINTENANT LES DESTINATIONS. Elles vivaient dans un champ de
 * l'éditeur n8n jusqu'à ce qu'une régénération l'efface — voir la section
 * « la destination vient de l'API », qui garde la trace de cette panne.
 */
const UNE_DESTINATION = [{ pseudo: 'mdieude14', conversation: '1234567890' }];

const releve = (tickets, statusCode = 200, destinations = UNE_DESTINATION) => [
  { json: { statusCode, body: { succes: true, nombre: tickets.length, tickets, destinations } } },
];

const ticket = (surcharge = {}) => ({
  _id: '6ab1285095591f9c0d385b80',
  auteur: { _id: 'u1', pseudo: 'alice', nom: 'Durand', prenom: 'Alice', type: 'utilisateur' },
  roleAuteur: 'utilisateur',
  question: 'Je veux être remboursé de mon abonnement du mois dernier.',
  origine: '/compte',
  motifEscalade: 'décision à prendre par un humain',
  statut: 'escalade',
  escaladeLe: '2026-09-21T13:42:07.000Z',
  createdAt: '2026-09-21T13:42:05.000Z',
  notifieExploitant: false,
  ...surcharge,
});

/* ================================================================== *
 *  1 — STRUCTURE DU WORKFLOW
 * ================================================================== */

section('Structure — le workflow tient debout');

const noeuds = workflowReleve.nodes;
const parNom = Object.fromEntries(noeuds.map((n) => [n.name, n]));
const attendus = [
  'Toutes les minutes',
  'Relever la file',
  'Préparer les annonces',
  'Annoncer sur Telegram',
  'Retenir les envois confirmés',
  'Marquer comme annoncés',
];

ok('les six nœuds attendus sont présents',
  attendus.every((n) => parNom[n]) && noeuds.length === attendus.length,
  `${noeuds.length} nœud(s)`);

ok('chaque nœud porte un identifiant et un nom uniques',
  new Set(noeuds.map((n) => n.id)).size === noeuds.length &&
  new Set(noeuds.map((n) => n.name)).size === noeuds.length);

ok('`versionId` est renseigné — sans lui l’import échoue sur une contrainte NOT NULL',
  typeof workflowReleve.versionId === 'string' && workflowReleve.versionId.length > 0);

const cibles = Object.values(workflowReleve.connections)
  .flatMap((c) => c.main.flat().map((l) => l.node));

ok('toute connexion pointe vers un nœud qui existe',
  cibles.every((n) => parNom[n]), `${cibles.length} liaison(s)`);

// Parcours depuis le déclencheur : un nœud injoignable ne s'exécuterait jamais.
const atteints = new Set(['Toutes les minutes']);
let ajout = true;
while (ajout) {
  ajout = false;
  for (const [depuis, conn] of Object.entries(workflowReleve.connections)) {
    if (!atteints.has(depuis)) continue;
    for (const lien of conn.main.flat()) {
      if (!atteints.has(lien.node)) { atteints.add(lien.node); ajout = true; }
    }
  }
}
ok('**aucun nœud orphelin** — tous sont atteints depuis le déclencheur',
  attendus.every((n) => atteints.has(n)), `${atteints.size}/${attendus.length}`);

ok('le déclencheur est planifié, à la minute',
  parNom['Toutes les minutes'].type === 'n8n-nodes-base.scheduleTrigger' &&
  parNom['Toutes les minutes'].parameters.rule.interval[0].minutesInterval === 1);

section('Structure — les clés et les pannes');

const cleDesDeux = [parNom['Relever la file'], parNom['Marquer comme annoncés']]
  .map((n) => n.credentials?.httpHeaderAuth?.id);

ok('**les deux appels à l’API présentent la clé de SERVICE**',
  cleDesDeux.every((id) => id === 'ccCleServiceSup1'), cleDesDeux.join(' / '));

ok('**et jamais la clé d’agent** — elle n’ouvre pas la relève (cf. test:support)',
  cleDesDeux.every((id) => id !== 'ccCleAgentSupp01'));

ok('le nœud Telegram porte l’identifiant du bot',
  parNom['Annoncer sur Telegram'].credentials?.telegramApi?.id === 'ccTelegramBot001');

ok('**les trois nœuds réseau survivent à une panne** (`continueRegularOutput`)',
  ['Relever la file', 'Annoncer sur Telegram', 'Marquer comme annoncés']
    .every((n) => parNom[n].onError === 'continueRegularOutput'));

ok('le marquage borne son envoi à la liste d’identifiants, rien d’autre',
  parNom['Marquer comme annoncés'].parameters.jsonBody === '={{ JSON.stringify({ ids: $json.ids }) }}');

/*
 * LA PANNE DU 24 SEPTEMBRE, ENCODÉE EN TEST.
 *
 * Le champ « Chat ID » était vide dans le dépôt et se renseignait à la main
 * dans l'éditeur n8n. Régénérer ce workflow l'a effacé : n8n a classé le nœud
 * « en défaut » et a REFUSÉ d'exécuter la relève pendant des heures —
 * `WorkflowHasIssuesError`, levé avant le premier nœud. Aucune escalade n'est
 * partie, et rien ne l'a signalé.
 *
 * Ce test échouerait si quelqu'un remettait une valeur en dur, ou un champ
 * vide : la destination doit venir de l'élément, donc de l'API.
 */
ok('**la destination vient de l’élément, jamais d’un champ à recopier**',
  parNom['Annoncer sur Telegram'].parameters.chatId === '={{ $json.chatId }}',
  parNom['Annoncer sur Telegram'].parameters.chatId);

ok('**et aucun identifiant de conversation n’est gravé dans le dépôt**',
  !/["']\d{6,}["']/.test(JSON.stringify(workflowReleve.nodes)));

ok('les messages partent en HTML, sans aperçu de lien ni signature n8n', (() => {
  const a = parNom['Annoncer sur Telegram'].parameters.additionalFields;
  return a.parse_mode === 'HTML' && a.disable_web_page_preview === true && a.appendAttribution === false;
})());

section('Structure — le code des nœuds est du JavaScript valide');

for (const nom of ['Préparer les annonces', 'Retenir les envois confirmés']) {
  let erreur = null;
  try { new Function(parNom[nom].parameters.jsCode); } catch (e) { erreur = e.message; }
  ok(`« ${nom} » se compile`, erreur === null, erreur ?? '');
}

/* ================================================================== *
 *  2 — CE QUI PART VERS TELEGRAM
 * ================================================================== */

section('Préparer les annonces — quand il n’y a rien à annoncer');

ok('file vide : aucun élément, la branche s’arrête d’elle-même',
  executer(preparerAnnonces, { entree: releve([]) }).length === 0);

ok('**l’API répond 500 : on ne marque rien** — on ignore ce que contient la file',
  executer(preparerAnnonces, { entree: releve([ticket()], 500) }).length === 0);

ok('**panne réseau : on ne marque rien non plus**',
  executer(preparerAnnonces, { entree: [{ json: { error: 'fetch failed' } }] }).length === 0);

ok('corps inattendu : aucun élément plutôt qu’une erreur',
  executer(preparerAnnonces, { entree: [{ json: { statusCode: 200, body: {} } }] }).length === 0);

section('Préparer les annonces — la destination vient de l’API');

/*
 * CE QUI A COÛTÉ UNE JOURNÉE D'ESCALADES SILENCIEUSES. La conversation de
 * destination était saisie dans l'éditeur n8n ; une régénération du workflow
 * l'a effacée, et n8n a cessé d'exécuter la relève sans prévenir. Elle est
 * désormais servie avec la file : aucune régénération ne peut plus l'effacer.
 */
ok('**aucune destination rattachée : on ne marque rien**, la file reste intacte',
  executer(preparerAnnonces, { entree: releve([ticket()], 200, []) }).length === 0);

ok('destinations absentes du corps : même prudence',
  executer(preparerAnnonces, {
    entree: [{ json: { statusCode: 200, body: { tickets: [ticket()] } } }],
  }).length === 0);

ok('**un identifiant de GROUPE est écarté** — un dossier n’a rien à faire sous les yeux d’un groupe',
  executer(preparerAnnonces, {
    entree: releve([ticket()], 200, [{ pseudo: 'x', conversation: '-1001234567890' }]),
  }).length === 0);

ok('une conversation vide ou fantaisiste est écartée de la même façon',
  executer(preparerAnnonces, {
    entree: releve([ticket()], 200, [{ pseudo: 'x', conversation: '' }, { pseudo: 'y' }, { conversation: 'abc' }]),
  }).length === 0);

const deuxAdmins = executer(preparerAnnonces, {
  entree: releve(
    [ticket(), ticket({ _id: '6ab1285095591f9c0d385b81', question: 'Autre chose' })],
    200,
    [{ pseudo: 'mdieude14', conversation: '111' }, { pseudo: 'admin', conversation: '222' }]
  ),
});

ok('**deux dossiers et deux administrateurs donnent quatre envois**', deuxAdmins.length === 4);
ok('chacun porte sa propre destination',
  JSON.stringify(deuxAdmins.map((a) => a.json.chatId)) === JSON.stringify(['111', '222', '111', '222']));
ok('et le même dossier part à l’identique aux deux',
  deuxAdmins[0].json.texte === deuxAdmins[1].json.texte &&
  deuxAdmins[0].json.idTicket === deuxAdmins[1].json.idTicket);

section('Préparer les annonces — le message');

const annonces = executer(preparerAnnonces, {
  entree: releve([ticket(), ticket({ _id: '6ab1285095591f9c0d385b81', question: 'Autre chose' })]),
});

ok('deux tickets donnent deux annonces', annonces.length === 2);

ok('chaque annonce porte l’identifiant du ticket, pour le marquage ensuite',
  annonces.every((a) => typeof a.json.idTicket === 'string' && a.json.idTicket.length === 24));

const message = annonces[0].json.texte;

ok('le pseudo et le rôle sont annoncés, en français',
  message.includes('@alice') && message.includes('(sportif)'), 'rôle traduit depuis `utilisateur`');

ok('le motif d’escalade est annoncé',
  message.includes('décision à prendre par un humain'));

ok('l’écran d’origine est annoncé', message.includes('/compte'));

ok('la date est formatée à la main, sans dépendre des locales de l’image',
  /\d{2}\/\d{2}\/\d{4} à \d{2} h \d{2}/.test(message), message.match(/\d{2}\/.*h \d{2}/)?.[0] ?? '');

ok('un lien mène au back-office pour instruire',
  message.includes('http://localhost:5173/admin/moderation'));

ok('un extrait de la question permet de trier',
  message.includes('Je veux être remboursé'));

section('Préparer les annonces — la frontière de confidentialité');

ok('**le nom de famille ne part pas vers Telegram**', !message.includes('Durand'));
ok('**le prénom ne part pas non plus**', !message.includes('Alice'));

const avecMail = executer(preparerAnnonces, {
  entree: releve([ticket({
    roleAuteur: 'coach',
    auteur: { pseudo: 'bob', nom: 'X', prenom: 'Y', type: 'coach', email: 'bob@exemple.fr' },
  })]),
})[0].json.texte;

/*
 * L'ADRESSE PART VERS TELEGRAM DEPUIS LE 24 SEPTEMBRE, et c'est un arbitrage
 * assumé : l'exploitant répond depuis Telegram, et la réponse s'envoie par
 * courriel. Une version antérieure l'excluait — la vérification disait alors
 * l'inverse de celle-ci.
 */
ok('**l’adresse de l’auteur est annoncée** — la réponse part par courriel',
  avecMail.includes('bob@exemple.fr'));
ok('**le nom et le prénom, eux, ne partent toujours pas**',
  !avecMail.includes('"X"') && !/X/.test(avecMail) && !avecMail.includes('Y'));
ok('une adresse inconnue est dite comme telle, sans laisser la ligne vide',
  executer(preparerAnnonces, { entree: releve([ticket({ auteur: { pseudo: 'sansmail' } })]) })[0]
    .json.texte.includes('adresse inconnue'));

/*
 * LE RÔLE ANNONCÉ EST CELUI DU TICKET (`roleAuteur`), PAS CELUI DU COMPTE
 * AUJOURD'HUI (`auteur.type`). Une personne devenue coach depuis sa question
 * doit apparaître telle qu'elle était quand elle l'a posée — c'est ce rôle
 * qui explique ce qu'elle voyait à l'écran.
 */
ok('un coach est annoncé comme coach', avecMail.includes('(coach)'));

const long = 'a'.repeat(2000);
const tronque = executer(preparerAnnonces, { entree: releve([ticket({ question: long })]) })[0].json.texte;

ok('**une question longue est tronquée** — Telegram plafonne un message à 4096 signes',
  tronque.includes(`${'a'.repeat(1200)}…`) && !tronque.includes('a'.repeat(1201)),
  '1200 caractères');

section('La référence, clé de la réponse');

const avecRef = executer(preparerAnnonces, { entree: releve([ticket()]) })[0];
ok('**la référence figure en clair dans le message** — c’est par elle que le bot retrouvera le dossier',
  avecRef.json.texte.includes('Réf. 0d385b80'), avecRef.json.reference);
ok('et accompagne l’élément, pour la suite du parcours', avecRef.json.reference === '0d385b80');
ok('**ce sont les huit DERNIERS signes de l’identifiant** — les premiers ne sont qu’un horodatage',
  avecRef.json.reference === '6ab1285095591f9c0d385b80'.slice(-8));
ok('le message invite à répondre directement', avecRef.json.texte.includes('Répondez à ce message'));

section('Préparer les annonces — les cas qui cassent un envoi');

const hostile = executer(preparerAnnonces, {
  entree: releve([ticket({ question: 'Pourquoi <b>ça</b> plante & pourquoi <script>?' })]),
})[0].json.texte;

ok('**les chevrons de la question sont échappés** — sinon Telegram refuse tout le message',
  hostile.includes('&lt;b&gt;') && hostile.includes('&lt;script&gt;') && !hostile.includes('<b>ça</b>'));

ok('**l’esperluette est échappée**', hostile.includes('&amp;'));

ok('les balises du gabarit, elles, restent du HTML',
  hostile.includes('<blockquote>') && hostile.includes('<b>Escalade support</b>'));

ok('**un ticket sans identifiant est écarté** — sinon il serait réannoncé sans fin',
  executer(preparerAnnonces, { entree: releve([ticket({ _id: undefined })]) }).length === 0);

ok('un compte supprimé n’empêche pas l’annonce',
  executer(preparerAnnonces, { entree: releve([ticket({ auteur: null })]) })[0]
    .json.texte.includes('compte supprimé'));

ok('un motif absent ne laisse pas un trou dans le message',
  executer(preparerAnnonces, { entree: releve([ticket({ motifEscalade: undefined })]) })[0]
    .json.texte.includes('non précisé'));

ok('une date invalide ne fait pas échouer la composition',
  executer(preparerAnnonces, { entree: releve([ticket({ escaladeLe: 'n’importe quoi', createdAt: null })]) })[0]
    .json.texte.includes('date inconnue'));

/* ================================================================== *
 *  3 — CE QUI EST RÉPUTÉ ANNONCÉ
 * ================================================================== */

section('Retenir les envois confirmés — le cœur du module');

/** Les annonces telles que le nœud précédent les a produites. */
const troisAnnonces = [
  { json: { idTicket: 'aaaaaaaaaaaaaaaaaaaaaaa1', texte: 'un' } },
  { json: { idTicket: 'aaaaaaaaaaaaaaaaaaaaaaa2', texte: 'deux' } },
  { json: { idTicket: 'aaaaaaaaaaaaaaaaaaaaaaa3', texte: 'trois' } },
];
const contexte = { 'Préparer les annonces': troisAnnonces };

const confirme = (i, message_id = 100 + i) => ({ json: { message_id }, pairedItem: { item: i } });

const tousConfirmes = executer(retenirConfirmes, {
  entree: [confirme(0), confirme(1), confirme(2)],
  nœuds: contexte,
});

ok('trois envois confirmés : trois identifiants à marquer',
  tousConfirmes[0]?.json.ids.length === 3);

ok('et ce sont bien ceux des tickets annoncés',
  tousConfirmes[0]?.json.ids.join(',') ===
    'aaaaaaaaaaaaaaaaaaaaaaa1,aaaaaaaaaaaaaaaaaaaaaaa2,aaaaaaaaaaaaaaaaaaaaaaa3');

const avecErreur = executer(retenirConfirmes, {
  entree: [confirme(0), { json: { error: 'chat not found' }, pairedItem: { item: 1 } }, confirme(2)],
  nœuds: contexte,
});

ok('**un envoi en erreur n’est PAS marqué** — son ticket repassera au tour suivant',
  avecErreur[0]?.json.ids.length === 2 &&
  !avecErreur[0].json.ids.includes('aaaaaaaaaaaaaaaaaaaaaaa2'),
  avecErreur[0]?.json.ids.join(','));

const sansPreuve = executer(retenirConfirmes, {
  entree: [confirme(0), { json: {}, pairedItem: { item: 1 } }, confirme(2)],
  nœuds: contexte,
});

ok('**une réponse vide n’est pas une confirmation** : sans `message_id`, rien n’est marqué',
  sansPreuve[0]?.json.ids.length === 2 &&
  !sansPreuve[0].json.ids.includes('aaaaaaaaaaaaaaaaaaaaaaa2'));

ok('l’autre forme de réponse Telegram est acceptée (`result.message_id`)',
  executer(retenirConfirmes, {
    entree: [{ json: { result: { message_id: 42 } }, pairedItem: { item: 1 } }],
    nœuds: contexte,
  })[0]?.json.ids[0] === 'aaaaaaaaaaaaaaaaaaaaaaa2');

ok('**aucun envoi confirmé : aucun appel de marquage** — la branche s’arrête',
  executer(retenirConfirmes, {
    entree: [{ json: { error: 'unauthorized' }, pairedItem: { item: 0 } }],
    nœuds: contexte,
  }).length === 0);

ok('Telegram muet : rien à marquer, plutôt qu’une erreur',
  executer(retenirConfirmes, { entree: [], nœuds: contexte }).length === 0);

section('Retenir les envois confirmés — plusieurs destinations');

/*
 * UN DOSSIER ANNONCÉ À DEUX ADMINISTRATEURS PRODUIT DEUX ENVOIS. Sans
 * dédoublonnage, la liste porterait deux fois le même identifiant : la borne
 * de cinquante de l'API serait atteinte avec vingt-cinq dossiers, et le
 * marquage travaillerait pour rien.
 */
const deuxDestinations = {
  'Préparer les annonces': [
    { json: { idTicket: 'bbbbbbbbbbbbbbbbbbbbbbb1', chatId: '111', texte: 'un' } },
    { json: { idTicket: 'bbbbbbbbbbbbbbbbbbbbbbb1', chatId: '222', texte: 'un' } },
    { json: { idTicket: 'bbbbbbbbbbbbbbbbbbbbbbb2', chatId: '111', texte: 'deux' } },
    { json: { idTicket: 'bbbbbbbbbbbbbbbbbbbbbbb2', chatId: '222', texte: 'deux' } },
  ],
};

const dedoublonne = executer(retenirConfirmes, {
  entree: [confirme(0), confirme(1), confirme(2), confirme(3)],
  nœuds: deuxDestinations,
});

ok('**quatre envois, deux dossiers : deux identifiants seulement**',
  dedoublonne[0]?.json.ids.length === 2, dedoublonne[0]?.json.ids.join(','));

/*
 * UN SEUL ENVOI RÉUSSI SUFFIT. L'équipe a été jointe ; réannoncer le dossier
 * au tour suivant ne ferait que sonner deux fois chez celui qui l'a déjà reçu.
 */
const unSeulPasse = executer(retenirConfirmes, {
  entree: [
    { json: { error: 'chat not found' }, pairedItem: { item: 0 } },
    confirme(1),
  ],
  nœuds: deuxDestinations,
});

ok('**un administrateur injoignable n’empêche pas le marquage** si l’autre a reçu',
  unSeulPasse[0]?.json.ids.join(',') === 'bbbbbbbbbbbbbbbbbbbbbbb1');

section('Retenir les envois confirmés — l’appariement');

ok('**l’appariement suit `pairedItem`, pas la position** — un nœud qui filtre décalerait tout',
  executer(retenirConfirmes, {
    entree: [confirme(2), confirme(0)],
    nœuds: contexte,
  })[0]?.json.ids.join(',') === 'aaaaaaaaaaaaaaaaaaaaaaa3,aaaaaaaaaaaaaaaaaaaaaaa1');

ok('`pairedItem` donné comme un nombre est compris aussi',
  executer(retenirConfirmes, {
    entree: [{ json: { message_id: 7 }, pairedItem: 1 }],
    nœuds: contexte,
  })[0]?.json.ids[0] === 'aaaaaaaaaaaaaaaaaaaaaaa2');

ok('sans `pairedItem`, on retombe sur la position',
  executer(retenirConfirmes, {
    entree: [{ json: { message_id: 7 } }],
    nœuds: contexte,
  })[0]?.json.ids[0] === 'aaaaaaaaaaaaaaaaaaaaaaa1');

ok('un appariement qui ne retrouve aucune annonce ne marque rien',
  executer(retenirConfirmes, {
    entree: [{ json: { message_id: 7 }, pairedItem: { item: 99 } }],
    nœuds: contexte,
  }).length === 0);

const soixante = Array.from({ length: 60 }, (_, i) => ({
  json: { idTicket: `b${String(i).padStart(23, '0')}`, texte: 'x' },
}));
const grosLot = executer(retenirConfirmes, {
  entree: soixante.map((_, i) => confirme(i)),
  nœuds: { 'Préparer les annonces': soixante },
});

ok('**le lot est borné à 50 identifiants** — la limite du validateur de l’API',
  grosLot[0]?.json.ids.length === 50, `annoncés : ${grosLot[0]?.json.nombre}`);

ok('le nombre réellement confirmé reste visible dans l’exécution',
  grosLot[0]?.json.nombre === 60);

process.exit(afficher() > 0 ? 1 : 0);
