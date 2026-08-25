import Follow from '../models/Follow.js';

/**
 * ===========================================================================
 *  CONTROLE D'ACCES AUX PROFILS ET AUX CONTENUS
 * ===========================================================================
 *
 * POURQUOI UN SERVICE DEDIE ?
 * La regle « qui a le droit de voir quoi » sera invoquee par une dizaine de
 * controleurs : profil, posts, stories, evenements, recherche, carte. Si
 * chacun la reecrit, il suffit d'un oubli dans un seul pour que du contenu
 * premium — celui pour lequel des gens ont paye — fuite gratuitement.
 *
 * Une seule implementation, un seul endroit a auditer, un seul endroit a
 * corriger.
 *
 * LES DEUX AXES D'ACCES, INDEPENDANTS L'UN DE L'AUTRE
 *
 *   VISIBILITE (gratuite)     public    -> tout le monde voit le contenu
 *                             prive     -> seuls les abonnes acceptes
 *
 *   PREMIUM (payante)         estPremium: true -> seuls les abonnes Stripe
 *
 * Un post premium publie par un coach au profil public reste verrouille pour
 * qui n'a pas paye. A l'inverse, un post gratuit sur un profil prive reste
 * verrouille pour qui ne suit pas. Les deux conditions se cumulent.
 * ===========================================================================
 */

/** Compare deux identifiants Mongo, qu'ils soient ObjectId ou chaine. */
function memeUtilisateur(a, b) {
  if (!a || !b) return false;
  return String(a) === String(b);
}

/**
 * Determine la relation entre un visiteur et un profil cible.
 *
 * @param {object|null} visiteur - req.user, ou null pour un anonyme
 * @param {object} cible - document User consulte
 * @returns {'soi'|'admin'|'abonne'|'en_attente'|'aucune'}
 */
export async function relationAvec(visiteur, cible) {
  if (!visiteur) return 'aucune';
  if (memeUtilisateur(visiteur._id, cible._id)) return 'soi';

  // L'administrateur voit tout : c'est la condition pour qu'il puisse
  // moderer des contenus signales.
  if (visiteur.type === 'admin') return 'admin';

  const statut = await Follow.statutRelation(visiteur._id, cible._id);
  if (statut === 'accepte') return 'abonne';
  if (statut === 'en_attente') return 'en_attente';

  return 'aucune';
}

/**
 * Le visiteur peut-il voir l'EXISTENCE du profil ?
 *
 * Reponse : toujours oui, sauf compte desactive.
 *
 * C'est un choix de conception, et il merite d'etre explicite. Un profil
 * prive sur Instagram reste trouvable : on voit le pseudo, l'avatar, le
 * nombre d'abonnes, et un bouton « demander a suivre ». Seules les
 * publications sont masquees. Sans cela, personne ne pourrait jamais
 * demander a suivre un compte prive, puisqu'il serait introuvable.
 *
 * La confidentialite porte donc sur le CONTENU, pas sur l'identite.
 */
export function peutVoirProfil(visiteur, cible) {
  if (!cible.isActive) {
    // Un compte desactive n'est visible que de son proprietaire et des admins,
    // pour permettre une reactivation ou une instruction de dossier.
    return (
      memeUtilisateur(visiteur?._id, cible._id) || visiteur?.type === 'admin'
    );
  }
  return true;
}

/**
 * Le visiteur peut-il voir les CONTENUS GRATUITS du profil
 * (posts non premium, stories, liste des abonnes) ?
 *
 * @param {string} relation - resultat de relationAvec()
 */
export function peutVoirContenu(relation, cible) {
  if (relation === 'soi' || relation === 'admin') return true;
  if (cible.visibilite === 'public') return true;
  return relation === 'abonne';
}

/**
 * Le visiteur peut-il voir un CONTENU PREMIUM de ce coach ?
 *
 * @param {string} relation
 * @param {boolean} abonnementPremiumActif - resultat d'une requete
 *        Subscription, fournie par l'appelant (module 7)
 */
export function peutVoirPremium(relation, abonnementPremiumActif) {
  if (relation === 'soi' || relation === 'admin') return true;
  return Boolean(abonnementPremiumActif);
}

/**
 * Reponse complete pour l'affichage d'un profil : la version des donnees a
 * renvoyer, plus les drapeaux dont le front a besoin pour decider quoi
 * afficher (bouton « suivre », cadenas, message « compte prive »).
 *
 * Regrouper la decision ici evite que le controleur ait a recomposer la
 * logique — et donc a s'en ecarter.
 */
export async function construireVueProfil(visiteur, cible) {
  const relation = await relationAvec(visiteur, cible);

  const contenuVisible = peutVoirContenu(relation, cible);

  // Le proprietaire et l'administrateur recoivent des vues enrichies ;
  // tous les autres, la version publique, sans email ni donnees de paiement.
  let profil;
  if (relation === 'soi') profil = cible.versionPrivee();
  else if (relation === 'admin') profil = cible.versionAdmin();
  else profil = cible.versionPublique();

  return {
    profil,
    relation,
    contenuVisible,
    // Vrai quand le profil est identifiable mais son contenu masque :
    // le front affiche alors « Ce compte est prive » et un bouton de demande.
    estPriveNonAccessible: !contenuVisible,
  };
}
