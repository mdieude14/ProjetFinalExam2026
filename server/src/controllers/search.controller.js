import { asyncHandler } from '../utils/asyncHandler.js';
import * as searchService from '../services/search.service.js';

/**
 * ===========================================================================
 *  RECHERCHE
 * ===========================================================================
 *
 * Ces contrôleurs sont volontairement minces : toute la difficulté — les deux
 * mécanismes de recherche, les règles de visibilité, le verrou premium — vit
 * dans `search.service.js`. Un contrôleur qui déciderait quoi que ce soit ici
 * ferait exister une seconde version de règles déjà écrites ailleurs.
 */

/* ================================================================== *
 *  GET /api/search/suggestions
 * ================================================================== */

/**
 * Autocomplétion pendant la frappe.
 *
 * ROUTE À PART, ET NON UN PARAMÈTRE DE LA RECHERCHE GÉNÉRALE.
 * Elle n'a ni le même coût, ni la même forme de réponse, ni la même
 * fréquence d'appel : une recherche part quand on valide, une suggestion à
 * chaque poignée de frappes. Les confondre reviendrait à faire payer à
 * chaque frappe le prix d'une recherche complète.
 */
export const suggestions = asyncHandler(async (req, res) => {
  const resultats = await searchService.suggestions(req.query.q, {
    limite: req.query.limite,
  });

  return res.json({ succes: true, nombre: resultats.length, suggestions: resultats });
});

/* ================================================================== *
 *  GET /api/search
 * ================================================================== */

/** Recherche globale : personnes, publications et événements. */
export const globale = asyncHandler(async (req, res) => {
  const resultats = await searchService.globale(req.query.q, req.user, {
    limite: req.query.limite || 6,
  });

  return res.json({
    succes: true,
    terme: req.query.q,
    ...resultats,
    total:
      resultats.utilisateurs.length +
      resultats.publications.length +
      resultats.evenements.length,
  });
});

/* ================================================================== *
 *  GET /api/search/utilisateurs
 * ================================================================== */

export const utilisateurs = asyncHandler(async (req, res) => {
  const resultats = await searchService.utilisateurs(req.query.q, {
    type: req.query.type,
    ville: req.query.ville,
    limite: req.query.limite,
  });

  return res.json({ succes: true, nombre: resultats.length, utilisateurs: resultats });
});

/* ================================================================== *
 *  GET /api/search/publications
 * ================================================================== */

export const publications = asyncHandler(async (req, res) => {
  const resultats = await searchService.publications(req.query.q, req.user, {
    limite: req.query.limite,
  });

  return res.json({ succes: true, nombre: resultats.length, publications: resultats });
});

/* ================================================================== *
 *  GET /api/search/evenements
 * ================================================================== */

export const evenements = asyncHandler(async (req, res) => {
  const resultats = await searchService.evenements(req.query.q, req.user, {
    limite: req.query.limite,
  });

  return res.json({ succes: true, nombre: resultats.length, evenements: resultats });
});
