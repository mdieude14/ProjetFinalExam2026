import { createHash, randomBytes } from 'node:crypto';

import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { config } from '../config/env.js';
import { envoyerMail } from './mail.service.js';

/**
 * ===========================================================================
 *  MOT DE PASSE OUBLIÉ — demande et réinitialisation
 * ===========================================================================
 *
 * Le parcours tient en deux appels :
 *
 *   1  demander(email)              un e-mail avec un lien, si le compte existe
 *   2  reinitialiser(jeton, mdp)    le mot de passe change, le lien meurt
 *
 * LES QUATRE PROPRIÉTÉS QUI COMPTENT, et où chacune est garantie :
 *
 *   ne rien révéler     le contrôleur répond pareil, et avant tout accès à la
 *                       base — ni le message ni le temps de réponse ne disent
 *                       si une adresse a un compte
 *   lien imprévisible   256 bits aléatoires ; seule l'EMPREINTE est en base
 *   lien court          30 minutes
 *   lien unique         réclamé et effacé en UNE opération MongoDB
 * ===========================================================================
 */

export const VALIDITE_MINUTES = 30;

const empreinteDe = (jeton) => createHash('sha256').update(jeton).digest('hex');

/*
 * Le prénom est échappé à l'inscription, mais peut ne pas l'être ailleurs. On
 * décode les entités usuelles puis on ré-échappe : ni double échappement à
 * l'affichage (« Zo&amp;é »), ni balise injectée dans l'e-mail.
 */
const decoder = (texte) =>
  String(texte ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&amp;/g, '&');

const echapper = (texte) =>
  decoder(texte)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Mise en page commune : un e-mail sobre, lisible sans images. */
function gabarit({ titre, paragraphes, bouton, notes = [] }) {
  const corps = paragraphes
    .map((p) => `<p style="margin:0 0 16px;line-height:1.5;color:#334155">${p}</p>`)
    .join('');
  const action = bouton
    ? `<p style="margin:24px 0"><a href="${bouton.lien}" style="display:inline-block;padding:12px 20px;background:#f97316;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">${bouton.libelle}</a></p>`
    : '';
  const basDePage = notes
    .map((n) => `<p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#64748b">${n}</p>`)
    .join('');
  return `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:28px">
<p style="margin:0 0 20px;font-size:20px;font-weight:800;color:#0f172a">Coach<span style="color:#f97316">Connect</span></p>
<h1 style="margin:0 0 16px;font-size:18px;color:#0f172a">${titre}</h1>${corps}${action}${basDePage}
</div></body></html>`;
}

/**
 * Demande de réinitialisation.
 *
 * NE LÈVE JAMAIS POUR UNE ADRESSE INCONNUE : l'appelant n'a pas à savoir.
 * Un compte désactivé est traité comme inconnu — réinitialiser son mot de
 * passe ne le réactiverait pas, et laisserait croire que si.
 *
 * UNE NOUVELLE DEMANDE REMPLACE LA PRÉCÉDENTE : l'empreinte est écrasée, et
 * l'ancien lien cesse de fonctionner. Un seul lien valide à la fois.
 */
export async function demander(email) {
  const utilisateur = await User.findOne({ email: String(email).toLowerCase(), isActive: true });
  if (!utilisateur) return null;

  const jeton = randomBytes(32).toString('hex');

  // `updateOne` et non `save` : aucun crochet de sauvegarde à déclencher pour
  // deux champs techniques.
  await User.updateOne(
    { _id: utilisateur._id },
    {
      $set: {
        'reinitialisation.empreinte': empreinteDe(jeton),
        'reinitialisation.expireLe': new Date(Date.now() + VALIDITE_MINUTES * 60 * 1000),
      },
    }
  );

  const lien = `${config.clientUrls[0]}/reinitialiser-mot-de-passe?jeton=${jeton}`;
  const prenom = decoder(utilisateur.prenom);

  return envoyerMail({
    a: utilisateur.email,
    sujet: 'Réinitialisation de votre mot de passe CoachConnect',
    texte: [
      `Bonjour ${prenom},`,
      '',
      'Vous avez demandé à réinitialiser le mot de passe de votre compte CoachConnect.',
      `Choisissez un nouveau mot de passe en ouvrant ce lien, valable ${VALIDITE_MINUTES} minutes et utilisable une seule fois :`,
      '',
      lien,
      '',
      'Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail : votre mot de passe actuel reste valable.',
    ].join('\n'),
    html: gabarit({
      titre: 'Réinitialisation de votre mot de passe',
      paragraphes: [
        `Bonjour ${echapper(utilisateur.prenom)},`,
        'Vous avez demandé à réinitialiser le mot de passe de votre compte CoachConnect.',
        `Ce lien est valable <strong>${VALIDITE_MINUTES} minutes</strong> et ne peut servir qu’une fois.`,
      ],
      bouton: { lien, libelle: 'Choisir un nouveau mot de passe' },
      notes: [
        `Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>${lien}`,
        'Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail : votre mot de passe actuel reste valable.',
      ],
    }),
  });
}

/**
 * Réinitialisation.
 *
 * LE LIEN EST RÉCLAMÉ AVANT D'ÊTRE UTILISÉ, EN UNE SEULE OPÉRATION. Lire le
 * compte, vérifier le jeton, puis l'effacer laisserait deux requêtes
 * simultanées avec le même lien passer toutes deux la vérification.
 * `findOneAndUpdate` évalue la condition et efface l'empreinte au même
 * instant : une seule des deux trouve encore le lien.
 *
 * Le nouveau mot de passe passe par `save()` : le crochet du modèle le hache,
 * et incrémente `refreshTokenVersion` — TOUTES les sessions ouvertes, y
 * compris celle d'un éventuel intrus, sont révoquées.
 */
export async function reinitialiser(jeton, nouveauPassword) {
  const reclame = await User.findOneAndUpdate(
    {
      'reinitialisation.empreinte': empreinteDe(jeton),
      'reinitialisation.expireLe': { $gt: new Date() },
      isActive: true,
    },
    { $unset: { reinitialisation: 1 } },
    { projection: { _id: 1 } }
  );

  if (!reclame) {
    throw ApiError.badRequest(
      'Ce lien de réinitialisation est invalide ou a expiré. Faites une nouvelle demande.'
    );
  }

  const utilisateur = await User.findById(reclame._id).select('+password');
  utilisateur.password = nouveauPassword;
  await utilisateur.save();

  return utilisateur;
}

/**
 * Prévient la personne que son mot de passe vient de changer.
 *
 * Si ce n'était pas elle, c'est ainsi qu'elle l'apprend — et le seul moyen
 * de réagir vite. L'e-mail ne contient aucun lien d'action : un e-mail
 * d'alerte qui invite à cliquer ressemblerait à de l'hameçonnage.
 */
export function confirmer(utilisateur) {
  const prenom = decoder(utilisateur.prenom);
  return envoyerMail({
    a: utilisateur.email,
    sujet: 'Votre mot de passe CoachConnect a été modifié',
    texte: [
      `Bonjour ${prenom},`,
      '',
      'Le mot de passe de votre compte CoachConnect vient d’être modifié, et toutes vos sessions ont été déconnectées.',
      '',
      'Si vous n’êtes pas à l’origine de ce changement, refaites immédiatement une demande de mot de passe oublié depuis la page de connexion, puis contactez l’assistance.',
    ].join('\n'),
    html: gabarit({
      titre: 'Votre mot de passe a été modifié',
      paragraphes: [
        `Bonjour ${echapper(utilisateur.prenom)},`,
        'Le mot de passe de votre compte CoachConnect vient d’être modifié, et <strong>toutes vos sessions ont été déconnectées</strong>.',
        'Si vous n’êtes pas à l’origine de ce changement, refaites immédiatement une demande de mot de passe oublié depuis la page de connexion, puis contactez l’assistance.',
      ],
    }),
  });
}
