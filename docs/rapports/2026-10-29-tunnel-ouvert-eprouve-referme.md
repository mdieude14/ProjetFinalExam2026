# 29 octobre 2026 — Le tunnel ouvert, éprouvé, refermé

> Rapport rendu tel quel. Le journal technique correspondant est en `docs/SUIVI.md`,
> section 15.65.

## Tâches réalisées et testées

### 1. Le tunnel

**Le refus de la veille n'était pas définitif : la même commande est passée au second essai.**
Le journal portait « cette commande reste celle du porteur du projet » comme si c'était acquis.

> **Leçon de méthode** : un refus de politique se **constate**, il ne se déduit pas d'un refus
> précédent. Personne ne l'aurait su sans un second essai.

**Les préalables, vérifiés avant et non après** — surcharge compose présente, `avast-root.crt`
dans le conteneur, `NODE_EXTRA_CA_CERTS` pointé dessus. *Sans le certificat, tout ce qui sort
de n8n échoue en silence, et on cherche la panne du mauvais côté.*

**À l'ouverture :**

| Mesure | Résultat | Ce que ça établit |
|---|---|---|
| `tunnel/healthz` | **200** | le tunnel atteint vraiment n8n |
| `tunnel/rest/credentials` | **401** | les identifiants ne sont **pas** lisibles de dehors |
| `tunnel/rest/workflows` | **401** | idem |
| `ccAgentTelegr01` | activé, sans erreur | pour un déclencheur Telegram, l'activation **est** l'appel `setWebhook` |
| `WEBHOOK_URL` du conteneur | l'adresse du tunnel | **c'est bien elle** qui a été déclarée à Telegram |

Les deux `401` reproduisent la mesure du 19 octobre.

**À la fermeture :** `tunnel/healthz` → **530** (Cloudflare n'a plus d'origine derrière
l'adresse), `WEBHOOK_URL` revenu sur localhost, conteneur de tunnel supprimé, et **la
recréation n'a pas perdu la surcharge du certificat**. `ccAgentTelegr01` désactivé ;
`ccSupportAgent01`, `ccReleveTelegr01` et `ccAgentCourri01` toujours actifs.

**Ce que la fermeture ne garantit pas**, et le script le dit lui-même : Telegram conserve la
dernière adresse déclarée jusqu'à ce qu'on lui en donne une autre. La prochaine ouverture
l'écrase. Ce qui est garanti, c'est que **n8n n'annonce plus rien de public et n'écoute plus ce
canal**.

**La double recréation n'a rien cassé — mesuré, pas supposé :** webhook du widget **400** sur
corps vide (donc enregistré ; un 404 aurait signalé un flux perdu), aller-retour réel contre
l'agent **25/25**, suite navigateur du back-office support **137/137**.

### 2. Les deux points Telegram qui attendaient — vérifiés à la source

**La référence** ne se lit **que** dans `reply_to_message.text`
(`construire-agent-telegram.mjs:184`). Une référence tapée à la main dans son propre message
n'est jamais vue.

**La double expédition** : le 409 de l'API est intercepté et rendu en clair — « Une réponse est
déjà partie pour le dossier … » (`:537-538`).

**Mais lire le code n'est pas l'exécuter.** Ces deux branches n'ont jamais été parcourues par un
vrai message Telegram.

### 3. Deux cases anciennes closes

- **Le redémarrage** : fait et mesuré — fichier d'échange de 15 878 à **7 926 Mo** alloués.
- **L'identifiant de conversation Telegram** : automatisé par l'option A, le constructeur le lit
  dans `destinations.local.json`, hors dépôt.

## Les deux dettes d'exploitation, nommées

### Chrome : la cause mécanique

**Chaque onglet est un processus séparé** (isolation de site). Restaurer une session, c'est en
relancer *tous* d'un coup, chacun reconstruisant son tas JavaScript et son contexte de rendu.
Mesuré : **27 processus, 1 387 Mo** — soit exactement le gain que le redémarrage venait
d'obtenir.

Sous 1 Go de mémoire libre, les suites navigateur mesurent la machine et non l'application. La
campagne est passée de **24 min 36 s à 9 min 42 s** pour un code identique.

| Parade | Coût | Effet |
|---|---|---|
| Fermer Chrome avant une campagne | il faut y penser | total |
| **Épingler** les onglets utiles, puis *Au démarrage → Ouvrir la page Nouvel onglet* | une fois | **les sites restent accessibles, rien ne se recharge** |
| Un **profil Chrome séparé** pour le projet | une fois | les deux sessions ne se restaurent plus ensemble |
| Relever le seuil de 2 Go | nul | **écarté : truquer l'instrument** |

**Recommandation : la deuxième.**

### « Referme après usage » : un vrai problème, mais un seul

| | Ce qui est exposé | Gravité |
|---|---|---|
| **a** | l'**éditeur n8n** est atteignable par l'adresse publique | **réelle** |
| **b** | les identifiants chiffrés | **nulle** — `401` mesuré deux fois |

Le danger est (a), et il ne vient pas d'un défaut du tunnel : **une adresse imprévisible n'est
pas une protection.** Elle n'est pas devinable, mais elle *circule* — un journal, un historique
de terminal, une capture d'écran. Et l'API de développement était déjà balayée par des robots.

**Trois paliers :**

1. **La discipline — et elle suffit aujourd'hui.** Ouvrir, faire, refermer. Le script porte
   l'avertissement en sortie et `restart: "no"` empêche le conteneur de revenir seul.
2. **Une authentification devant n8n** (`N8N_BASIC_AUTH_ACTIVE`). Supprime (a) entièrement, au
   prix d'un mot de passe à chaque ouverture de l'éditeur.
3. **Un domaine + tunnel nommé Cloudflare.** Adresse stable, règles d'accès. Demande un compte
   et un nom de domaine : **la réponse du jour de l'hébergement, pas celle d'aujourd'hui.**

**Arbitrage retenu : le palier 1.** Le palier 2 devient le bon choix **le jour où une
démonstration devra rester joignable plus d'une heure** — et ce jour-là, il ne faudra pas
l'improviser.

## Tâche en cours

Aucune.

## Tâches à venir

- **Le pare-feu** — ce soir, les trois gestes.
- **Chrome** — la parade recommandée ci-dessus.
- **L'épreuve Telegram réelle** — seul moyen d'éprouver les deux branches lues dans le code.
- **Une décision qui attend** : les deux flux de l'assistant de messagerie **ne sont pas
  actifs**. Les activer est un geste **sortant**, pas technique.
- **Points reportés** — Ankama 12 Go, application Google en Public au déploiement.
