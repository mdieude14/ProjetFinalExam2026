/**
 * ===========================================================================
 *  DIAGNOSTIC D'UNE URI MONGODB — nommer la faute avant qu'elle ne coûte
 * ===========================================================================
 *
 * POURQUOI CE MODULE EXISTE.
 *
 * Une URI Atlas se recopie à la main depuis une page web, et les quatre
 * fautes possibles rendent toutes le même genre d'erreur illisible :
 *
 *   « Authentication failed »        le mot de passe n'a pas été substitué
 *   « querySrv ENOTFOUND »           le nom du cluster est altéré
 *   l'application paraît VIDE        le nom de base manque — le pilote écrit
 *                                    dans `test`, et rien ne le signale
 *   « ENOTFOUND <bout de passe> »    le mot de passe contient un `@`
 *
 * LA TROISIÈME EST LA PIRE, parce qu'elle ne produit aucune erreur : tout
 * fonctionne, dans une base vide. On la découvre en se demandant pourquoi
 * l'application a perdu ses données.
 *
 * Ce module ne corrige rien. Il DIT ce qui ne va pas, avec le remède, avant
 * qu'un pilote ne rende un message qui parle d'autre chose.
 *
 * ---------------------------------------------------------------------------
 *  AUTO-CONTRÔLE
 * ---------------------------------------------------------------------------
 *
 *   node scripts/lib/uri-mongo.mjs
 *
 * Exécuté directement, il déroule un tableau de cas et vérifie que chaque
 * faute est bien détectée — et surtout qu'une URI CORRECTE ne déclenche
 * rien. *Un contrôle qui ne s'allume jamais ne vérifie rien ; un contrôle
 * qui s'allume toujours est pire.*
 * ===========================================================================
 */

import { pathToFileURL } from 'node:url';

/** Les caractères qui doivent être encodés dans un mot de passe d'URI. */
const RESERVES = ['@', ':', '/', '?', '#', '[', ']'];

/**
 * Examine une URI MongoDB et rend la liste de ses fautes.
 *
 * @param {string} uri
 * @returns {{quoi: string, pourquoi: string, remede: string}[]}
 */
export function diagnostiquerUri(uri) {
  const fautes = [];
  const texte = String(uri ?? '').trim();

  if (!texte) {
    fautes.push({
      quoi: 'URI vide',
      pourquoi: 'aucune adresse à joindre',
      remede: 'renseigner la variable',
    });
    return fautes;
  }

  if (!/^mongodb(\+srv)?:\/\//.test(texte)) {
    fautes.push({
      quoi: 'schéma inattendu',
      pourquoi: 'une URI MongoDB commence par mongodb:// ou mongodb+srv://',
      remede: 'recopier la chaîne depuis « Connect » → « Drivers »',
    });
    return fautes;
  }

  const srv = texte.startsWith('mongodb+srv://');
  const sansSchema = texte.replace(/^mongodb(\+srv)?:\/\//, '');

  /* --- 1. UNE MARQUE LAISSÉE EN PLACE, LA FAUTE LA PLUS COURANTE --- */
  const marque = texte.match(/<[^>]{1,40}>/);
  if (marque) {
    fautes.push({
      quoi: `la marque « ${marque[0]} » n’a pas été remplacée`,
      pourquoi: 'Atlas affiche des marques à substituer, il ne les remplit pas',
      remede: `remplacer ${marque[0]} par sa valeur réelle`,
    });
  }

  /*
   * ON DÉCOUPE SUR LE DERNIER « @ », JAMAIS SUR LE PREMIER « / ».
   *
   * Premier jet : `sansSchema.split('/')[0]` pour obtenir l'autorité. Mais un
   * mot de passe contenant un « / » — précisément l'une des fautes que ce
   * module cherche — coupait la chaîne AVANT l'arobase, l'autorité n'en
   * contenait plus, et le contrôle du mot de passe ne s'exécutait pas.
   *
   *   LE DÉCOUPAGE ÉTAIT CASSÉ PAR LE CARACTÈRE QU'IL DEVAIT DÉTECTER.
   *   Trouvé par l'auto-contrôle de ce fichier, qui a servi avant d'être utile.
   *
   * Le pilote, lui, coupe au DERNIER « @ » : on fait pareil.
   */
  const posArobase = sansSchema.lastIndexOf('@');
  const identifiants = posArobase >= 0 ? sansSchema.slice(0, posArobase) : '';
  const apresArobase = posArobase >= 0 ? sansSchema.slice(posArobase + 1) : sansSchema;
  const hote = apresArobase.split(/[/?]/)[0];

  /* --- 2. LE NOM DE BASE, ET LE SILENCE QU'IL PRODUIT --- */
  const base = apresArobase.includes('/')
    ? apresArobase.slice(apresArobase.indexOf('/') + 1).split('?')[0]
    : '';

  if (!base) {
    fautes.push({
      quoi: 'aucun nom de base',
      pourquoi:
        'le pilote écrit alors dans la base « test » — l’application paraît VIDE sans qu’aucune erreur ne remonte',
      remede: 'insérer le nom AVANT le « ? » : …mongodb.net/sportsocial?retryWrites=true',
    });
  }

  /* --- 3. UN MOT DE PASSE NON ENCODÉ --- */
  if (posArobase >= 0) {
    const motDePasse = identifiants.includes(':')
      ? identifiants.slice(identifiants.indexOf(':') + 1)
      : '';

    const trouves = RESERVES.filter((c) => motDePasse.includes(c));
    if (trouves.length) {
      const avecArobase = trouves.includes('@');
      fautes.push({
        quoi: avecArobase
          ? 'le mot de passe contient un « @ » non encodé'
          : `le mot de passe contient ${trouves.map((c) => `« ${c} »`).join(', ')}`,
        pourquoi: avecArobase
          ? 'le pilote coupe au DERNIER « @ » : l’hôte devient un fragment de mot de passe'
          : 'ces caractères délimitent l’URI : elle est coupée au mauvais endroit',
        remede: 'régénérer un mot de passe alphanumérique, c’est plus sûr que de l’encoder',
      });
    }
  }

  /* --- 4. UN PORT AVEC +srv --- */
  if (srv && /:\d+$/.test(hote)) {
    fautes.push({
      quoi: 'un port est précisé avec mongodb+srv',
      pourquoi: 'le schéma +srv découvre les hôtes et leurs ports par DNS : un port explicite le rend invalide',
      remede: 'retirer « :27017 »',
    });
  }

  /* --- 5. +srv vers une adresse locale --- */
  if (srv && /(localhost|127\.0\.0\.1)/i.test(hote)) {
    fautes.push({
      quoi: 'mongodb+srv vers une adresse locale',
      pourquoi: '+srv exige un enregistrement DNS SRV, qui n’existe pas pour localhost',
      remede: 'employer mongodb:// pour une base locale',
    });
  }

  return fautes;
}

/** Masque les identifiants d'une URI, pour tout affichage. */
export const sansSecret = (uri) =>
  String(uri ?? '').replace(/\/\/[^@/]*@/, '//<identifiants masqués>@');

/* ================================================================== *
 *  AUTO-CONTRÔLE
 * ================================================================== */

/*
 * ON COMPARE DES URL, PAS DES CHAÎNES BRICOLÉES.
 *
 * Premier jet : `file://${process.argv[1].replace(/\\/g, '/')}`. Sous Windows,
 * `import.meta.url` vaut `file:///C:/…` — TROIS barres — alors que cette
 * construction en donne deux. La comparaison était donc toujours fausse, et
 * l'auto-contrôle ne s'exécutait jamais : code de sortie 0, aucune sortie,
 * tout allait bien en apparence.
 *
 *   UN CONTRÔLE QUI NE S'EXÉCUTE PAS REND LE MÊME VERDICT QU'UN CONTRÔLE QUI
 *   PASSE. `pathToFileURL` est fait pour ça.
 */
const executeDirectement =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (executeDirectement) {
  const CAS = [
    {
      titre: 'une URI Atlas CORRECTE',
      uri: 'mongodb+srv://util:MotDePasseAlphanum123@grappe.abcde.mongodb.net/sportsocial?retryWrites=true&w=majority',
      attendu: 0,
    },
    {
      titre: 'une URI locale correcte',
      uri: 'mongodb://localhost:27017/sportsocial?replicaSet=rs0',
      attendu: 0,
    },
    { titre: 'vide', uri: '', attendu: 1 },
    { titre: 'schéma inattendu', uri: 'https://grappe.mongodb.net/sportsocial', attendu: 1 },
    {
      titre: 'marque <db_password> laissée en place',
      uri: 'mongodb+srv://util:<db_password>@grappe.abcde.mongodb.net/sportsocial',
      attendu: 1,
    },
    {
      titre: 'AUCUN NOM DE BASE — la faute silencieuse',
      uri: 'mongodb+srv://util:MotDePasse123@grappe.abcde.mongodb.net/?retryWrites=true',
      attendu: 1,
    },
    {
      titre: 'mot de passe contenant un @',
      uri: 'mongodb+srv://util:Mot@DePasse@grappe.abcde.mongodb.net/sportsocial',
      attendu: 1,
    },
    {
      titre: 'mot de passe contenant / et #',
      uri: 'mongodb+srv://util:Mot/De#Passe@grappe.abcde.mongodb.net/sportsocial',
      attendu: 1,
    },
    {
      titre: 'un port avec +srv',
      uri: 'mongodb+srv://util:MotDePasse123@grappe.abcde.mongodb.net:27017/sportsocial',
      attendu: 1,
    },
    {
      titre: '+srv vers localhost',
      uri: 'mongodb+srv://util:MotDePasse123@localhost/sportsocial',
      attendu: 1,
    },
    {
      titre: 'DEUX fautes à la fois : marque ET pas de base',
      uri: 'mongodb+srv://util:<db_password>@grappe.abcde.mongodb.net/',
      attendu: 2,
    },
  ];

  console.log('');
  console.log('='.repeat(74));
  console.log('  AUTO-CONTRÔLE DU DIAGNOSTIC D’URI');
  console.log('='.repeat(74));
  console.log('');

  let echecs = 0;

  for (const cas of CAS) {
    const fautes = diagnostiquerUri(cas.uri);
    const conforme = fautes.length === cas.attendu;
    if (!conforme) echecs += 1;
    console.log(
      `  ${conforme ? 'OK   ' : 'ECHEC'}  ${cas.titre.padEnd(44)} ${fautes.length} faute(s), ${cas.attendu} attendue(s)`
    );
    for (const f of fautes) console.log(`            · ${f.quoi}`);
  }

  console.log('');
  console.log('-'.repeat(74));
  console.log(`  ${CAS.length - echecs}/${CAS.length} cas conformes.`);
  console.log('');
  console.log('  Et le masquage :');
  console.log(
    `    ${sansSecret('mongodb+srv://util:MotDePasseUltraSecret@grappe.abcde.mongodb.net/sportsocial')}`
  );
  console.log('');
  process.exit(echecs > 0 ? 1 : 0);
}
