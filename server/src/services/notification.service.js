import Notification from '../models/Notification.js';
import { diffuserA } from '../sockets/index.js';

/**
 * ===========================================================================
 *  NOTIFICATIONS — POINT DE GÉNÉRATION UNIQUE
 * ===========================================================================
 *
 * POURQUOI CE SERVICE EXISTE, ET POURQUOI RIEN D'AUTRE N'ÉCRIT ICI.
 *
 * Huit endroits du code peuvent produire une notification : un like, un
 * commentaire, un suivi, une demande de suivi, une demande de chat, un
 * message, une inscription à un événement, un abonnement premium. La
 * tentation est d'écrire `Notification.create(...)` dans chacun — c'est
 * direct, et chaque contrôleur sait ce qu'il vient de faire.
 *
 * C'est aussi le moyen d'obtenir HUIT RÈGLES LÉGÈREMENT DIFFÉRENTES. L'un
 * oubliera de vérifier qu'on ne se notifie pas soi-même ; un autre empilera
 * une notification à chaque re-like ; un troisième plantera le jour où
 * l'émetteur est absent. Aucun de ces défauts ne se voit en lisant un seul
 * contrôleur : ils n'apparaissent qu'en les comparant entre eux, c'est-à-dire
 * jamais.
 *
 * Les contrôleurs déclarent une INTENTION ; ce fichier décide de la mécanique.
 * ===========================================================================
 */

/**
 * Fenêtre de regroupement des actions réversibles.
 *
 * Liker, dé-liker, re-liker en trente secondes est un geste d'hésitation, pas
 * trois événements. Au-delà d'une heure, en revanche, il s'agit bien d'une
 * nouvelle attention portée à la publication.
 */
const FENETRE_REGROUPEMENT_MS = 60 * 60 * 1000;

/**
 * Crée une notification.
 *
 * NE LÈVE JAMAIS, ET C'EST UNE DÉCISION.
 * Une notification est un accessoire : elle accompagne une action, elle n'est
 * pas l'action. Si son écriture échoue, le like doit rester, le message doit
 * partir, l'inscription doit tenir. Propager l'erreur ferait échouer une
 * opération réussie à cause de son accessoire — et l'utilisateur verrait
 * « erreur » alors que tout s'est bien passé.
 *
 * L'échec est tracé côté serveur, pas renvoyé à l'appelant.
 *
 * @param {object} p
 * @param {string} p.destinataire   qui reçoit
 * @param {string} [p.emetteur]     qui a déclenché (absent pour l'admin)
 * @param {string} p.type           l'un de TYPES_NOTIFICATION
 * @param {string} [p.cibleType]    'Post' | 'Comment' | 'SportEvent' | ...
 * @param {string} [p.cible]        identifiant de la cible
 * @returns {Promise<object|null>}  la notification, ou null si écartée
 */
export async function creer({ destinataire, emetteur, type, cibleType, cible }) {
  /*
   * ON NE SE NOTIFIE JAMAIS SOI-MÊME — la règle est ici, une seule fois.
   *
   * Aimer sa propre publication, commenter son propre événement, s'abonner à
   * son propre fil : autant de gestes courants qui ne doivent rien produire.
   * Répartie dans les huit appelants, cette vérification serait oubliée dans
   * l'un d'eux, et l'oubli ne se verrait qu'à l'usage.
   */
  if (!destinataire) return null;
  if (emetteur && String(emetteur) === String(destinataire)) return null;

  try {
    const notification = await Notification.create({
      destinataire,
      emetteur,
      type,
      cibleType,
      cible,
    });

    await diffuser(notification);
    return notification;
  } catch (erreur) {
    console.error('[NOTIFICATIONS] Echec de creation :', erreur.message);
    return null;
  }
}

/**
 * Crée une notification, ou rafraîchit la précédente si elle est récente.
 *
 * POUR LES ACTIONS RÉVERSIBLES — like, suivi, inscription à un événement.
 * Sans regroupement, une hésitation produit une pile : « X a aimé votre
 * publication » trois fois de suite parce que la personne a cliqué, changé
 * d'avis, puis recliqué. La liste devient du bruit, et le compteur ment.
 *
 * `findOneAndUpdate` avec `upsert` fait le travail EN UNE OPÉRATION : chercher
 * puis créer laisserait entre les deux la fenêtre où deux clics rapides
 * créent deux documents. C'est le même raisonnement qu'aux modules 9 et 11.
 *
 * La notification regroupée repasse en « non lue » et remonte en tête : c'est
 * bien une attention nouvelle, même si elle porte sur le même objet.
 */
export async function creerOuRegrouper({ destinataire, emetteur, type, cibleType, cible }) {
  if (!destinataire) return null;
  if (emetteur && String(emetteur) === String(destinataire)) return null;

  const depuis = new Date(Date.now() - FENETRE_REGROUPEMENT_MS);

  try {
    const notification = await Notification.findOneAndUpdate(
      {
        destinataire,
        emetteur,
        type,
        cible,
        createdAt: { $gte: depuis },
      },
      {
        $set: { lu: false, createdAt: new Date() },
        // `luLe` doit disparaître : sinon une notification relue puis
        // regroupée resterait exposée à la purge automatique alors qu'elle
        // vient de redevenir non lue.
        $unset: { luLe: '' },
        $setOnInsert: { destinataire, emetteur, type, cibleType, cible },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await diffuser(notification);
    return notification;
  } catch (erreur) {
    /*
     * Deux clics simultanés peuvent faire échouer l'upsert en 11000 : les
     * deux ne trouvent rien, les deux insèrent. Le doublon est exactement ce
     * qu'on voulait éviter, mais l'incident n'a aucune conséquence pour
     * l'utilisateur — on trace et l'on passe.
     */
    console.error('[NOTIFICATIONS] Echec de regroupement :', erreur.message);
    return null;
  }
}

/**
 * Envoie la notification à son destinataire, en direct.
 *
 * RÉUTILISE `diffuserA()` DU MODULE 11 : la salle par utilisateur, les règles
 * d'authentification du socket, la tolérance à l'absence de temps réel — tout
 * est déjà écrit et vérifié. Ouvrir un second mécanisme de diffusion pour les
 * notifications donnerait deux couches à maintenir et deux façons de se
 * tromper de destinataire.
 */
async function diffuser(notification) {
  await notification.populate('emetteur', 'pseudo nom prenom avatar type');

  diffuserA([String(notification.destinataire)], 'notification:nouvelle', {
    notification: notification.versionPublique(),
  });
}

/* ================================================================== *
 *  LECTURE
 * ================================================================== */

/** Notifications d'un utilisateur, les plus récentes en tête. */
export async function liste(idUtilisateur, { seulementNonLues, page = 1, limite = 20 } = {}) {
  const filtre = { destinataire: idUtilisateur };
  if (seulementNonLues) filtre.lu = false;

  const saut = (page - 1) * limite;

  const [notifications, total] = await Promise.all([
    Notification.find(filtre)
      .sort({ createdAt: -1 })
      .skip(saut)
      .limit(limite)
      .populate('emetteur', 'pseudo nom prenom avatar type'),
    Notification.countDocuments(filtre),
  ]);

  return { notifications, total };
}

/** Nombre de notifications non lues — pour la pastille. */
export function compterNonLues(idUtilisateur) {
  return Notification.countDocuments({ destinataire: idUtilisateur, lu: false });
}

/**
 * Marque une notification comme lue.
 *
 * LE FILTRE PORTE AUSSI SUR LE DESTINATAIRE, et pas seulement sur
 * l'identifiant. Sans cela, connaître l'identifiant d'une notification
 * suffirait à la marquer lue chez quelqu'un d'autre — un dégât modeste, mais
 * une écriture sur des données qui ne nous appartiennent pas. La règle vaut
 * pour toute ressource nominative.
 */
export async function marquerLu(idNotification, idUtilisateur) {
  return Notification.findOneAndUpdate(
    { _id: idNotification, destinataire: idUtilisateur },
    { $set: { lu: true, luLe: new Date() } },
    { new: true }
  );
}

/** Marque toutes les notifications comme lues. */
export async function toutMarquerLu(idUtilisateur) {
  const resultat = await Notification.updateMany(
    { destinataire: idUtilisateur, lu: false },
    { $set: { lu: true, luLe: new Date() } }
  );

  return resultat.modifiedCount;
}

/** Supprime une notification — la sienne uniquement. */
export async function supprimer(idNotification, idUtilisateur) {
  return Notification.findOneAndDelete({
    _id: idNotification,
    destinataire: idUtilisateur,
  });
}
