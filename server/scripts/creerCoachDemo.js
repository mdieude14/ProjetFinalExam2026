import mongoose from 'mongoose';
import { connecterDB, deconnecterDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import * as stripeService from '../src/services/stripe.service.js';
import { config } from '../src/config/env.js';

/**
 * ===========================================================================
 *  CRÉATION D'UN COACH DE DÉMONSTRATION, PRÊT À ÊTRE ENRÔLÉ CHEZ STRIPE
 * ===========================================================================
 *
 * Crée un coach au diplôme déjà validé, lui ouvre un compte Stripe connecté,
 * et affiche le lien d'inscription hébergé par Stripe.
 *
 * POURQUOI LE DIPLÔME EST MARQUÉ VÉRIFIÉ D'OFFICE.
 * En usage normal, un administrateur l'examine depuis le back-office du
 * module 4. Pour une démonstration, refaire ce circuit à chaque fois n'a pas
 * d'intérêt : on part d'un coach déjà certifié.
 *
 * USAGE
 *   npm run coach-demo
 *   npm run coach-demo -- --pseudo=marc --prenom=Marc --nom=Bernard
 *
 * Le lien d'inscription EXPIRE en quelques minutes. S'il ne fonctionne plus,
 * relancer le script : il réutilise le compte Stripe existant et régénère
 * simplement un lien neuf.
 * ===========================================================================
 */

function lireArguments() {
  const args = {};
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

const args = lireArguments();
const pseudo = (args.pseudo || 'coachdemo').toLowerCase();
const prenom = args.prenom || 'Marc';
const nom = args.nom || 'Bernard';
const email = args.email || `${pseudo}@demo.local`;
const motDePasse = args.password || 'MotDePasse123';

await connecterDB();

/* --- 1. Le coach existe-t-il déjà ? ------------------------------- */

let coach = await User.findOne({ pseudo });

if (coach) {
  console.log(`\nCoach « ${pseudo} » déjà présent, on le réutilise.`);
} else {
  coach = await User.create({
    type: 'coach',
    nom,
    prenom,
    pseudo,
    email,
    password: motDePasse, // haché par le hook pre-save du modèle
    ville: args.ville || 'Lyon',
    bio: 'Coach de démonstration — préparation physique et remise en forme.',
    sports: ['musculation', 'course'],
  });
  console.log(`\nCoach « ${pseudo} » créé.`);
}

/* --- 2. Diplôme validé (raccourci de démonstration) --------------- */

if (coach.diplome?.statut !== 'verifie') {
  coach.diplome = {
    intitule: 'BPJEPS Activités de la Forme',
    organisme: 'DRJSCS Rhône-Alpes',
    statut: 'verifie',
    dateSoumission: new Date(),
    dateVerification: new Date(),
  };
  await coach.save();
  console.log('Diplôme marqué vérifié (en usage réel : validation par un admin).');
}

/* --- 3. Compte Stripe connecté ------------------------------------ */

const { id, deja } = await stripeService.creerCompteConnecte(coach);
console.log(
  deja
    ? `Compte Stripe existant réutilisé : ${id}`
    : `Compte Stripe connecté créé : ${id}`
);

/* --- 4. Lien d'inscription ---------------------------------------- */

const urlBase = config.clientUrls[0] || 'http://localhost:5173';
const lien = await stripeService.lienOnboarding(id, urlBase);

/* --- 5. État courant ---------------------------------------------- */

// On RELIT le coach depuis la base : `creerCompteConnecte` a écrit
// `stripeAccount.id` via un `updateOne`, qui ne touche pas au document déjà
// chargé en mémoire. Passer l'ancien objet ferait croire au service qu'aucun
// compte Stripe n'existe.
const coachAJour = await User.findById(coach._id);
const etat = await stripeService.rafraichirCompteConnecte(coachAJour);

console.log('\n' + '='.repeat(72));
console.log('  IDENTIFIANTS DE CONNEXION À L’APPLICATION');
console.log('='.repeat(72));
console.log(`  pseudo        : ${pseudo}`);
console.log(`  mot de passe  : ${motDePasse}`);
console.log(`  page profil   : ${urlBase}/profile/${pseudo}`);

console.log('\n' + '='.repeat(72));
console.log('  ÉTAT DU COMPTE STRIPE');
console.log('='.repeat(72));
console.log(`  statut            : ${etat.statut}`);
console.log(`  peut encaisser    : ${etat.chargesEnabled ? 'oui' : 'non'}`);
console.log(`  peut monétiser    : ${coachAJour.peutMonetiser ? 'oui' : 'non'}`);
console.log(`  informations dues : ${etat.exigences.length}`);

console.log('\n' + '='.repeat(72));
console.log('  LIEN D’INSCRIPTION STRIPE  (expire en quelques minutes)');
console.log('='.repeat(72));
console.log(`\n${lien}\n`);
console.log('  Ouvrez ce lien, remplissez le formulaire avec les données de');
console.log('  TEST proposées par Stripe, puis relancez ce script pour voir');
console.log('  le statut passer à « actif ».');
console.log('='.repeat(72) + '\n');

await deconnecterDB();
await mongoose.disconnect();
process.exit(0);
