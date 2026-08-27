/**
 * ===========================================================================
 *  LISTES D'ABONNÉS ET D'ABONNEMENTS — MODULE 6
 * ===========================================================================
 *
 *   npm run test:relations
 *
 * Prérequis : l'API (port 5000) doit tourner et MongoDB être joignable.
 *
 * POURQUOI CETTE SUITE EXISTE.
 *
 * Un défaut signalé à l'usage : « la liste ne s'actualise pas et n'affiche pas
 * toutes les personnes ». Les suites du module 6 vérifiaient bien que suivre,
 * accepter et refuser fonctionnent — mais aucune ne comparait LE COMPTEUR
 * AFFICHÉ au NOMBRE DE LIGNES RENDUES.
 *
 * C'est exactement là que le défaut vivait. Le tri des comptes inaccessibles
 * se faisait APRÈS la pagination, en JavaScript :
 *
 *   - une page de vingt pouvait rendre dix-sept lignes ;
 *   - le total venait d'un comptage séparé, sans ce tri : « 25 abonnés »
 *     au-dessus d'une liste de 23 ;
 *   - une relation vers un compte SUPPRIMÉ passait le comptage et
 *     disparaissait de la liste, sans que rien ne l'explique.
 *
 * Chaque vérification ci-dessous compare donc deux choses que l'ancien code
 * laissait diverger.
 *
 * Les comptes créés ici sont supprimés à la fin — et au démarrage.
 * ===========================================================================
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const API = 'http://localhost:5000/api';
const DOM = '@reltest.local';
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

async function appel(chemin, { methode = 'GET', corps, token } = {}) {
  const entetes = {};
  if (token) entetes.Authorization = `Bearer ${token}`;
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

async function inscrire(prefixe, prenom) {
  const pseudo = `${prefixe}${S}`;
  const r = await appel('/auth/register', {
    methode: 'POST',
    corps: {
      type: 'utilisateur', nom: 'Rel', prenom, pseudo,
      email: `${pseudo}${DOM}`, password: MDP, ville: 'Lyon',
    },
  });
  if (r.statut !== 201) throw new Error(`création de ${pseudo} : ${r.statut} ${r.json?.message}`);
  return { token: r.json.accessToken, id: r.json.utilisateur._id, pseudo };
}

/* ------------------------- Accès direct à la base ------------------------ */

const requireLocal = createRequire(import.meta.url);
const { MongoClient, ObjectId } = requireLocal('mongodb');

const uriMongo = readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .find((ligne) => ligne.startsWith('MONGO_URI='))
  .slice('MONGO_URI='.length)
  .trim()
  .replace(/^["']|["']$/g, '');

const clientMongo = new MongoClient(uriMongo, { serverSelectionTimeoutMS: 8000 });
await clientMongo.connect();
const bdd = clientMongo.db();

const motifTest = /@reltest[.]local$/;

async function purger() {
  const comptes = await bdd.collection('users')
    .find({ email: motifTest }, { projection: { _id: 1 } })
    .toArray();
  const ids = comptes.map((u) => u._id);
  if (ids.length === 0) return 0;

  await bdd.collection('notifications').deleteMany({
    $or: [{ destinataire: { $in: ids } }, { emetteur: { $in: ids } }],
  });
  await bdd.collection('follows').deleteMany({
    $or: [{ follower: { $in: ids } }, { following: { $in: ids } }],
  });
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
 * VINGT-CINQ ABONNÉS, ET CE NOMBRE N'EST PAS ARBITRAIRE.
 * La page par défaut en contient vingt : il faut dépasser ce seuil pour que
 * la pagination entre en jeu, sans quoi le défaut d'origine — un tri appliqué
 * après la découpe en pages — resterait invisible.
 */
const vedette = await inscrire('relvedette', 'Vedette');

const abonnes = [];
for (let i = 0; i < 25; i++) {
  const compte = await inscrire(`relab${i}`, `Abonne${i}`);
  await appel(`/follows/${vedette.id}`, { methode: 'POST', token: compte.token });
  abonnes.push(compte);
}

ok('25 comptes suivent la vedette', abonnes.length === 25);

const profil = await appel(`/users/${vedette.pseudo}`);
ok('le compteur affiche 25 abonnés',
  profil.json?.profil?.stats?.followersCount === 25,
  `${profil.json?.profil?.stats?.followersCount}`);

/* ================================================================== *
 *  LE COMPTEUR ET LA LISTE DOIVENT CONCORDER
 * ================================================================== */

section('Concordance compteur / liste');

/** Parcourt toutes les pages et rend la liste complète. */
async function listerTout(pseudo, sens, token) {
  const tous = [];
  let page = 1;
  let total = null;

  for (;;) {
    const r = await appel(`/follows/${pseudo}/${sens}?page=${page}`, { token });
    if (r.statut !== 200) throw new Error(`${sens} page ${page} : ${r.statut}`);

    tous.push(...r.json.elements);
    total = r.json.pagination.total;

    if (!r.json.pagination.aSuivante) break;
    page += 1;
  }

  return { tous, total };
}

const page1 = await appel(`/follows/${vedette.pseudo}/abonnes`, { token: vedette.token });
ok('la première page rend bien 20 éléments',
  page1.json?.elements?.length === 20, `${page1.json?.elements?.length}`);
ok('le total annoncé est 25', page1.json?.pagination?.total === 25,
  `${page1.json?.pagination?.total}`);
ok('une page suivante est annoncée', page1.json?.pagination?.aSuivante === true);

const complet = await listerTout(vedette.pseudo, 'abonnes', vedette.token);
ok('**toutes les pages parcourues rendent 25 personnes**',
  complet.tous.length === 25, `${complet.tous.length}`);
ok('**et le total correspond au nombre réellement rendu**',
  complet.tous.length === complet.total, `${complet.tous.length} rendus / ${complet.total} annoncés`);

const pseudosUniques = new Set(complet.tous.map((u) => u.pseudo));
ok('aucun doublon entre les pages', pseudosUniques.size === complet.tous.length,
  `${pseudosUniques.size} distincts`);

/* ================================================================== *
 *  LE CŒUR DU DÉFAUT — UN COMPTE DÉSACTIVÉ
 * ================================================================== */

section('Compte désactivé parmi les abonnés');

/*
 * TROIS ABONNÉS SONT DÉSACTIVÉS.
 *
 * C'est le scénario qui produisait le symptôme signalé : le compteur restait
 * à 25 tandis que la liste n'en montrait plus que 22, et rien dans
 * l'interface ne permettait de comprendre l'écart.
 */
for (let i = 0; i < 3; i++) {
  await bdd.collection('users').updateOne(
    { _id: new ObjectId(abonnes[i].id) },
    { $set: { isActive: false } }
  );
}

const apresDesactivation = await listerTout(vedette.pseudo, 'abonnes', vedette.token);

ok('**les comptes désactivés n’apparaissent plus dans la liste**',
  apresDesactivation.tous.length === 22, `${apresDesactivation.tous.length} personnes`);

ok('**et le total annoncé descend avec eux**',
  apresDesactivation.total === 22, `total ${apresDesactivation.total}`);

ok('**aucune page ne rend moins d’éléments que prévu**',
  apresDesactivation.tous.length === apresDesactivation.total,
  'le tri se fait avant la pagination, plus après');

const premierePageApres = await appel(`/follows/${vedette.pseudo}/abonnes`, {
  token: vedette.token,
});
ok('la première page reste pleine (20 éléments)',
  premierePageApres.json?.elements?.length === 20,
  `${premierePageApres.json?.elements?.length}`);

/* ================================================================== *
 *  UNE RELATION ORPHELINE
 * ================================================================== */

section('Relation vers un compte supprimé');

/*
 * LE CAS LE PLUS FRÉQUENT EN PRATIQUE, et le plus déroutant.
 * L'utilisateur n'existe plus, mais le document `Follow` demeure. L'ancien
 * code le comptait — le `countDocuments` ne regarde que la collection des
 * relations — puis le perdait à l'affichage, le `populate` rendant `null`.
 */
await bdd.collection('users').deleteOne({ _id: new ObjectId(abonnes[3].id) });

const apresSuppression = await listerTout(vedette.pseudo, 'abonnes', vedette.token);

ok('**une relation orpheline ne compte plus**',
  apresSuppression.total === 21, `total ${apresSuppression.total}`);
ok('et n’apparaît pas dans la liste',
  apresSuppression.tous.length === 21, `${apresSuppression.tous.length} personnes`);
ok('**liste et total restent égaux**',
  apresSuppression.tous.length === apresSuppression.total);

ok('aucune ligne vide ni identifiant nul',
  apresSuppression.tous.every((u) => u && u._id && u.pseudo));

/* ================================================================== *
 *  LE COMPTEUR DÉNORMALISÉ SE RECALE
 * ================================================================== */

section('Recalage du compteur affiché');

/*
 * LE SYMPTÔME EXACT QUI A ÉTÉ SIGNALÉ.
 *
 * Le compteur du profil est dénormalisé : il s'incrémente à chaque relation
 * créée, mais rien ne le corrige quand un compte suivi est désactivé ou
 * supprimé. Le profil annonçait donc « 26 abonnés » au-dessus d'une liste de
 * 22, et l'écart était impossible à comprendre depuis l'interface.
 *
 * Le recaler pour tous les abonnés à chaque désactivation serait un travail
 * non borné, déclenché par une action anodine. On répare donc AU MOMENT OÙ
 * L'ÉCART DEVIENT VISIBLE : à la lecture de la liste, qui vient justement de
 * calculer le bon total.
 */
const nouvelAbonne = await inscrire('relnouveau', 'Nouveau');
await appel(`/follows/${vedette.id}`, { methode: 'POST', token: nouvelAbonne.token });

/*
 * ON DÉSYNCHRONISE VOLONTAIREMENT LE COMPTEUR.
 *
 * Les lectures de liste précédentes l'ont déjà recalé — la réparation
 * fonctionne trop bien pour qu'on puisse observer l'écart par accident. Écrire
 * une valeur fausse en base reproduit exactement l'état d'un profil dont un
 * abonné a été désactivé après coup, et rend la vérification déterministe :
 * sans cela, elle passerait pour la mauvaise raison.
 */
await bdd.collection('users').updateOne(
  { _id: new ObjectId(vedette.id) },
  { $set: { 'stats.followersCount': 99 } }
);

const avantOuverture = await appel(`/users/${vedette.pseudo}`);
const compteurAvant = avantOuverture.json?.profil?.stats?.followersCount;

/*
 * ON LIT LA LISTE AVANT DE RELIRE LE PROFIL, et l'ordre est significatif :
 * c'est l'ouverture de la liste qui déclenche le recalage. Relire le profil
 * d'abord mesurerait l'état d'avant réparation.
 */
const listeApres = await listerTout(vedette.pseudo, 'abonnes', vedette.token);

// L'écriture de recalage ne bloque pas la réponse : on lui laisse un instant.
await new Promise((r) => setTimeout(r, 500));

const profilApres = await appel(`/users/${vedette.pseudo}`);
const compteurApres = profilApres.json?.profil?.stats?.followersCount;

ok('le compteur était bien désynchronisé avant ouverture',
  compteurAvant !== listeApres.total,
  `compteur ${compteurAvant} / réel ${listeApres.total}`);

ok('**ouvrir la liste recale le compteur du profil**',
  compteurApres === listeApres.total,
  `compteur ${compteurApres} / liste ${listeApres.total}`);

/* ================================================================== *
 *  ABONNEMENTS — LE SENS INVERSE
 * ================================================================== */

section('Abonnements (sens inverse)');

const suiveur = await inscrire('relsuiveur', 'Suiveur');
for (let i = 5; i < 15; i++) {
  await appel(`/follows/${abonnes[i].id}`, { methode: 'POST', token: suiveur.token });
}

const sesAbonnements = await listerTout(suiveur.pseudo, 'abonnements', suiveur.token);
ok('les 10 abonnements sont listés', sesAbonnements.tous.length === 10,
  `${sesAbonnements.tous.length}`);
ok('total et liste concordent', sesAbonnements.total === sesAbonnements.tous.length);

await bdd.collection('users').updateOne(
  { _id: new ObjectId(abonnes[5].id) },
  { $set: { isActive: false } }
);

const apresDesabo = await listerTout(suiveur.pseudo, 'abonnements', suiveur.token);
ok('**la même règle s’applique aux abonnements**',
  apresDesabo.total === 9 && apresDesabo.tous.length === 9,
  `${apresDesabo.tous.length} / ${apresDesabo.total}`);

/* ================================================================== *
 *  CONTENU DES LIGNES
 * ================================================================== */

section('Contenu des lignes');

const echantillon = apresSuppression.tous[0];

ok('chaque ligne porte pseudo, nom et identifiant',
  Boolean(echantillon?.pseudo && echantillon?.nom && echantillon?._id));
ok('**et l’état de MA relation**, pour afficher le bon bouton',
  typeof echantillon?.maRelation === 'string', echantillon?.maRelation);
ok('`estCertifie` est présent (virtuel reconstitué après agrégation)',
  typeof echantillon?.estCertifie === 'boolean', String(echantillon?.estCertifie));
ok('**aucune adresse email dans la réponse**', !JSON.stringify(apresSuppression.tous).includes(DOM));

/* ================================================================== *
 *  VISIBILITÉ
 * ================================================================== */

section('Visibilité');

const prive = await inscrire('relprive', 'Prive');
await appel('/users/me/visibilite', {
  methode: 'PATCH', token: prive.token, corps: { visibilite: 'prive' },
});
await appel(`/follows/${prive.id}`, { methode: 'POST', token: abonnes[10].token });

const vuParEtranger = await appel(`/follows/${prive.pseudo}/abonnes`, {
  token: suiveur.token,
});
ok('**la liste d’un compte privé est refusée à un non-abonné**',
  vuParEtranger.statut === 403, vuParEtranger.json?.message);

const vuParSoi = await appel(`/follows/${prive.pseudo}/abonnes`, { token: prive.token });
ok('mais reste accessible à son propriétaire', vuParSoi.statut === 200);

const sansSession = await appel(`/follows/${vedette.pseudo}/abonnes`);
ok('un compte public reste consultable sans session', sansSession.statut === 200);

/* ================================================================== *
 *  NETTOYAGE
 * ================================================================== */

const supprimes = await purger();
await clientMongo.close();

console.log('\n========== RELATIONS — ABONNÉS ET ABONNEMENTS ==========');
const echecs = afficher();
console.log(`\n  (${supprimes} compte(s) de test supprimés)`);
process.exit(echecs > 0 ? 1 : 0);
