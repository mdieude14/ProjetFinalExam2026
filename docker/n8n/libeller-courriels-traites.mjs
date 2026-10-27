/**
 * ===========================================================================
 *  POSER « CC/Support/Traite » SUR L'ARRIÉRÉ, AVANT DE RETIRER `is:unread`
 * ===========================================================================
 *
 *   node docker/n8n/libeller-courriels-traites.mjs             compte, n'écrit rien
 *   node docker/n8n/libeller-courriels-traites.mjs --appliquer pose le libellé
 *
 * ───────────────────────────────────────────────────────────────────────────
 *  POURQUOI CE SCRIPT EXISTE
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Le flux de support relevait la boîte avec `is:unread`. Ce terme confondait
 * deux questions sans rapport : *un humain a-t-il regardé ce message ?* et
 * *l'agent l'a-t-il traité ?* Conséquence mesurée deux fois, les 24 et 26
 * octobre : un courriel dont l'aperçu d'une notification avait suffi à ôter
 * `UNREAD` devenait invisible à l'agent, définitivement et sans trace.
 *
 * Le remplaçant est un libellé posé par le flux lui-même, `CC/Support/Traite`.
 * Mais le jour où l'on retire `is:unread`, la recherche cesse de distinguer
 * « nouveau » de « déjà traité » pour tout ce qui est DÉJÀ dans la boîte :
 * aucun message antérieur ne porte le nouveau libellé, donc tous redeviennent
 * « à traiter ». Sans ce script, la première relève reprendrait deux semaines
 * de courrier, cinq messages par passage, avec un appel facturé au modèle pour
 * chacun.
 *
 * CE SCRIPT POSE DONC LA LIGNE DE DÉPART : il marque « traité » tout ce que la
 * nouvelle recherche trouverait aujourd'hui. Après son passage, la recherche
 * rend zéro message, et seul le courrier qui arrivera ENSUITE sera traité.
 *
 * ───────────────────────────────────────────────────────────────────────────
 *  POURQUOI « CC/Support/Traite » ET PAS « CC/Traite »
 * ───────────────────────────────────────────────────────────────────────────
 *
 * `CC/Traite` existe déjà, et appartient à l'assistant de MESSAGERIE, qui
 * relève LA MÊME BOÎTE (`support.coachconnect.app@gmail.com`, même identifiant
 * OAuth). Le réutiliser ferait que chaque flux rendrait l'autre aveugle : le
 * tri pose `CC/Traite` sur tout ce qu'il classe, toutes les quinze minutes —
 * il aurait donc volé chaque question de support avant que le flux de support
 * ne la voie.
 *
 * C'EST AUSSI POURQUOI LA RECHERCHE DU SUPPORT N'EXCLUT PAS `-label:cc-traite`.
 * Ce serait le même piège, dans l'autre sens.
 *
 * UN NOM SANS ESPACE, ET DÉLIBÉRÉMENT. Gmail écrit un libellé en minuscules
 * dans une recherche et remplace « / » par « - » : `CC/Support/Traite` devient
 * `cc-support-traite`. C'est la transformation déjà éprouvée par `cc-traite` et
 * `cc-prive`. Un nom à espace — « CC/Support traite » — dépendrait en plus de
 * la conversion des espaces, que rien dans ce projet n'a vérifiée.
 *
 * Le libellé se niche sous `CC/Support`, la catégorie que l'assistant de
 * messagerie pose déjà : « support, et traité ».
 *
 * ───────────────────────────────────────────────────────────────────────────
 *  CE QU'IL FAIT, ET CE QU'IL NE FAIT PAS
 * ───────────────────────────────────────────────────────────────────────────
 *
 *   1. échange le jeton de rafraîchissement du serveur contre un jeton d'accès ;
 *   2. crée `CC/Support/Traite` s'il manque (un 409 veut dire « il existe ») ;
 *   3. interroge Gmail avec LA NOUVELLE RECHERCHE, celle d'après `is:unread` ;
 *   4. sans `--appliquer`, s'arrête là et dit ce qu'il aurait marqué ;
 *   5. avec `--appliquer`, pose le libellé message par message.
 *
 * IL NE LIT AUCUN CORPS DE MESSAGE, n'en envoie aucun, n'en supprime aucun, et
 * ne retire jamais un libellé. La seule écriture possible est l'ajout de
 * `CC/Support/Traite` — récupérable d'un clic dans Gmail.
 *
 * IL EST REJOUABLE SANS DOMMAGE : un message déjà marqué n'est plus rendu par
 * la recherche, donc un second passage ne trouve rien.
 * ===========================================================================
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const LIBELLE = 'CC/Support/Traite';

/*
 * LA RECHERCHE D'APRÈS `is:unread`, RECOPIÉE DE `construire-agent-courriel.mjs`.
 *
 * Elle est écrite ici en clair plutôt qu'importée : ce script doit pouvoir
 * tourner AVANT que le workflow soit modifié, pour mesurer l'arriéré que la
 * modification créerait. L'importer rendrait la mesure impossible à faire au
 * bon moment — et la suite de tests vérifie que les deux chaînes concordent.
 */
const DEPUIS = '2026/10/09';
const RECHERCHE = `in:inbox -from:me after:${DEPUIS} -label:cc-prive -label:cc-support-traite`;

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

const racine = new URL('../../', import.meta.url);

/** Les trois valeurs OAuth du serveur, lues sans charger tout son environnement. */
function lireEnvironnement() {
  const chemin = fileURLToPath(new URL('server/.env', racine));
  const lignes = readFileSync(chemin, 'utf8').split(/\r?\n/);

  const valeur = (cle) => {
    const ligne = lignes.find((l) => l.startsWith(`${cle}=`));
    return ligne ? ligne.slice(cle.length + 1).trim() : '';
  };

  const config = {
    client: valeur('GOOGLE_OAUTH_CLIENT_ID'),
    secret: valeur('GOOGLE_OAUTH_CLIENT_SECRET'),
    rafraichissement: valeur('GOOGLE_OAUTH_REFRESH_TOKEN'),
  };

  const manquantes = Object.entries(config).filter(([, v]) => !v).map(([k]) => k);
  if (manquantes.length) {
    throw new Error(
      `Il manque dans server/.env : ${manquantes.join(', ')}. ` +
      'Relancer « node server/scripts/autoriser-gmail.mjs » pour réémettre le jeton.'
    );
  }
  return config;
}

/**
 * LE JETON D'ACCÈS, OBTENU DU JETON DE RAFRAÎCHISSEMENT DU SERVEUR.
 *
 * On réutilise celui du serveur, et pas celui de n8n : il porte la portée
 * `https://mail.google.com/`, qui englobe la modification des libellés. Et il
 * est lisible ici, alors que celui de n8n est chiffré dans la base du
 * conteneur — c'est tout le propos du chiffrement.
 */
async function jetonAcces(config) {
  const reponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.client,
      client_secret: config.secret,
      refresh_token: config.rafraichissement,
      grant_type: 'refresh_token',
    }),
  });

  const corps = await reponse.json().catch(() => ({}));
  if (!reponse.ok || !corps.access_token) {
    /*
     * `invalid_grant` VEUT DIRE QUE LE JETON EST MORT, pas que l'appel est mal
     * formé — c'est ce qu'a produit l'expiration des sept jours du mode « test »
     * de Google, le 19 octobre. On le dit, plutôt que de laisser lire un code.
     */
    const indice = corps.error === 'invalid_grant'
      ? ' Le jeton de rafraîchissement est expiré ou révoqué : relancer ' +
        '« node server/scripts/autoriser-gmail.mjs ».'
      : '';
    throw new Error(`Jeton refusé (${reponse.status} ${corps.error ?? ''}).${indice}`);
  }
  return corps.access_token;
}

const appel = async (jeton, methode, chemin, corps) => {
  const reponse = await fetch(`${GMAIL}${chemin}`, {
    method: methode,
    headers: {
      Authorization: `Bearer ${jeton}`,
      ...(corps ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(corps ? { body: JSON.stringify(corps) } : {}),
  });
  return { statut: reponse.status, corps: await reponse.json().catch(() => ({})) };
};

/** Crée le libellé s'il manque, et rend son identifiant. */
async function assurerLibelle(jeton) {
  const liste = await appel(jeton, 'GET', '/labels');
  if (liste.statut !== 200) {
    throw new Error(`Lecture des libellés refusée (${liste.statut}).`);
  }

  const existant = (liste.corps.labels ?? []).find((l) => l.name === LIBELLE);
  if (existant) return { id: existant.id, cree: false };

  const creation = await appel(jeton, 'POST', '/labels', {
    name: LIBELLE,
    labelListVisibility: 'labelShow',
    messageListVisibility: 'show',
  });

  // 409 : quelqu'un — ou le workflow — l'a créé entre-temps. On relit.
  if (creation.statut === 409) {
    const relecture = await appel(jeton, 'GET', '/labels');
    const trouve = (relecture.corps.labels ?? []).find((l) => l.name === LIBELLE);
    if (trouve) return { id: trouve.id, cree: false };
  }

  if (creation.statut !== 200 || !creation.corps.id) {
    throw new Error(`Création du libellé refusée (${creation.statut}).`);
  }
  return { id: creation.corps.id, cree: true };
}

/** Tous les messages que la nouvelle recherche rend, pagination comprise. */
async function chercherTout(jeton) {
  const trouves = [];
  let page = '';

  do {
    const parametres = new URLSearchParams({ q: RECHERCHE, maxResults: '100' });
    if (page) parametres.set('pageToken', page);

    const reponse = await appel(jeton, 'GET', `/messages?${parametres}`);
    if (reponse.statut !== 200) {
      throw new Error(`Recherche refusée (${reponse.statut}).`);
    }

    // Gmail omet la clé `messages` quand la recherche ne trouve rien.
    trouves.push(...(reponse.corps.messages ?? []));
    page = reponse.corps.nextPageToken ?? '';
  } while (page);

  return trouves;
}

/** De quoi lire la liste sans ouvrir Gmail : expéditeur, objet, date. */
async function resumer(jeton, id) {
  const parametres = 'format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date';
  const reponse = await appel(jeton, 'GET', `/messages/${id}?${parametres}`);
  if (reponse.statut !== 200) return { de: '?', objet: '?', date: '?' };

  const entetes = Object.fromEntries(
    (reponse.corps.payload?.headers ?? []).map((h) => [String(h.name).toLowerCase(), h.value ?? ''])
  );
  return {
    de: entetes.from ?? '?',
    objet: entetes.subject ?? '(sans objet)',
    date: entetes.date ?? '?',
  };
}

async function principal() {
  const applique = process.argv.includes('--appliquer');

  console.log('');
  console.log('  POSER LA LIGNE DE DÉPART DU FLUX DE SUPPORT');
  console.log('  ──────────────────────────────────────────────────────────────');
  console.log(`  Libellé   : ${LIBELLE}`);
  console.log(`  Recherche : ${RECHERCHE}`);
  console.log(`  Mode      : ${applique ? 'APPLIQUER — le libellé sera posé' : 'mesure seule, aucune écriture'}`);
  console.log('');

  const jeton = await jetonAcces(lireEnvironnement());
  const libelle = await assurerLibelle(jeton);
  console.log(`  Libellé ${libelle.cree ? 'créé' : 'déjà présent'} (${libelle.id}).`);

  const messages = await chercherTout(jeton);
  console.log(`  ${messages.length} message(s) que la nouvelle recherche reprendrait.`);
  console.log('');

  if (!messages.length) {
    console.log('  Rien à marquer : la ligne de départ est déjà posée.');
    console.log('');
    return;
  }

  let marques = 0;
  for (const message of messages) {
    const entete = await resumer(jeton, message.id);
    const ligne = `${entete.de} — ${entete.objet}`.slice(0, 96);

    if (!applique) {
      console.log(`  · ${ligne}`);
      continue;
    }

    const pose = await appel(jeton, 'POST', `/messages/${message.id}/modify`, {
      addLabelIds: [libelle.id],
    });

    if (pose.statut === 200) {
      marques += 1;
      console.log(`  ✓ ${ligne}`);
    } else {
      // On ne s'arrête pas : un message refusé ne doit pas bloquer les autres,
      // et l'index unique côté serveur rattrape de toute façon le doublon.
      console.log(`  ✗ ${ligne} (${pose.statut})`);
    }
  }

  console.log('');
  if (applique) {
    console.log(`  ${marques} / ${messages.length} message(s) marqué(s) « ${LIBELLE} ».`);
    console.log('  La recherche doit désormais rendre zéro : relancer sans --appliquer pour le vérifier.');
  } else {
    console.log('  Aucune écriture. Relancer avec --appliquer pour poser le libellé.');
  }
  console.log('');
}

principal().catch((erreur) => {
  console.error('');
  console.error(`  ÉCHEC : ${erreur.message}`);
  console.error('');
  process.exitCode = 1;
});
