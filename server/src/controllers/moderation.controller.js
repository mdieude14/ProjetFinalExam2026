import { asyncHandler } from '../utils/asyncHandler.js';
import * as moderation from '../services/moderation.service.js';

/**
 * ===========================================================================
 *  MODÉRATION PERSONNELLE — points d'entrée HTTP
 * ===========================================================================
 *
 * CES CONTRÔLEURS SONT VOLONTAIREMENT MINCES. Toute la difficulté — la
 * transaction du blocage, la rupture des suivis, le silence de la restriction,
 * l'unicité du signalement — vit dans `moderation.service.js`. Un contrôleur
 * qui déciderait quoi que ce soit ici ferait exister une seconde version de
 * règles déjà écrites ailleurs, et c'est celle-là qui finirait par diverger.
 *
 * LE DÉCOUPAGE DES VERBES SUIT L'EFFET, PAS LA COMMODITÉ :
 *
 *   POST   /blocage      pose une relation           DELETE  la retire
 *   POST   /restriction  pose une relation           DELETE  la retire
 *   POST   /signalement  ouvre un dossier            — pas de retrait
 *
 * Un signalement ne se retire pas : il est instruit par l'administration, qui
 * le classe. Le retirer soi-même effacerait la trace d'une alerte que
 * quelqu'un d'autre a peut-être déjà commencé à traiter.
 */

/* ================================================================== *
 *  BLOCAGE
 * ================================================================== */

export const bloquer = asyncHandler(async (req, res) => {
  const resultat = await moderation.bloquer(req.user, req.params.id);

  return res.status(201).json({
    succes: true,
    /*
     * LE MESSAGE EST LE MÊME QUE LE BLOCAGE SOIT NOUVEAU OU DÉJÀ POSÉ.
     * L'action est idempotente (index unique sur le triplet) : dire
     * « c'était déjà fait » n'apporte rien et rendrait un double clic
     * inquiétant. Le détail reste disponible dans `deja` pour l'interface.
     */
    message: 'Compte bloqué',
    deja: resultat.deja,
    suivisRompus: resultat.suivisRompus,
  });
});

export const debloquer = asyncHandler(async (req, res) => {
  const resultat = await moderation.debloquer(req.user, req.params.id);

  return res.json({
    succes: true,
    message: 'Compte débloqué',
    /*
     * ON RAPPELLE QUE LES SUIVIS NE REVIENNENT PAS. C'est la question que
     * l'utilisateur se pose immédiatement après avoir débloqué, et la seule
     * réponse honnête est de le dire avant qu'il ne la cherche.
     */
    suivisRetablis: false,
    existait: resultat.existait,
  });
});

/* ================================================================== *
 *  RESTRICTION
 * ================================================================== */

export const restreindre = asyncHandler(async (req, res) => {
  const resultat = await moderation.restreindre(req.user, req.params.id);

  return res.status(201).json({
    succes: true,
    message: 'Compte restreint',
    deja: resultat.deja,
  });
});

export const leverRestriction = asyncHandler(async (req, res) => {
  const resultat = await moderation.leverRestriction(req.user, req.params.id);

  return res.json({
    succes: true,
    message: 'Restriction levée',
    /*
     * L'INTERFACE DOIT POUVOIR PRÉVENIR que les commentaires déjà en attente
     * le restent. Ils ont été écrits pendant la restriction et n'ont jamais
     * été vus : les publier d'un coup ferait apparaître, sans prévenir, des
     * commentaires que personne n'a approuvés.
     */
    commentairesEnAttenteConserves: true,
    existait: resultat.existait,
  });
});

/* ================================================================== *
 *  SIGNALEMENT
 * ================================================================== */

export const signaler = asyncHandler(async (req, res) => {
  const { deja } = await moderation.signaler(req.user, req.params.id, {
    motif: req.body.motif,
    commentaire: req.body.commentaire,
  });

  /*
   * LE SIGNALEMENT CRÉÉ N'EST JAMAIS RENVOYÉ, même à son auteur.
   *
   * Il porte le champ `statut` et, plus tard, la décision de l'administration.
   * L'exposer ouvrirait une lecture du travail de modération depuis le compte
   * qui a signalé — et, par recoupement, depuis le compte signalé. Seul
   * l'accusé de réception sort d'ici.
   */
  return res.status(201).json({
    succes: true,
    message: 'Signalement transmis à la modération',
    deja,
  });
});

/* ================================================================== *
 *  LISTES ET ÉTAT
 * ================================================================== */

/**
 * État des trois actions vis-à-vis d'un compte.
 *
 * POURQUOI CETTE ROUTE EXISTE ALORS QUE LE PROFIL RENVOIE DÉJÀ L'ÉTAT.
 * Le profil le porte parce qu'il le charge de toute façon. Mais le menu « ⋯ »
 * s'affiche aussi dans une CONVERSATION, qui ne charge aucun profil : sans
 * cette route, la messagerie devrait demander un profil complet — publications
 * comprises — pour trois booléens.
 *
 * ELLE NE DIT RIEN DE L'AUTRE CÔTÉ. Les trois drapeaux sont ORIENTÉS : ils
 * décrivent ce que le demandeur a posé, jamais ce qu'il subit. Répondre
 * « cette personne vous a bloqué » ferait de la route un détecteur de blocage,
 * exactement ce que le 404 de la messagerie sert à éviter.
 */
export const etat = asyncHandler(async (req, res) => {
  const donnees = await moderation.etatModeration(req.user, req.params.id);
  return res.json({ succes: true, moderation: donnees });
});

/** Écran « Comptes bloqués », premier onglet. */
export const mesBloques = asyncHandler(async (req, res) => {
  const comptes = await moderation.listeBloques(req.user);
  return res.json({ succes: true, nombre: comptes.length, comptes });
});

/** Second onglet du même écran. */
export const mesRestreints = asyncHandler(async (req, res) => {
  const comptes = await moderation.listeRestreints(req.user);
  return res.json({ succes: true, nombre: comptes.length, comptes });
});
