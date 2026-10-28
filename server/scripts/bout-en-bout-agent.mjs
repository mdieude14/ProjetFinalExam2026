/**
 * ===========================================================================
 *  ALLER-RETOUR RÉEL — widget -> n8n -> Claude -> API -> widget
 * ===========================================================================
 *
 *  CE SCRIPT APPELLE LE MODÈLE POUR DE VRAI, ET IL COÛTE DE L'ARGENT.
 *  C'est pourquoi il vit dans `scripts/` et NON dans `tests/` : il n'est pas
 *  enregistré dans `scripts/test-tout.mjs`, donc la campagne ne le déclenche
 *  jamais. On le lance à la main, quand on veut la preuve que la chaîne
 *  entière fonctionne — pas pour surveiller une régression.
 *
 *  Les suites qui surveillent, elles, interceptent l'agent : `test:escalade`
 *  (35 vérifications) couvre la même logique sans dépenser un jeton.
 *
 *  Ce que ce script prouve, et qu'aucune suite ne peut prouver :
 *    - n8n transmet bien `parcours` et `objet` dans ses trois prompts ;
 *    - le modèle rend un texte SANS tiret cadratin, comme `sansCadratin()`
 *      l'exige ;
 *    - une demande au support reçoit la phrase de transmission AVEC une
 *      référence, et une piste en prime quand l'intention reste de l'usage ;
 *    - `escaladeForcee` envoyé dans le corps est ignoré de bout en bout.
 *
 *  USAGE :  node scripts/bout-en-bout-agent.mjs
 *  PRÉALABLES : API, Vite, Mongo et n8n debout ; flux `ccSupportAgent01` actif.
 * ===========================================================================
 */
import { MongoClient, ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';

const API = 'http://localhost:5000/api';
const AGENT = 'http://localhost:5678/webhook/coachconnect-support';
const MDP = 'MotDePasse1!';
const S = Date.now().toString().slice(-6);

const client = new MongoClient('mongodb://localhost:27017/?replicaSet=rs0');
await client.connect();
const bdd = client.db('sportsocial');

let ok = 0;
let ko = 0;
const dire = (b, t, d = '') => {
  console.log(`${b ? 'OK   ' : 'ECHEC'} ${t}${d ? `  -> ${d}` : ''}`);
  if (b) ok += 1;
  else ko += 1;
};

const inscrire = async (pseudo, type = 'utilisateur') => {
  const { insertedId } = await bdd.collection('users').insertOne({
    type,
    nom: 'Bout',
    prenom: 'EnBout',
    pseudo,
    email: `${pseudo}@exemple.local`,
    password: bcrypt.hashSync(MDP, 12),
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifiant: pseudo, password: MDP }),
  });
  const j = await r.json();
  if (!j.accessToken) throw new Error(`connexion ${pseudo} : ${r.status}`);
  return { token: j.accessToken, id: insertedId, pseudo };
};

/** Appelle le webhook EXACTEMENT comme le fait `supportApi.demander`. */
const demander = async (token, corps) => {
  const debut = Date.now();
  const r = await fetch(AGENT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(corps),
  });
  const texte = await r.text();
  let json = null;
  try {
    json = JSON.parse(texte);
  } catch {
    /* n8n peut rendre du texte nu */
  }
  return { statut: r.status, json, texte, ms: Date.now() - debut };
};

const dossierLePlusRecent = (id) =>
  bdd
    .collection('tickets')
    .findOne({ auteur: new ObjectId(String(id)) }, { sort: { createdAt: -1 } });

const u = await inscrire(`bout${S}`);
console.log(`\ncompte de test : ${u.pseudo}\n`);

/* ------------------------------------------------------------------ */
console.log('--- 1. Contacter le support client, avec un objet ---');
const un = await demander(u.token, {
  question: "Je n'arrive pas a resilier mon abonnement premium, le bouton ne repond pas.",
  origine: 'Mes abonnements',
  parcours: 'support',
  objet: 'Resiliation bloquee',
});
dire(un.statut === 200, 'le widget recoit une reponse', `${un.statut} en ${(un.ms / 1000).toFixed(1)} s`);
const r1 = String(un.json?.reponse ?? un.texte);
console.log(`\n      reponse rendue a l ecran :\n      ${r1.replace(/\n/g, '\n      ')}\n`);
dire(/transmis/i.test(r1), 'la reponse annonce la transmission a l equipe');
dire(/r[ée]f\./i.test(r1), 'et elle donne une reference de dossier');
dire(!/[—–]/.test(r1), 'AUCUN tiret cadratin dans ce que lit la personne');

const d1 = await dossierLePlusRecent(u.id);
dire(Boolean(d1), 'un dossier existe en base');
dire(d1?.parcours === 'support', 'parcours vaut bien support', String(d1?.parcours));
dire(d1?.objet === 'Resiliation bloquee', 'objet est enregistre tel quel', String(d1?.objet));
dire(d1?.escaladeForcee === true, 'escaladeForcee est VRAI', String(d1?.escaladeForcee));
dire(d1?.statut === 'escalade', 'le dossier est en escalade', String(d1?.statut));
dire(d1?.notifieExploitant === false, 'et il attend son alerte Telegram', String(d1?.notifieExploitant));

/* ------------------------------------------------------------------ */
console.log('\n--- 2. Question d utilisation : l agent doit repondre, pas escalader ---');
const deux = await demander(u.token, {
  question: 'Comment je change ma photo de profil ?',
  origine: 'Mon profil',
  parcours: 'usage',
  objet: null,
});
dire(deux.statut === 200, 'le widget recoit une reponse', `${deux.statut} en ${(deux.ms / 1000).toFixed(1)} s`);
const r2 = String(deux.json?.reponse ?? deux.texte);
console.log(`\n      reponse rendue a l ecran :\n      ${r2.slice(0, 500).replace(/\n/g, '\n      ')}\n`);
dire(r2.length > 30, 'la reponse est substantielle', `${r2.length} caracteres`);
dire(!/transmis/i.test(r2), 'elle N annonce PAS de transmission a l equipe');
dire(!/[—–]/.test(r2), 'AUCUN tiret cadratin');

const d2 = await dossierLePlusRecent(u.id);
dire(d2?.parcours === 'usage', 'parcours vaut usage', String(d2?.parcours));
dire(d2?.objet == null, 'objet reste vide hors du formulaire support', String(d2?.objet));
dire(d2?.escaladeForcee === false, 'escaladeForcee est FAUX', String(d2?.escaladeForcee));

/* ------------------------------------------------------------------ */
console.log('\n--- 3. La falsification : usage + escaladeForcee injecte dans le corps ---');
const trois = await demander(u.token, {
  question: 'Ou est-ce que je vois mes notifications deja lues ?',
  origine: 'Notifications',
  parcours: 'usage',
  objet: 'objet que je ne devrais pas pouvoir poser',
  escaladeForcee: true,
});
dire(trois.statut === 200, 'le widget recoit une reponse', String(trois.statut));
const d3 = await dossierLePlusRecent(u.id);
dire(
  d3?.escaladeForcee === false,
  'escaladeForcee du corps est IGNORE — le service seul le deduit',
  String(d3?.escaladeForcee)
);
dire(d3?.objet == null, 'objet est ignore aussi hors parcours support', String(d3?.objet));

/* ------------------------------------------------------------------ */
console.log('\n--- 4. L anti-doublon, sur la vraie chaine ---');
const quatre = await demander(u.token, {
  question: "Je n'arrive pas a resilier mon abonnement premium, le bouton ne repond pas.",
  origine: 'Mes abonnements',
  parcours: 'support',
  objet: 'Resiliation bloquee',
});
const refs = await bdd.collection('tickets').countDocuments({
  auteur: new ObjectId(String(u.id)),
  escaladeForcee: true,
  objet: 'Resiliation bloquee',
});
dire(quatre.statut === 200, 'le second envoi identique aboutit', String(quatre.statut));
dire(refs === 1, 'UN SEUL dossier pour les deux envois', `${refs} dossier(s)`);

/* ------------------------------------------------------------------ */
console.log('\n--- 5. L exploitant voit-il tout cela ? ---');
const adm = await inscrire(`boutadm${S}`, 'admin');
const file = await fetch(`${API}/admin/support/tickets?statut=escalade&ordre=recent`, {
  headers: { Authorization: `Bearer ${adm.token}` },
});
const fj = await file.json();
const liste = fj.elements ?? fj.tickets ?? fj.data ?? [];
const mien = (Array.isArray(liste) ? liste : []).find((t) => t.objet === 'Resiliation bloquee');
dire(file.status === 200, 'la file de l exploitant repond', String(file.status));
dire(Boolean(mien), 'le dossier y figure', mien ? '' : JSON.stringify(Object.keys(fj)));
dire(
  mien?.parcours === 'support' && mien?.escaladeForcee === true,
  'avec son parcours et son escalade forcee',
  `${mien?.parcours} / ${mien?.escaladeForcee}`
);

/* ------------------------------------------------------------------ */
console.log(`\n${ok}/${ok + ko} verifications reussies`);
const comptes = [new ObjectId(String(u.id)), new ObjectId(String(adm.id))];
await bdd.collection('tickets').deleteMany({ auteur: { $in: comptes } });
await bdd.collection('users').deleteMany({ _id: { $in: comptes } });
console.log('  (compte et dossiers de test supprimes)');
await client.close();
process.exit(ko ? 1 : 0);
