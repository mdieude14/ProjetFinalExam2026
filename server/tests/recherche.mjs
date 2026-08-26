/**
 * ===========================================================================
 *  RECHERCHE — MODULE 10
 * ===========================================================================
 *
 *   npm run test:recherche
 *
 * Prérequis : l'API (port 5000) doit tourner et MongoDB être joignable.
 *
 * LES DEUX VÉRIFICATIONS QUI JUSTIFIENT L'ARCHITECTURE DU MODULE :
 *
 *   1. `$text` ne trouve PAS un préfixe, l'autocomplétion SI. C'est la
 *      méprise fondatrice du module — on la met noir sur blanc plutôt que de
 *      la laisser se redécouvrir un jour de mise en production.
 *
 *   2. La recherche n'ouvre AUCUNE porte dérobée. Tout ce que les modules 4,
 *      7 et 9 ont fermé doit rester fermé quand on y accède par ce chemin :
 *      compte désactivé, publication premium, adresse d'événement privé.
 *
 * Les comptes créés ici sont supprimés à la fin — et au démarrage, pour que
 * la suite ne dépende pas de la façon dont la précédente s'est terminée.
 * ===========================================================================
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const API = 'http://localhost:5000/api';
const DOM = '@recherchetest.local';
const MDP = 'MotDePasse123';
const S = Date.now();

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

async function appel(chemin, { methode = 'GET', corps, form, token } = {}) {
  const entetes = {};
  if (token) entetes.Authorization = `Bearer ${token}`;
  if (corps) entetes['Content-Type'] = 'application/json';

  const r = await fetch(API + chemin, {
    method: methode,
    headers: entetes,
    body: form || (corps ? JSON.stringify(corps) : undefined),
  });

  const texte = await r.text();
  return {
    statut: r.status,
    texte,
    json: (() => { try { return JSON.parse(texte); } catch { return null; } })(),
  };
}

/** PNG 1×1 — le plus petit média valide acceptable par l'API. */
const png = () =>
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );

function formMedia(champs = {}) {
  const fd = new FormData();
  fd.append('medias', new Blob([png()], { type: 'image/png' }), 'p.png');
  for (const [cle, valeur] of Object.entries(champs)) fd.append(cle, String(valeur));
  return fd;
}

async function inscrire({ type = 'utilisateur', pseudo, nom, prenom, ville, visibilite }) {
  const r = await appel('/auth/register', {
    methode: 'POST',
    corps: {
      type, nom, prenom, pseudo,
      email: `${pseudo}${DOM}`, password: MDP,
      ...(ville ? { ville } : {}),
      ...(visibilite ? { visibilite } : {}),
      ...(type === 'coach' ? { diplome: { intitule: 'BPJEPS', organisme: 'DRJSCS' } } : {}),
    },
  });
  if (r.statut !== 201) throw new Error(`création de ${pseudo} : ${r.statut} ${r.json?.message}`);
  return { token: r.json.accessToken, id: r.json.utilisateur._id, pseudo };
}

const dansNJours = (n, heure = 10) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(heure, 0, 0, 0);
  return d.toISOString();
};

/* ------------------------- Accès direct à la base ------------------------ */

const requireLocal = createRequire(import.meta.url);
const { MongoClient } = requireLocal('mongodb');

const uriMongo = readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .find((ligne) => ligne.startsWith('MONGO_URI='))
  .slice('MONGO_URI='.length)
  .trim()
  .replace(/^["']|["']$/g, '');

const clientMongo = new MongoClient(uriMongo, { serverSelectionTimeoutMS: 8000 });
await clientMongo.connect();
const bdd = clientMongo.db();

const motifTest = /@recherchetest[.]local$/;

async function purger() {
  const comptes = await bdd.collection('users')
    .find({ email: motifTest }, { projection: { _id: 1 } })
    .toArray();
  const ids = comptes.map((u) => u._id);
  if (ids.length === 0) return 0;

  const evts = await bdd.collection('sportevents')
    .find({ organisateur: { $in: ids } }, { projection: { _id: 1 } })
    .toArray();

  await bdd.collection('eventregistrations').deleteMany({
    $or: [{ event: { $in: evts.map((e) => e._id) } }, { utilisateur: { $in: ids } }],
  });
  await bdd.collection('sportevents').deleteMany({ organisateur: { $in: ids } });
  await bdd.collection('posts').deleteMany({ auteur: { $in: ids } });
  await bdd.collection('users').deleteMany({ _id: { $in: ids } });

  return ids.length;
}

const restes = await purger();
if (restes > 0) {
  console.log(`  (purge d'entrée : ${restes} compte(s) laissés par une exécution précédente)`);
}

/* ================================================================== *
 *  MISE EN PLACE
 * ================================================================== */

section('Mise en place');

/*
 * LE PSEUDO PORTE LE MOT CHERCHÉ, SÉPARÉ PAR UN POINT.
 * Le segmenteur de MongoDB coupe sur la ponctuation : « natation.1787… »
 * produit bien le terme « natation », avec le poids 10 de l'index. Sans le
 * point, le pseudo entier ne formerait qu'un seul terme, et aucune recherche
 * sur « natation » ne l'atteindrait — ce qui rendrait le test du classement
 * impossible à écrire.
 */
const coach = await inscrire({
  type: 'coach',
  pseudo: `natation.${S}`,
  nom: 'Martineau',
  prenom: 'Éloïse',
  ville: 'Lyon',
});

const sportif = await inscrire({
  pseudo: `rechsam${S}`,
  nom: 'Natation',        // le même mot, mais dans le NOM : poids 3
  prenom: 'Sam',
  ville: 'Lyon',
});

const prive = await inscrire({
  pseudo: `rechbruno${S}`,
  nom: 'Confidentiel',
  prenom: 'Bruno',
});

/*
 * LE PASSAGE EN PROFIL PRIVÉ SE FAIT PAR SA ROUTE, PAS À L'INSCRIPTION.
 * `register` n'accepte pas `visibilite` — et c'est un choix défendable : la
 * confidentialité se règle dans les paramètres, une fois le compte créé.
 * Ce détail a d'abord fait échouer ce test pour une raison trompeuse : la
 * publication d'un compte réputé privé remontait à un anonyme, alors que le
 * compte était en réalité resté public. Le contrôle d'accès n'était pas en
 * cause ; le jeu d'essai l'était.
 */
const passagePrive = await appel('/users/me/visibilite', {
  methode: 'PATCH', token: prive.token, corps: { visibilite: 'prive' },
});
ok('compte de test réellement passé en privé',
  passagePrive.statut === 200, passagePrive.json?.message);

const inactif = await inscrire({
  pseudo: `rechmarius${S}`,
  nom: 'Fantome',
  prenom: 'Marius',
});

ok('quatre comptes inscrits', Boolean(coach.token && sportif.token && prive.token && inactif.token));

// Compte désactivé : il ne doit plus jamais remonter.
await bdd.collection('users').updateOne({ _id: new (requireLocal('mongodb').ObjectId)(inactif.id) }, { $set: { isActive: false } });

// Coach certifié et capable de monétiser (les trois conditions du module 7).
await bdd.collection('users').updateOne(
  { pseudo: `natation.${S}` },
  {
    $set: {
      'diplome.statut': 'verifie',
      'stripeAccount.chargesEnabled': true,
      'premium.actif': true,
      'premium.prixMensuel': 1990,
      'premium.stripePriceId': 'price_recherche',
    },
  }
);

const postLibre = await appel('/posts', {
  methode: 'POST', token: coach.token,
  form: formMedia({ titre: 'Seance decouverte', description: 'Initiation en petit groupe' }),
});
ok('publication gratuite créée', postLibre.statut === 201, postLibre.json?.message);

const postPremium = await appel('/posts', {
  methode: 'POST', token: coach.token,
  form: formMedia({
    titre: 'Programme intensif',
    description: 'Plan de progression reserve aux abonnes',
    estPremium: 'true',
  }),
});
ok('publication premium créée', postPremium.statut === 201, postPremium.json?.message);

const postPrive = await appel('/posts', {
  methode: 'POST', token: prive.token,
  form: formMedia({ titre: 'Programme confidentiel', description: 'Visible de mes abonnes' }),
});
ok('publication d’un compte privé créée', postPrive.statut === 201);

const evenement = await appel('/events', {
  methode: 'POST', token: coach.token,
  corps: {
    titre: 'Stage aquatique',
    description: 'Deux jours de perfectionnement',
    sport: 'Natation',
    dateDebut: dansNJours(6),
    dateFin: dansNJours(6, 18),
    lieu: { ville: 'Lyon', adresse: 'Piscine du Rhone' },
  },
});
ok('événement à venir créé', evenement.statut === 201, evenement.json?.message);

const evenementPasse = await appel('/events', {
  methode: 'POST', token: coach.token,
  corps: {
    titre: 'Stage aquatique archive',
    sport: 'Natation',
    dateDebut: dansNJours(4),
    dateFin: dansNJours(4, 18),
    lieu: { ville: 'Lyon' },
  },
});
// Le validateur exige une date future : on le fait vieillir en base, ce qu'un
// simple écoulement du temps produirait de toute façon.
await bdd.collection('sportevents').updateOne(
  { _id: new (requireLocal('mongodb').ObjectId)(evenementPasse.json.evenement._id) },
  { $set: { dateDebut: new Date('2020-01-01'), dateFin: new Date('2020-01-02') } }
);

const evenementPrive = await appel('/events', {
  methode: 'POST', token: coach.token,
  corps: {
    titre: 'Stage aquatique reserve',
    type: 'prive',
    sport: 'Natation',
    dateDebut: dansNJours(8),
    dateFin: dansNJours(8, 18),
    lieu: { ville: 'Lyon', adresse: 'Bassin Introuvable' },
  },
});
ok('événement privé créé', evenementPrive.statut === 201);

/* ================================================================== *
 *  AUTOCOMPLÉTION
 * ================================================================== */

section('Autocomplétion — le préfixe');

const pseudos = (reponse, cle = 'suggestions') =>
  (reponse.json?.[cle] || []).map((u) => u.pseudo);

const sug3 = await appel('/search/suggestions?q=mar');
ok('**un préfixe de trois lettres trouve « Martineau »**',
  pseudos(sug3).includes(`natation.${S}`), pseudos(sug3).join(', ') || 'aucun');

const sugAccent = await appel('/search/suggestions?q=elo');
ok('**« elo » trouve « Éloïse » — accents ignorés**',
  pseudos(sugAccent).includes(`natation.${S}`));

const sugCasse = await appel('/search/suggestions?q=ELO');
ok('la casse est ignorée', pseudos(sugCasse).includes(`natation.${S}`));

const sugMotEntier = await appel('/search/suggestions?q=martineau');
ok('un mot entier fonctionne aussi', pseudos(sugMotEntier).includes(`natation.${S}`));

const sugInactif = await appel('/search/suggestions?q=fant');
ok('**un compte désactivé ne remonte jamais**',
  !pseudos(sugInactif).includes(`rechmarius${S}`), pseudos(sugInactif).join(', ') || 'aucun');

const sugPrive = await appel('/search/suggestions?q=confid');
ok('un profil privé reste trouvable', pseudos(sugPrive).includes(`rechbruno${S}`));

const sugCourt = await appel('/search/suggestions?q=e');
ok('une seule lettre est refusée en 400', sugCourt.statut === 400, sugCourt.json?.message);

const sugVide = await appel('/search/suggestions');
ok('terme manquant refusé en 400', sugVide.statut === 400);

const sugMilieu = await appel('/search/suggestions?q=ineau');
ok('**un fragment au MILIEU d’un mot ne remonte pas** (préfixe, pas sous-chaîne)',
  !pseudos(sugMilieu).includes(`natation.${S}`));

/* ================================================================== *
 *  RECHERCHE TEXTUELLE
 * ================================================================== */

section('Recherche textuelle et pertinence');

const parMot = await appel('/search/utilisateurs?q=martineau');
ok('un mot entier est trouvé par $text',
  pseudos(parMot, 'utilisateurs').includes(`natation.${S}`));

const classement = await appel('/search/utilisateurs?q=natation');
const ordre = pseudos(classement, 'utilisateurs');
ok('les deux comptes portant le mot sont trouvés',
  ordre.includes(`natation.${S}`) && ordre.includes(`rechsam${S}`), ordre.join(' > '));
ok('**le pseudo (poids 10) passe devant le nom (poids 3)**',
  ordre.indexOf(`natation.${S}`) < ordre.indexOf(`rechsam${S}`), ordre.join(' > '));

/*
 * LE POINT QUI JUSTIFIE TOUTE L'ARCHITECTURE DU MODULE.
 * `$text` seul ne répond pas à un préfixe. Le service complète donc par la
 * recherche par préfixe : la réponse doit contenir le compte malgré tout.
 */
const prefixeValide = await appel('/search/utilisateurs?q=mar');
ok('**une recherche validée sur un préfixe aboutit quand même**',
  pseudos(prefixeValide, 'utilisateurs').includes(`natation.${S}`),
  'le repli par préfixe a fonctionné');

const filtreType = await appel('/search/utilisateurs?q=natation&type=coach');
ok('filtre par type appliqué',
  pseudos(filtreType, 'utilisateurs').includes(`natation.${S}`) &&
    !pseudos(filtreType, 'utilisateurs').includes(`rechsam${S}`));

const filtreVille = await appel('/search/utilisateurs?q=natation&ville=LYON');
ok('filtre par ville insensible à la casse',
  pseudos(filtreVille, 'utilisateurs').length >= 2);

const villeInconnue = await appel('/search/utilisateurs?q=natation&ville=Brest');
ok('ville sans résultat renvoie une liste vide',
  villeInconnue.statut === 200 && villeInconnue.json.utilisateurs.length === 0);

ok('**aucune adresse email dans les résultats**',
  !parMot.texte.includes(DOM), 'vue publique uniquement');

/* ================================================================== *
 *  VISIBILITÉ DES PUBLICATIONS
 * ================================================================== */

section('Publications — les deux verrous');

const pubAnonyme = await appel('/search/publications?q=programme');
const titresAnonyme = (pubAnonyme.json?.publications || []).map((p) => p.titre);

ok('recherche de publications accessible sans session', pubAnonyme.statut === 200);
ok('**la publication d’un compte privé est absente pour un anonyme**',
  !titresAnonyme.includes('Programme confidentiel'), titresAnonyme.join(', ') || 'aucune');

const pubSportif = await appel('/search/publications?q=programme', { token: sportif.token });
const premiumVu = (pubSportif.json?.publications || []).find(
  (p) => p.titre === 'Programme intensif'
);

ok('la publication premium figure bien dans les résultats', Boolean(premiumVu));
ok('**elle est marquée verrouillée**', premiumVu?.verrouille === true);
ok('**ses médias sont retirés de la réponse HTTP**', (premiumVu?.medias || []).length === 0);
ok('sa description est masquée', premiumVu?.description === null);
ok('aucune URL de média premium ne fuit',
  !pubSportif.texte.includes('res.cloudinary.com') ||
    !JSON.stringify(premiumVu).includes('cloudinary'));

const pubProprietaire = await appel('/search/publications?q=programme', { token: coach.token });
const vueCoach = (pubProprietaire.json?.publications || []).find(
  (p) => p.titre === 'Programme intensif'
);
ok('le coach relit sa propre publication premium', vueCoach?.verrouille === false);

const pubPrive = await appel('/search/publications?q=programme', { token: prive.token });
ok('l’auteur privé retrouve sa propre publication',
  (pubPrive.json?.publications || []).some((p) => p.titre === 'Programme confidentiel'));

const pubGratuite = await appel('/search/publications?q=decouverte');
ok('une publication gratuite d’un compte public est trouvée par tous',
  (pubGratuite.json?.publications || []).some((p) => p.titre === 'Seance decouverte'));

/* ================================================================== *
 *  ÉVÉNEMENTS
 * ================================================================== */

section('Événements');

const evtTrouve = await appel('/search/evenements?q=aquatique');
const titresEvt = (evtTrouve.json?.evenements || []).map((e) => e.titre);

ok('l’événement à venir est trouvé', titresEvt.includes('Stage aquatique'), titresEvt.join(', '));
ok('**un événement passé n’est pas un résultat**',
  !titresEvt.includes('Stage aquatique archive'));

const evtPriveVu = (evtTrouve.json?.evenements || []).find(
  (e) => e.titre === 'Stage aquatique reserve'
);
ok('un événement privé reste visible dans les résultats', Boolean(evtPriveVu));
ok('**son adresse exacte est absente de la réponse**',
  !evtTrouve.texte.includes('Bassin Introuvable'));
ok('le verrouillage est signalé au front', evtPriveVu?.detailsVerrouilles === true);

const evtParSport = await appel('/search/evenements?q=natation');
ok('la recherche par discipline fonctionne',
  (evtParSport.json?.evenements || []).some((e) => e.titre === 'Stage aquatique'));

const evtOrganisateur = await appel('/search/evenements?q=aquatique', { token: coach.token });
ok('l’organisateur voit l’adresse de son événement privé',
  evtOrganisateur.texte.includes('Bassin Introuvable'));

/* ================================================================== *
 *  RECHERCHE GLOBALE
 * ================================================================== */

section('Recherche globale');

const globale = await appel('/search?q=natation', { token: sportif.token });

ok('la recherche globale répond', globale.statut === 200);
ok('elle contient des personnes', (globale.json?.utilisateurs || []).length > 0);
ok('elle contient des événements', (globale.json?.evenements || []).length > 0);
ok('elle expose un total', typeof globale.json?.total === 'number', String(globale.json?.total));
ok('elle rappelle le terme cherché', globale.json?.terme === 'natation');

/* ================================================================== *
 *  ROBUSTESSE DE LA SAISIE
 * ================================================================== */

section('Robustesse de la saisie');

const tropLong = await appel(`/search?q=${'a'.repeat(120)}`);
ok('une saisie de 120 caractères est refusée', tropLong.statut === 400, tropLong.json?.message);

const limiteHorsBornes = await appel('/search/utilisateurs?q=natation&limite=999');
ok('une limite hors bornes est refusée', limiteHorsBornes.statut === 400);

/*
 * ReDoS — LA BARRE DE RECHERCHE COMME SURFACE D'ATTAQUE.
 * `(a+)+$` est le motif d'école : sur une expression non échappée, il fait
 * partir le moteur en temps exponentiel. Échappé, il n'est plus qu'une
 * chaîne littérale que rien ne trouve. On mesure le temps de réponse : c'est
 * la seule façon de distinguer « refusé » de « a mis huit secondes ».
 */
const debut = Date.now();
const redos = await appel('/search/suggestions?q=' + encodeURIComponent('(a+)+$'));
const duree = Date.now() - debut;

ok('**un motif ReDoS ne fait pas travailler le serveur**',
  redos.statut === 200 && duree < 2000, `${duree} ms`);
ok('il ne renvoie rien, la chaîne étant littérale',
  (redos.json?.suggestions || []).length === 0);

const accentDansTexte = await appel('/search/utilisateurs?q=Éloïse');
ok('un terme accentué est accepté tel quel', accentDansTexte.statut === 200);

const apostrophe = await appel('/search/publications?q=' + encodeURIComponent("l'initiation"));
ok('**une apostrophe n’est pas échappée en entité HTML**',
  apostrophe.statut === 200 && !apostrophe.texte.includes('&#x27;'));

/* ================================================================== *
 *  ORDRE DES ROUTES
 * ================================================================== */

section('Ordre des routes');

const suggestionsRoute = await appel('/search/suggestions?q=mar');
ok('/search/suggestions est bien sa propre route',
  suggestionsRoute.statut === 200 && Array.isArray(suggestionsRoute.json?.suggestions));

const racine = await appel('/search?q=mar');
ok('/search sert la recherche globale',
  racine.statut === 200 && racine.json?.utilisateurs !== undefined);

/* ================================================================== *
 *  NETTOYAGE
 * ================================================================== */

const supprimes = await purger();
await clientMongo.close();

console.log('\n============== RECHERCHE — MODULE 10 ==============');
const echecs = afficher();
console.log(`\n  (${supprimes} compte(s) de test supprimés, contenus compris)`);
process.exit(echecs > 0 ? 1 : 0);
