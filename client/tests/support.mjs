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
 * ===========================================================================
 */

import { chromium, selectors } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

selectors.setTestIdAttribute('data-test');

const BASE = process.env.CLIENT_URL || 'http://localhost:5173';
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

async function appel(chemin, { methode = 'GET', corps, token, cleAgent } = {}) {
  const entetes = {};
  if (token) entetes.Authorization = `Bearer ${token}`;
  if (cleAgent) entetes['x-agent-key'] = cleAgent;
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
  await page.waitForSelector('nav[aria-label="Navigation principale"] a', { timeout: 15000 });
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

  const boutonsWidget = await pageAlice.getByTestId('widget-support-bouton').count();
  if (urlAgent) {
    ok('URL d’agent configurée : le widget est proposé', boutonsWidget === 1,
      `${boutonsWidget} bouton(s)`);

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
  } else {
    ok('**sans URL d’agent, le widget est masqué — pas cassé**', boutonsWidget === 0,
      `${boutonsWidget} bouton(s)`);
  }

  section('Le back-office reste fermé à un compte ordinaire');

  await pageAlice.goto(`${BASE}/admin/moderation`, { waitUntil: 'domcontentloaded' });
  await pageAlice.waitForTimeout(1500);
  ok('aucune famille « Support » pour un sportif',
    (await pageAlice.getByTestId('famille-support').count()) === 0);
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
  await ecran.getByTestId('liste-support').waitFor({ state: 'visible', timeout: 15000 });

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
  await ecran.getByText('Dossier instruit').waitFor({ state: 'visible', timeout: 15000 });
  ok('l’administration confirme l’instruction', true);

  await ecran.waitForFunction(
    (q) => !document.body.innerText.includes(q),
    QUESTION_ESCALADE,
    { timeout: 15000 }
  ).catch(() => {});
  ok('le dossier quitte « À traiter »',
    (await ecran.getByTestId('dossier-ticket').filter({ hasText: QUESTION_ESCALADE }).count()) === 0);

  const enBase = await bdd.collection('tickets').findOne({ _id: new ObjectId(String(idEscalade)) });
  ok('**en base : clos, avec la décision et l’instructeur**',
    enBase?.statut === 'clos' &&
      enBase?.decision?.startsWith('Remboursement accordé') &&
      String(enBase?.traitePar) === String(admin.id),
    `statut « ${enBase?.statut} »`);

  await ecran.getByRole('button', { name: 'Instruits' }).click();
  const carteInstruite = ecran.getByTestId('dossier-ticket').filter({ hasText: QUESTION_ESCALADE });
  await carteInstruite.waitFor({ state: 'visible', timeout: 15000 });
  const texteInstruit = await carteInstruite.innerText();
  ok('« Instruits » le montre avec son historique', texteInstruit.includes(`par @${admin.pseudo}`));
  ok('et la décision prise', texteInstruit.includes('Décision : Remboursement accordé'));
  ok('plus aucun bouton d’action sur un dossier instruit',
    (await carteInstruite.getByRole('button', { name: 'Clore sans courriel' }).count()) === 0);

  await ecran.getByRole('button', { name: 'Non escaladés' }).click();
  const carteUsage = ecran.getByTestId('dossier-ticket').filter({ hasText: QUESTION_USAGE });
  await carteUsage.waitFor({ state: 'visible', timeout: 15000 });
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
  await ecran.getByRole('button', { name: 'À traiter' }).click();

  const carteCourriel = ecran.getByTestId('dossier-ticket').filter({ hasText: QUESTION_COURRIEL });
  await carteCourriel.waitFor({ state: 'visible', timeout: 15000 });

  ok('**l’adresse du destinataire est affichée** — une erreur de dossier doit sauter aux yeux',
    (await carteCourriel.getByTestId('destinataire-courriel').innerText()).includes(alice.email));

  ok('**« Envoyer » est fermé tant qu’aucun brouillon n’est enregistré**',
    await carteCourriel.getByTestId('preparer-envoi').isDisabled());

  await carteCourriel.getByTestId('brouillon-reponse').fill(BROUILLON);
  await carteCourriel.getByTestId('enregistrer-brouillon').click();
  await ecran.getByText('Rien n’est encore parti').waitFor({ state: 'visible', timeout: 15000 });

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
  await ecran.getByText('Rien n’est encore parti').waitFor({ state: 'visible', timeout: 15000 });
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
  await avis.waitFor({ state: 'visible', timeout: 15000 });
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
  await pageRetour.waitForTimeout(2500);
  ok('**et il ne reparaît pas à la visite suivante**',
    (await pageRetour.getByTestId('avis-reponse-courriel').count()) === 0);

  await contexteRetour.close();
  }

  /* =================================================================== *
   *  DEUX ADMINISTRATEURS, UN DOSSIER
   * =================================================================== */
  section('Un dossier instruit ailleurs pendant qu’on le lit');

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
  await ecran.getByRole('button', { name: 'À traiter' }).click();
  const carteConcurrente = ecran.getByTestId('dossier-ticket').filter({ hasText: QUESTION_CONCURRENTE });
  await carteConcurrente.waitFor({ state: 'visible', timeout: 15000 });

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

  await ecran.getByText('Ce dossier a déjà été instruit').waitFor({ state: 'visible', timeout: 15000 })
    .catch(() => {});
  ok('**l’écran explique le refus**',
    (await ecran.getByText('Ce dossier a déjà été instruit').count()) > 0);

  await ecran.waitForFunction(
    (q) => !document.body.innerText.includes(q),
    QUESTION_CONCURRENTE,
    { timeout: 15000 }
  ).catch(() => {});
  ok('**et retire la carte périmée de « À traiter »**',
    (await ecran.getByTestId('dossier-ticket').filter({ hasText: QUESTION_CONCURRENTE }).count()) === 0);

  const conserve = await bdd.collection('tickets').findOne({ _id: new ObjectId(String(idConcurrent)) });
  ok('**la première décision n’est pas écrasée**',
    conserve?.decision === 'Compte réactivé par le second administrateur.', conserve?.decision);

  /* =================================================================== *
   *  MOBILE
   * =================================================================== */
  section('Mobile');

  await ecran.setViewportSize({ width: 375, height: 800 });
  await ecran.goto(`${BASE}/admin/moderation`, { waitUntil: 'domcontentloaded' });
  await ecran.getByTestId('famille-support').click();
  await ecran.getByRole('button', { name: 'Instruits' }).click();
  await ecran.getByTestId('dossier-ticket').first().waitFor({ state: 'visible', timeout: 15000 });

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
