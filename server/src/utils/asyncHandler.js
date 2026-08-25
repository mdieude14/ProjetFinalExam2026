/**
 * Enveloppe un controleur asynchrone pour transmettre automatiquement
 * les erreurs au middleware de gestion d'erreurs.
 *
 * Express 4 n'attrape PAS les rejets de promesses : sans ce wrapper, un
 * `await` qui echoue laisse la requete en suspens jusqu'au timeout du client,
 * et il faudrait ecrire un try/catch dans chaque controleur.
 *
 * Avant :
 *   export const getPost = async (req, res, next) => {
 *     try { ... } catch (e) { next(e); }
 *   };
 *
 * Apres :
 *   export const getPost = asyncHandler(async (req, res) => { ... });
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
