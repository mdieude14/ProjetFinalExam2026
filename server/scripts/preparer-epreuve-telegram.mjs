/**
 * ===========================================================================
 *  PRÉPARER L'ÉPREUVE TELEGRAM — un vrai dossier, auquel répondre
 * ===========================================================================
 *
 *   node scripts/preparer-epreuve-telegram.mjs
 *
 * POURQUOI CE SCRIPT EXISTE.
 *
 * Éprouver la réponse depuis Telegram demande un dossier EN ATTENTE D'ALERTE.
 * Or la file était vide : les quatorze dossiers en escalade avaient tous déjà
 * reçu la leur (`notifieExploitant: true`), et la relève ne renvoie jamais une
 * alerte déjà partie — c'est précisément l'anti-doublon qu'on veut.
 *
 * Il n'y avait donc RIEN À QUOI RÉPONDRE, et aucune épreuve possible.
 *
 * CE SCRIPT APPELLE LE MODÈLE POUR DE VRAI, ET IL LAISSE SES TRACES. C'est
 * pour cela qu'il vit dans `scripts/` et non dans `tests/` : aucune suite ne
 * le déclenche, et il ne nettoie PAS derrière lui — le dossier doit survivre
 * pour qu'on puisse lui répondre. Son nettoyage est une commande à part.
 *
 *   node scripts/preparer-epreuve-telegram.mjs --nettoyer
 *
 * PRÉALABLES : API, Mongo et n8n debout ; flux `ccSupportAgent01` actif.
 * ===========================================================================
 */
import { MongoClient, ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';

const API = 'http://localhost:5000/api';
const AGENT = 'http://localhost:5678/webhook/coachconnect-support';
const MDP = 'MotDePasse1!';
const MARQUE = 'epreuvetg';

const client = new MongoClient('mongodb://localhost:27017/?replicaSet=rs0');
await client.connect();
const bdd = client.db('sportsocial');

/* ------------------------------------------------------------------ */
if (process.argv.includes('--nettoyer')) {
  const comptes = await bdd
    .collection('users')
    .find({ pseudo: new RegExp(`^${MARQUE}`) }, { projection: { _id: 1 } })
    .toArray();
  const ids = comptes.map((c) => c._id);
  const d = await bdd.collection('tickets').deleteMany({ auteur: { $in: ids } });
  const u = await bdd.collection('users').deleteMany({ _id: { $in: ids } });
  console.log(`nettoyé : ${u.deletedCount} compte(s), ${d.deletedCount} dossier(s)`);
  await client.close();
  process.exit(0);
}

/* ------------------------------------------------------------------ */
const pseudo = `${MARQUE}${Date.now().toString().slice(-6)}`;
const { insertedId } = await bdd.collection('users').insertOne({
  type: 'utilisateur',
  nom: 'Epreuve',
  prenom: 'Telegram',
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

console.log(`compte d'épreuve : ${pseudo}`);
console.log('appel du webhook de l’agent, comme le fait le widget…\n');

const debut = Date.now();
const rep = await fetch(AGENT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${j.accessToken}` },
  body: JSON.stringify({
    question:
      "Mon paiement premium a ete debite deux fois ce mois-ci, et je ne trouve pas comment demander un remboursement.",
    origine: 'Mes abonnements',
    parcours: 'support',
    objet: 'Double prelevement premium',
  }),
});
const texte = await rep.text();
console.log(`  réponse du widget : ${rep.status} en ${((Date.now() - debut) / 1000).toFixed(1)} s`);
try {
  const o = JSON.parse(texte);
  console.log(`\n  ce que lirait la personne :\n  ${String(o.reponse ?? texte).replace(/\n/g, '\n  ')}\n`);
} catch {
  console.log(`\n  ${texte}\n`);
}

const dossier = await bdd
  .collection('tickets')
  .findOne({ auteur: new ObjectId(String(insertedId)) }, { sort: { createdAt: -1 } });

if (!dossier) {
  console.error('AUCUN DOSSIER CRÉÉ — la chaîne est rompue.');
  await client.close();
  process.exit(1);
}

/*
 * LES HUIT DERNIERS CARACTERES, PAS LES HUIT PREMIERS. C'est ce que rend
 * `referenceDe` (`models/Ticket.js:395`), donc c'est la seule reference que
 * la personne voit, que le courriel porte en objet, et que le bot cite dans
 * son alerte. Une premiere version de ce script prenait le prefixe : elle
 * affichait une reference qui ne designait AUCUN dossier, et aurait envoye
 * chercher une panne dans l'application alors qu'elle etait dans l'outil.
 */
const reference = String(dossier._id).slice(-8);
console.log('  dossier créé');
console.log(`    référence          : ${reference}`);
console.log(`    statut             : ${dossier.statut}`);
console.log(`    escaladeForcee     : ${dossier.escaladeForcee}`);
console.log(`    notifieExploitant  : ${dossier.notifieExploitant}`);
console.log(`
  La relève tourne chaque minute : l'alerte Telegram part dans la minute.
  Répondre AU MESSAGE DU BOT pour instruire ce dossier.

  Pour effacer ensuite :
    node scripts/preparer-epreuve-telegram.mjs --nettoyer
`);

await client.close();
process.exit(dossier.statut === 'escalade' && dossier.notifieExploitant === false ? 0 : 1);
