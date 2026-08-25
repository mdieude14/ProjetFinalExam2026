import mongoose from 'mongoose';
import { connecterDB, deconnecterDB } from '../src/config/db.js';
import User from '../src/models/User.js';

/**
 * Creation d'un compte administrateur — EN LIGNE DE COMMANDE UNIQUEMENT.
 *
 * POURQUOI PAS DE ROUTE API ?
 * L'administrateur valide les diplomes des coachs : c'est lui qui decide qui
 * peut afficher le badge « certifie » et vendre du contenu. Exposer sa
 * creation, meme derriere un mot de passe secret, ajouterait une surface
 * d'attaque permanente pour une operation qui n'a lieu qu'une fois. Exiger un
 * acces au serveur est la garantie la plus simple et la plus solide.
 *
 * USAGE
 *   npm run creer-admin -- --email=admin@site.fr --pseudo=admin \
 *                          --password=MotDePasse123 --nom=Dieude --prenom=Martin
 *
 * Le « -- » supplementaire est indispensable : il indique a npm que les
 * arguments qui suivent sont destines au script et non a npm lui-meme.
 */

/** Transforme --cle=valeur en objet { cle: valeur }. */
function lireArguments() {
  const args = {};
  for (const argument of process.argv.slice(2)) {
    const correspondance = /^--([^=]+)=(.*)$/.exec(argument);
    if (correspondance) args[correspondance[1]] = correspondance[2];
  }
  return args;
}

async function principal() {
  const args = lireArguments();
  const requis = ['email', 'pseudo', 'password', 'nom', 'prenom'];
  const manquants = requis.filter((cle) => !args[cle]);

  if (manquants.length > 0) {
    console.error(`\nArguments manquants : ${manquants.join(', ')}\n`);
    console.error('Exemple :');
    console.error(
      '  npm run creer-admin -- --email=admin@site.fr --pseudo=admin \\\n' +
        '                         --password=MotDePasse123 --nom=Dupont --prenom=Marie\n'
    );
    process.exit(1);
  }

  // On applique la meme exigence de robustesse que sur l'inscription publique :
  // le compte le plus privilegie de l'application ne peut pas etre le moins
  // bien protege.
  const motDePasseSolide =
    args.password.length >= 8 &&
    /[a-z]/.test(args.password) &&
    /[A-Z]/.test(args.password) &&
    /\d/.test(args.password);

  if (!motDePasseSolide) {
    console.error(
      '\nMot de passe trop faible : 8 caractères minimum, avec au moins ' +
        'une minuscule, une majuscule et un chiffre.\n'
    );
    process.exit(1);
  }

  await connecterDB();

  const adminsExistants = await User.countDocuments({ type: 'admin' });
  if (adminsExistants > 0) {
    console.warn(`\nAttention : ${adminsExistants} compte(s) admin existent déjà.\n`);
  }

  try {
    const admin = await User.create({
      type: 'admin',
      nom: args.nom,
      prenom: args.prenom,
      pseudo: args.pseudo.toLowerCase(),
      email: args.email.toLowerCase(),
      password: args.password, // hache par le hook pre-save du modele
      visibilite: 'prive', // un compte de moderation n'a pas vocation a etre suivi
    });

    console.log('\nCompte administrateur créé :');
    console.log(`   pseudo : ${admin.pseudo}`);
    console.log(`   email  : ${admin.email}`);
    console.log(`   id     : ${admin._id}`);
    console.log('\nConnexion via POST /api/auth/login comme n’importe quel compte.\n');
  } catch (erreur) {
    if (erreur.code === 11000) {
      const champ = Object.keys(erreur.keyValue)[0];
      console.error(`\nEchec : ce ${champ} est déjà utilise.\n`);
    } else if (erreur.name === 'ValidationError') {
      console.error('\nEchec de validation :');
      Object.values(erreur.errors).forEach((e) => console.error(`   - ${e.message}`));
      console.error('');
    } else {
      console.error('\nEchec :', erreur.message, '\n');
    }
    await deconnecterDB();
    process.exit(1);
  }

  await deconnecterDB();
  await mongoose.disconnect();
  process.exit(0);
}

principal();
