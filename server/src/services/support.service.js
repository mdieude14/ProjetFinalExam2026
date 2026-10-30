import Ticket, { referenceDe, PARCOURS } from '../models/Ticket.js';
import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { envoyerMail } from './mail.service.js';

/**
 * ===========================================================================
 *  SUPPORT — règles du journal des tickets
 * ===========================================================================
 *
 * Ce service porte les décisions qui ne doivent exister qu'à un seul endroit :
 * qui peut lire quel ticket, quand un ticket s'escalade, et ce que l'agent a
 * le droit d'écrire dedans. Les contrôleurs traduisent du HTTP ; ces règles
 * n'en dépendent pas et sont appelées aussi par la file de l'exploitant.
 *
 * DEUX ZONES DE CONFIANCE, ET ELLES NE COMMUNIQUENT QUE PAR CETTE COLLECTION.
 * La zone utilisateur — joignable depuis le widget de chat — crée et relit ses
 * propres tickets. La zone exploitant relève ceux qui ont été escaladés. Aucun
 * appel direct d'un agent à l'autre : le lien est asynchrone, et il passe par
 * la base. C'est la même précaution qu'au module 11, où le socket ne peut rien
 * écrire — une seule voie d'écriture, et elle est vérifiable.
 * ===========================================================================
 */

/**
 * DIX MINUTES : LA FENÊTRE OÙ DEUX ENVOIS IDENTIQUES SONT LE MÊME ENVOI.
 *
 * Le parcours « support » crée un dossier à coup sûr. Un double-clic, un
 * rechargement, un « ça n'a pas marché je renvoie » produisent alors deux
 * dossiers pour une seule demande, et l'exploitant répond deux fois à la même
 * personne — ou, pire, deux exploitants se répondent l'un l'autre.
 *
 * POURQUOI DIX ET NON UNE HEURE. Au-delà, un renvoi n'est plus une
 * répétition : c'est une relance, et une relance mérite son dossier. Elle dit
 * quelque chose que le premier ne disait pas — que la personne attend toujours.
 */
export const FENETRE_DOUBLON_MS = 10 * 60 * 1000;

/** Ce qu'un agent ne tranche jamais seul : la liste est fermée à dessein. */
export const MOTIFS_ESCALADE_AUTOMATIQUE = [
  'remboursement',
  'litige_diplome',
  'contestation_moderation',
  'signalement_grave',
];

/**
 * Enregistre un échange avec l'agent.
 *
 * L'AUTEUR VIENT DU JETON, PAS DU CORPS DE LA REQUÊTE. Le contrôleur passe
 * `req.user` ; accepter un identifiant fourni par l'appelant laisserait
 * n'importe qui écrire un ticket au nom d'un autre — et, pire, lire la suite
 * de la conversation de cet autre en relisant le ticket qu'il vient de créer.
 *
 * L'ESCALADE EST DÉCIDÉE ICI, PAS PAR L'AGENT. Un modèle de langage peut se
 * laisser convaincre de ne pas escalader ; une intention `decision` escalade
 * toujours, que l'agent l'ait demandé ou non.
 *
 * CE QUE SEUL L'AGENT PEUT ÉCRIRE. `parAgent` n'est vrai que si la clé
 * d'agent a été présentée (`agentIdentifie`). Sans elle :
 *
 *   - `reponse` et `outils` sont IGNORÉS. L'utilisateur détient le même jeton
 *     que n8n ; les accepter lui permettait d'écrire « l'agent m'a promis un
 *     remboursement » et de le présenter au back-office comme tel ;
 *   - le ticket S'ESCALADE toujours. « Résolu » veut dire que l'agent a
 *     répondu : sans agent, personne n'a répondu, et un ticket classé résolu
 *     finirait dans un onglet que personne ne lit pour agir ;
 *   - `brouillonReponse` est IGNORÉ, pour la même raison que `reponse` : sans
 *     la clé, l'appelant pourrait se préparer un brouillon flatteur et le
 *     présenter au back-office comme la proposition de l'agent.
 *
 * LE BROUILLON N'EXISTE QUE SUR UN DOSSIER ESCALADÉ, et c'est délibéré. Un
 * dossier `resolu` a déjà reçu sa réponse dans le widget : lui attacher un
 * brouillon ferait apparaître, dans l'onglet d'audit, un texte que personne
 * n'est censé valider ni envoyer — et inviterait à envoyer deux fois.
 *
 * ---------------------------------------------------------------------------
 *  L'ESCALADE FORCÉE DU PARCOURS « SUPPORT »
 * ---------------------------------------------------------------------------
 *
 * `parcours: 'support'` ESCALADE TOUJOURS, quelle que soit l'intention lue par
 * le classifieur. La personne a cliqué « Contacter le support client » : elle
 * a demandé un humain, et aucun classement automatique ne doit pouvoir le lui
 * refuser. Un modèle qui lit « je n'arrive pas à résilier » classera
 * raisonnablement `usage` et répondra bien, mais la personne ne demandait pas
 * une réponse : elle demandait l'équipe.
 *
 * LA DÉCISION EST ICI, PAS DANS UNE CONSIGNE DE PROMPT. C'est tout le point de
 * la règle. Écrite dans le prompt, le modèle pourrait l'activer comme la
 * désactiver, et une demande tournée « réponds-moi sans escalader » suffirait
 * à la contourner. Écrite ici, à côté de `intention === 'decision'`, elle est
 * hors de sa portée, exactement au même titre que l'autre.
 *
 * LE CHAMP EST REMPLI PAR LE CLIENT, ET C'EST ACCEPTABLE. Le pire abus
 * possible est UN DOSSIER DE TROP : jamais un accès à une donnée, jamais une
 * décision prise. Le quota de `limiteurEscaladeSupport` borne le volume, et le
 * contrôle anti-doublon ci-dessous écarte la répétition involontaire. C'est le
 * bon compromis : un champ de confort côté client, des bornes côté serveur.
 */
export async function enregistrer(
  utilisateur,
  {
    question,
    origine,
    intention,
    reponse,
    outils,
    motifEscalade,
    brouillonReponse,
    parcours,
    objet,
  },
  { parAgent = false } = {}
) {
  /*
   * LA VALEUR EST RE-VÉRIFIÉE ICI, APRÈS LE VALIDATEUR. Celui-ci borne la
   * route ; le service, lui, est appelé aussi par les tests et le sera demain
   * par un autre canal. Une fonction qui décide d'une escalade ne doit pas
   * dépendre d'un intermédiaire pour savoir ce qu'elle a reçu.
   */
  const voie = PARCOURS.includes(parcours) ? parcours : undefined;
  const sujet =
    voie === 'support' ? String(objet ?? '').trim().slice(0, 120) || undefined : undefined;

  const escaladeForcee = voie === 'support';

  const escalade = !parAgent || escaladeForcee || intention === 'decision' || Boolean(motifEscalade);

  /*
   * TROIS MOTIFS PAR DÉFAUT, UN PAR CAUSE D'ESCALADE. Celui qu'écrit l'agent
   * l'emporte quand il en donne un ; sinon le dossier doit dire POURQUOI il
   * est remonté, et « demande de décision » sur une question d'utilisation
   * envoyée au support client serait faux : l'exploitant croirait à un
   * arbitrage là où il n'y a qu'une personne qui veut parler à quelqu'un.
   */
  const motifParDefaut = !parAgent
    ? 'demande sans agent'
    : escaladeForcee
      ? 'demande au support client'
      : 'demande de décision';

  /*
   * LE DOUBLON SE CHERCHE AVANT D'ÉCRIRE, et seulement sur l'escalade forcée.
   *
   * POURQUOI RENVOYER L'EXISTANT PLUTÔT QUE REFUSER, même raisonnement que
   * pour le canal courriel : un second envoi identique n'est pas une faute de
   * l'appelant, c'est un double-clic ou une relance après une réponse lente.
   * Un 400 obligerait le widget à expliquer une erreur qui n'en est pas une.
   * La personne reçoit la référence du dossier qui existe déjà, ce qui est la
   * vérité : sa demande EST enregistrée.
   *
   * `objet: sujet ?? null` ET NON `objet: sujet` : Mongoose retire d'une
   * requête les clés à `undefined`, et le filtre deviendrait « n'importe quel
   * objet » — deux demandes différentes du même compte seraient alors
   * confondues. `null` interroge bien « champ absent ou nul ».
   *
   * PAS D'INDEX DÉDIÉ. `{ auteur: 1, createdAt: -1 }` existe déjà et porte la
   * sélection ; `objet` et `question` filtrent ensuite le tout petit nombre de
   * dossiers récents de ce compte. Indexer `question` serait d'ailleurs
   * impossible : 2000 signes dépassent la limite de clé de MongoDB.
   */
  if (escaladeForcee) {
    const jumeau = await Ticket.findOne({
      auteur: utilisateur._id,
      escaladeForcee: true,
      objet: sujet ?? null,
      question,
      createdAt: { $gte: new Date(Date.now() - FENETRE_DOUBLON_MS) },
    }).sort({ createdAt: -1 });

    if (jumeau) return { ticket: jumeau, nouveau: false };
  }

  /*
   * MÊME SEUIL DE DIX SIGNES QUE LE CANAL COURRIEL. Un brouillon de trois mots
   * n'est pas un brouillon : il ferait croire à une proposition là où l'agent
   * n'a rien produit, et l'exploitant perdrait son temps à l'ouvrir pour le
   * vider. En dessous, on préfère un textarea franchement vide.
   */
  const propose = parAgent && escalade ? String(brouillonReponse ?? '').trim() : '';
  const avecBrouillon = propose.length >= 10;
  const maintenant = new Date();

  const ticket = await Ticket.create({
    auteur: utilisateur._id,
    roleAuteur: utilisateur.type,
    question,
    origine,
    intention,
    parcours: voie,
    objet: sujet,
    escaladeForcee,
    reponse: parAgent ? reponse : undefined,
    outils: parAgent && Array.isArray(outils) ? outils : [],
    ecritParAgent: parAgent,
    statut: escalade ? 'escalade' : 'resolu',
    motifEscalade: escalade ? motifEscalade || motifParDefaut : undefined,
    escaladeLe: escalade ? maintenant : undefined,
    /*
     * PAS DE `traitePar` ICI, et c'est le même raisonnement que pour le canal
     * courriel : aucun administrateur n'est intervenu, c'est l'agent qui a
     * rédigé. Renseigner ce champ attribuerait le texte à un humain qui ne l'a
     * pas écrit.
     */
    brouillonReponse: avecBrouillon ? propose.slice(0, 4000) : undefined,
    brouillonLe: avecBrouillon ? maintenant : undefined,
    // Le back-office l'affichera comme « proposé par l'agent, à relire ».
    brouillonParAgent: avecBrouillon,
    brouillonOrigine: avecBrouillon ? 'agent' : undefined,
  });

  /*
   * LA FORME DU RETOUR A CHANGÉ, et c'est le prix de l'anti-doublon : le
   * contrôleur doit pouvoir répondre 200 au lieu de 201 quand rien n'a été
   * créé. Même convention que `enregistrerCourriel`, qui a déjà ce besoin —
   * deux formes différentes pour la même information auraient été pires.
   */
  return { ticket, nouveau: true };
}

/**
 * Enregistre une demande arrivée par COURRIEL, avec le brouillon déjà rédigé.
 *
 * POURQUOI LE DOSSIER ET SON BROUILLON EN UNE SEULE ÉCRITURE. Les deux arrivent
 * du même passage de l'assistant : il relève le courriel, rédige, et dépose.
 * En deux appels, une panne entre les deux laisserait un dossier muet dans la
 * file de l'exploitant, sans qu'on sache si la rédaction a échoué ou si elle
 * est simplement en retard.
 *
 * POURQUOI `escalade`, ET PAS `resolu`. C'est ce statut qui met le dossier dans
 * la file de l'exploitant, et c'est lui que relève `aNotifier()` — donc c'est
 * lui, et lui seul, qui déclenche l'alerte Telegram. Un dossier `resolu`
 * n'alerterait personne et attendrait indéfiniment une validation.
 *
 * POURQUOI `traitePar` RESTE VIDE. Personne n'a encore relu ce texte : c'est
 * l'assistant qui l'a écrit. Y poser un administrateur mentirait sur qui a
 * traite le dossier, et `envoyerReponse` l'y inscrira de toute façon au
 * moment de la validation — c'est-à-dire quand ce sera vrai.
 *
 * RIEN NE PART D'ICI. Aucun courriel n'est envoyé par cette fonction : elle
 * dépose un brouillon, et c'est tout. L'expédition passe par `envoyerReponse`,
 * après une validation humaine.
 *
 * LA DÉDUPLICATION SE FAIT ICI, SUR L'IDENTIFIANT DU MESSAGE GMAIL.
 *
 * Elle a été ajoutée le 26 octobre, et elle remplace un garde-fou qui n'en
 * était pas un : la relève écartait les courriels déjà lus (`is:unread`). Or
 * deux courriels de test sont arrivés dans la boîte DÉJÀ marqués lus, sans que
 * personne les ouvre — l'aperçu d'une notification suffit. Le filtre était donc
 * inopérant dans un sens (il masquait des courriels à traiter) et fragile dans
 * l'autre (rien n'empêchait un rejeu).
 *
 * POURQUOI RENVOYER L'EXISTANT PLUTÔT QUE LEVER UNE ERREUR. Un second passage
 * sur le même courriel n'est pas une faute de l'appelant : c'est une relance
 * après panne, un rejeu manuel, une restauration. L'assistant doit pouvoir
 * repasser sans conséquence. Il reçoit alors le dossier déjà créé, et le
 * contrôleur répond `200` au lieu de `201` — ce qui lui dit, sans ambiguïté,
 * que c'était déjà fait.
 *
 * ON NE RÉÉCRIT PAS LE BROUILLON EXISTANT, et c'est important : l'exploitant
 * peut l'avoir modifié, voire déjà envoyé. L'écraser avec une rédaction neuve
 * détruirait son travail en silence.
 */
export async function enregistrerCourriel({ expediteur, sujet, question, brouillon, messageId }) {
  const texte = String(brouillon ?? '').trim();
  if (texte.length < 10) throw ApiError.badRequest('Le brouillon est trop court');

  const reference = String(messageId ?? '').trim();

  /*
   * LECTURE D'ABORD, POUR LE CAS ORDINAIRE. L'index unique est la garantie ; ce
   * test n'est qu'un raccourci qui évite de produire une erreur d'écriture dans
   * le cas de loin le plus fréquent. Les deux sont nécessaires : entre la
   * lecture et l'écriture, deux passages simultanés peuvent se croiser, et
   * c'est alors l'index qui tranche.
   */
  if (reference) {
    const dejaVu = await Ticket.findOne({ messageCourriel: reference });
    if (dejaVu) return { ticket: dejaVu, nouveau: false };
  }

  const maintenant = new Date();

  /*
   * LE SUJET TIENT LIEU D'ORIGINE. Ce champ dit d'où part la question — un
   * écran pour le widget, le sujet du courriel ici. Dans les deux cas il
   * donne à l'exploitant le contexte qui change la réponse, et il évite
   * d'ajouter un champ pour la même fonction.
   */
  try {
    const ticket = await Ticket.create({
      canal: 'courriel',
      courrielAuteur: expediteur,
      messageCourriel: reference || undefined,
      question,
      origine: sujet ? String(sujet).slice(0, 120) : undefined,
      ecritParAgent: true,
      statut: 'escalade',
      motifEscalade: 'demande reçue par courriel',
      escaladeLe: maintenant,
      brouillonReponse: texte.slice(0, 4000),
      brouillonLe: maintenant,
      brouillonParAgent: true,
      brouillonOrigine: 'agent',
      notifieExploitant: false,
    });

    return { ticket, nouveau: true };
  } catch (erreur) {
    /*
     * CODE 11000 : L'INDEX UNIQUE A TRANCHÉ. Deux passages se sont croisés entre
     * la lecture ci-dessus et cette écriture. Ce n'est pas une panne, c'est la
     * garantie qui joue son rôle : on relit le dossier que l'autre vient de
     * créer et on le renvoie, exactement comme si on l'avait trouvé au premier
     * test. Toute autre erreur remonte telle quelle.
     */
    if (erreur?.code === 11000 && reference) {
      const concurrent = await Ticket.findOne({ messageCourriel: reference });
      if (concurrent) return { ticket: concurrent, nouveau: false };
    }
    throw erreur;
  }
}

/**
 * Les tickets d'une personne, du plus récent au plus ancien.
 *
 * Le filtre porte sur `auteur` et rien d'autre : c'est ce qui garantit qu'on
 * ne peut pas lire ceux d'un tiers, même en devinant un identifiant.
 */
export async function mesTickets(idUtilisateur, { saut = 0, limite = 20 } = {}) {
  const [elements, total] = await Promise.all([
    Ticket.find({ auteur: idUtilisateur }).sort({ createdAt: -1 }).skip(saut).limit(limite),
    Ticket.countDocuments({ auteur: idUtilisateur }),
  ]);

  return { elements: elements.map((t) => t.versionAuteur()), total };
}

/**
 * Un ticket précis, à condition qu'il soit le sien.
 *
 * ON RENVOIE 404 ET NON 403 quand le ticket appartient à un autre. Un 403
 * dirait « il existe, mais il n'est pas à vous » et confirmerait donc son
 * existence — même raisonnement qu'au module 9 pour les ressources nominatives.
 */
export async function monTicket(idUtilisateur, idTicket) {
  const ticket = await Ticket.findOne({ _id: idTicket, auteur: idUtilisateur });
  if (!ticket) throw ApiError.notFound('Ticket introuvable');
  return ticket.versionAuteur();
}

/* ================================================================== *
 *  ZONE EXPLOITANT
 * ================================================================== */

/**
 * La file de l'exploitant.
 *
 * LE PLUS RÉCENT D'ABORD PAR DÉFAUT, DEPUIS LE 26 OCTOBRE — et l'ordre
 * inverse reste accessible, parce que les deux ont raison selon l'onglet.
 *
 * CE CODE TRIAIT DU PLUS ANCIEN AU PLUS RÉCENT, avec ce raisonnement, qui
 * tient toujours : « une file d'attente se traite dans l'ordre d'arrivée ;
 * présenter les plus récents en premier laisserait les dossiers anciens au
 * fond indéfiniment. » Il est juste pour « À traiter », qui EST une file.
 *
 * MAIS « Traiter » ET « Non escaladés » NE SONT PAS DES FILES : ce sont des
 * archives, et l'on y vient pour voir ce que l'agent vient de faire. Le même
 * tri sur les trois onglets servait donc mal deux d'entre eux.
 *
 * D'OÙ UN PARAMÈTRE PLUTÔT QU'UN CHOIX IMPOSÉ. Le porteur du projet a demandé
 * le plus récent d'abord : c'est le défaut. L'ordre d'arrivée reste à un clic,
 * et la valeur est bornée par le validateur — un tri qui vient de l'URL ne doit
 * pas pouvoir désigner un champ arbitraire.
 */
export async function file({ statut = 'escalade', saut = 0, limite = 20, ordre = 'recent' } = {}) {
  const filtre = statut === 'tous' ? {} : { statut };

  const [elements, total] = await Promise.all([
    Ticket.find(filtre)
      .populate('auteur', 'pseudo nom prenom type avatar email')
      // Le pseudo de l'instructeur seulement — de quoi écrire « par @… » dans
      // l'historique du back-office, comme pour les signalements.
      .populate('traitePar', 'pseudo')
      .sort({ createdAt: ordre === 'ancien' ? 1 : -1 })
      .skip(saut)
      .limit(limite),
    Ticket.countDocuments(filtre),
  ]);

  return { elements: elements.map((t) => t.versionExploitant()), total };
}

/**
 * Supprime définitivement un dossier clos.
 *
 * SEULS `clos` ET `resolu` SONT SUPPRIMABLES, et ce n'est pas une précaution
 * de forme. Un dossier `escalade` est une demande à laquelle PERSONNE n'a
 * encore répondu : le supprimer ferait disparaître la question de quelqu'un
 * sans que quelqu'un l'ait lue. Un dossier `ouvert` est en cours de traitement
 * par l'agent. Dans les deux cas, la suppression détruirait de l'information
 * que personne n'a encore vue — c'est le seul cas qu'un back-office ne doit
 * jamais permettre d'un clic.
 *
 *   clos    traité par un humain, réponse envoyée
 *   resolu  répondu par l'agent, sans escalade
 *
 * LA VÉRIFICATION EST DANS LE FILTRE DE L'ÉCRITURE, et pas seulement avant.
 * Lire puis supprimer laisserait une fenêtre : un dossier rouvert entre les
 * deux — `envoyerReponse` le fait quand le SMTP échoue — serait supprimé alors
 * qu'il vient de redevenir une demande en attente.
 *
 * ON NE PASSE PAS PAR `deleteOne` SEUL : il faut distinguer « introuvable » de
 * « pas dans un statut supprimable », sans quoi l'exploitant lirait « dossier
 * introuvable » sur un dossier qu'il a sous les yeux.
 */
export async function supprimer(idTicket) {
  const ticket = await Ticket.findById(idTicket).select('statut');
  if (!ticket) throw ApiError.notFound('Dossier introuvable');

  const supprimable = await Ticket.findOneAndDelete({
    _id: idTicket,
    statut: { $in: ['clos', 'resolu'] },
  });

  if (!supprimable) {
    throw ApiError.conflict(
      'Seul un dossier traité ou répondu peut être supprimé. ' +
      'Celui-ci attend encore une réponse.'
    );
  }

  return { reference: referenceDe(supprimable._id), statut: supprimable.statut };
}

/**
 * Ce que l'assistant personnel doit annoncer, et qu'il n'a pas encore annoncé.
 *
 * POURQUOI UN DRAPEAU ET NON UN HORODATAGE DE DERNIÈRE RELÈVE. Un horodatage
 * obligerait l'appelant à se souvenir de son dernier passage, et un redémarrage
 * du workflow rejouerait les notifications ou en sauterait. Le drapeau vit avec
 * le ticket : il ne peut ni se désynchroniser, ni se perdre.
 */
/**
 * LES DOSSIERS DES SUITES DE TESTS NE DOIVENT PAS ALERTER L'EXPLOITANT.
 *
 * LE DÉFAUT QUE CE FILTRE CORRIGE, constaté le 30 octobre 2026.
 *
 * Une suite de tests crée un dossier escaladé, la relève envoie son alerte sur
 * Telegram, puis la suite supprime le dossier en fin de passage. L'exploitant
 * se retrouve avec une alerte **qui ne pointe vers rien** : il y répond, et le
 * bot lui dit qu'aucun dossier ne porte cette référence.
 *
 * C'est exactement ce qui s'est produit avec la référence `bc7b0f49`, auteur
 * `…@supportfront.local` : à l'instant où elle a été lue, le dossier ET le
 * compte avaient disparu. Le porteur du projet a conclu, raisonnablement, que
 * la fonctionnalité ne marchait pas.
 *
 * POURQUOI LE CRITÈRE EST LE DOMAINE RÉSERVÉ, ET NON UN NOM DE COMPTE.
 *
 * `.local`, `.test`, `.invalid` et `.example` sont réservés par les RFC 2606 et
 * 6761 : **aucune adresse réelle ne peut s'y trouver**, et aucun courriel ne
 * peut y être livré. Le critère ne repose donc sur aucune convention de nommage
 * qu'une suite pourrait oublier de suivre — il repose sur une impossibilité.
 *
 * LE FILTRE EST DANS LA REQUÊTE, PAS APRÈS. Filtrer le résultat laisserait les
 * dossiers écartés occuper la fenêtre : triés du plus ancien au plus récent,
 * vingt dossiers de test jamais supprimés bloqueraient toute alerte réelle,
 * pour toujours et sans rien dire.
 *
 * ---------------------------------------------------------------------------
 * ET POURQUOI `inclureReserves` EXISTE, PLUTÔT QU'UN FILTRE INCONDITIONNEL
 * ---------------------------------------------------------------------------
 *
 * Les suites de tests ont, elles, BESOIN de voir leurs propres dossiers par
 * cette route : c'est ainsi qu'elles vérifient que la file de l'exploitant
 * ramène un dossier escaladé et expose son adresse. Or leurs comptes vivent
 * précisément sur des domaines réservés — `@supporttest.local`,
 * `@courrieltest.local`.
 *
 * Un filtre inconditionnel aurait donc fait tomber ces suites, et la tentation
 * aurait été de leur donner un domaine livrable : on aurait alors risqué
 * d'envoyer de vrais courriels à de vraies adresses depuis une campagne.
 *
 * Le drapeau est donc opt-in, et le défaut est le comportement SÛR. La route
 * est en lecture seule et derrière la clé de service : l'exposer ne crée aucun
 * risque, et il rend l'intention explicite aux deux endroits qui appellent —
 * la relève ne le passe pas, les suites le passent.
 */
const DOMAINES_RESERVES = ['local', 'test', 'invalid', 'example'];
const MOTIF_RESERVE = new RegExp(`@[^@]*\\.(${DOMAINES_RESERVES.join('|')})$`, 'i');

export async function aNotifier({ limite = 20, inclureReserves = false } = {}) {
  if (inclureReserves) {
    const tous = await Ticket.find({ statut: 'escalade', notifieExploitant: false })
      .populate('auteur', 'pseudo nom prenom type email')
      .sort({ createdAt: 1 })
      .limit(limite);

    return tous.map((t) => t.versionExploitant());
  }

  /*
   * L'ADRESSE EST À DEUX ENDROITS SELON LE CANAL : sur le compte peuplé pour le
   * widget, dans `courrielAuteur` pour le courriel — où `auteur` est vide par
   * construction. Les deux doivent être examinées, sinon la moitié des dossiers
   * passerait le filtre sans avoir été regardée.
   */
  const candidats = await Ticket.aggregate([
    { $match: { statut: 'escalade', notifieExploitant: false } },
    { $sort: { createdAt: 1 } },
    {
      $lookup: {
        from: User.collection.name,
        localField: 'auteur',
        foreignField: '_id',
        as: 'comptes',
      },
    },
    {
      $addFields: {
        adresse: {
          $ifNull: [{ $arrayElemAt: ['$comptes.email', 0] }, '$courrielAuteur'],
        },
      },
    },
    { $match: { adresse: { $not: MOTIF_RESERVE } } },
    { $limit: limite },
    { $project: { _id: 1 } },
  ]);

  if (candidats.length === 0) return [];

  /*
   * DEUXIÈME REQUÊTE, et c'est voulu : `versionExploitant()` est une méthode du
   * document. Une agrégation rend des objets nus, qui ne la portent pas, et
   * recopier la sérialisation ici la dupliquerait hors de son modèle.
   */
  const tickets = await Ticket.find({ _id: { $in: candidats.map((c) => c._id) } })
    .populate('auteur', 'pseudo nom prenom type email')
    .sort({ createdAt: 1 });

  return tickets.map((t) => t.versionExploitant());
}

/**
 * À QUELLES CONVERSATIONS TELEGRAM UNE ESCALADE DOIT-ELLE PARTIR.
 *
 * LA DESTINATION EST UNE DONNÉE, PLUS UN RÉGLAGE RECOPIÉ À LA MAIN. Elle
 * vivait auparavant dans un champ de l'éditeur n8n, saisi une fois. Un
 * `import:workflow` — qui REMPLACE le workflow par le fichier du dépôt — l'a
 * effacée, et n8n a cessé d'exécuter la relève pendant des heures sans que
 * personne ne le sache : un paramètre requis vide met le workflow « en
 * défaut », et n8n le refuse AVANT de l'exécuter. Aucune erreur visible, aucune
 * escalade annoncée. Ce qui ne peut pas être régénéré ne doit pas vivre dans
 * un workflow.
 *
 * CE QUE CELA RÉVÈLE À LA CLÉ DE SERVICE : des identifiants de conversation
 * Telegram de l'équipe, et rien d'autre. Un tel identifiant n'ouvre rien sans
 * le jeton du bot — celui-là même que n8n détient déjà pour écrire. C'est donc
 * le strict nécessaire à ce que la relève doit faire.
 *
 * SEULS LES ADMINISTRATEURS ACTIFS. Un compte fermé par la modération cesse de
 * recevoir les dossiers, sans qu'il faille penser à le délier ; un compte qui
 * n'est plus de l'équipe non plus.
 */
export async function destinationsTelegram() {
  const equipe = await User.find({
    type: 'admin',
    isActive: true,
    'telegram.conversation': { $exists: true, $ne: null },
  }).select('+telegram.conversation pseudo');

  return equipe
    .map((u) => ({ pseudo: u.pseudo, conversation: String(u.telegram?.conversation ?? '') }))
    .filter((d) => d.conversation.length > 0);
}

/**
 * Marque des tickets comme annoncés.
 *
 * L'ÉCRITURE EST SÉPARÉE DE LA LECTURE, et c'est délibéré. Marquer au moment
 * de la lecture perdrait la notification si l'envoi Telegram échouait ensuite :
 * le ticket serait réputé annoncé sans l'avoir été. L'appelant marque APRÈS
 * avoir eu confirmation de l'envoi.
 */
export async function marquerNotifies(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 0;

  const resultat = await Ticket.updateMany(
    { _id: { $in: ids }, notifieExploitant: false },
    { $set: { notifieExploitant: true } }
  );

  return resultat.modifiedCount;
}

/**
 * Traite un dossier escaladé.
 *
 * Le ticket est CONSERVÉ, jamais supprimé — même choix qu'au module 14 pour
 * les signalements : un dossier classé reste consultable, et l'instructeur
 * reste identifié.
 *
 * UNE DÉCISION HUMAINE NE S'ÉCRASE PAS. Le premier jet ne protégeait que le
 * statut « clos » : un dossier traité en « resolu » pouvait l'être une
 * seconde fois, et la seconde décision remplaçait la première — `traitePar`
 * compris, si bien que l'historique perdait jusqu'à l'identité de celui qui
 * avait tranché. Le critère est donc « un humain a-t-il déjà décidé », pas
 * le statut.
 *
 * LE CONTRÔLE ET L'ÉCRITURE SONT UNE SEULE OPÉRATION. Lire, vérifier puis
 * enregistrer laisserait deux administrateurs validant au même instant
 * passer tous deux la vérification — et le dernier enregistrement
 * l'emporterait. Le filtre de `findOneAndUpdate` est évalué par MongoDB au
 * moment de l'écriture : un seul des deux peut le satisfaire.
 */
export async function trancher(idTicket, administrateur, { decision, statut = 'clos' }) {
  const ticket = await Ticket.findOneAndUpdate(
    // `traitePar: null` couvre le champ absent comme le champ nul.
    { _id: idTicket, traitePar: null, statut: { $ne: 'clos' } },
    {
      $set: {
        statut,
        decision,
        traitePar: administrateur._id,
        traiteLe: new Date(),
      },
    },
    { new: true, runValidators: true }
  );

  if (ticket) return ticket.versionExploitant();

  // Aucun document modifié : il reste à dire pourquoi.
  const existe = await Ticket.exists({ _id: idTicket });
  if (!existe) throw ApiError.notFound('Ticket introuvable');
  throw ApiError.conflict('Ce dossier a déjà été traité');
}

/** Compteurs de la file, pour le back-office et le résumé Telegram. */
export async function statistiques() {
  const parStatut = await Ticket.aggregate([
    { $group: { _id: '$statut', total: { $sum: 1 } } },
  ]);

  const parIntention = await Ticket.aggregate([
    { $match: { intention: { $ne: null } } },
    { $group: { _id: '$intention', total: { $sum: 1 } } },
  ]);

  const enAttente = await Ticket.countDocuments({ statut: 'escalade' });

  return {
    parStatut: Object.fromEntries(parStatut.map((l) => [l._id, l.total])),
    parIntention: Object.fromEntries(parIntention.map((l) => [l._id, l.total])),
    enAttente,
  };
}

/* ================================================================== *
 *  RÉPONDRE À LA PERSONNE — brouillon, puis validation
 * ================================================================== */

/**
 * Retrouve un dossier par sa référence courte, celle qui figure dans le
 * message Telegram.
 *
 * LA RECHERCHE PORTE SUR LES HUIT DERNIERS SIGNES DE L'IDENTIFIANT, comparés
 * côté base. On ne stocke pas la référence dans un champ à part : ce serait
 * une seconde source de vérité à tenir cohérente, et les tickets déjà en base
 * en seraient dépourvus.
 *
 * DEUX DOSSIERS QUI PARTAGERAIENT LA MÊME RÉFÉRENCE SONT REFUSÉS plutôt que
 * départagés au hasard : répondre au mauvais utilisateur serait pire que de
 * demander à l'exploitant de passer par le back-office.
 */
export async function parReference(reference) {
  const cherchee = String(reference ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(cherchee)) throw ApiError.badRequest('Référence invalide');

  const trouves = await Ticket.find({
    $expr: { $eq: [{ $substrCP: [{ $toString: '$_id' }, 16, 8] }, cherchee] },
  })
    .populate('auteur', 'pseudo nom prenom type email')
    .limit(2);

  if (trouves.length === 0) throw ApiError.notFound('Dossier introuvable');
  if (trouves.length > 1) throw ApiError.conflict('Référence ambiguë : passez par le back-office');

  return trouves[0];
}

/** Le même dossier, par son identifiant complet — pour le back-office. */
export async function parIdentifiant(idTicket) {
  const ticket = await Ticket.findById(idTicket).populate('auteur', 'pseudo nom prenom type email');
  if (!ticket) throw ApiError.notFound('Dossier introuvable');
  return ticket;
}

/**
 * Enregistre un brouillon de réponse. Il se réécrit autant de fois qu'on veut.
 *
 * UN DOSSIER DÉJÀ RÉPONDU N'EN ACCEPTE PLUS : une fois le courriel parti, le
 * réécrire ne changerait rien pour la personne, et laisserait croire le
 * contraire.
 */
export async function enregistrerBrouillon(ticket, administrateur, texte, origine = 'back-office') {
  const propre = String(texte ?? '').trim();
  if (propre.length < 10) throw ApiError.badRequest('Le brouillon est trop court');
  if (ticket.reponseEnvoyeeLe) throw ApiError.conflict('Une réponse a déjà été envoyée pour ce dossier');

  /*
   * L'ORIGINE EST IMPOSÉE PAR L'APPELANT, JAMAIS DEVINÉE ICI. Le service ne
   * sait pas par quelle route il a été atteint, et une valeur par défaut qui se
   * tromperait serait pire qu'absente : elle mentirait avec aplomb dans l'écran
   * de modération. `back-office` est le défaut parce que c'est la voie au
   * clavier — celle où l'exploitant regarde le dossier en écrivant.
   */
  const voie = ['agent', 'telegram', 'back-office'].includes(origine) ? origine : 'back-office';

  const maj = await Ticket.findOneAndUpdate(
    { _id: ticket._id, reponseEnvoyeeLe: null },
    {
      $set: {
        brouillonReponse: propre.slice(0, 4000),
        brouillonLe: new Date(),
        traitePar: administrateur._id,
        /*
         * LE TEXTE N'EST PLUS CELUI DE L'AGENT, même si l'exploitant n'a changé
         * qu'un mot. On ne peut pas savoir ce qu'il a conservé, et prétendre
         * « proposé par l'agent » sur un texte relu et modifié serait faux dans
         * le seul sens qui compte : il l'a validé des yeux.
         */
        brouillonParAgent: false,
        brouillonOrigine: voie,
      },
    },
    { new: true, runValidators: true }
  ).populate('auteur', 'pseudo nom prenom type email');

  if (!maj) throw ApiError.conflict('Une réponse a déjà été envoyée pour ce dossier');
  return maj.versionExploitant();
}

/**
 * Valide le brouillon et l'envoie à la personne.
 *
 * L'ÉCRITURE EST ATOMIQUE, et le filtre exige qu'aucune réponse ne soit déjà
 * partie. Deux validations simultanées — une depuis Telegram, une depuis le
 * back-office — ne peuvent donc pas envoyer deux courriels.
 *
 * L'ENVOI A LIEU APRÈS le verrouillage du dossier, jamais avant : si le
 * courriel échoue, le dossier est rouvert par le même chemin, et rien n'a été
 * annoncé à tort.
 */
export async function envoyerReponse(ticket, administrateur) {
  const texte = (ticket.brouillonReponse ?? '').trim();
  if (!texte) throw ApiError.badRequest('Aucun brouillon à envoyer pour ce dossier');

  const maintenant = new Date();
  const verrouille = await Ticket.findOneAndUpdate(
    { _id: ticket._id, reponseEnvoyeeLe: null },
    {
      $set: {
        reponseExploitant: texte,
        reponseEnvoyeeLe: maintenant,
        statut: 'clos',
        traitePar: administrateur._id,
        traiteLe: maintenant,
      },
    },
    { new: true, runValidators: true }
  ).populate('auteur', 'pseudo nom prenom type email');

  if (!verrouille) throw ApiError.conflict('Une réponse a déjà été envoyée pour ce dossier');

  /*
   * DEUX SOURCES POUR L'ADRESSE, ET L'ORDRE COMPTE.
   *
   * Sur le canal `courriel`, c'est l'adresse QUI A ÉCRIT qui fait foi : répondre
   * ailleurs surprendrait la personne, même si un compte portait le même nom.
   * Sur le widget, `courrielAuteur` est vide et seul le compte porte l'adresse.
   *
   * SANS CE REPLI, tout dossier venu du courriel tomberait dans la branche
   * ci-dessous — écrite pour un compte supprimé — et serait CLOS SANS QUE
   * PERSONNE NE REÇOIVE RIEN : statut `clos`, `reponseEnvoyeeLe` posé, et aucun
   * courriel parti. L'exploitant croirait avoir répondu.
   */
  const adresse = verrouille.courrielAuteur || verrouille.auteur?.email;
  if (!adresse) {
    // Compte supprimé entre-temps : le dossier reste clos, rien à envoyer.
    return { ticket: verrouille.versionExploitant(), canal: null };
  }

  let canal;
  try {
    canal = await envoyerMail({
      a: adresse,
      sujet: `Réponse à votre demande — CoachConnect (réf. ${referenceDe(verrouille._id)})`,
      texte,
    });
  } catch (erreur) {
    // L'envoi a échoué : on rouvre, pour que le dossier reparaisse dans la file.
    await Ticket.updateOne(
      { _id: verrouille._id },
      { $set: { statut: 'escalade' }, $unset: { reponseExploitant: 1, reponseEnvoyeeLe: 1, traiteLe: 1 } }
    );
    throw ApiError.internal(`L’envoi du courriel a échoué : ${erreur.message}`);
  }

  await Ticket.updateOne({ _id: verrouille._id }, { $set: { reponseCanal: canal } });
  verrouille.reponseCanal = canal;

  return { ticket: verrouille.versionExploitant(), canal };
}

/**
 * L'auteur a vu, dans le widget, qu'une réponse lui était partie.
 *
 * ON NE MARQUE QUE LES SIENS, et seulement ceux dont une réponse est partie :
 * un identifiant pris au hasard ne peut pas servir à sonder les dossiers des
 * autres — la réponse est la même, qu'il existe ou non.
 */
export async function marquerVueParAuteur(idAuteur, idTicket) {
  await Ticket.updateOne(
    { _id: idTicket, auteur: idAuteur, reponseEnvoyeeLe: { $ne: null }, vueParAuteurLe: null },
    { $set: { vueParAuteurLe: new Date() } }
  );
  return true;
}
