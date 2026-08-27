import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { lirePagination, reponsePaginee } from '../utils/pagination.js';

import * as notificationService from '../services/notification.service.js';

/**
 * ===========================================================================
 *  NOTIFICATIONS
 * ===========================================================================
 *
 * Contrôleurs volontairement minces : la génération, le regroupement et la
 * diffusion vivent dans `notification.service.js`. Ici, on ne fait que LIRE
 * et MARQUER — jamais créer. Aucune route ne permet de fabriquer une
 * notification, et c'est délibéré : elles naissent d'actions réelles
 * (un like, un message), jamais d'une requête qui le demanderait.
 */

/* ================================================================== *
 *  GET /api/notifications
 * ================================================================== */

export const liste = asyncHandler(async (req, res) => {
  const { page, limite } = lirePagination(req);

  const { notifications, total } = await notificationService.liste(req.user._id, {
    seulementNonLues: req.query.nonLues === 'true',
    page,
    limite,
  });

  const elements = notifications.map((n) => n.versionPublique());

  return res.json(reponsePaginee(elements, total, { page, limite }));
});

/* ================================================================== *
 *  GET /api/notifications/non-lues
 * ================================================================== */

/** Compteur pour la pastille de la navigation. */
export const nonLues = asyncHandler(async (req, res) => {
  const nombre = await notificationService.compterNonLues(req.user._id);
  return res.json({ succes: true, nombre });
});

/* ================================================================== *
 *  PATCH /api/notifications/:id/lu
 * ================================================================== */

export const marquerLu = asyncHandler(async (req, res) => {
  const notification = await notificationService.marquerLu(req.params.id, req.user._id);

  /*
   * UNE NOTIFICATION QUI N'EST PAS LA NÔTRE REÇOIT UN 404, PAS UN 403.
   *
   * Le 403 dirait « elle existe, mais elle ne vous appartient pas » — donc
   * confirmerait l'existence d'une notification chez quelqu'un d'autre. Le
   * 404 ne distingue pas « inexistante » de « pas à vous », et ne révèle
   * donc rien. La nuance est mince ici ; la prendre par défaut évite d'avoir
   * à juger, ressource par ressource, si la fuite est acceptable.
   */
  if (!notification) throw ApiError.notFound('Notification introuvable');

  return res.json({
    succes: true,
    message: 'Notification marquée comme lue',
    notification: notification.versionPublique(),
  });
});

/* ================================================================== *
 *  POST /api/notifications/tout-lu
 * ================================================================== */

export const toutMarquerLu = asyncHandler(async (req, res) => {
  const marquees = await notificationService.toutMarquerLu(req.user._id);

  return res.json({
    succes: true,
    message:
      marquees === 0
        ? 'Aucune notification à marquer'
        : `${marquees} notification${marquees > 1 ? 's' : ''} marquée${marquees > 1 ? 's' : ''} comme lue${marquees > 1 ? 's' : ''}`,
    marquees,
  });
});

/* ================================================================== *
 *  DELETE /api/notifications/:id
 * ================================================================== */

export const supprimer = asyncHandler(async (req, res) => {
  const notification = await notificationService.supprimer(req.params.id, req.user._id);

  if (!notification) throw ApiError.notFound('Notification introuvable');

  return res.json({ succes: true, message: 'Notification supprimée' });
});
