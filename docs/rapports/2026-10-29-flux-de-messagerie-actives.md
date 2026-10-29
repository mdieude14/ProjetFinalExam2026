# 29 octobre 2026 — Les flux de messagerie activés, et le pare-feu qui autorisait déjà tout

> Rapport rendu tel quel. Le journal technique correspondant est en `docs/SUIVI.md`,
> section 15.66.

## Tâches réalisées et testées

### 1. Ce qui manquait n'était pas l'option A

L'option A était **complète**, vérifié fichier par fichier : les deux JSON générés et
`destinations.local.json` ne sont pas suivis par git, l'exemple l'est, et le constructeur lit
l'identifiant dans le fichier local en refusant ce qui n'est pas une conversation privée.

**Ce qui manquait, c'était l'activation.** Les deux flux existaient dans n8n et n'avaient
**jamais tourné**. Vu de l'extérieur cela ressemble à « l'option A n'est pas finie » ; en
réalité la génération marchait et personne n'avait appuyé sur le bouton.

### 2. Le vrai risque, levé avant d'activer

L'autorisation Google expire après sept jours en mode « test », et la saisie datait du
14 octobre — quinze jours. Activer un flux au jeton mort, c'est un échec toutes les quinze
minutes, en silence.

**Le jeton est vivant, et on peut le savoir sans le déchiffrer** : n8n réécrit la ligne du
justificatif à chaque rafraîchissement, et celle du Gmail OAuth2 portait `maj 2026-10-29
02:40:51`. *Une date de mise à jour vaut une preuve de validité, là où lire le secret serait à
la fois interdit et inutile.*

Les deux flux sont sur un **déclencheur horaire de 15 minutes**, pas un webhook : ils ne
dépendent donc pas du tunnel. Lot plafonné à 10 courriels, 20 brouillons par jour, et **un
seul** message Telegram de résumé.

**Activés, et ils tournent** : quatre exécutions, toutes en `success`.

### 3. La campagne est morte de mémoire, et elle a été jetée

Arrêtée à la suite 23 : toutes les suites navigateur butaient sur le même plafond de 86 s et
les trois services répondaient `000`. **0,51 Go de mémoire libre, compression à 631 Mo** — la
machine paginait, et le banc d'essai appelait cela « panne réseau ».

Le back-end n'est jamais mort : son journal montre la relève servie chaque minute pendant tout
l'épisode. Les traces `ws proxy error` du front-end sont bénignes — elles arrivent quand
Playwright ferme une page sur un socket ouvert.

**Épreuves ciblées à la place**, et c'est le bon périmètre : ce qui a changé aujourd'hui ne
touche aucun navigateur.

| Suite | Résultat |
|---|---|
| relève des escalades | **78/78** |
| Telegram et courriel | **267/267** |
| rattachement Telegram | **57/57** |
| assistant de messagerie | **104/104** |
| support par courriel | **56/56** |
| performance | **18/18** |
| navigateur — rattachement | **19/19** |
| chaîne réelle contre l'agent | **25/25** |

**599 vérifications**, dont une suite navigateur : les navigateurs fonctionnent, c'est la
campagne entière qui ne tient pas sous 1 Go.

### 4. Une erreur dans mon outil, pas dans l'application

Mon script d'épreuve affichait les **huit premiers** caractères de l'`_id` ; la référence est
les **huit derniers** (`referenceDe`, `models/Ticket.js:395`). L'agent annonçait
`réf. d9d87805`, mon script imprimait `6ae2bd02`, pour le **même dossier**.

> *Un outil qui affiche une référence ne désignant aucun dossier envoie chercher une panne dans
> l'application alors qu'elle est dans l'outil.*

### 5. Le pare-feu : il autorisait déjà tout, et le test attendait l'inverse

C'est la trouvaille du jour, et ce n'était pas celle qu'on cherchait.

> ⚠️ **CETTE MESURE NE PROUVAIT PAS CE QU'ELLE AFFIRMAIT — rectifié le 29 octobre 2026,
> voir 15.69.** Le pare-feu Hyper-V, qui régit le trafic WSL, porte `LoopbackEnabled : True` :
> la requête d'un conteneur vers l'hôte est traitée comme du **loopback** et ne traverse
> **pas** le filtre de profil. Les trois lignes ci-dessous ne disent donc rien de plus que les
> sockets d'écoute — que l'hôte écoute sur cette adresse. *Croire qu'un conteneur est « un
> autre appareil » a produit une conclusion de sécurité fausse, et rassurante dans le mauvais
> sens : elle donnait l'impression d'avoir déjà tout compris.* **Seul un appareil tiers
> tranche.**

Mesuré depuis un conteneur Docker — mesure dont la portée était surestimée, voir le
rectificatif ci-dessus :

```
http://192.168.1.21:5000/api/health   REPONSE 200     <- l'API de dev
http://192.168.1.21:5173/             ECONNREFUSED    <- Vite, sain
http://192.168.1.21:5678/healthz      REPONSE 200     <- n8n, ÉDITEUR COMPRIS
```

**La cause n'a rien à voir avec le projet :**

```
regle entrante "Node.js JavaScript Runtime"
  programme : C:\Program Files\nodejs\node.exe
  ports     : TOUS
  profil    : Private
Wi-Fi : categorie Private
back-end : tourne sur ce binaire exactement
```

Les trois profils du pare-feu sont pourtant actifs avec `DefaultInboundAction = Block`. **Une
seule règle, posée un jour par l'invite « Autoriser node.js », suffit à tout ouvrir sur le
réseau domestique.**

Vite est sain **sans** pare-feu : il n'écoute que sur `::1`. L'API et n8n écoutent sur toutes
les interfaces, et leur seule protection était une règle qui les **autorise**. Donc **n8n est
exposé au réseau local en permanence**, tunnel ou pas : le tunnel ajoute Internet, le réseau
local était déjà ouvert.

**Mon premier relevé était incomplet, et je l'ai vu.** Je cherchais les règles par **port**, et
une règle créée par l'invite Windows n'a aucun filtre de port. C'est en passant du critère
« port » au critère « programme » qu'elle est apparue. *Un filtre de recherche mal choisi rend
un résultat rassurant et faux.*

**Le script d'épreuve avait raison, et ne corrigeait rien.** `epreuve-pare-feu.ps1` reclasse le
Wi-Fi en `Public` 90 secondes, ce qui neutralise la règle `Private` : son « attendu : échec » est
juste **pour cette fenêtre**. À l'état normal, c'est un succès.

**`scripts/pare-feu-fermer-le-dev.ps1` écrit**, avec son retrait : une règle de blocage ciblée
sur 5000, 5173 et 5678, source `192.168.1.0/24` uniquement.

**Pourquoi une règle ciblée et non une liaison sur `127.0.0.1`** : la correction évidente
casserait toute la chaîne de support. Les flux appellent l'API par `host.docker.internal:5000`,
qui résout vers **192.168.65.254** — une passerelle interne à Docker, pas `127.0.0.1`. Mesuré.
Les deux chemins sont distincts, donc séparables.

### 6. Le tunnel rouvert, et les six flux actifs

`tunnel/healthz` **200**, `/rest/credentials` et `/rest/workflows` **401**, certificat préservé,
**6 flux sur 6** annoncés actifs.

**Un relevé trop tôt m'a fait croire à un défaut** : le journal n'annonçait que quatre flux et
j'ai cru les deux de messagerie désactivés. La base les donnait tous les six actifs, et les
deux lignes sont apparues un instant après. *n8n active ses flux de façon asynchrone ; lire son
journal une fois ne dit pas l'état, seulement l'instant.*

### 7. Un dossier réel a parcouru la chaîne

**La chaîne sortante est prouvée de bout en bout** : widget → n8n → Claude → API → escalade →
relève → alerte Telegram. Le dossier a été répondu et clos, `traitePar` = le compte
administrateur du porteur du projet. **Aucune suite n'a détourné quoi que ce soit.**

**Ce qui n'est PAS établi** : lequel des deux gestes a fait quoi. `ccAgentTelegr01` a exécuté
une fois avec succès, **35 secondes après** l'envoi de la réponse — les deux horloges ont été
comparées au même instant et sont synchrones à la seconde, donc l'ordre tient. L'hypothèse
cohérente est une validation depuis le back-office puis l'arrivée d'une réponse Telegram mise en
file. **Je n'ai pas pu le lire**, et je préfère le dire que raconter une histoire plausible.

**Une chose à savoir, qui change la façon d'éprouver** : Telegram **met les mises à jour en
file** et les délivre quand le webhook redevient joignable. Une réponse envoyée tunnel fermé
n'est pas perdue — elle arrive en retard, ce qui rend le diagnostic trompeur si l'on ne regarde
pas les heures.

**Dossier neuf préparé** pour une épreuve propre : référence `d9d8790e`, en `escalade`. L'outil
est versionné et **ne nettoie pas derrière lui** — le dossier doit survivre pour qu'on puisse
lui répondre.

## Tâche en cours

Aucune.

## Tâches à venir

- **Répondre au bot sur le dossier `d9d8790e`** — le tunnel est ouvert, les six flux actifs.
  Noter l'heure de chaque geste, pour lever l'attribution restée indéterminée.
- **Refermer le tunnel après l'épreuve** : `node docker/n8n/ouvrir-tunnel.mjs --fermer`.
- **Poser la règle du pare-feu** (élévation requise, mesurée : « Accès refusé » sans elle), puis
  vérifier **les deux sens** — le téléphone doit échouer ET l'agent rendre 25/25.
- **Chrome** — la parade : épingler les onglets, puis *Au démarrage → Ouvrir la page Nouvel
  onglet*.
- **Rejouer la campagne complète** une fois la mémoire libérée : les 37 suites n'ont pas été
  éprouvées aujourd'hui, seules les 8 du périmètre modifié l'ont été.
- **Points reportés** — Ankama 12 Go, application Google en Public au déploiement.
