import User from '../models/User.js';
import Post from '../models/Post.js';
import SportEvent from '../models/SportEvent.js';
import { motifPrefixe, normaliser } from '../utils/texte.js';
import { idsSuivis, abonnementsPremiumActifs, aAccesPremium } from './feed.service.js';

/**
 * ===========================================================================
 *  RECHERCHE
 * ===========================================================================
 *
 * DEUX MÉCANISMES, ET ILS NE RÉPONDENT PAS À LA MÊME QUESTION.
 *
 *   suggestions()   « je tape, propose-moi »  -> préfixe, indexé, très rapide,
 *                                                très peu de résultats
 *   utilisateurs()  « j'ai validé, cherche »  -> `$text`, mots entiers,
 *                                                classement par pertinence
 *
 * Vouloir n'en garder qu'un mène à une impasse : `$text` ne trouve pas de
 * préfixe (« mar » ne donne jamais « Martin »), et une recherche par préfixe
 * ne sait ni classer par pertinence ni chercher un mot au milieu d'un texte.
 *
 * LA RECHERCHE NE DOIT JAMAIS DEVENIR UNE PORTE DÉROBÉE. Tout ce que les
 * modules 4, 7 et 9 ont fermé reste fermé ici : comptes désactivés absents,
 * publications premium verrouillées, adresses d'événements privés retirées.
 * On ne réécrit aucune de ces règles — on appelle celles qui existent.
 * ===========================================================================
 */

/** Nombre de résultats par défaut, et plafond dur. */
const LIMITE_DEFAUT = 20;
const LIMITE_MAX = 50;
const LIMITE_SUGGESTIONS = 8;

const borner = (valeur, defaut, max) =>
  Math.min(Math.max(Number(valeur) || defaut, 1), max);

/* ================================================================== *
 *  AUTOCOMPLÉTION
 * ================================================================== */

/**
 * Suggestions pendant la frappe.
 *
 * POURQUOI SI PEU DE RÉSULTATS, ET POURQUOI C'EST VOULU.
 * Une liste déroulante de suggestions n'est pas une page de résultats : elle
 * doit tenir sous le champ de saisie et se lire d'un coup d'œil. Huit
 * entrées, pas davantage — au-delà, il vaut mieux valider la recherche.
 *
 * Le tri se fait sur le nombre d'abonnés : à préfixe égal, le compte le plus
 * suivi est presque toujours celui que l'on cherchait. C'est un classement
 * grossier, mais il ne coûte rien de plus, et l'alternative — l'ordre naturel
 * de la base — n'a aucun sens pour l'utilisateur.
 *
 * @param {string} saisie
 * @returns {Promise<Array>} vues publiques allégées
 */
export async function suggestions(saisie, { limite = LIMITE_SUGGESTIONS } = {}) {
  const motif = motifPrefixe(saisie);
  if (!motif) return [];

  const utilisateurs = await User.find({
    isActive: true,
    termesRecherche: motif,
  })
    .select('pseudo nom prenom avatar type diplome stats ville')
    .sort({ 'stats.followersCount': -1 })
    .limit(borner(limite, LIMITE_SUGGESTIONS, 20));

  return utilisateurs.map((u) => ({
    _id: u._id,
    pseudo: u.pseudo,
    nom: u.nom,
    prenom: u.prenom,
    avatar: u.avatar,
    type: u.type,
    ville: u.ville,
    estCertifie: u.estCertifie,
    followersCount: u.stats?.followersCount || 0,
  }));
}

/* ================================================================== *
 *  RECHERCHE VALIDÉE
 * ================================================================== */

/**
 * Recherche d'utilisateurs.
 *
 * `$text` D'ABORD, PRÉFIXE EN FILET.
 * Une recherche validée porte le plus souvent sur un mot entier — un pseudo,
 * un nom —, et `$text` la sert avec un score de pertinence que les poids de
 * l'index orientent (le pseudo vaut dix, le prénom et le nom trois). Mais
 * quelqu'un qui valide « mar » sans finir son mot n'obtiendrait rien du tout.
 * On complète donc par le même préfixe que l'autocomplétion, et l'on fusionne.
 *
 * L'ORDRE DE FUSION N'EST PAS ANODIN : les résultats de `$text`, classés par
 * pertinence, passent devant. Les résultats de préfixe comblent la suite sans
 * jamais déloger un résultat mieux noté.
 *
 * UN PROFIL PRIVÉ RESTE TROUVABLE. C'est la règle posée au module 4 : la
 * confidentialité porte sur le contenu, pas sur l'identité. Sans cela,
 * personne ne pourrait demander à suivre un compte privé, puisqu'il serait
 * introuvable. Seule sa version publique sort d'ici.
 */
export async function utilisateurs(saisie, { type, ville, limite = LIMITE_DEFAUT } = {}) {
  const requis = { isActive: true };
  if (type) requis.type = type;
  if (ville) requis.ville = new RegExp(`^${normaliser(ville).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

  const plafond = borner(limite, LIMITE_DEFAUT, LIMITE_MAX);

  /*
   * `score` n'existe que dans une requête `$text` : le demander ailleurs
   * lève « $meta textScore requires a $text query ». Les deux branches sont
   * donc bâties séparément, et non par un filtre conditionnel commun.
   */
  const parTexte = await User.find(
    { ...requis, $text: { $search: saisie } },
    { score: { $meta: 'textScore' } }
  )
    .select('pseudo nom prenom avatar bio type ville sports diplome premium stripeAccount stats visibilite createdAt')
    .sort({ score: { $meta: 'textScore' } })
    .limit(plafond);

  const motif = motifPrefixe(saisie);
  const parPrefixe = motif
    ? await User.find({ ...requis, termesRecherche: motif })
        .select('pseudo nom prenom avatar bio type ville sports diplome premium stripeAccount stats visibilite createdAt')
        .sort({ 'stats.followersCount': -1 })
        .limit(plafond)
    : [];

  return fusionner([parTexte, parPrefixe], plafond).map((u) => u.versionPublique());
}

/**
 * Recherche de publications.
 *
 * DEUX FILTRES SE CUMULENT, ET AUCUN NE REMPLACE L'AUTRE :
 *
 *   1. la VISIBILITÉ du profil de l'auteur — une publication d'un compte
 *      privé ne sort que pour ses abonnés acceptés ;
 *   2. le verrou PREMIUM — une publication payante sort, mais amputée de sa
 *      description et de ses médias.
 *
 * Le second est délégué à `versionPour()` du module 5, qui retire les URL de
 * la RÉPONSE et pas seulement de l'écran. Le premier se règle en amont, en
 * restreignant les auteurs interrogeables : filtrer après coup obligerait à
 * charger des documents pour les jeter, et fausserait le compte de résultats.
 */
export async function publications(saisie, visiteur, { limite = LIMITE_DEFAUT } = {}) {
  const plafond = borner(limite, LIMITE_DEFAUT, LIMITE_MAX);

  const auteursAutorises = await auteursVisiblesPar(visiteur);

  const posts = await Post.find(
    { auteur: { $in: auteursAutorises }, $text: { $search: saisie } },
    { score: { $meta: 'textScore' } }
  )
    .sort({ score: { $meta: 'textScore' } })
    .limit(plafond)
    .populate('auteur', 'pseudo nom prenom avatar type diplome');

  const abonnements = await abonnementsPremiumActifs(visiteur?._id);

  return posts.map((post) =>
    post.versionPour(
      visiteur,
      aAccesPremium(visiteur, post.auteur?._id || post.auteur, abonnements)
    )
  );
}

/**
 * Recherche d'événements à venir.
 *
 * ON NE RAMÈNE PAS LE PASSÉ. Un événement terminé n'est pas un résultat :
 * personne ne cherche une sortie de l'an dernier. Le filtre porte sur
 * `dateFin`, comme au module 9 — une séance commencée ce matin et courant
 * jusqu'à ce soir est encore d'actualité à midi.
 */
export async function evenements(saisie, visiteur, { limite = LIMITE_DEFAUT } = {}) {
  const plafond = borner(limite, LIMITE_DEFAUT, LIMITE_MAX);

  const trouves = await SportEvent.find(
    { dateFin: { $gte: new Date() }, $text: { $search: saisie } },
    { score: { $meta: 'textScore' } }
  )
    .sort({ score: { $meta: 'textScore' } })
    .limit(plafond)
    .populate('organisateur', 'pseudo nom prenom avatar type diplome premium');

  const abonnements = await abonnementsPremiumActifs(visiteur?._id);

  return trouves.map((evenement) => {
    const idOrga = evenement.organisateur?._id || evenement.organisateur;
    return evenement.versionPour(
      visiteur,
      aAccesPremium(visiteur, idOrga, abonnements)
    );
  });
}

/**
 * Recherche globale — les trois familles d'un coup.
 *
 * LES TROIS REQUÊTES PARTENT EN PARALLÈLE. Enchaînées, l'écran d'ensemble
 * attendrait la somme des trois latences alors qu'aucune ne dépend des
 * autres. `Promise.all` ramène l'attente à celle de la plus lente.
 */
export async function globale(saisie, visiteur, { limite = 6 } = {}) {
  const [personnes, posts, evts] = await Promise.all([
    utilisateurs(saisie, { limite }),
    publications(saisie, visiteur, { limite }),
    evenements(saisie, visiteur, { limite }),
  ]);

  return { utilisateurs: personnes, publications: posts, evenements: evts };
}

/* ================================================================== *
 *  OUTILS INTERNES
 * ================================================================== */

/**
 * Identifiants des auteurs dont le visiteur peut voir les publications.
 *
 * Un compte public est ouvert à tous ; un compte privé ne l'est qu'à ses
 * abonnés acceptés, à lui-même et à l'administration. On construit donc
 * l'ensemble autorisé AVANT d'interroger les publications.
 *
 * L'administrateur n'est pas restreint : c'est la condition pour qu'il puisse
 * retrouver un contenu signalé, quel que soit le compte qui l'héberge.
 */
async function auteursVisiblesPar(visiteur) {
  if (visiteur?.type === 'admin') {
    return User.distinct('_id', { isActive: true });
  }

  const publics = await User.distinct('_id', {
    isActive: true,
    visibilite: 'public',
  });

  if (!visiteur) return publics;

  // Les comptes privés que le visiteur suit, plus le sien.
  const suivis = await idsSuivis(visiteur._id);

  return [...publics, ...suivis, visiteur._id];
}

/**
 * Fusionne plusieurs listes de documents en supprimant les doublons.
 *
 * L'ORDRE DES LISTES PORTE LA PRIORITÉ : le premier passage l'emporte, donc
 * un document déjà classé par pertinence ne sera pas repoussé par sa seconde
 * apparition dans la liste de repli.
 */
function fusionner(listes, plafond) {
  const vus = new Set();
  const resultat = [];

  for (const liste of listes) {
    for (const document of liste) {
      const cle = String(document._id);
      if (vus.has(cle)) continue;

      vus.add(cle);
      resultat.push(document);

      if (resultat.length >= plafond) return resultat;
    }
  }

  return resultat;
}
