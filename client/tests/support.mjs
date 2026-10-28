/**
 * ===========================================================================
 *  SUPPORT — le widget et le back-office, dans un vrai navigateur
 * ===========================================================================
 *
 *   npm run test:support
 *
 * CE QUE CETTE SUITE DÉFEND.
 *
 * La suite serveur prouve que les portes tiennent. Celle-ci prouve que
 * l'écran montre à l'administrateur de quoi décider — et qu'il ne lui montre
 * RIEN d'autre :
 *
 *   - le widget suit sa configuration : masqué sans URL d'agent ;
 *   - la file « Support » n'affiche jamais les dossiers d'une autre famille.
 *     C'est le défaut trouvé pendant la campagne du module 15 : une liste
 *     périmée, invisible tant qu'aucun diplôme n'attendait. Cette suite crée
 *     donc EXPRÈS un diplôme en attente, pour que la condition du défaut soit
 *     réunie à chaque exécution et non plus par accident ;
 *   - une décision prise par un autre administrateur entre l'affichage et le
 *     clic n'est pas écrasée, et l'écran se remet à jour.
 *
 * TOUTES LES ATTENTES SONT À 30 SECONDES, ET LE CHIFFRE N'EST PAS ARBITRAIRE.
 *
 * Elles étaient à 15. Le 28 octobre 2026, cette suite a été INTERROMPUE en
 * trente-sixième position d'une campagne, sur
 * `waiting for getByTestId('liste-support') to be visible` doublé de
 * `waiting for navigation to finish` — l'écran `/admin/moderation` est le plus
 * lourd de l'application, et quinze secondes n'ont pas suffi à l'ouvrir sur un
 * poste à 0,9 Go de mémoire libre. Relancée seule : 137/137.
 *
 * Ce sont toutes des attentes CONDITIONNELLES, et c'est ce qui rend
 * l'allongement gratuit : elles rendent la main dès que la condition est
 * remplie, donc elles ne coûtent rien de plus sur une machine au repos. Un
 * délai fixe, lui, se paie à chaque passage — la distinction vaut d'être
 * retenue avant de toucher à un budget d'attente.
 * ===========================================================================
 */

import { chromium, selectors } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

selectors.setTestIdAttribute('data-test');

const BASE = process.env.CLIENT_URL || 'http://localhost:5173';

/*
 * ATTENDRE QU'UNE CHOSE SOIT RENDUE, PLUTÔT QUE DE L'ESPÉRER.
 *
 * Une lecture instantanée — count(), textContent(), inputValue() — ne réessaie
 * JAMAIS. Placée après un délai fixe, elle mesure le DOM à un instant
 * arbitraire : trop tôt sur une machine chargée, et l'assertion tombe sans que
 * le produit ait le moindre défaut.
 *
 * Relever un délai fixe se paie à CHAQUE passage, même quand tout va vite.
 * Relever une attente conditionnelle ne coûte rien : elle sort dès que la
 * condition cède. C'est pourquoi le plafond est généreux.
 *
 * L'explication complète, et la mesure qui l'a établie, sont dans
 * `tests/evenements.mjs`.
 */
const rendu = async (localisateur, delai = 15000) => {
  try {
    await localisateur.first().waitFor({ state: 'visible', timeout: delai });
    return true;
  } catch {
    return false;
  }
};

const API = 'http://localhost:5000/api';
const DOM = '@supportfront.local';
const MDP = 'MotDePasse123';
const S = Date.now();

const DOSSIER_CAPTURES = fileURLToPath(new URL('../captures/', import.meta.url));
mkdirSync(DOSSIER_CAPTURES, { recursive: true });

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

async function appel(chemin, { methode = 'GET', corps, token, cleAgent, cleService } = {}) {
  const entetes = {};
  if (token) entetes.Authorization = `Bearer ${token}`;
  if (cleAgent) entetes['x-agent-key'] = cleAgent;
  if (cleService) entetes['x-service-key'] = cleService;
  if (corps) entetes['Content-Type'] = 'application/json';
  const r = await fetch(API + chemin, {
    method: methode,
    headers: entetes,
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const texte = await r.text();
  return {
    statut: r.status,
    texte,
    json: (() => { try { return JSON.parse(texte); } catch { return null; } })(),
  };
}

async function inscrire(prefixe, prenom, type = 'utilisateur') {
  const pseudo = `${prefixe}${S}`;
  const r = await appel('/auth/register', {
    methode: 'POST',
    corps: {
      type, nom: 'Front', prenom, pseudo,
      email: `${pseudo}${DOM}`, password: MDP, ville: 'Lyon',
    },
  });
  if (r.statut !== 201) throw new Error(`création de ${pseudo} : ${r.statut} ${r.json?.message}`);
  return { token: r.json.accessToken, id: r.json.utilisateur._id, pseudo, email: `${pseudo}${DOM}` };
}

async function seConnecter(page, pseudo) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email ou pseudo').fill(pseudo);
  await page.getByLabel('Mot de passe').fill(MDP);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL('**/home', { timeout: 25000 });
  await page.waitForSelector('nav[aria-label="Navigation principale"] a', { timeout: 30000 });
}

/* ------------------------- Accès direct à la base ------------------------ */

const requireServeur = createRequire(new URL('../../server/package.json', import.meta.url));
const { MongoClient, ObjectId } = requireServeur('mongodb');

const lireEnv = (fichier, cle) => {
  const ligne = readFileSync(new URL(fichier, import.meta.url), 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${cle}=`));
  return ligne ? ligne.slice(cle.length + 1).trim().replace(/^["']|["']$/g, '') : '';
};

const clientMongo = new MongoClient(lireEnv('../../server/.env', 'MONGO_URI'), {
  serverSelectionTimeoutMS: 8000,
});
await clientMongo.connect();
const bdd = clientMongo.db();

const motifTest = /@supportfront[.]local$/;

async function purger() {
  /*
   * LES DOSSIERS DU COURRIEL N'ONT AUCUN COMPTE, et la purge par `auteur` ne
   * les verrait donc pas : ils resteraient en base d'une campagne à l'autre,
   * et la file de l'exploitant se remplirait de dossiers de test. On les
   * cherche par l'adresse, qui porte le même domaine réservé.
   */
  await bdd.collection('tickets').deleteMany({ courrielAuteur: motifTest });

  const comptes = await bdd.collection('users')
    .find({ email: motifTest }, { projection: { _id: 1 } })
    .toArray();
  const ids = comptes.map((u) => u._id);
  if (ids.length === 0) return 0;
  await bdd.collection('tickets').deleteMany({ auteur: { $in: ids } });
  await bdd.collection('users').deleteMany({ _id: { $in: ids } });
  return ids.length;
}

const restes = await purger();
if (restes > 0) {
  console.log(`  (purge d'entrée : ${restes} compte(s) laissés par une exécution précédente)`);
}

/* ------------------------------ Jeu de données ------------------------------ */

const alice = await inscrire('alicesup', 'Alice');
const coach = await inscrire('coachperime', 'Coachperime', 'coach');

/*
 * LA CONDITION DU DÉFAUT DE LISTE PÉRIMÉE, RÉUNIE EXPRÈS. Un diplôme en
 * attente rend la file « Diplômes » non vide : si l'écran affichait encore
 * une liste périmée en changeant de famille, c'est ce coach qui apparaîtrait
 * dans la file « Support ».
 */
await bdd.collection('users').updateOne(
  { pseudo: coach.pseudo },
  {
    $set: {
      'diplome.statut': 'en_attente',
      'diplome.intitule': 'BPJEPS Activités de la forme',
      'diplome.organisme': 'DRAJES',
      'diplome.dateSoumission': new Date(),
    },
  }
);

const QUESTION_ESCALADE = `Je veux être remboursé de mon abonnement ${S}`;
const QUESTION_USAGE = `Comment publier une story ? ${S}`;
const QUESTION_CONCURRENTE = `Je conteste la désactivation de mon compte ${S}`;
const QUESTION_DIRECTE = `Où en est mon remboursement ? ${S}`;
const REPONSE_TRANSMISE = 'Je transmets votre demande à un conseiller.';
const REPONSE_USURPEE = 'L’agent confirme : remboursement de 500 € accordé.';

const CLE_AGENT = lireEnv('../../server/.env', 'SUPPORT_AGENT_KEY');
if (!CLE_AGENT) {
  console.error('SUPPORT_AGENT_KEY absente de server/.env — la suite ne peut pas s’exécuter.');
  process.exit(1);
}

/* La clé de SERVICE, distincte : elle ouvre le dépôt des demandes par courriel. */
const CLE_SERVICE = lireEnv('../../server/.env', 'SUPPORT_SERVICE_KEY');
if (!CLE_SERVICE) {
  console.error('SUPPORT_SERVICE_KEY absente de server/.env — la suite ne peut pas s’exécuter.');
  process.exit(1);
}

const ADRESSE_VISITEUR = `visiteur${S}${DOM}`;
const QUESTION_COURRIEL_ENTRANT = `Ma carte est refusée au moment de payer ${S}`;
const BROUILLON_ENTRANT =
  'Bonjour, votre carte a expiré. Mettez-la à jour depuis « Mon compte », puis relancez le paiement.';

/** Écriture directe par Alice, sans agent. */
const creerTicket = (corps) => appel('/support/tickets', {
  methode: 'POST', token: alice.token, corps,
});

/** Écriture par l'agent, pour Alice : son jeton ET la clé d'agent — le parcours de n8n. */
const creerTicketParAgent = (corps) => appel('/support/tickets', {
  methode: 'POST', token: alice.token, cleAgent: CLE_AGENT, corps,
});

const escalade = await creerTicketParAgent({
  question: QUESTION_ESCALADE,
  origine: '/abonnements',
  intention: 'decision',
  motifEscalade: 'remboursement',
  reponse: REPONSE_TRANSMISE,
  outils: [
    { outil: 'GET /subscriptions', statut: 200, dureeMs: 57 },
    { outil: 'GET /stripe/premium/revenus', statut: 403, dureeMs: 12 },
  ],
});
const idEscalade = escalade.json?.ticket?._id;

await creerTicketParAgent({
  question: QUESTION_USAGE,
  intention: 'usage',
  reponse: 'Touchez « + » dans la barre des stories.',
});

// L'usurpation : Alice écrit elle-même une « réponse de l'agent ».
await creerTicket({
  question: QUESTION_DIRECTE,
  intention: 'usage',
  reponse: REPONSE_USURPEE,
  outils: [{ outil: 'GET /stripe/premium/revenus', statut: 200, dureeMs: 5 }],
});

/*
 * PROMOTION EN BASE, ET NON PAR L'API — créer un administrateur par l'API est
 * refusé depuis le module 3, et cette suite n'a pas à tester le contournement.
 */
const admin = await inscrire('adminsupfront', 'Admin');
await bdd.collection('users').updateOne({ pseudo: admin.pseudo }, { $set: { type: 'admin' } });

let codeSortie = 1;
const navigateur = await chromium.launch();

try {
  /* =================================================================== *
   *  LE WIDGET
   * =================================================================== */
  section('Le widget suit sa configuration');

  const urlAgent = lireEnv('../.env', 'VITE_SUPPORT_WEBHOOK_URL');

  const contexteAlice = await navigateur.newContext({ viewport: { width: 1280, height: 900 } });
  const pageAlice = await contexteAlice.newPage();
  await seConnecter(pageAlice, alice.pseudo);
  await pageAlice.waitForTimeout(800);

  /*
   * DEUX VERDICTS OPPOSÉS SELON LA CONFIGURATION, DONC DEUX ANCRES.
   * Avec une URL d'agent on attend le bouton : c'est une PRÉSENCE. Sans elle
   * on affirme une ABSENCE, et une absence ne conclut rien sur un écran vide
   * — il faut donc prouver d'abord que la page est rendue, en attendant la
   * barre de navigation, qui elle est là dans les deux cas.
   */
  const boutonWidget = pageAlice.getByTestId('widget-support-bouton');
  const widgetOuEcranRendu = urlAgent
    ? await rendu(boutonWidget)
    : await rendu(pageAlice.locator('nav[aria-label="Navigation principale"]'));
  const boutonsWidget = await boutonWidget.count();
  if (urlAgent) {
    ok('URL d’agent configurée : le widget est proposé',
      widgetOuEcranRendu && boutonsWidget === 1,
      widgetOuEcranRendu ? `${boutonsWidget} bouton(s)` : 'BOUTON JAMAIS RENDU en 15 s');

    section('Le widget interroge l’agent — navigateur, n8n et API');

    /*
     * DE BOUT EN BOUT, ET QUEL QUE SOIT L'ÉTAT DU MODÈLE. Que Claude réponde
     * ou soit injoignable, le contrat est le même : une réponse s'affiche, et
     * un ticket écrit PAR L'AGENT existe. Ce que cette section interdit, c'est
     * le cas constaté au premier essai — un 200 vide, et « un conseiller va
     * prendre le relais » sans aucun dossier derrière.
     */
    const QUESTION_WIDGET = `Comment changer ma photo de profil ? ${S}`;

    await pageAlice.getByTestId('widget-support-bouton').click();
    await pageAlice.getByTestId('support-saisie').fill(QUESTION_WIDGET);
    await pageAlice.getByTestId('support-envoyer').click();

    const bulle = pageAlice.getByTestId('support-agent').first();
    await bulle.waitFor({ state: 'visible', timeout: 90000 });
    const texteBulle = await bulle.innerText();

    ok('**l’agent répond dans le widget**', texteBulle.trim().length > 0, texteBulle.slice(0, 90));
    ok('ce n’est pas le message d’indisponibilité du widget',
      !texteBulle.includes('momentanément indisponible'));

    const ticketWidget = await bdd.collection('tickets').findOne({ question: QUESTION_WIDGET });
    ok('**un ticket est enregistré, écrit par l’agent**', ticketWidget?.ecritParAgent === true,
      `statut « ${ticketWidget?.statut} », motif « ${ticketWidget?.motifEscalade ?? '—'} »`);
    ok('au nom de la personne qui a posé la question', String(ticketWidget?.auteur) === String(alice.id));
    ok('avec l’écran d’où elle l’a posée', ticketWidget?.origine === '/home', ticketWidget?.origine);
    ok('**annoncer un conseiller implique un dossier escaladé**',
      !/conseiller/i.test(texteBulle) || ticketWidget?.statut === 'escalade');

    if (ticketWidget?.motifEscalade === 'agent indisponible') {
      console.log('  (modèle injoignable : c’est le parcours d’échec qui a été vérifié)');
    }

    await pageAlice.screenshot({ path: `${DOSSIER_CAPTURES}support-widget.png` });

    section('Le widget ne recouvre aucune commande');

    /*
     * UN BOUTON FLOTTANT SE POSE PAR-DESSUS QUELQUE CHOSE. Mesuré à la mise
     * en place : à 375 et 768 px il masquait l'onglet « Notifications » de la
     * barre mobile, puis, remonté, le bouton « Envoyer » de la messagerie.
     * Pour chaque commande qui touche le widget, on regarde QUI est au-dessus
     * au point de contact : si c'est le widget, la commande est inaccessible.
     */
    const commandesRecouvertes = (page) => page.evaluate(() => {
      const widget = document.querySelector('[data-test="widget-support-bouton"]');
      const w = widget?.getBoundingClientRect();
      if (!w || !w.width) return null; // widget masqué
      const recouvertes = [];
      for (const el of document.querySelectorAll('button, a, input, textarea, [role="button"]')) {
        if (el.closest('[data-test^="widget-support"]')) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || r.right <= w.left || r.left >= w.right || r.bottom <= w.top || r.top >= w.bottom) continue;
        const x = Math.min(Math.max((r.left + r.right) / 2, w.left + 1), w.right - 1);
        const y = Math.min(Math.max((r.top + r.bottom) / 2, w.top + 1), w.bottom - 1);
        if (document.elementFromPoint(x, y)?.closest('[data-test="widget-support-bouton"]')) {
          recouvertes.push((el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30));
        }
      }
      return recouvertes;
    });

    for (const [largeur, hauteur] of [[375, 740], [1280, 900]]) {
      await pageAlice.setViewportSize({ width: largeur, height: hauteur });
      for (const chemin of ['/home', '/evenements', '/settings']) {
        await pageAlice.goto(BASE + chemin, { waitUntil: 'domcontentloaded' });
        await pageAlice.getByTestId('widget-support-bouton').waitFor({ state: 'attached', timeout: 20000 });
        await pageAlice.waitForTimeout(1200);
        const recouvertes = await commandesRecouvertes(pageAlice);
        ok(`${largeur} px, ${chemin} : aucune commande sous le widget`,
          Array.isArray(recouvertes) && recouvertes.length === 0,
          recouvertes === null ? 'widget masqué' : recouvertes.join(', ') || 'aucune');
      }
    }

    await pageAlice.setViewportSize({ width: 375, height: 740 });
    await pageAlice.goto(`${BASE}/messages`, { waitUntil: 'domcontentloaded' });
    await pageAlice.getByTestId('widget-support-bouton').waitFor({ state: 'attached', timeout: 20000 });
    ok('**375 px, messagerie : le widget est masqué, la zone de saisie reste libre**',
      !(await pageAlice.getByTestId('widget-support-bouton').isVisible()));

    await pageAlice.setViewportSize({ width: 1280, height: 900 });
    await pageAlice.goto(`${BASE}/messages`, { waitUntil: 'domcontentloaded' });
    await pageAlice.getByTestId('widget-support-bouton').waitFor({ state: 'visible', timeout: 20000 });
    ok('1280 px, messagerie : le widget reste proposé',
      await pageAlice.getByTestId('widget-support-bouton').isVisible());

    /* =================================================================== *
     *  PRÉSENTATION, PARCOURS, ET CE QUI PART RÉELLEMENT À L'AGENT
     * =================================================================== */
    section('Le widget : présentation et parcours');

    /*
     * L'AGENT EST SIMULÉ DANS CE QUI SUIT, ET C'EST TOUT LE POINT.
     *
     * Ce qu'on vérifie ici n'est pas la réponse du modèle — la section « Le
     * widget interroge l'agent » l'a fait pour de vrai, une fois — mais CE QUE
     * LE WIDGET ENVOIE : le parcours annoncé, l'objet dans son propre champ, et
     * une question qui reste le message seul. Lire le corps de la requête est
     * la seule preuve possible, et l'interception la rend déterministe ET
     * gratuite : huit envois sans un centime de modèle.
     */
    const corpsRecus = [];
    const ENTETES_CORS = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*',
    };

    const simulerAgent = (page) =>
      page.route(urlAgent, async (route) => {
        /*
         * LA PRÉ-VÉRIFICATION CORS N'EST PAS UNE REQUÊTE MÉTIER : on y répond
         * sans la compter, sinon chaque envoi apparaîtrait deux fois et les
         * contrôles liraient le mauvais corps.
         */
        if (route.request().method() === 'OPTIONS') {
          return route.fulfill({ status: 204, headers: ENTETES_CORS });
        }
        corpsRecus.push(JSON.parse(route.request().postData() || '{}'));
        return route.fulfill({
          status: 200,
          headers: ENTETES_CORS,
          body: JSON.stringify({ reponse: 'Bien reçu, je regarde votre dossier.' }),
        });
      });

    /*
     * ON ATTEND UN ENVOI DE PLUS, PAS UN DÉLAI. Une attente fixe mesure la
     * machine et non le code — la leçon de la suite « notifications ».
     */
    const attendreEnvoi = async (page, avant) => {
      for (let essai = 0; essai < 100 && corpsRecus.length <= avant; essai += 1) {
        await page.waitForTimeout(100);
      }
      return corpsRecus.length > avant ? corpsRecus[corpsRecus.length - 1] : null;
    };

    const ouvrirWidget = async (page) => {
      await page.getByTestId('widget-support-bouton').click();
      await page.getByTestId('widget-support-panneau').waitFor({ state: 'visible', timeout: 20000 });
    };

    /*
     * PRÉSENT N'EST PAS VISIBLE, ET C'EST EXACTEMENT LE DÉFAUT TROUVÉ ICI.
     *
     * Première version : les options étaient posées SOUS la présentation, dans
     * le fil. Elles existaient dans le DOM, un `count()` les trouvait, la suite
     * passait au vert — et elles commençaient à 397 px d'un fil qui en montre
     * 294. Personne ne les voyait. On compare donc leur rectangle à celui du
     * panneau, seule mesure qui distingue « rendu » de « atteignable ».
     */
    const optionDansLeCadre = (page, cle) =>
      page.getByTestId(`support-option-${cle}`).evaluate((bouton) => {
        const p = bouton.closest('[data-test="widget-support-panneau"]').getBoundingClientRect();
        const b = bouton.getBoundingClientRect();
        return b.top >= p.top - 1 && b.bottom <= p.bottom + 1;
      });

    const contexteParcours = await navigateur.newContext({ viewport: { width: 1280, height: 900 } });
    const pageParcours = await contexteParcours.newPage();
    await simulerAgent(pageParcours);
    await seConnecter(pageParcours, alice.pseudo);
    await ouvrirWidget(pageParcours);

    const presentation = pageParcours.getByTestId('support-presentation');
    await presentation.waitFor({ state: 'visible', timeout: 20000 });
    const textePresentationSportif = await presentation.innerText();

    ok('**la présentation salue la personne par son prénom**',
      textePresentationSportif.includes('Bonjour Alice'),
      textePresentationSportif.split('\n')[0]);
    ok('elle annonce ce qui concerne un sportif',
      textePresentationSportif.includes('Abonnements premium')
        && textePresentationSportif.includes('contenu exclusif'));
    ok('**et jamais ce qui ne le concerne pas** — ni diplôme, ni versements',
      !/diplôme|versements/i.test(textePresentationSportif));
    ok('elle dit que l’assistant consulte le compte',
      textePresentationSportif.includes('consulte votre compte'));
    ok('**et qu’une décision humaine repart par e-mail** — sinon le silence de l’agent passe pour une panne',
      textePresentationSportif.includes('répond par e-mail'));

    /*
     * LE CADRATIN EST PROSCRIT DANS CE QUE LIT L'UTILISATEUR, et cette règle
     * du projet ne datait pas de ce widget : les deux flux n8n la font déjà
     * respecter au modèle par un `sansCadratin()` qui NETTOIE sa sortie.
     *
     * CE QUI AVAIT ÉTÉ MANQUÉ : la règle portait sur le texte PRODUIT par
     * l'agent, et personne ne l'avait appliquée aux textes ÉCRITS EN DUR dans
     * le widget. La présentation en employait trois — un séparateur entre
     * chaque capacité, deux encadrant l'incise de la phrase de transparence.
     * Le même caractère était donc filtré d'un côté de la fenêtre et affiché
     * de l'autre.
     *
     * LE CONTRÔLE PORTE SUR LE TEXTE RENDU, pas sur le fichier source : c'est
     * ce que la personne voit qui compte, et un détail ajouté demain dans
     * `PRESENTATION` passera par ici. Le demi-cadratin est surveillé avec le
     * cadratin, comme dans `sansCadratin()` : ils se ressemblent à l'écran.
     */
    ok('**aucun tiret cadratin dans la présentation** — la règle du projet vaut aussi pour les textes du widget',
      !/[—–]/.test(textePresentationSportif),
      (textePresentationSportif.match(/.{0,20}[—–].{0,20}/g) ?? []).join(' | '));
    ok('les deux options de parcours sont proposées',
      (await pageParcours.getByTestId('support-option-support').count()) === 1
        && (await pageParcours.getByTestId('support-option-usage').count()) === 1);
    ok('**et elles sont VISIBLES dans le panneau, pas seulement présentes**',
      (await optionDansLeCadre(pageParcours, 'support'))
        && (await optionDansLeCadre(pageParcours, 'usage')));

    await pageParcours.screenshot({ path: `${DOSSIER_CAPTURES}support-presentation-sportif.png` });

    /* Le même panneau, vu par un coach : ce n'est pas le même texte. */
    const contexteCoach = await navigateur.newContext({ viewport: { width: 1280, height: 900 } });
    const pageCoach = await contexteCoach.newPage();
    await seConnecter(pageCoach, coach.pseudo);
    await ouvrirWidget(pageCoach);
    await pageCoach.getByTestId('support-presentation').waitFor({ state: 'visible', timeout: 20000 });
    const textePresentationCoach = await pageCoach.getByTestId('support-presentation').innerText();

    ok('**la présentation d’un coach n’est pas celle d’un sportif**',
      textePresentationCoach !== textePresentationSportif);
    ok('elle parle de diplôme, de versements et d’abonnés premium',
      /diplôme/i.test(textePresentationCoach)
        && /versements/i.test(textePresentationCoach)
        && /abonnés premium/i.test(textePresentationCoach));
    ok('et jamais de souscrire un abonnement — un coach n’en souscrit pas',
      !/souscrire/i.test(textePresentationCoach));
    ok('**le texte du coach est net de cadratin lui aussi** — deux textes, une seule règle',
      !/[—–]/.test(textePresentationCoach),
      (textePresentationCoach.match(/.{0,20}[—–].{0,20}/g) ?? []).join(' | '));

    await pageCoach.screenshot({ path: `${DOSSIER_CAPTURES}support-presentation-coach.png` });
    await contexteCoach.close();

    section('Le formulaire support : l’objet part à côté, pas dans la question');

    await pageParcours.getByTestId('support-option-support').click();
    await pageParcours.getByTestId('support-formulaire').waitFor({ state: 'visible', timeout: 30000 });

    ok('**l’option « support » remplace la zone libre par un formulaire**',
      (await pageParcours.getByTestId('support-saisie').count()) === 0);
    ok('et referme les options : la pastille en tient lieu',
      (await pageParcours.getByTestId('support-option-usage').count()) === 0);
    ok('le focus arrive sur l’objet, sans tabulation à l’aveugle',
      await pageParcours.getByTestId('support-objet')
        .evaluate((el) => el === document.activeElement));
    ok('une pastille rappelle le mode choisi',
      (await pageParcours.getByTestId('support-pastille-parcours').innerText())
        .includes('Support client'));

    const OBJET_SUPPORT = `Prélèvement en double ${S}`;
    const MESSAGE_SUPPORT = `J’ai été débité deux fois ce mois-ci, pouvez-vous vérifier ? ${S}`;

    const envoisAvantBlocage = corpsRecus.length;
    await pageParcours.getByTestId('support-message').fill(MESSAGE_SUPPORT);
    ok('**objet vide : le bouton d’envoi reste fermé**',
      await pageParcours.getByTestId('support-envoyer-formulaire').isDisabled());

    await pageParcours.getByTestId('support-objet').fill('ab');
    await pageParcours.getByTestId('support-message').click();
    await pageParcours.getByTestId('support-erreur-objet')
      .waitFor({ state: 'visible', timeout: 30000 });
    ok('un objet trop court est expliqué SOUS le champ, pas deviné',
      (await pageParcours.getByTestId('support-erreur-objet').innerText()).includes('3 caractères'));
    ok('et rien n’est encore parti à l’agent', corpsRecus.length === envoisAvantBlocage,
      `${corpsRecus.length - envoisAvantBlocage} envoi(s)`);

    await pageParcours.getByTestId('support-objet').fill(OBJET_SUPPORT);

    let ouvrable = false;
    for (let essai = 0; essai < 30 && !ouvrable; essai += 1) {
      ouvrable = await pageParcours.getByTestId('support-envoyer-formulaire').isEnabled();
      if (!ouvrable) await pageParcours.waitForTimeout(100);
    }
    ok('objet et message valides : l’envoi s’ouvre', ouvrable);

    const avantSupport = corpsRecus.length;
    await pageParcours.getByTestId('support-envoyer-formulaire').click();
    const corpsSupport = await attendreEnvoi(pageParcours, avantSupport);

    ok('**le parcours « support » part avec la demande**', corpsSupport?.parcours === 'support',
      `parcours « ${corpsSupport?.parcours} »`);
    ok('**l’objet part dans SON champ**', corpsSupport?.objet === OBJET_SUPPORT,
      String(corpsSupport?.objet).slice(0, 60));
    ok('**et la question reste le message SEUL** — rien n’est concaténé, la borne des 2000 tient',
      corpsSupport?.question === MESSAGE_SUPPORT);
    ok('l’écran d’origine est toujours transmis', corpsSupport?.origine === '/home',
      String(corpsSupport?.origine));

    const bulleSupport = pageParcours.getByTestId('support-moi').last();
    await bulleSupport.waitFor({ state: 'visible', timeout: 30000 });
    ok('**l’objet s’affiche en tête de la bulle envoyée**',
      (await bulleSupport.innerText()).startsWith(OBJET_SUPPORT));
    ok('présentation et options quittent le fil au premier envoi',
      (await pageParcours.getByTestId('support-presentation').count()) === 0
        && (await pageParcours.getByTestId('support-option-support').count()) === 0);
    ok('le parcours reste mémorisé pour la suite de la conversation',
      (await pageParcours.getByTestId('support-formulaire').count()) === 1);

    section('Les deux autres parcours : « usage », et aucun choix du tout');

    await pageParcours.reload({ waitUntil: 'domcontentloaded' });
    await ouvrirWidget(pageParcours);
    await pageParcours.getByTestId('support-option-usage').click();
    await pageParcours.getByTestId('support-pastille-parcours')
      .waitFor({ state: 'visible', timeout: 30000 });

    ok('**l’option « usage » garde la zone de saisie libre**',
      (await pageParcours.getByTestId('support-saisie').count()) === 1
        && (await pageParcours.getByTestId('support-formulaire').count()) === 0);
    ok('son invite change, pour dire ce qu’on attend',
      (await pageParcours.getByTestId('support-saisie').getAttribute('placeholder'))
        === 'Décrivez ce que vous voulez faire…');
    ok('et le focus y est posé',
      await pageParcours.getByTestId('support-saisie')
        .evaluate((el) => el === document.activeElement));

    const avantUsage = corpsRecus.length;
    await pageParcours.getByTestId('support-saisie')
      .fill(`Comment me désinscrire d’un événement ? ${S}`);
    await pageParcours.getByTestId('support-envoyer').click();
    const corpsUsage = await attendreEnvoi(pageParcours, avantUsage);

    ok('**le parcours « usage » part avec la question**', corpsUsage?.parcours === 'usage',
      `parcours « ${corpsUsage?.parcours} »`);
    ok('et l’objet part à null, puisqu’il n’y en a pas', corpsUsage?.objet === null,
      String(corpsUsage?.objet));

    await pageParcours.reload({ waitUntil: 'domcontentloaded' });
    await ouvrirWidget(pageParcours);
    const avantDirect = corpsRecus.length;
    await pageParcours.getByTestId('support-saisie').fill(`Où voir mes notifications ? ${S}`);
    await pageParcours.getByTestId('support-envoyer').click();
    const corpsDirect = await attendreEnvoi(pageParcours, avantDirect);

    ok('**sans aucun choix, la zone libre fonctionne comme avant**',
      typeof corpsDirect?.question === 'string' && corpsDirect.question.includes('notifications'));
    ok('**et le parcours part à null** — les options ne sont pas un passage obligé',
      corpsDirect?.parcours === null, String(corpsDirect?.parcours));

    section('« Changer » ramène aux options, et la fermeture aussi');

    await pageParcours.reload({ waitUntil: 'domcontentloaded' });
    await ouvrirWidget(pageParcours);
    await pageParcours.getByTestId('support-option-support').click();
    await pageParcours.getByTestId('support-formulaire').waitFor({ state: 'visible', timeout: 30000 });
    await pageParcours.getByTestId('support-objet').fill('Un objet qui sera abandonné');
    await pageParcours.getByTestId('support-changer-parcours').click();
    await pageParcours.getByTestId('support-option-support')
      .waitFor({ state: 'visible', timeout: 30000 });

    ok('**« Changer » réaffiche les deux options**',
      (await pageParcours.getByTestId('support-option-usage').count()) === 1);
    ok('et referme le formulaire structuré',
      (await pageParcours.getByTestId('support-formulaire').count()) === 0);
    ok('la pastille du mode disparaît avec lui',
      (await pageParcours.getByTestId('support-pastille-parcours').count()) === 0);

    await pageParcours.getByTestId('support-option-usage').click();
    await pageParcours.getByTestId('support-pastille-parcours')
      .waitFor({ state: 'visible', timeout: 30000 });
    await pageParcours.keyboard.press('Escape');
    await pageParcours.getByTestId('widget-support-panneau')
      .waitFor({ state: 'detached', timeout: 30000 });
    await ouvrirWidget(pageParcours);
    await pageParcours.getByTestId('support-option-usage')
      .waitFor({ state: 'visible', timeout: 30000 });
    ok('**fermé puis rouvert SANS échange, le parcours est oublié**',
      (await pageParcours.getByTestId('support-pastille-parcours').count()) === 0);

    section('Le parcours complet à 375 px');

    const panneauWidget = pageParcours.getByTestId('widget-support-panneau');
    /*
     * `scrollWidth > clientWidth`, ET NON DES RECTANGLES. Le panneau porte
     * `overflow-hidden` : un contenu trop large y est COUPÉ, donc invisible à
     * la mesure des rectangles — et le défilement du document ne bouge pas
     * davantage. Seule la largeur de défilement du panneau le dit.
     */
    const debordement = (cible) => cible.evaluate((el) => el.scrollWidth > el.clientWidth + 1);

    await pageParcours.setViewportSize({ width: 375, height: 740 });
    await pageParcours.reload({ waitUntil: 'domcontentloaded' });
    await ouvrirWidget(pageParcours);
    await pageParcours.getByTestId('support-presentation')
      .waitFor({ state: 'visible', timeout: 20000 });

    ok('présentation et options tiennent en largeur', !(await debordement(panneauWidget)));
    ok('**et les deux options restent VISIBLES sur un téléphone** — c’est là que le fil est le plus court',
      (await optionDansLeCadre(pageParcours, 'support'))
        && (await optionDansLeCadre(pageParcours, 'usage')));
    ok('le panneau ne déborde pas par le haut de l’écran',
      await panneauWidget.evaluate((el) => el.getBoundingClientRect().top >= 0));
    ok('et le document ne défile pas horizontalement',
      !(await pageParcours.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1
      )));

    const cadre = await pageParcours.getByTestId('support-envoyer').evaluate((bouton) => {
      const p = bouton.closest('[data-test="widget-support-panneau"]').getBoundingClientRect();
      const b = bouton.getBoundingClientRect();
      return {
        dedans: b.right <= p.right + 1 && b.left >= p.left - 1,
        largeur: Math.round(b.width),
      };
    });
    ok('**le bouton « Envoyer » reste DANS le panneau** — c’est ce que `min-w-0` défend',
      cadre.dedans, `largeur ${cadre.largeur} px`);

    await pageParcours.screenshot({ path: `${DOSSIER_CAPTURES}support-presentation-375.png` });

    await pageParcours.getByTestId('support-option-support').click();
    await pageParcours.getByTestId('support-formulaire').waitFor({ state: 'visible', timeout: 30000 });
    await pageParcours.getByTestId('support-objet').fill(`Carte refusée ${S}`);
    await pageParcours.getByTestId('support-message')
      .fill(`Le paiement est refusé depuis hier soir ${S}`);

    ok('**le formulaire support tient lui aussi à 375 px**', !(await debordement(panneauWidget)));
    ok('et son bouton d’envoi reste atteignable',
      await pageParcours.getByTestId('support-envoyer-formulaire').isVisible());

    await pageParcours.screenshot({ path: `${DOSSIER_CAPTURES}support-formulaire-375.png` });

    const avant375 = corpsRecus.length;
    await pageParcours.getByTestId('support-envoyer-formulaire').click();
    const corps375 = await attendreEnvoi(pageParcours, avant375);
    ok('**et l’envoi aboutit depuis un téléphone**',
      corps375?.parcours === 'support' && corps375?.objet === `Carte refusée ${S}`,
      `parcours « ${corps375?.parcours} », objet « ${corps375?.objet} »`);

    await contexteParcours.close();
  } else {
    ok('**sans URL d’agent, le widget est masqué — pas cassé**', boutonsWidget === 0,
      `${boutonsWidget} bouton(s)`);
  }

  section('Le back-office reste fermé à un compte ordinaire');

  await pageAlice.goto(`${BASE}/admin/moderation`, { waitUntil: 'domcontentloaded' });

  /*
   * ON ANCRE SUR LA BARRE DE NAVIGATION, présente sur tout écran d'un compte
   * connecté — que la route admin redirige Alice ou lui refuse l'accès.
   *
   * Sans cet ancrage, « aucune famille Support pour un sportif » était
   * satisfaite par un écran encore blanc. C'est un contrôle d'autorisation :
   * un faux vert y vaut une porte ouverte qu'on croit fermée.
   */
  const ecranAliceRendu = await pageAlice
    .locator('nav[aria-label="Navigation principale"]')
    .first()
    .waitFor({ state: 'visible', timeout: 30000 })
    .then(() => true)
    .catch(() => false);

  ok('aucune famille « Support » pour un sportif',
    ecranAliceRendu && (await pageAlice.getByTestId('famille-support').count()) === 0,
    ecranAliceRendu ? '' : 'ÉCRAN NON RENDU : une absence ne conclut rien');
  await contexteAlice.close();

  /* =================================================================== *
   *  LA FILE « SUPPORT »
   * =================================================================== */
  section('La file des dossiers remontés');

  const contexteAdmin = await navigateur.newContext({ viewport: { width: 1280, height: 900 } });
  const ecran = await contexteAdmin.newPage();
  await seConnecter(ecran, admin.pseudo);
  await ecran.goto(`${BASE}/admin/moderation`, { waitUntil: 'domcontentloaded' });

  // Famille par défaut : les diplômes. Le coach en attente doit y être.
  await ecran.getByTestId('liste-diplomes').waitFor({ state: 'visible', timeout: 20000 });
  ok('condition du défaut réunie : un diplôme attend',
    (await ecran.getByTestId('liste-diplomes').innerText()).includes('Coachperime'));

  const compteur = ecran.getByTestId('compteur-support');
  await compteur.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  ok('la famille « Support » annonce les dossiers en attente',
    Number(await compteur.innerText().catch(() => '0')) >= 1,
    `${await compteur.innerText().catch(() => 'absent')}`);

  /*
   * LE RENDU PÉRIMÉ NE DURE QU'UNE IMAGE — le lire après coup arrive trop tard.
   * Un observateur est donc posé DANS la page avant le clic : il note le
   * contenu de chaque liste « Support » au moment même où React l'insère,
   * avant tout affichage. Toute liste apparue doit contenir le dossier
   * attendu ; une liste montée avec les diplômes de l'onglet précédent ne le
   * contiendrait pas.
   *
   * Chercher le nom du coach ne suffirait pas : une liste périmée passe le
   * coach au composant d'un ticket, qui n'affiche pas son prénom.
   */
  await ecran.evaluate(() => {
    window.__listesSupport = [];
    let derniere = null;
    new MutationObserver(() => {
      const liste = document.querySelector('[data-test="liste-support"]');
      if (liste && liste !== derniere) {
        derniere = liste;
        window.__listesSupport.push(liste.innerText);
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true });
  });

  await ecran.getByTestId('famille-support').click();
  await ecran.getByTestId('liste-support').waitFor({ state: 'visible', timeout: 30000 });

  const listesVues = await ecran.evaluate(() => window.__listesSupport);
  ok('**aucune liste périmée n’est montée, même une image**',
    listesVues.length >= 1 && listesVues.every((texte) => texte.includes(QUESTION_ESCALADE)),
    `${listesVues.length} liste(s) montée(s), ` +
      `${listesVues.filter((t) => !t.includes(QUESTION_ESCALADE)).length} sans le dossier attendu`);

  const carte = ecran.getByTestId('dossier-ticket').filter({ hasText: QUESTION_ESCALADE });
  ok('le dossier remonté y figure', (await carte.count()) === 1);

  const texteCarte = await carte.innerText();
  ok('le motif d’escalade est lisible, pas la valeur brute',
    texteCarte.includes('Remonté : Remboursement'));
  ok('la question est affichée en entier', texteCarte.includes(QUESTION_ESCALADE));
  ok('l’écran d’origine est indiqué', texteCarte.includes('/abonnements'));
  ok('la réponse déjà transmise est visible', texteCarte.includes(REPONSE_TRANSMISE));

  /*
   * « RÉPONSE DE L'AGENT » SEULEMENT QUAND LE SERVEUR L'ATTESTE. Ce ticket a
   * été écrit avec la clé d'agent : l'écran peut le dire. Le suivant, non.
   */
  // Insensible à la casse : le libellé est en `uppercase`, et `innerText`
  // renvoie le texte tel qu'il est AFFICHÉ, pas tel qu'il est écrit.
  const libelleAgent = /réponse de l’agent/i.test(texteCarte);
  const badgesDirects = await carte.getByTestId('badge-demande-directe').count();
  ok('**une réponse attestée est présentée comme celle de l’agent**',
    libelleAgent && badgesDirects === 0,
    `libellé « réponse de l’agent » : ${libelleAgent}, badge « demande directe » : ${badgesDirects}`);

  ok('les outils consultés sont listés', texteCarte.includes('GET /subscriptions'));
  ok('un refus d’accès de l’agent est visible', texteCarte.includes('403'));
  ok('l’auteur est identifié', texteCarte.includes(`@${alice.pseudo}`));

  await ecran.screenshot({ path: `${DOSSIER_CAPTURES}support-back-office.png` });

  section('Une fausse réponse d’agent, vue par l’administrateur');

  /*
   * LE SCÉNARIO QUI A MOTIVÉ LA CLÉ D'AGENT. Alice a écrit elle-même
   * « l'agent confirme : remboursement de 500 € accordé ». Sans clé, le
   * serveur n'a gardé ni la réponse ni l'outil — et le dossier est arrivé
   * dans « À traiter » au lieu de disparaître dans « Non escaladés ».
   */
  const carteDirecte = ecran.getByTestId('dossier-ticket').filter({ hasText: QUESTION_DIRECTE });
  ok('**la demande directe remonte à un humain**', (await carteDirecte.count()) === 1);

  const texteDirect = await carteDirecte.innerText();
  ok('**elle porte le badge « Demande directe, sans agent »**',
    (await carteDirecte.getByTestId('badge-demande-directe').count()) === 1);
  ok('**la fausse réponse d’agent n’apparaît nulle part**', !texteDirect.includes('500 €'));
  ok('ni l’outil prétendument consulté', !texteDirect.includes('/stripe/premium/revenus'));
  ok('le motif dit qu’elle n’est pas passée par l’agent',
    texteDirect.includes('Écrite sans passer par l’agent'));

  section('Instruction du dossier');

  const bouton = carte.getByRole('button', { name: 'Clore sans courriel' });
  ok('**« Clore » est inactif tant qu’aucune décision n’est écrite**', await bouton.isDisabled());

  await carte.getByLabel('Décision').fill('Remboursement accordé, visible sous 5 à 10 jours.');
  ok('il s’active une fois la décision écrite', await bouton.isEnabled());

  await bouton.click();
  await ecran.getByText('Dossier traité').waitFor({ state: 'visible', timeout: 30000 });
  ok('l’administration confirme l’instruction', true);

  await ecran.waitForFunction(
    (q) => !document.body.innerText.includes(q),
    QUESTION_ESCALADE,
    { timeout: 30000 }
  ).catch(() => {});
  ok('le dossier quitte « À traiter »',
    (await ecran.getByTestId('dossier-ticket').filter({ hasText: QUESTION_ESCALADE }).count()) === 0);

  const enBase = await bdd.collection('tickets').findOne({ _id: new ObjectId(String(idEscalade)) });
  ok('**en base : clos, avec la décision et l’instructeur**',
    enBase?.statut === 'clos' &&
      enBase?.decision?.startsWith('Remboursement accordé') &&
      String(enBase?.traitePar) === String(admin.id),
    `statut « ${enBase?.statut} »`);

  /*
   * LES ONGLETS SE DÉSIGNENT PAR LEUR IDENTIFIANT, PAS PAR LEUR LIBELLÉ.
   *
   * Ils étaient cliqués par leur texte — `{ name: 'Instruits' }` — jusqu'au
   * 26 octobre au soir, où le libellé de l'onglet `clos` a été reformulé. La
   * suite entière s'est arrêtée net à cet endroit, sur un délai d'attente de
   * trente secondes, et le message n'accusait rien de ce qui avait changé.
   *
   * UN LIBELLÉ EST UN CHOIX DE PRODUIT : il doit pouvoir être reformulé sans
   * casser un test. L'identifiant `data-test`, lui, désigne le statut du
   * dossier — `escalade`, `clos`, `resolu` — et ne change que si le modèle
   * change, auquel cas le test DOIT être relu.
   */
  await ecran.getByTestId('onglet-clos').click();
  const carteInstruite = ecran.getByTestId('dossier-ticket').filter({ hasText: QUESTION_ESCALADE });
  await carteInstruite.waitFor({ state: 'visible', timeout: 30000 });
  const texteInstruit = await carteInstruite.innerText();
  ok('« Traiter » le montre avec son historique', texteInstruit.includes(`par @${admin.pseudo}`));
  ok('et la décision prise', texteInstruit.includes('Décision : Remboursement accordé'));
  ok('plus aucun bouton d’action sur un dossier traité',
    (await carteInstruite.getByRole('button', { name: 'Clore sans courriel' }).count()) === 0);

  await ecran.getByTestId('onglet-resolu').click();
  const carteUsage = ecran.getByTestId('dossier-ticket').filter({ hasText: QUESTION_USAGE });
  await carteUsage.waitFor({ state: 'visible', timeout: 30000 });
  ok('« Non escaladés » montre les échanges sans intervention humaine',
    (await carteUsage.count()) === 1);
  ok('en lecture seule',
    (await carteUsage.getByRole('button', { name: 'Clore sans courriel' }).count()) === 0);

  /* =================================================================== *
   *  RÉPONDRE PAR COURRIEL — brouillon, relecture, envoi
   *
   *  LE MÊME PARCOURS QUE SUR TELEGRAM, AU CLAVIER. Ce que cette section
   *  défend tient en une phrase : rien ne part avant une validation
   *  explicite, et ce qui part est le texte RELU, pas celui qui se trouve
   *  à l'écran au moment du clic.
   * =================================================================== */
  section('Le brouillon : écrit, enregistré, et rien n’est parti');

  const QUESTION_COURRIEL = `Mon abonnement a été débité deux fois ${S}`;
  const BROUILLON = `Bonjour Alice,\n\nNous avons constaté le double prélèvement ${S}.\n\nL’équipe CoachConnect`;
  const CORRECTION = `${BROUILLON} (corrigé)`;

  const aRepondre = await creerTicketParAgent({
    question: QUESTION_COURRIEL,
    origine: '/settings',
    intention: 'decision',
    motifEscalade: 'remboursement',
    reponse: REPONSE_TRANSMISE,
  });
  const idCourriel = aRepondre.json?.ticket?._id;
  ok('condition réunie : un dossier attend une réponse', Boolean(idCourriel));

  await ecran.reload({ waitUntil: 'domcontentloaded' });
  await ecran.getByTestId('famille-support').click();
  await ecran.getByTestId('onglet-escalade').click();

  const carteCourriel = ecran.getByTestId('dossier-ticket').filter({ hasText: QUESTION_COURRIEL });
  await carteCourriel.waitFor({ state: 'visible', timeout: 30000 });

  ok('**l’adresse du destinataire est affichée** — une erreur de dossier doit sauter aux yeux',
    (await carteCourriel.getByTestId('destinataire-courriel').innerText()).includes(alice.email));

  ok('**« Envoyer » est fermé tant qu’aucun brouillon n’est enregistré**',
    await carteCourriel.getByTestId('preparer-envoi').isDisabled());

  await carteCourriel.getByTestId('brouillon-reponse').fill(BROUILLON);
  await carteCourriel.getByTestId('enregistrer-brouillon').click();
  await ecran.getByText('Rien n’est encore parti').waitFor({ state: 'visible', timeout: 30000 });

  const apresBrouillon = await bdd.collection('tickets').findOne({ _id: new ObjectId(String(idCourriel)) });
  ok('**en base : le brouillon est là, et AUCUNE réponse n’est partie**',
    apresBrouillon?.brouillonReponse === BROUILLON &&
      !apresBrouillon?.reponseEnvoyeeLe &&
      apresBrouillon?.statut === 'escalade',
    `statut « ${apresBrouillon?.statut} », envoyée : ${apresBrouillon?.reponseEnvoyeeLe ?? 'non'}`);

  section('Ce qui part est le texte RELU, pas celui de l’écran');

  /*
   * LE PIÈGE QUE CETTE SECTION FERME. L'envoi expédie le brouillon EN BASE.
   * Si l'écran laissait valider après une modification non enregistrée,
   * l'administrateur lirait un texte et en enverrait un autre — sans que rien
   * ne le lui dise. Le bouton se referme donc dès la première frappe.
   */
  await carteCourriel.getByTestId('brouillon-reponse').fill(CORRECTION);

  ok('**une modification non enregistrée referme « Envoyer »**',
    await carteCourriel.getByTestId('preparer-envoi').isDisabled());
  ok('et l’écran dit pourquoi, au lieu de rester muet',
    (await carteCourriel.getByTestId('avis-brouillon-modifie').innerText())
      .includes('C’est le brouillon enregistré qui partirait'));

  await carteCourriel.getByTestId('enregistrer-brouillon').click();
  await ecran.getByText('Rien n’est encore parti').waitFor({ state: 'visible', timeout: 30000 });
  ok('une fois enregistrée, la correction rouvre l’envoi',
    await carteCourriel.getByTestId('preparer-envoi').isEnabled());

  section('L’envoi : deux gestes, un seul courriel');

  await carteCourriel.getByTestId('preparer-envoi').click();
  const confirmation = carteCourriel.getByTestId('confirmer-envoi');
  await confirmation.waitFor({ state: 'visible', timeout: 10000 });
  ok('**un premier clic ne fait qu’annoncer le destinataire**',
    (await confirmation.innerText()).includes(alice.email));

  const avantConfirmation = await bdd.collection('tickets').findOne({ _id: new ObjectId(String(idCourriel)) });
  ok('**et rien n’est parti à ce stade**', !avantConfirmation?.reponseEnvoyeeLe);

  await confirmation.click();
  // Deux libellés possibles selon le canal — la casse diffère, le sens non.
  await ecran.getByText(/dossier clos/i).waitFor({ state: 'visible', timeout: 20000 });

  const apresEnvoi = await bdd.collection('tickets').findOne({ _id: new ObjectId(String(idCourriel)) });
  ok('**en base : la réponse est partie, et c’est le texte enregistré**',
    apresEnvoi?.reponseExploitant === CORRECTION && Boolean(apresEnvoi?.reponseEnvoyeeLe),
    apresEnvoi?.reponseExploitant?.slice(0, 40));
  ok('le dossier est clos, à ce nom-là',
    apresEnvoi?.statut === 'clos' && String(apresEnvoi?.traitePar) === String(admin.id));

  /*
   * LE COURRIEL LUI-MÊME. Les comptes de test sont en `.local` : le service
   * de courriel les dépose dans `server/.boite-mails/` plutôt que de les
   * envoyer. On lit donc le fichier déposé — la seule preuve que le corps
   * expédié est bien celui qui a été relu, et non un résumé ou un tronçon.
   */
  const BOITE = fileURLToPath(new URL('../../server/.boite-mails/', import.meta.url));
  const depots = existsSync(BOITE)
    ? readdirSync(BOITE)
        .filter((f) => f.includes(alice.email.replace(/[^a-z0-9@._-]/gi, '_')))
        .map((f) => JSON.parse(readFileSync(join(BOITE, f), 'utf8')))
    : [];
  const courrielParti = depots.find((m) => m.text === CORRECTION);

  ok('**un courriel a été produit pour l’auteur du dossier**', Boolean(courrielParti),
    `${depots.length} dépôt(s) pour cette adresse`);
  ok('son corps est le brouillon relu, au signe près',
    courrielParti?.text === CORRECTION);
  ok('et son objet porte la référence du dossier',
    courrielParti?.subject?.includes(String(idCourriel).slice(-8)) === true,
    courrielParti?.subject);

  await ecran.screenshot({ path: `${DOSSIER_CAPTURES}support-reponse-courriel.png` });

  /* =================================================================== *
   *  CE QUE L'AUTEUR EN VOIT
   * =================================================================== */
  section('L’avis dans le widget : une réponse vous attend');

  /*
   * L'AUTEUR APPREND QU'UNE RÉPONSE LUI EST PARTIE, PAS SON CONTENU. Le texte
   * vit dans sa boîte de réception ; le widget n'en est que l'avis. Sans lui,
   * quelqu'un qui revient ici verrait sa question sans suite et n'aurait
   * aucune raison d'aller regarder ses courriels.
   */
  /*
   * SANS URL D'AGENT, LE WIDGET EST MASQUÉ — c'est la règle du module, et
   * cette section n'aurait rien à ouvrir. On le dit plutôt que d'échouer.
   */
  if (!urlAgent) {
    ok('section ignorée : aucune URL d’agent configurée, le widget est masqué', true);
  } else {

  const contexteRetour = await navigateur.newContext({ viewport: { width: 1280, height: 900 } });
  const pageRetour = await contexteRetour.newPage();
  await seConnecter(pageRetour, alice.pseudo);
  await pageRetour.getByTestId('widget-support-bouton').click();

  const avis = pageRetour.getByTestId('avis-reponse-courriel');
  await avis.waitFor({ state: 'visible', timeout: 30000 });
  const texteAvis = await avis.innerText();

  ok('**l’avis annonce le courriel**', texteAvis.includes('envoyée par e-mail'));
  ok('il rappelle la demande concernée, pour la reconnaître',
    texteAvis.includes('Mon abonnement a été débité'));
  ok('et donne la référence du dossier',
    texteAvis.includes(String(idCourriel).slice(-8)));
  ok('**mais JAMAIS le texte de la réponse** — il est dans la boîte de réception',
    !texteAvis.includes('double prélèvement'));

  await pageRetour.screenshot({ path: `${DOSSIER_CAPTURES}support-avis-courriel.png` });

  /*
   * LE MARQUAGE PART APRÈS L'AFFICHAGE, sans bloquer l'avis : on attend qu'il
   * atterrisse, plutôt que de supposer un délai. Une attente fixe passerait ou
   * échouerait selon la charge de la machine — le pire des tests.
   */
  let vu = null;
  for (let i = 0; i < 20 && !vu?.vueParAuteurLe; i += 1) {
    vu = await bdd.collection('tickets').findOne({ _id: new ObjectId(String(idCourriel)) });
    if (!vu?.vueParAuteurLe) await pageRetour.waitForTimeout(250);
  }
  ok('**l’avis est marqué vu** — sinon il se réafficherait des semaines durant',
    Boolean(vu?.vueParAuteurLe), vu?.vueParAuteurLe ? 'marqué' : 'non marqué');

  await pageRetour.reload({ waitUntil: 'domcontentloaded' });
  await pageRetour.getByTestId('widget-support-bouton').click();

  /*
   * ON ANCRE SUR LE PANNEAU OUVERT. L'avis vit DANS le panneau : tant que
   * celui-ci n'est pas monté, son absence ne prouve rien.
   */
  const panneauRouvert = await pageRetour
    .getByTestId('widget-support-panneau')
    .waitFor({ state: 'visible', timeout: 30000 })
    .then(() => true)
    .catch(() => false);

  ok('**et il ne reparaît pas à la visite suivante**',
    panneauRouvert && (await pageRetour.getByTestId('avis-reponse-courriel').count()) === 0,
    panneauRouvert ? '' : 'PANNEAU NON OUVERT : une absence ne conclut rien');

  await contexteRetour.close();
  }

  /* =================================================================== *
   *  DEUX ADMINISTRATEURS, UN DOSSIER
   * =================================================================== */
  section('Un dossier traité ailleurs pendant qu’on le lit');

  const concurrent = await creerTicket({ question: QUESTION_CONCURRENTE, intention: 'decision' });
  const idConcurrent = concurrent.json?.ticket?._id;

  /*
   * RECHARGEMENT EXPLICITE, ET NON UN CLIC SUR L'ONGLET COURANT. Cliquer
   * « À traiter » alors qu'on y est déjà ne change aucun état, donc ne relit
   * pas la file : le dossier créé à l'instant n'apparaîtrait jamais. La suite
   * passait par chance, parce que la section précédente laissait l'écran sur
   * un autre onglet — une dépendance invisible entre deux sections.
   */
  await ecran.reload({ waitUntil: 'domcontentloaded' });
  await ecran.getByTestId('famille-support').click();
  await ecran.getByTestId('onglet-escalade').click();
  const carteConcurrente = ecran.getByTestId('dossier-ticket').filter({ hasText: QUESTION_CONCURRENTE });
  await carteConcurrente.waitFor({ state: 'visible', timeout: 30000 });

  // Pendant que la carte est à l'écran, un second administrateur tranche.
  const second = await inscrire('adminbisfront', 'Second');
  await bdd.collection('users').updateOne({ pseudo: second.pseudo }, { $set: { type: 'admin' } });
  const cxSecond = await appel('/auth/login', {
    methode: 'POST', corps: { identifiant: second.pseudo, password: MDP },
  });
  const ailleurs = await appel(`/admin/support/tickets/${idConcurrent}`, {
    methode: 'PATCH',
    token: cxSecond.json?.accessToken,
    corps: { decision: 'Compte réactivé par le second administrateur.' },
  });
  ok('le second administrateur tranche le premier', ailleurs.statut === 200,
    `statut ${ailleurs.statut}`);

  await carteConcurrente.getByLabel('Décision').fill('Désactivation maintenue.');
  await carteConcurrente.getByRole('button', { name: 'Clore sans courriel' }).click();

  await ecran.getByText('Ce dossier a déjà été traité').waitFor({ state: 'visible', timeout: 30000 })
    .catch(() => {});
  ok('**l’écran explique le refus**',
    (await ecran.getByText('Ce dossier a déjà été traité').count()) > 0);

  await ecran.waitForFunction(
    (q) => !document.body.innerText.includes(q),
    QUESTION_CONCURRENTE,
    { timeout: 30000 }
  ).catch(() => {});
  ok('**et retire la carte périmée de « À traiter »**',
    (await ecran.getByTestId('dossier-ticket').filter({ hasText: QUESTION_CONCURRENTE }).count()) === 0);

  const conserve = await bdd.collection('tickets').findOne({ _id: new ObjectId(String(idConcurrent)) });
  ok('**la première décision n’est pas écrasée**',
    conserve?.decision === 'Compte réactivé par le second administrateur.', conserve?.decision);

  /* =================================================================== *
   *  UNE DEMANDE ARRIVÉE PAR COURRIEL, SANS COMPTE DERRIÈRE ELLE
   * =================================================================== */
  section('Un dossier venu du courriel, vu par l’administrateur');

  /*
   * CE QUE CETTE SECTION DÉFEND.
   *
   * Une demande écrite à la boîte de support n'a pas forcément de compte :
   * `Ticket.auteur` est alors vide, et l'écran affichait un avatar sans image,
   * un lien vers `/profile/undefined` et « @undefined · undefined ». Un
   * exploitant aurait douté du dossier avant de douter de l'affichage.
   *
   * ET L'ADRESSE ANNONCÉE DOIT ÊTRE CELLE QUI RECEVRA. `envoyerReponse` prend
   * `courrielAuteur` d'abord, puis l'adresse du compte. Si l'écran lisait dans
   * l'autre ordre, la confirmation nommerait quelqu'un d'autre que le vrai
   * destinataire — et ce second clic ne servirait plus à rien.
   */
  const depotAssistant = await appel('/support/service/courriel', {
    methode: 'POST',
    cleService: CLE_SERVICE,
    corps: {
      expediteur: ADRESSE_VISITEUR,
      sujet: 'Problème de paiement',
      question: QUESTION_COURRIEL_ENTRANT,
      brouillon: BROUILLON_ENTRANT,
    },
  });
  ok('condition réunie : le dépôt de l’assistant aboutit',
    depotAssistant.statut === 201, `statut ${depotAssistant.statut}`);

  await ecran.goto(`${BASE}/admin/moderation`, { waitUntil: 'domcontentloaded' });
  await ecran.getByTestId('famille-support').click();
  await ecran.getByTestId('onglet-escalade').click();

  const carteEntrante = ecran
    .getByTestId('dossier-ticket')
    .filter({ hasText: QUESTION_COURRIEL_ENTRANT });
  await carteEntrante.waitFor({ state: 'visible', timeout: 30000 });

  ok('**le canal est annoncé dès la file** — inutile de chercher un pseudo qui n’existe pas',
    await carteEntrante.getByTestId('badge-canal-courriel').isVisible());

  ok('**l’adresse tient lieu d’identité**, faute de compte',
    (await carteEntrante.getByTestId('auteur-courriel').innerText()).includes(ADRESSE_VISITEUR));

  ok('**aucun lien vers un profil inexistant**',
    (await carteEntrante.locator('a[href*="/profile/"]').count()) === 0);

  ok('**le destinataire affiché est l’adresse qui a écrit**, celle-là même où le serveur enverra',
    (await carteEntrante.getByTestId('destinataire-courriel').innerText()).includes(ADRESSE_VISITEUR));

  ok('le brouillon de l’assistant est déjà dans le champ, prêt à être relu',
    (await carteEntrante.getByTestId('brouillon-reponse').inputValue()) === BROUILLON_ENTRANT);

  ok('**« Envoyer » est ouvert** — un brouillon est bien enregistré en base, pas seulement affiché',
    !(await carteEntrante.getByTestId('preparer-envoi').isDisabled()));

  const avantEnvoiCourriel = await bdd.collection('tickets').findOne({ courrielAuteur: ADRESSE_VISITEUR });
  ok('**en base, avant le clic : rien n’est parti, et aucun administrateur n’est inscrit**',
    avantEnvoiCourriel && !avantEnvoiCourriel.reponseEnvoyeeLe && !avantEnvoiCourriel.traitePar &&
      avantEnvoiCourriel.statut === 'escalade',
    `statut « ${avantEnvoiCourriel?.statut} »`);

  await carteEntrante.getByTestId('preparer-envoi').click();
  await carteEntrante.getByTestId('confirmer-envoi').click();
  // Le dossier clos quitte « À traiter » : sa disparition EST la confirmation.
  await carteEntrante.waitFor({ state: 'detached', timeout: 30000 });

  const apresEnvoiCourriel = await bdd.collection('tickets').findOne({ courrielAuteur: ADRESSE_VISITEUR });
  ok('**après validation : le texte relu est figé, et le dossier clos**',
    apresEnvoiCourriel?.statut === 'clos' && apresEnvoiCourriel?.reponseExploitant === BROUILLON_ENTRANT,
    `statut « ${apresEnvoiCourriel?.statut} »`);

  ok('l’administrateur qui a validé est inscrit',
    String(apresEnvoiCourriel?.traitePar) === String(admin.id));

  ok('**et le canal d’envoi est réel, pas `null`** — le dossier n’est pas clos sans réponse',
    typeof apresEnvoiCourriel?.reponseCanal === 'string' && apresEnvoiCourriel.reponseCanal.length > 0,
    String(apresEnvoiCourriel?.reponseCanal));

  /* =================================================================== *
   *  TRI, PAGINATION, PROVENANCE, SUPPRESSION
   * =================================================================== */
  section('Le back-office : trier, paginer, relire, supprimer');

  await ecran.goto(`${BASE}/admin/moderation`, { waitUntil: 'domcontentloaded' });
  await ecran.getByTestId('famille-support').click();
  await ecran.getByTestId('onglet-escalade').click();
  await ecran.getByTestId('dossier-ticket').first().waitFor({ state: 'visible', timeout: 30000 });

  /* ---------------------------- Le tri ---------------------------- */

  ok('les deux ordres de tri sont proposés sur le support',
    (await ecran.getByTestId('ordre-recent').count()) === 1 &&
    (await ecran.getByTestId('ordre-ancien').count()) === 1);

  ok('**« Plus récents » est l’ordre par défaut**',
    (await ecran.getByTestId('ordre-recent').getAttribute('aria-pressed')) === 'true');

  const premierRecent = await ecran.getByTestId('dossier-ticket').first().innerText();

  await ecran.getByTestId('ordre-ancien').click();
  await ecran.waitForTimeout(1200);
  const premierAncien = await ecran.getByTestId('dossier-ticket').first().innerText();

  /*
   * DEUX DOSSIERS DIFFÉRENTS EN TÊTE : c'est la preuve que le paramètre
   * atteint réellement la base, et pas seulement l'URL. Un tri appliqué côté
   * écran aurait produit le même résultat sur une seule page — mais pas sur
   * une file qui en compte plusieurs.
   */
  ok('**changer l’ordre change le dossier en tête** — le tri vient bien du serveur',
    premierRecent !== premierAncien);

  await ecran.getByTestId('ordre-recent').click();
  await ecran.waitForTimeout(1200);

  /*
   * LE TRI N'EST PAS PROPOSÉ AILLEURS, et c'est voulu : les routes des
   * diplômes et des signalements ne l'acceptent pas. Un réglage sans effet est
   * pire qu'un réglage absent.
   */
  await ecran.getByTestId('famille-diplomes').click();

  /*
   * ON ANCRE SUR LE COMPTEUR DE LA LISTE, qui s'affiche pour TOUTE famille
   * ayant au moins un élément — et la suite crée exprès un diplôme en attente.
   * Sans lui, l'absence du réglage de tri serait constatée sur une liste pas
   * encore montée.
   */
  const listeDiplomesRendue = await ecran
    .getByTestId('total-dossiers')
    .waitFor({ state: 'visible', timeout: 30000 })
    .then(() => true)
    .catch(() => false);

  ok('**aucun réglage de tri sur les familles qui ne le gèrent pas**',
    listeDiplomesRendue && (await ecran.getByTestId('ordre-recent').count()) === 0,
    listeDiplomesRendue ? '' : 'LISTE NON RENDUE : une absence ne conclut rien');

  await ecran.getByTestId('famille-support').click();
  await ecran.getByTestId('onglet-escalade').click();
  await ecran.getByTestId('dossier-ticket').first().waitFor({ state: 'visible', timeout: 30000 });

  ok('le nombre total de dossiers est annoncé',
    (await ecran.getByTestId('total-dossiers').count()) === 1);

  /* ---------------------- La provenance du brouillon ---------------------- */

  const ADRESSE_RELIRE = `relire${S}${DOM}`;
  const depotRelire = await appel('/support/service/courriel', {
    methode: 'POST',
    cleService: CLE_SERVICE,
    corps: {
      expediteur: ADRESSE_RELIRE,
      sujet: 'Texte à relire',
      question: 'Pouvez-vous me dire où retrouver mes factures mensuelles ?',
      brouillon: 'Bonjour, vos factures se trouvent dans Paramètres puis Facturation.',
    },
  });
  ok('condition réunie : un second dépôt de l’assistant aboutit',
    depotRelire.statut === 201, `statut ${depotRelire.statut}`);

  await ecran.reload({ waitUntil: 'domcontentloaded' });
  await ecran.getByTestId('famille-support').click();
  await ecran.getByTestId('onglet-escalade').click();

  const carteARelire = ecran.getByTestId('dossier-ticket').filter({ hasText: ADRESSE_RELIRE });
  await carteARelire.waitFor({ state: 'visible', timeout: 30000 });

  /*
   * L'AVERTISSEMENT DE PROVENANCE, ET POURQUOI IL COMPTE.
   *
   * Un brouillon proposé par un modèle de langage et un brouillon écrit par
   * l'exploitant ont exactement la même apparence dans le champ. Le texte part
   * tel quel : sans cette mention, rien ne dit qu'il n'a jamais été relu.
   */
  ok('**un brouillon venu de l’agent s’annonce comme tel**',
    await carteARelire.getByTestId('provenance-brouillon').isVisible());

  await carteARelire.getByTestId('brouillon-reponse').fill(
    'Bonjour, vos factures sont dans Paramètres puis Facturation. Bonne journée.'
  );
  await carteARelire.getByTestId('enregistrer-brouillon').click();

  /*
   * ON ATTEND LA PREUVE EN BASE, et elle sert d'ancrage à l'absence qui suit :
   * la mention « proposé par l'agent » doit tomber PARCE QUE l'exploitant a
   * écrit, pas parce que la carte n'est plus montée.
   *
   * POURQUOI LA BASE ET NON UN REPÈRE À L'ÉCRAN. Premier essai : attendre
   * `avis-brouillon-modifie`. C'était faux — ce repère signale des
   * modifications NON enregistrées, donc il DISPARAÎT à la sauvegarde. Le
   * serveur, lui, passe `brouillonParAgent` à `false` en enregistrant, avec un
   * commentaire qui explique pourquoi : « le texte n'est plus celui de l'agent,
   * même si l'exploitant n'a changé qu'un mot ». C'est exactement la condition
   * que la mention lit, donc c'est elle qu'il faut attendre.
   */
  const brouillonEnregistre = await (async () => {
    const limite = Date.now() + 30000;
    while (Date.now() < limite) {
      const dossier = await bdd
        .collection('tickets')
        .findOne({ courrielAuteur: ADRESSE_RELIRE });
      if (dossier && dossier.brouillonParAgent === false) return true;
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  })();

  /*
   * ET IL DISPARAÎT DÈS QUE L'EXPLOITANT A ÉCRIT. Le laisser ensuite en ferait
   * un ornement, qu'on cesserait de voir — et la mention perdrait tout son
   * sens le jour où elle serait vraie.
   */
  ok('**et la mention tombe dès que l’exploitant a relu et enregistré**',
    brouillonEnregistre &&
      (await carteARelire.getByTestId('provenance-brouillon').count()) === 0,
    brouillonEnregistre ? '' : 'ENREGISTREMENT NON CONSTATÉ : une absence ne conclut rien');

  /* ---------------------------- La suppression ---------------------------- */

  /*
   * AUCUN BOUTON DE SUPPRESSION SUR UN DOSSIER EN ATTENTE. C'est la garantie
   * qui compte : un dossier escaladé est une demande à laquelle personne n'a
   * encore répondu. Le serveur refuse de toute façon, mais l'écran ne doit pas
   * proposer un geste qui détruirait la question de quelqu'un.
   */
  ok('**aucune suppression possible sur un dossier en attente de réponse**',
    (await carteARelire.getByTestId('supprimer-dossier').count()) === 0);

  await ecran.getByTestId('onglet-clos').click();
  const carteClose = ecran.getByTestId('dossier-ticket').filter({ hasText: ADRESSE_VISITEUR });
  await carteClose.waitFor({ state: 'visible', timeout: 30000 });

  ok('un dossier traité propose, lui, la suppression',
    await carteClose.getByTestId('supprimer-dossier').isVisible());

  /*
   * DEUX CLICS, ET LE SECOND BOUTON EST AILLEURS. Un `confirm()` du navigateur
   * ne dit pas DE QUEL dossier il parle — c'est exactement ce qu'il faut savoir
   * avant d'effacer. La confirmation est donc dans la carte, à côté du dossier.
   */
  await carteClose.getByTestId('supprimer-dossier').click();
  ok('**un premier clic demande confirmation**, il ne supprime rien',
    await carteClose.getByTestId('confirmer-suppression').isVisible() &&
    (await bdd.collection('tickets').findOne({ courrielAuteur: ADRESSE_VISITEUR })) !== null);

  await carteClose.getByTestId('confirmer-suppression').click();
  await carteClose.waitFor({ state: 'detached', timeout: 30000 });

  ok('**le second clic supprime, et la base le confirme**',
    (await bdd.collection('tickets').findOne({ courrielAuteur: ADRESSE_VISITEUR })) === null);

  /* =================================================================== *
   *  MOBILE
   * =================================================================== */
  section('Mobile');

  await ecran.setViewportSize({ width: 375, height: 800 });
  await ecran.goto(`${BASE}/admin/moderation`, { waitUntil: 'domcontentloaded' });
  await ecran.getByTestId('famille-support').click();
  await ecran.getByTestId('onglet-clos').click();
  await ecran.getByTestId('dossier-ticket').first().waitFor({ state: 'visible', timeout: 30000 });

  const deborde = await ecran.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  ok('/admin/moderation, famille Support, sans débordement en 375 px', !deborde);
  await ecran.screenshot({ path: `${DOSSIER_CAPTURES}support-back-office-mobile.png`, fullPage: true });

  await contexteAdmin.close();
} finally {
  await navigateur.close();
  await purger();
  await clientMongo.close();
  codeSortie = afficher(null) > 0 ? 1 : 0;
}

process.exit(codeSortie);
