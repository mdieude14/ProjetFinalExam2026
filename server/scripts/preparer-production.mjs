#!/usr/bin/env node
/**
 * ===========================================================================
 *  LA BASCULE EN PRODUCTION — les trois adresses, en une commande
 * ===========================================================================
 *
 *   npm run preparer:production -- --essai \
 *     --api=https://api.mondomaine.fr \
 *     --appli=https://coachconnect.vercel.app \
 *     --n8n=https://n8n.mondomaine.fr
 *
 *   npm run preparer:production -- --api=… --appli=… --n8n=…   écrit pour de bon
 *   npm run preparer:production -- --revenir                   revient au local
 *
 * ---------------------------------------------------------------------------
 *  POURQUOI UNE SEULE COMMANDE POUR QUATRE GESTES
 * ---------------------------------------------------------------------------
 *
 * Le déménagement touche TROIS adresses, et chacune casse un lien différent
 * — sans produire d'erreur visible :
 *
 *   le SERVEUR  →  N8N_WEBHOOK_TELEGRAM      poste vers localhost, repli EN
 *                                            DUR : le scrutage se tait
 *   le CLIENT   →  VITE_SUPPORT_WEBHOOK_URL  réponse bloquée par le CORS :
 *                                            le widget se tait
 *   n8n         →  COACHCONNECT_API          appelle host.docker.internal,
 *                                            inexistant sur un VPS
 *
 * Fait à la main, c'est quatre gestes dans un ordre contraint, dont deux
 * portent une adresse à recopier sans faute. Ce script écrit ce qui peut
 * l'être, et DICTE le reste au caractère près.
 *
 * ---------------------------------------------------------------------------
 *  CE QU'IL ÉCRIT, ET CE QU'IL NE PEUT PAS ÉCRIRE
 * ---------------------------------------------------------------------------
 *
 * IL ÉCRIT : les cinq flux n8n régénérés. Les adresses y sont FIGÉES dans le
 * code des nœuds — n8n tournant avec `N8N_BLOCK_ENV_ACCESS_IN_NODE=true`,
 * un nœud ne peut pas lire l'environnement, parce qu'il y lirait aussi la clé
 * qui déchiffre tous les identifiants.
 *
 * IL NE PEUT PAS ÉCRIRE : les variables des deux hébergeurs. Elles vivent
 * dans leurs consoles respectives, pas dans ce dépôt. Il les affiche donc,
 * prêtes à coller, en nommant la conséquence de chaque oubli.
 *
 * ---------------------------------------------------------------------------
 *  ⚠️ ET APRÈS, LES JSON PORTENT DES ADRESSES DE PRODUCTION
 * ---------------------------------------------------------------------------
 *
 * `docker/n8n/workflows/*.json` est VERSIONNÉ. Une fois régénéré, il contient
 * le domaine public. Ce n'est pas un secret, mais ce n'est pas l'état de
 * développement : `--revenir` restaure les adresses locales, et la sortie
 * est alors identique à l'octet près — vérifié le 8 novembre.
 * ===========================================================================
 */

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const RACINE = fileURLToPath(new URL('../..', import.meta.url));
const FLUX = join(RACINE, 'docker', 'n8n', 'workflows');

const ARGS = process.argv.slice(2);
const ESSAI = ARGS.includes('--essai');
const REVENIR = ARGS.includes('--revenir');

const lire = (nom) => ARGS.find((a) => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);

const dire = (t) => console.log(`  ${t}`);
const crier = (t) => console.error(`  ${t}`);

/* ------------------------------------------------------------------ *
 *  1 — LES TROIS ADRESSES, ET CE QU'ON REFUSE
 * ------------------------------------------------------------------ */

/**
 * Examine une adresse publique et rend ses fautes.
 *
 * LA BARRE OBLIQUE FINALE EST LA FAUTE LA PLUS DISCRÈTE : les générateurs
 * composent `${API}/support/service/…`. Avec une barre de trop, l'URL devient
 * `https://api.fr//support/…` — que certains relais réécrivent, d'autres
 * rejettent, et aucun n'explique.
 */
const fautesDe = (nom, valeur, { api = false } = {}) => {
  const f = [];
  if (!valeur) {
    f.push(`--${nom} est absente`);
    return f;
  }
  if (!/^https:\/\//.test(valeur)) {
    f.push(
      `--${nom} n’est pas en HTTPS — le cookie « secure » ne serait pas posé, et Telegram refuse un webhook en clair`
    );
  }
  if (/\/$/.test(valeur)) {
    f.push(`--${nom} finit par « / » — retirez-la, les adresses sont composées par concaténation`);
  }
  if (/localhost|127\.0\.0\.1/i.test(valeur)) {
    f.push(`--${nom} est une adresse locale`);
  }
  if (api && !/\/api$/.test(valeur)) {
    f.push(
      `--api doit finir par « /api » — le socket est construit en RETIRANT ce suffixe ; sans lui il s’ouvrirait sur une adresse qui n’écoute pas`
    );
  }
  return f;
};

console.log('');
console.log('='.repeat(78));
console.log(
  `  BASCULE EN PRODUCTION${REVENIR ? '  —  RETOUR AUX ADRESSES LOCALES' : ESSAI ? '  —  ESSAI À BLANC' : ''}`
);
console.log('='.repeat(78));
console.log('');

let API = '';
let APPLI = '';
let N8N = '';

if (!REVENIR) {
  API = lire('api') ?? '';
  APPLI = lire('appli') ?? '';
  N8N = lire('n8n') ?? '';

  const fautes = [
    ...fautesDe('api', API, { api: true }),
    ...fautesDe('appli', APPLI),
    ...fautesDe('n8n', N8N),
  ];

  if (fautes.length) {
    crier(`REFUS : ${fautes.length} faute(s) dans les adresses.`);
    crier('');
    for (const x of fautes) crier(`  · ${x}`);
    crier('');
    crier('  Forme attendue :');
    crier('    --api=https://api.mondomaine.fr/api');
    crier('    --appli=https://coachconnect.vercel.app');
    crier('    --n8n=https://n8n.mondomaine.fr');
    process.exit(1);
  }

  dire(`API    : ${API}`);
  dire(`client : ${APPLI}`);
  dire(`n8n    : ${N8N}`);
} else {
  dire('Les flux vont être régénérés avec les adresses de DÉVELOPPEMENT.');
}

console.log('');

/* ------------------------------------------------------------------ *
 *  2 — LA RÉGÉNÉRATION DES CINQ FLUX
 * ------------------------------------------------------------------ */

const generateurs = readdirSync(FLUX)
  .filter((f) => f.startsWith('construire-') && f.endsWith('.mjs'))
  .sort();

if (generateurs.length === 0) {
  crier(`Aucun générateur trouvé dans ${FLUX}`);
  process.exit(1);
}

if (ESSAI) {
  dire(`ESSAI À BLANC — les ${generateurs.length} générateurs NE seront pas lancés :`);
  for (const g of generateurs) dire(`    ${g}`);
} else {
  dire(`Régénération des ${generateurs.length} flux :`);
  const env = REVENIR
    ? { ...process.env, COACHCONNECT_API: undefined, COACHCONNECT_APPLI: undefined }
    : { ...process.env, COACHCONNECT_API: API, COACHCONNECT_APPLI: APPLI };

  // `undefined` dans un objet d'environnement est transmis comme la chaîne
  // « undefined » par certaines versions : on retire les clés pour de bon.
  if (REVENIR) {
    delete env.COACHCONNECT_API;
    delete env.COACHCONNECT_APPLI;
  }

  for (const g of generateurs) {
    try {
      execFileSync(process.execPath, [join(FLUX, g)], { env, stdio: 'pipe' });
      dire(`    OK   ${g}`);
    } catch (erreur) {
      crier(`    ECHEC ${g} : ${erreur.message.split('\n')[0]}`);
      process.exit(1);
    }
  }
}

if (REVENIR) {
  console.log('');
  dire('Les flux portent de nouveau les adresses locales.');
  dire('Vérifiez avec :   git status --short docker/n8n/workflows/');
  dire('Aucune ligne ne devrait apparaître pour les .json.');
  console.log('');
  process.exit(0);
}

/* ------------------------------------------------------------------ *
 *  3 — CE QUI NE PEUT PAS S'ÉCRIRE D'ICI
 * ------------------------------------------------------------------ */

const bloc = (titre, ou, lignes, piege) => {
  console.log('');
  console.log('  ' + '─'.repeat(74));
  console.log(`  ${titre}`);
  console.log(`  à poser dans : ${ou}`);
  console.log('  ' + '─'.repeat(74));
  for (const l of lignes) console.log(`    ${l}`);
  if (piege) {
    console.log('');
    console.log(`    ⚠️  ${piege}`);
  }
};

const hoteN8n = N8N.replace(/^https:\/\//, '');

bloc(
  'HÉBERGEUR DE L’API  —  processus persistant, WebSocket, HTTPS',
  'ses variables d’environnement',
  [
    `NODE_ENV=production`,
    `MONGO_URI=<la chaîne Atlas, celle de MONGO_URI_CIBLE>`,
    `CLIENT_URL=${APPLI},http://localhost:5173`,
    `PUBLIC_URL=${APPLI}`,
    `N8N_WEBHOOK_TELEGRAM=${N8N}/webhook/telegram-support`,
    `JWT_ACCESS_SECRET=<neuf, 64 octets>`,
    `JWT_REFRESH_SECRET=<neuf, 64 octets, DIFFÉRENT du précédent>`,
    `CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET=<les mêmes qu’en local>`,
  ],
  `CLIENT_URL : le domaine Vercel EN PREMIER. Sa PREMIÈRE valeur sert d’adresse
        publique à Stripe Checkout, à l’onboarding Connect et aux LIENS DES
        COURRIELS de réinitialisation. Mise en second, trois parcours
        échoueraient en silence, CHEZ L’UTILISATEUR.`
);

bloc(
  'VERCEL  —  le client',
  'Settings → Environment Variables',
  [
    `VITE_API_URL=${API}`,
    `VITE_SUPPORT_WEBHOOK_URL=${N8N}/webhook/coachconnect-support`,
    `VITE_TELEGRAM_BOT=<le nom du bot>`,
    ``,
    `# et PAS de VITE_STRIPE_PUBLIC_KEY : vérifié, le client ne la lit nulle part.`,
    `# Le paiement est ENTIÈREMENT côté serveur — le client appelle`,
    `# POST /subscriptions/:coach/checkout, l'API crée la session Stripe et`,
    `# rend l'adresse vers laquelle rediriger. Aucune dépendance @stripe/* côté`,
    `# client, zéro lecture de cette variable dans client/src.`,
  ],
  `Une variable VITE_ est FIGÉE DANS LE PAQUET à la construction. Après les
        avoir posées, il faut REDÉPLOYER — modifier la variable seule ne change
        rien au site déjà en ligne.`
);

bloc(
  'n8n  —  l’instance sur le VPS',
  'son .env, ou les variables du modèle de l’hébergeur',
  [
    `N8N_HOST=${hoteN8n}`,
    `N8N_PROTOCOL=https`,
    `WEBHOOK_URL=${N8N}/`,
    `N8N_EDITOR_BASE_URL=${N8N}/`,
    `N8N_PROXY_HOPS=1`,
    `N8N_SECURE_COOKIE=true`,
  ],
  `Déclarer aussi chez Google le rappel OAuth :
        ${N8N}/rest/oauth2-credential/callback
        Sans lui, l’identifiant Gmail ne peut plus être réautorisé.`
);

/* ------------------------------------------------------------------ *
 *  4 — L'ORDRE, ET LES CONTRÔLES
 * ------------------------------------------------------------------ */

console.log('');
console.log('  ' + '─'.repeat(74));
console.log('  L’ORDRE, ET IL EST CONTRAINT');
console.log('  ' + '─'.repeat(74));
console.log(`
    1. les flux sont régénérés          ${ESSAI ? '(essai : non fait)' : 'FAIT ci-dessus'}
    2. importer et ACTIVER les six flux dans n8n
       « import:workflow » remet TOUJOURS active: false
    3. poser les variables des trois blocs ci-dessus
    4. redéployer le client sur Vercel   (les VITE_ sont figées au build)

    puis, pour contrôler sans rien déclencher :

       npm run verifier:atlas  -- --hote=<cluster>.mongodb.net
       npm run verifier:n8n    -- --adresse=${N8N}
       MONGO_URI=<Atlas> NODE_ENV=production npm run verifier:deploiement
`);

if (!ESSAI) {
  console.log('  ' + '─'.repeat(74));
  dire('⚠️  LES JSON DES FLUX PORTENT MAINTENANT DES ADRESSES DE PRODUCTION.');
  dire('    Ils sont versionnés. Pour revenir à l’état de développement :');
  dire('');
  dire('        npm run preparer:production -- --revenir');
  dire('');
  dire('    La sortie est alors identique à l’octet près.');
}

console.log('');
process.exit(0);
