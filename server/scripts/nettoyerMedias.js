import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';

import { connecterDB, deconnecterDB } from '../src/config/db.js';
import { DOSSIER_LOCAL, modeStockage } from '../src/services/storage.service.js';
import cloudinary, { cloudinaryConfigure } from '../src/config/cloudinary.js';

import Post from '../src/models/Post.js';
import Story from '../src/models/Story.js';
import User from '../src/models/User.js';

/**
 * ===========================================================================
 *  NETTOYAGE DES MEDIAS ORPHELINS
 * ===========================================================================
 *
 * POURQUOI CE SCRIPT EXISTE.
 * Les stories sont supprimees par l'index TTL de MongoDB au bout de 24 h.
 * Cette suppression est effectuee par le SERVEUR MongoDB lui-meme : elle ne
 * passe pas par Mongoose et ne declenche donc AUCUN hook applicatif — ni
 * `pre('remove')`, ni `post('deleteOne')`.
 *
 * Consequence : le document disparait de la base, mais le fichier video reste
 * chez l'hebergeur. Sur un service factures a l'octet stocke, une plateforme
 * active accumulerait ainsi des gigaoctets de fichiers que plus personne ne
 * peut afficher.
 *
 * Le script compare l'inventaire du stockage a celui de la base, et efface ce
 * qui n'est plus reference nulle part.
 *
 * USAGE
 *   npm run nettoyer-medias              (mode simulation, n'efface rien)
 *   npm run nettoyer-medias -- --confirmer
 *
 * Le mode simulation est le DEFAUT VOLONTAIRE : un script de suppression de
 * masse qui agit sans confirmation est une catastrophe en attente. On regarde
 * d'abord ce qu'il propose de faire.
 *
 * A programmer une fois par jour en production (tache cron de l'hebergeur).
 * ===========================================================================
 */

const confirmer = process.argv.includes('--confirmer');

/** Inventaire de tous les publicId encore references en base. */
async function publicIdsReferences() {
  const references = new Set();

  // Medias des publications
  const posts = await Post.find({}, { medias: 1 }).lean();
  for (const post of posts) {
    for (const media of post.medias || []) {
      if (media.publicId) references.add(media.publicId);
    }
  }

  // Medias des stories encore vivantes
  const stories = await Story.find({}, { media: 1 }).lean();
  for (const story of stories) {
    if (story.media?.publicId) references.add(story.media.publicId);
  }

  // Avatars et justificatifs de diplome
  const utilisateurs = await User.find(
    {},
    { 'avatar.publicId': 1, 'diplome.publicId': 1 }
  ).lean();
  for (const u of utilisateurs) {
    if (u.avatar?.publicId) references.add(u.avatar.publicId);
    if (u.diplome?.publicId) references.add(u.diplome.publicId);
  }

  return references;
}

/* ------------------------------------------------------------------ *
 *  MODE LOCAL
 * ------------------------------------------------------------------ */

/** Parcourt recursivement le dossier d'uploads. */
async function listerFichiersLocaux(racine, prefixe = '') {
  const fichiers = [];

  let entrees;
  try {
    entrees = await readdir(path.join(racine, prefixe), { withFileTypes: true });
  } catch {
    return fichiers; // dossier inexistant : rien a nettoyer
  }

  for (const entree of entrees) {
    const relatif = prefixe ? `${prefixe}/${entree.name}` : entree.name;
    if (entree.isDirectory()) {
      fichiers.push(...(await listerFichiersLocaux(racine, relatif)));
    } else {
      fichiers.push(relatif);
    }
  }

  return fichiers;
}

async function nettoyerLocal(references) {
  const fichiers = await listerFichiersLocaux(DOSSIER_LOCAL);
  const orphelins = fichiers.filter((f) => !references.has(f));

  console.log(`\nFichiers sur le disque   : ${fichiers.length}`);
  console.log(`References en base       : ${references.size}`);
  console.log(`Orphelins detectes       : ${orphelins.length}`);

  if (orphelins.length === 0) return { supprimes: 0, octets: 0 };

  let octets = 0;
  for (const orphelin of orphelins) {
    const chemin = path.join(DOSSIER_LOCAL, orphelin);
    try {
      const info = await stat(chemin);
      octets += info.size;
      console.log(`   ${confirmer ? 'supprime' : 'a supprimer'} : ${orphelin} (${Math.round(info.size / 1024)} Ko)`);
      if (confirmer) await unlink(chemin);
    } catch {
      // Fichier disparu entre-temps : sans consequence.
    }
  }

  return { supprimes: orphelins.length, octets };
}

/* ------------------------------------------------------------------ *
 *  MODE CLOUDINARY
 * ------------------------------------------------------------------ */

async function nettoyerCloudinary(references) {
  let curseur = null;
  let total = 0;
  const orphelins = [];

  // L'API pagine par 500 ressources. On boucle jusqu'a epuisement plutot que
  // de supposer que tout tient en une page.
  do {
    const reponse = await cloudinary.api.resources({
      type: 'upload',
      prefix: 'sportsocial/',
      max_results: 500,
      next_cursor: curseur,
    });

    total += reponse.resources.length;
    for (const ressource of reponse.resources) {
      if (!references.has(ressource.public_id)) {
        orphelins.push({
          id: ressource.public_id,
          type: ressource.resource_type,
          octets: ressource.bytes,
        });
      }
    }

    curseur = reponse.next_cursor;
  } while (curseur);

  console.log(`\nRessources sur Cloudinary : ${total}`);
  console.log(`References en base        : ${references.size}`);
  console.log(`Orphelines detectees      : ${orphelins.length}`);

  if (orphelins.length === 0) return { supprimes: 0, octets: 0 };

  let octets = 0;
  for (const orphelin of orphelins) {
    octets += orphelin.octets || 0;
    console.log(`   ${confirmer ? 'supprime' : 'a supprimer'} : ${orphelin.id} (${Math.round((orphelin.octets || 0) / 1024)} Ko)`);
    if (confirmer) {
      await cloudinary.uploader.destroy(orphelin.id, { resource_type: orphelin.type });
    }
  }

  return { supprimes: orphelins.length, octets };
}

/* ------------------------------------------------------------------ *
 *  PROGRAMME PRINCIPAL
 * ------------------------------------------------------------------ */

async function principal() {
  console.log('=== Nettoyage des medias orphelins ===');
  console.log(`Mode de stockage : ${modeStockage}`);
  console.log(
    confirmer
      ? 'Mode SUPPRESSION : les fichiers orphelins seront effaces.'
      : 'Mode SIMULATION : rien ne sera efface. Ajoutez --confirmer pour agir.'
  );

  await connecterDB();

  const references = await publicIdsReferences();

  const resultat = cloudinaryConfigure
    ? await nettoyerCloudinary(references)
    : await nettoyerLocal(references);

  console.log(
    `\n${confirmer ? 'Supprimes' : 'A supprimer'} : ${resultat.supprimes} fichier(s), ` +
      `${(resultat.octets / 1024 / 1024).toFixed(2)} Mo`
  );

  await deconnecterDB();
  await mongoose.disconnect();
  process.exit(0);
}

principal().catch(async (erreur) => {
  console.error('\nEchec du nettoyage :', erreur.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
