import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * ===========================================================================
 *  NOTIFICATION
 * ===========================================================================
 *
 * Huit événements de l'application peuvent en produire une : suivi, demande
 * de suivi, like, commentaire, demande de chat, message, inscription à un
 * événement, abonnement premium, diplôme vérifié.
 *
 * ILS POINTENT VERS DES CHOSES DE NATURES DIFFÉRENTES — une publication, un
 * commentaire, un événement, une conversation, un profil. D'où la cible
 * polymorphe : un champ par type (`post`, `evenement`, `conversation`…)
 * donnerait un document criblé de `null`, et obligerait chaque lecture à
 * deviner lequel est renseigné.
 */

/**
 * Types de notification.
 *
 * DÉCLARÉS EN CONSTANTE EXPORTÉE, et pas seulement dans l'`enum` du schéma :
 * le service, les validateurs et les tests s'y réfèrent. Recopiée à trois
 * endroits, la liste finirait par diverger — et un type valide côté service
 * serait refusé par le validateur, ou l'inverse.
 */
export const TYPES_NOTIFICATION = [
  'follow',
  'demande_follow',
  'like',
  'commentaire',
  'demande_chat',
  'message',
  'inscription_event',
  'nouvel_abonne_premium',
  'diplome_verifie',
];

/** Natures possibles de la cible, pour le `refPath`. */
export const TYPES_CIBLE = ['Post', 'Comment', 'SportEvent', 'User', 'Conversation'];

const notificationSchema = new Schema(
  {
    destinataire: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /**
     * Qui a déclenché la notification.
     *
     * FACULTATIF, et ce n'est pas un oubli : « votre diplôme a été vérifié »
     * est émis par l'administration, pas par une personne dont on afficherait
     * l'avatar. Rendre le champ obligatoire forcerait à inventer un émetteur.
     */
    emetteur: { type: Schema.Types.ObjectId, ref: 'User' },

    type: {
      type: String,
      enum: TYPES_NOTIFICATION,
      required: true,
    },

    /**
     * Cible polymorphe : `refPath` indique à Mongoose d'aller chercher la
     * collection nommée dans `cibleType`. Un seul `populate('cible')` suffit
     * alors, quel que soit le type.
     */
    cibleType: { type: String, enum: TYPES_CIBLE },
    cible: { type: Schema.Types.ObjectId, refPath: 'cibleType' },

    lu: { type: Boolean, default: false },

    /**
     * Date de lecture — sert au TTL plus bas.
     *
     * On ne peut pas faire expirer sur `updatedAt` : ce champ bouge pour
     * d'autres raisons, et une notification jamais lue ne doit pas
     * disparaître. Il faut une date qui ne soit posée QU'à la lecture.
     */
    luLe: { type: Date },
  },
  { timestamps: true }
);

/* ------------------------------------------------------------------ *
 *  INDEX
 * ------------------------------------------------------------------ */

/*
 * « Mes notifications, les non lues d'abord, les plus récentes en tête. »
 *
 * L'ORDRE DES CLÉS SUIT L'USAGE : égalité sur `destinataire`, filtre sur
 * `lu`, puis tri sur `createdAt`. C'est la règle habituelle — égalité, puis
 * plage, puis tri — et l'inverser rendrait l'index inutilisable pour cette
 * requête, qui est la seule fréquente du module.
 */
notificationSchema.index({ destinataire: 1, lu: 1, createdAt: -1 });

/*
 * PURGE AUTOMATIQUE DES NOTIFICATIONS LUES, après trente jours.
 *
 * Sans elle, la collection croît indéfiniment : un utilisateur actif en
 * produit des milliers par an, et plus personne ne consultera jamais celles
 * d'il y a six mois. C'est le seul endroit du projet où des données
 * s'effacent toutes seules — parce que c'est le seul où elles n'ont aucune
 * valeur passé un délai.
 *
 * `expireAfterSeconds` porte sur `luLe`, qui n'est renseigné qu'à la lecture :
 * une notification jamais lue n'expire donc jamais. MongoDB ignore les
 * documents dont le champ indexé est absent — c'est précisément ce qui rend
 * ce TTL sûr.
 */
notificationSchema.index(
  { luLe: 1 },
  { expireAfterSeconds: 30 * 24 * 3600, name: 'purge_notifications_lues' }
);

/* ------------------------------------------------------------------ *
 *  VUE
 * ------------------------------------------------------------------ */

/**
 * Vue envoyée au client.
 *
 * L'ÉMETTEUR EST RÉDUIT À CE QU'IL FAUT POUR L'AFFICHER : avatar, nom,
 * pseudo. Renvoyer le document complet ferait sortir l'email d'une personne
 * dans une liste que le destinataire n'a même pas demandée nommément — la
 * même règle qu'à la carte du module 8 et à la recherche du module 10.
 *
 * LA CIBLE PEUT ÊTRE `null`, et l'appelant doit s'y attendre : la publication
 * commentée a pu être supprimée entre-temps. On renvoie l'information telle
 * quelle plutôt que de masquer la notification — « quelqu'un a commenté une
 * publication supprimée » reste une information juste.
 */
notificationSchema.methods.versionPublique = function () {
  const emetteur = this.populated('emetteur') ? this.emetteur : null;

  return {
    _id: this._id,
    type: this.type,
    lu: this.lu,
    createdAt: this.createdAt,

    emetteur: emetteur
      ? {
          _id: emetteur._id,
          pseudo: emetteur.pseudo,
          nom: emetteur.nom,
          prenom: emetteur.prenom,
          avatar: emetteur.avatar,
          type: emetteur.type,
        }
      : this.emetteur || null,

    cibleType: this.cibleType,
    // Seul l'identifiant sort : le front construit le lien à partir du type,
    // il n'a pas besoin du document complet — et le charger multiplierait les
    // requêtes par la taille de la liste.
    cible: this.cible?._id || this.cible || null,
  };
};

export const Notification = model('Notification', notificationSchema);
export default Notification;
