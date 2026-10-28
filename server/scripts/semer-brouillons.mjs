/**
 * ===========================================================================
 *  SEMER LES BROUILLONS MANQUANTS DEPUIS LA RÉPONSE DE L'AGENT (module 15)
 * ===========================================================================
 *
 *   node server/scripts/semer-brouillons.mjs              (constat seul)
 *   node server/scripts/semer-brouillons.mjs --appliquer   (écriture)
 *
 * LE DÉFAUT QU'IL RATTRAPE.
 *
 * Le canal widget écrit `reponse` et jamais `brouillonReponse` : à l'origine,
 * la réponse était DÉJÀ partie dans la fenêtre, il n'y avait rien à faire
 * relire. L'escalade a été greffée ensuite, et personne n'a rebranché le texte
 * vers le brouillon. Résultat : des dossiers escaladés arrivent à l'exploitant
 * avec un textarea vide, alors que le modèle avait écrit une réponse utile
 * quelques lignes plus haut dans le même document.
 *
 * ---------------------------------------------------------------------------
 *  POURQUOI UNE ÉCRITURE, ET NON UN REPLI À LA LECTURE
 * ---------------------------------------------------------------------------
 *
 * Exposer `reponse` comme brouillon dans `versionExploitant()` aurait été plus
 * élégant : rien en base, rien à défaire. Mais `envoyerReponse()` lit
 * `ticket.brouillonReponse` SUR LE DOCUMENT, et refuse en 400 quand il est
 * vide. L'exploitant aurait vu un texte dans son champ, cliqué « envoyer », et
 * reçu « aucun brouillon à envoyer pour ce dossier ». Un pré-remplissage qui
 * ne s'envoie pas est pire que pas de pré-remplissage.
 *
 * ---------------------------------------------------------------------------
 *  CE QUI EST ÉCARTÉ, ET POURQUOI C'EST L'ESSENTIEL DU SCRIPT
 * ---------------------------------------------------------------------------
 *
 * Toutes les `reponse` ne sont pas des brouillons. Trois familles sont des
 * TEXTES FIXES du workflow, pas des rédactions du modèle :
 *
 *   `agent indisponible`  « Je n'ai pas pu traiter votre demande… » — un
 *                         message de panne. Le proposer comme brouillon ferait
 *                         perdre son temps à l'exploitant, qui l'ouvrirait
 *                         pour le vider.
 *   intention `decision`  « Votre demande a bien été transmise à un
 *                         conseiller… » — une notice de transmission. Or
 *                         l'exploitant EST ce conseiller : le brouillon
 *                         s'annoncerait lui-même comme provisoire.
 *   intention `hors_sujet` « Je ne peux vous aider que sur l'utilisation… » —
 *                         un refus, qui n'apprend rien à qui doit répondre.
 *
 * ON NE FILTRE DONC PAS PAR LONGUEUR. Un seuil de signes aurait marché sur les
 * huit dossiers connus et se serait trompé au neuvième : la longueur est une
 * CORRÉLATION de la panne, pas sa définition. On retient les deux intentions
 * où le modèle a réellement rédigé — `usage` et `contextuel` — et rien d'autre.
 *
 * LE SEUIL DE DIX SIGNES RESTE, parce que c'est celui du validateur de l'API
 * et de `enregistrer()` : écrire moins serait refusé ailleurs dans le projet,
 * et les deux côtés doivent s'accorder sur ce qu'est un brouillon.
 *
 * ---------------------------------------------------------------------------
 *  CONSTAT PAR DÉFAUT, ÉCRITURE SUR DEMANDE
 * ---------------------------------------------------------------------------
 *
 * Sans `--appliquer`, le script ne fait que compter et montrer. Une reprise de
 * données qui s'exécute du premier coup ne laisse pas l'occasion de vérifier
 * qu'elle visait les bons documents.
 *
 * IL NE TOUCHE JAMAIS UN BROUILLON EXISTANT. L'exploitant peut l'avoir écrit,
 * modifié, ou déjà envoyé : l'écraser détruirait son travail en silence. Le
 * filtre l'exige explicitement, et il est rejoué à l'écriture.
 * ===========================================================================
 */

import { connecterDB, deconnecterDB } from '../src/config/db.js';
import Ticket from '../src/models/Ticket.js';

const MIN_SIGNES = 10;
const INTENTIONS_REDIGEES = ['usage', 'contextuel'];

const appliquer = process.argv.includes('--appliquer');

/**
 * LE FILTRE, ÉCRIT UNE FOIS ET RÉUTILISÉ.
 *
 * Le constat et l'écriture doivent viser EXACTEMENT le même ensemble. Deux
 * requêtes recopiées auraient divergé au premier ajustement, et le script
 * aurait annoncé un chiffre puis écrit sur un autre.
 */
const filtre = {
  statut: 'escalade',
  ecritParAgent: true,
  intention: { $in: INTENTIONS_REDIGEES },
  reponse: { $exists: true, $ne: null },
  $or: [{ brouillonReponse: { $exists: false } }, { brouillonReponse: null }, { brouillonReponse: '' }],
};

const court = (texte, max = 90) =>
  texte.length > max ? `${texte.slice(0, max - 1).trimEnd()}…` : texte;

await connecterDB();

const candidats = (await Ticket.find(filtre).sort({ createdAt: 1 }).lean()).filter(
  (t) => String(t.reponse ?? '').trim().length >= MIN_SIGNES
);

/*
 * CE QUI EST ÉCARTÉ EST COMPTÉ, PAS SEULEMENT IGNORÉ. Annoncer « 4 dossiers
 * semés » sans dire combien ont été laissés de côté donnerait l'impression
 * d'un rattrapage complet, alors que c'est un rattrapage DÉLIBÉRÉMENT partiel.
 */
const ecartes = await Ticket.countDocuments({
  statut: 'escalade',
  $or: [{ brouillonReponse: { $exists: false } }, { brouillonReponse: null }, { brouillonReponse: '' }],
  intention: { $nin: INTENTIONS_REDIGEES },
});

console.log(`\n=== SEMIS DES BROUILLONS MANQUANTS ===\n`);
console.log(`Dossiers escaladés sans brouillon et rédigés par le modèle : ${candidats.length}`);
console.log(`Écartés (texte fixe : panne, décision, hors sujet)         : ${ecartes}\n`);

if (candidats.length === 0) {
  console.log('Rien à semer.\n');
} else {
  for (const t of candidats) {
    const reference = String(t._id).slice(-8);
    console.log(`  ${reference}  [${t.intention}]  ${court(String(t.reponse).trim())}`);
  }
  console.log('');
}

if (!appliquer) {
  console.log(
    candidats.length > 0
      ? 'CONSTAT SEUL. Relancez avec --appliquer pour écrire ces brouillons.\n'
      : ''
  );
} else if (candidats.length > 0) {
  const maintenant = new Date();
  let semes = 0;

  for (const t of candidats) {
    /*
     * LE FILTRE EST REJOUÉ DANS LA CONDITION D'ÉCRITURE. Entre le constat et
     * cette boucle, l'exploitant peut avoir ouvert le dossier et écrit son
     * propre brouillon : sans cette garde, on l'écraserait.
     */
    const { modifiedCount } = await Ticket.updateOne(
      {
        _id: t._id,
        $or: [
          { brouillonReponse: { $exists: false } },
          { brouillonReponse: null },
          { brouillonReponse: '' },
        ],
      },
      {
        $set: {
          brouillonReponse: String(t.reponse).trim().slice(0, 4000),
          brouillonLe: maintenant,
          // Le back-office affichera « texte proposé par l'agent, à relire ».
          brouillonParAgent: true,
        },
      }
    );
    semes += modifiedCount;
  }

  console.log(`${semes} brouillon(s) semé(s).`);
  if (semes !== candidats.length) {
    console.log(
      `  (${candidats.length - semes} dossier(s) ont reçu un brouillon entre-temps et ont été laissés tels quels)`
    );
  }
  console.log('');
}

await deconnecterDB();
