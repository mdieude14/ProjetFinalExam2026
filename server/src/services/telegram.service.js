import { createHash, randomInt } from 'node:crypto';

import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import EventRegistration from '../models/EventRegistration.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * ===========================================================================
 *  RATTACHEMENT TELEGRAM — une conversation, un compte (module 15)
 * ===========================================================================
 *
 * LE SENS DU LIEN EST TOUTE LA SÉCURITÉ. Un compte Telegram ne prouve rien de
 * l'identité d'un utilisateur de CoachConnect : n'importe qui peut écrire au
 * bot. Le rattachement part donc de l'APPLICATION, où la personne est
 * connectée : elle y génère un code, puis l'envoie au bot. Présenter le code,
 * c'est prouver qu'on tenait la session au moment où il a été affiché.
 *
 * LE CODE SUIT LE MODÈLE DE LA RÉINITIALISATION DU MOT DE PASSE :
 *   - l'empreinte seule est stockée, jamais le code ;
 *   - il sert une fois, et sa consommation est atomique ;
 *   - il expire vite : dix minutes, le temps d'ouvrir Telegram.
 *
 * CE QUE LE BOT PEUT LIRE ENSUITE EST VOLONTAIREMENT ÉTROIT : les abonnements
 * premium et les prochaines inscriptions, avec le seul pseudo des coachs.
 * Aucune donnée financière — ni montant, ni revenus, ni compte Stripe — et
 * aucune adresse. Une conversation Telegram vit sur un téléphone qui se prête
 * et se perd ; ce qui s'y affiche doit pouvoir être vu par-dessus l'épaule.
 * ===========================================================================
 */

/*
 * TRENTE-DEUX SIGNES, SANS LES AMBIGUS. Ni 0 ni O, ni 1 ni I : le code est
 * recopié à la main d'un écran à l'autre. Huit signes donnent 32^8, soit plus
 * de mille milliards de combinaisons pour une fenêtre de dix minutes, et le
 * bot plafonne chaque conversation à quinze messages par heure.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LONGUEUR = 8;
const VALIDITE_MS = 10 * 60 * 1000;

const empreinte = (code) => createHash('sha256').update(code).digest('hex');

/** « abcd-2345 », « ABCD 2345 » et « abcd2345 » désignent le même code. */
export const normaliserCode = (code) => String(code ?? '').toUpperCase().replace(/[\s-]/g, '');

/**
 * Un code frais pour la personne connectée.
 *
 * En demander un nouveau REMPLACE le précédent : un seul code valide à la
 * fois, comme un seul lien de réinitialisation.
 */
export async function genererCode(idUtilisateur) {
  const code = Array.from({ length: LONGUEUR }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  const expireLe = new Date(Date.now() + VALIDITE_MS);

  await User.updateOne(
    { _id: idUtilisateur },
    { $set: { 'telegram.empreinteCode': empreinte(code), 'telegram.codeExpireLe': expireLe } }
  );

  return { code, expireLe };
}

/** La personne a-t-elle une conversation rattachée ? Jamais laquelle. */
export async function etat(idUtilisateur) {
  const u = await User.findById(idUtilisateur).select('+telegram.conversation +telegram.lieLe');
  return { lie: Boolean(u?.telegram?.conversation), lieLe: u?.telegram?.lieLe ?? null };
}

const SANS_RATTACHEMENT = {
  $unset: {
    'telegram.conversation': 1,
    'telegram.lieLe': 1,
    'telegram.empreinteCode': 1,
    'telegram.codeExpireLe': 1,
  },
};

/** Délier depuis l'application. Retire aussi un code encore en attente. */
export async function delierCompte(idUtilisateur) {
  const r = await User.updateOne({ _id: idUtilisateur }, SANS_RATTACHEMENT);
  return r.modifiedCount > 0;
}

/**
 * Consommer un code envoyé au bot, et rattacher la conversation.
 *
 * UNE SEULE RÉPONSE POUR « INCONNU » ET « EXPIRÉ ». Distinguer les deux dirait
 * à qui tâtonne qu'il est tombé sur un code qui a existé.
 */
export async function lier(code, conversation) {
  const normalise = normaliserCode(code);
  const refus = ApiError.badRequest('Code invalide ou expiré');

  if (normalise.length !== LONGUEUR || ![...normalise].every((c) => ALPHABET.includes(c))) throw refus;

  /*
   * CONSOMMATION ATOMIQUE. Le filtre et l'effacement du code tiennent en une
   * seule opération : deux envois simultanés du même code ne peuvent pas
   * réussir tous les deux. Un compte désactivé ne se rattache pas.
   */
  /*
   * LE FILTRE EXIGE UN COMPTE ADMINISTRATEUR. La route qui fabrique un code le
   * réserve déjà aux administrateurs ; l'exiger ici aussi rend inoffensif un
   * code qui aurait été émis avant cette règle, ou par une autre voie.
   */
  const utilisateur = await User.findOneAndUpdate(
    {
      'telegram.empreinteCode': empreinte(normalise),
      'telegram.codeExpireLe': { $gt: new Date() },
      isActive: true,
      type: 'admin',
    },
    { $unset: { 'telegram.empreinteCode': 1, 'telegram.codeExpireLe': 1 } },
    { new: true }
  );

  if (!utilisateur) throw refus;

  /*
   * UNE CONVERSATION NE SERT QU'UN COMPTE. Si elle était rattachée ailleurs,
   * on l'y détache d'abord — sinon l'index unique refuserait l'écriture, et le
   * code, déjà consommé, serait perdu pour rien.
   */
  await User.updateMany(
    { _id: { $ne: utilisateur._id }, 'telegram.conversation': conversation },
    { $unset: { 'telegram.conversation': 1, 'telegram.lieLe': 1 } }
  );

  try {
    await User.updateOne(
      { _id: utilisateur._id },
      { $set: { 'telegram.conversation': conversation, 'telegram.lieLe': new Date() } }
    );
  } catch (erreur) {
    // Deux comptes qui se disputent la même conversation à la milliseconde.
    if (erreur?.code === 11000) {
      throw ApiError.conflict('Cette conversation vient d’être rattachée ailleurs. Réessayez.');
    }
    throw erreur;
  }

  return { pseudo: utilisateur.pseudo };
}

/** Délier depuis Telegram (`/delier`). */
export async function delierConversation(conversation) {
  const r = await User.updateOne(
    { 'telegram.conversation': conversation },
    { $unset: { 'telegram.conversation': 1, 'telegram.lieLe': 1 } }
  );
  return r.modifiedCount > 0;
}

/**
 * Ce que le bot peut dire du compte rattaché.
 *
 * UN COMPTE DÉSACTIVÉ NE RÉPOND PLUS : la modération qui ferme un compte le
 * ferme aussi sur Telegram, sans qu'il faille penser à délier.
 */
export async function resumeCompte(conversation) {
  const u = await User.findOne({ 'telegram.conversation': conversation, isActive: true, type: 'admin' })
    .select('pseudo type');
  if (!u) throw ApiError.notFound('Aucun compte rattaché à cette conversation');

  const maintenant = new Date();

  const [abonnements, inscriptions] = await Promise.all([
    Subscription.find({ utilisateur: u._id, statut: { $ne: 'incomplete' } })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('coach', 'pseudo'),
    EventRegistration.find({ utilisateur: u._id, statut: 'inscrit' })
      .populate('event', 'titre dateDebut lieu statut'),
  ]);

  return {
    pseudo: u.pseudo,
    type: u.type,
    abonnements: abonnements
      .filter((a) => a.coach)
      .map((a) => ({
        coach: a.coach.pseudo,
        statut: a.statut,
        periodeFin: a.periodeFin ?? null,
        annuleALaFinPeriode: Boolean(a.annuleALaFinPeriode),
      })),
    // Les CINQ prochaines, à venir seulement : un historique complet n'aide
    // pas à répondre, et coûte à chaque question.
    evenements: inscriptions
      .filter((i) => i.event && i.event.dateDebut >= maintenant)
      .sort((a, b) => a.event.dateDebut - b.event.dateDebut)
      .slice(0, 5)
      .map((i) => ({
        titre: i.event.titre,
        dateDebut: i.event.dateDebut,
        ville: i.event.lieu?.ville ?? null,
        statut: i.event.statut,
      })),
  };
}

/**
 * Quel administrateur parle, derrière cette conversation Telegram ?
 *
 * C'EST LA SEULE IDENTITÉ DONT DISPOSE LE BOT. La clé de service prouve que
 * l'appel vient bien de n8n ; elle ne dit pas QUI agit. C'est le rattachement,
 * établi depuis une session administrateur, qui le dit — et lui seul autorise
 * à rédiger ou à envoyer une réponse au nom de l'équipe.
 *
 * UN REFUS PLUTÔT QU'UN SILENCE : une conversation inconnue, un compte
 * désactivé ou un compte qui n'est plus administrateur reçoivent la même
 * réponse, sans distinguer les trois cas.
 */
export async function administrateurDeConversation(conversation) {
  const u = await User.findOne({
    'telegram.conversation': String(conversation ?? ''),
    isActive: true,
    type: 'admin',
  }).select('pseudo type');

  if (!u) throw ApiError.forbidden('Cette conversation n’est rattachée à aucun compte de l’équipe');
  return u;
}
