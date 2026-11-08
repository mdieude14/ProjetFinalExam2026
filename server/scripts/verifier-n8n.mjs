#!/usr/bin/env node
/**
 * ===========================================================================
 *  PRÉ-VOL n8n — la bonne adresse, les bons chemins, SANS DÉCLENCHER UN FLUX
 * ===========================================================================
 *
 *   npm run verifier:n8n                                   adresse configurée
 *   npm run verifier:n8n -- --adresse=https://n8n.mondomaine.fr
 *
 * ---------------------------------------------------------------------------
 *  TROIS PARTIS ADRESSENT n8n, ET LE DÉMÉNAGEMENT LES CASSE TOUS LES TROIS
 * ---------------------------------------------------------------------------
 *
 *   le SERVEUR  →  N8N_WEBHOOK_TELEGRAM        /webhook/telegram-support
 *   le CLIENT   →  VITE_SUPPORT_WEBHOOK_URL    /webhook/coachconnect-support
 *   n8n         →  COACHCONNECT_API            rappelle l'API de CoachConnect
 *
 * Et les trois échouent DIFFÉREMMENT :
 *
 *   · le serveur poste dans le vide — le repli de `config/env.js` est EN DUR
 *     vers `localhost:5678`. Aucune erreur ne remonte : le scrutage Telegram
 *     cesse simplement de transmettre ;
 *   · le client voit sa réponse bloquée par le navigateur au titre du CORS,
 *     si `allowedOrigins` ne porte pas le domaine Vercel. Le widget se tait ;
 *   · n8n rappelle `host.docker.internal`, qui n'existe pas sur un VPS.
 *
 *   AUCUN DES TROIS NE PRODUIT DE MESSAGE D'ERREUR VISIBLE. D'où ce script.
 *
 * ---------------------------------------------------------------------------
 *  POURQUOI DES REQUÊTES `GET` SUR DES WEBHOOKS DÉCLARÉS EN `POST`
 * ---------------------------------------------------------------------------
 *
 * Poster pour de vrai sur `/webhook/coachconnect-support` DÉCLENCHERAIT le
 * flux : un ticket créé, un appel facturé au modèle, une alerte Telegram. Un
 * contrôle ne doit pas avoir d'effet de bord.
 *
 * Or n8n distingue les deux cas dans son message, et c'est tout ce qu'il
 * faut — mesuré le 8 novembre sur l'instance locale :
 *
 *   chemin DÉCLARÉ en POST   404 « This webhook is not registered for GET
 *                                  requests. Did you mean to make a POST
 *                                  request? »                        → EXISTE
 *   chemin ABSENT            404 « The requested webhook "GET …" is not
 *                                  registered. »                   → MANQUANT
 *
 * Les deux rendent 404. **C'est le TEXTE qui tranche, pas le code.** Un
 * contrôle qui ne regarderait que le statut conclurait « absent » dans les
 * deux cas.
 * ===========================================================================
 */

import dotenv from 'dotenv';

dotenv.config();

const ARGS = process.argv.slice(2);
const DELAI = 10000;

const dire = (t) => console.log(`  ${t}`);
const crier = (t) => console.error(`  ${t}`);

let echecs = 0;
let alertes = 0;

const ok = (libelle, detail = '') => dire(`OK      ${libelle.padEnd(46)} ${detail}`);
const ko = (libelle, detail = '', consequence = '') => {
  echecs += 1;
  crier(`ECHEC   ${libelle.padEnd(46)} ${detail}`);
  if (consequence) crier(`        └─ ${consequence}`);
};
const alerte = (libelle, detail = '', consequence = '') => {
  alertes += 1;
  dire(`ALERTE  ${libelle.padEnd(46)} ${detail}`);
  if (consequence) dire(`        └─ ${consequence}`);
};

/* ------------------------------------------------------------------ *
 *  1 — L'ADRESSE
 * ------------------------------------------------------------------ */

/** Retire le chemin d'un webhook pour ne garder que la base. */
const baseDe = (url) => {
  try {
    return new URL(String(url)).origin;
  } catch {
    return null;
  }
};

const argAdresse = ARGS.find((a) => a.startsWith('--adresse='))?.slice(10);
const configuree = process.env.N8N_WEBHOOK_TELEGRAM;
const base = baseDe(argAdresse ?? configuree ?? 'http://localhost:5678');

if (!base) {
  crier('Adresse illisible.');
  crier('');
  crier('    npm run verifier:n8n -- --adresse=https://n8n.mondomaine.fr');
  process.exit(1);
}

const locale = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(base);

console.log('');
console.log('='.repeat(78));
console.log('  PRÉ-VOL n8n — aucun flux ne sera déclenché');
console.log('='.repeat(78));
console.log('');
dire(`adresse examinée   : ${base}${argAdresse ? '   (--adresse)' : ''}`);
dire(
  `adresse configurée : ${configuree ? baseDe(configuree) : 'aucune — repli EN DUR vers http://localhost:5678'}`
);
console.log('');

/* ------------------------------------------------------------------ *
 *  2 — LA COHÉRENCE AVEC CE QUE LE SERVEUR APPELLERA
 * ------------------------------------------------------------------ */

if (argAdresse) {
  const baseConfiguree = configuree ? baseDe(configuree) : 'http://localhost:5678';
  if (baseConfiguree === base) {
    ok('le serveur appellera bien cette adresse', base);
  } else {
    ko(
      'le serveur appellera une AUTRE adresse',
      baseConfiguree ?? '?',
      `poser N8N_WEBHOOK_TELEGRAM=${base}/webhook/telegram-support dans server/.env`
    );
  }
}

if (!locale) {
  if (base.startsWith('https://')) ok('adresse publique en HTTPS', 'Telegram et Google l’exigent');
  else
    ko(
      'adresse publique en HTTP',
      base,
      'Telegram refuse un webhook en clair, et le rappel OAuth de Google aussi'
    );
}

/* ------------------------------------------------------------------ *
 *  3 — L'INSTANCE RÉPOND-ELLE
 * ------------------------------------------------------------------ */

const demander = async (chemin) => {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), DELAI);
  try {
    const r = await fetch(`${base}${chemin}`, { signal: controleur.signal, redirect: 'manual' });
    const texte = await r.text().catch(() => '');
    return { statut: r.status, texte };
  } catch (erreur) {
    return { statut: 0, texte: erreur?.cause?.code ?? erreur?.message ?? 'inatteignable' };
  } finally {
    clearTimeout(minuteur);
  }
};

const sante = await demander('/healthz');

if (sante.statut === 200) {
  ok('l’instance répond', `/healthz → 200`);
} else {
  ko(
    'l’instance ne répond pas',
    sante.statut === 0 ? sante.texte : `/healthz → ${sante.statut}`,
    'rien d’autre ne sert à vérifier tant que ceci échoue'
  );
  console.log('');
  crier(`${echecs} contrôle(s) en échec.`);
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 *  4 — LES DEUX CHEMINS DE WEBHOOK, SANS EFFET DE BORD
 * ------------------------------------------------------------------ */

/*
 * LE TEXTE TRANCHE, PAS LE STATUT. Les deux cas rendent 404 :
 *   « not registered for GET requests »  → le chemin EXISTE, en POST
 *   « is not registered »                → le chemin est ABSENT
 *
 * ⚠️ ET L'ORDRE DES DEUX TESTS CI-DESSOUS PORTE LE RÉSULTAT.
 *
 * Les deux messages SE CHEVAUCHENT : « This webhook **is not registered** for
 * GET requests » contient littéralement le motif du cas « absent ». Tester
 * l'absence d'abord déclarerait donc MANQUANT un webhook parfaitement
 * déclaré — et l'on chercherait un flux à réimporter qui n'a rien.
 *
 *   ON TESTE DONC LE CAS LE PLUS SPÉCIFIQUE EN PREMIER. Ne pas inverser.
 */
const CHEMINS = [
  ['/webhook/telegram-support', 'appelé par le SERVEUR (scrutage Telegram)'],
  ['/webhook/coachconnect-support', 'appelé par le CLIENT (widget de support)'],
];

for (const [chemin, qui] of CHEMINS) {
  const r = await demander(chemin);

  if (/not registered for GET/i.test(r.texte)) {
    ok(`${chemin}`, `déclaré en POST — ${qui}`);
  } else if (/is not registered/i.test(r.texte)) {
    ko(
      `${chemin}`,
      'ABSENT',
      'le flux n’est pas importé, ou pas ACTIVÉ — `import:workflow` remet toujours active: false'
    );
  } else if (r.statut >= 200 && r.statut < 300) {
    alerte(
      `${chemin}`,
      `répond ${r.statut} en GET`,
      'inattendu : ce chemin devrait n’accepter que POST'
    );
  } else {
    alerte(`${chemin}`, `statut ${r.statut}`, 'réponse non reconnue, à regarder');
  }
}

/* ------------------------------------------------------------------ *
 *  5 — ET CE QUI NE DOIT PAS ÊTRE PUBLIC
 * ------------------------------------------------------------------ */

const rest = await demander('/rest/login');

if (rest.statut === 401 || rest.statut === 403) {
  ok('l’API REST de n8n est protégée', `/rest/login → ${rest.statut}`);
} else if (rest.statut === 200) {
  ko(
    'l’API REST de n8n répond SANS authentification',
    '/rest/login → 200',
    'n’importe qui pourrait lire ou modifier les flux, et les identifiants qu’ils portent'
  );
} else {
  alerte('l’API REST de n8n', `/rest/login → ${rest.statut}`, 'réponse non reconnue');
}

const racine = await demander('/');

if (racine.statut === 200 && /<!DOCTYPE html/i.test(racine.texte)) {
  if (locale) {
    ok('l’éditeur est servi', 'instance locale — sans objet');
  } else {
    /*
     * CE N'EST PAS UNE FAILLE EN SOI : la porte de n8n est dans son
     * application, et `/rest/*` rend bien 401. Mais sur Internet, servir
     * l'éditeur expose sa page de connexion ET SA VERSION.
     *
     * L'image est épinglée en 1.121.3, un choix fait pour un poste LOCAL :
     * le plus petit pas sortant de deux CVE exploitables par un compte
     * authentifié. Annoncer cette version au monde change ce raisonnement.
     */
    alerte(
      'l’éditeur est servi publiquement',
      '/ → 200 (HTML)',
      'à mettre derrière un mot de passe : le Caddyfile de docker/n8n/hostinger ne laisse passer que les webhooks'
    );
  }
} else {
  dire(`·       la racine rend ${racine.statut}` + (locale ? '' : '   (peut-être déjà protégée)'));
}

/* ------------------------------------------------------------------ *
 *  LE VERDICT
 * ------------------------------------------------------------------ */

console.log('');
console.log('-'.repeat(78));

if (echecs === 0 && alertes === 0) {
  dire('TOUT EST COHÉRENT.');
} else {
  dire(`${echecs} échec(s) · ${alertes} alerte(s)`);
}

console.log('');
dire('Ce que ce contrôle NE voit PAS, et il faut le dire :');
dire('  · si `allowedOrigins` du webhook porte le bon domaine — il faudrait');
dire('    une requête depuis un navigateur sur ce domaine pour le savoir ;');
dire('  · si les flux rappellent la bonne adresse d’API — elle est figée');
dire('    DANS leur code, et seule une exécution réelle le montrerait.');
console.log('');

process.exit(echecs > 0 ? 1 : 0);
