# Mise en ligne de CoachConnect

> **Choix arbitré le 8 novembre 2026 :** le **client sur Vercel**, l'**API sur un hébergeur
> à processus persistant**, **n8n sur un VPS Hostinger**, la **base sur MongoDB Atlas**.
>
> L'autre option — tout sur Vercel — est devenue possible : Vercel sait faire du WebSocket
> depuis le 22 juin 2026. Mais c'est une **bêta publique**, et la connexion se ferme quand la
> fonction atteint sa durée maximale. Une messagerie en direct présentée à un jury ne se joue
> pas là-dessus.

---

## 0. Ce qui est déjà prêt, et vérifié

Ces points n'ont **rien à faire** : ils ont été mesurés, pas supposés.

| Point | Constat |
|---|---|
| **Fichiers téléversés** | `modeStockage` vaut `cloudinary`. Rien ne s'écrit sur le disque de l'hôte. |
| **Minuteries, cron** | Aucune. Rien ne dépend d'un processus qui dort. |
| **Adresse de l'API côté client** | `baseURL: import.meta.env.VITE_API_URL \|\| '/api'` — une variable suffit. |
| **Adresse du socket** | `io(VITE_API_URL.replace(/\/api$/, ''))` — **déduite** de la précédente. |
| **Cookie entre deux domaines** | `sameSite: 'none'` et `secure: true` dès que `NODE_ENV=production`. |
| **CORS** | Lit `CLIENT_URL`, avec `credentials: true`. |
| **Transactions** | 20 usages, tous en `startSession` → `withTransaction` → `endSession`. C'est le motif qu'Atlas attend : `withTransaction` réessaie seul sur `TransientTransactionError`. |

> **Autrement dit, l'option retenue ne demande AUCUN changement de code applicatif.**
> Tout ce qui suit est de la configuration, plus la régénération des flux n8n.

---

## 0 bis. L'outil à lancer à chaque étape

```bash
cd server
npm run verifier:deploiement
```

Il lit la configuration et rend **tous** les défauts d'un coup, chacun suivi de sa
conséquence. Il n'affiche **aucune valeur de secret** — longueurs, préfixes et verdicts
seulement : le rapport peut être recopié tel quel.

**Pourquoi un script séparé alors que `config/env.js` garde déjà le démarrage :** `env.js`
s'arrête **au premier problème**, et c'est le bon comportement pour un serveur. Pas pour une
veille de déploiement — corriger une variable, redéployer, découvrir la suivante,
recommencer six fois est exactement ce qu'on veut éviter sur un hébergement distant.

**Il voit trois choses qu'aucune garde de démarrage ne peut voir :**

| Contrôle | Pourquoi il ne peut pas vivre au démarrage |
|---|---|
| **Les transactions passent** *(sonde réelle)* | il faut ouvrir une transaction, pas deviner la topologie |
| **Les deux secrets JWT diffèrent** | invariant écrit en commentaire dans `auth.service.js`, et que rien n'appliquait |
| **L'adresse publique est autorisée par CORS** | les deux variables sont valides séparément : seule leur confrontation révèle le défaut |

> Pour éprouver les contrôles réservés à la production sans rien installer :
> `NODE_ENV=production npm run verifier:deploiement`

---

## 1. MongoDB Atlas

### Pourquoi Atlas et pas un Mongo sur le VPS

**Les 20 transactions exigent un jeu de répliques.** Un `mongod` seul, installé en deux
minutes sur le VPS, les refuse toutes avec
`Transaction numbers are only allowed on a replica set member or mongos` — et sept modules
tombent : commentaires, publications, stories, événements, abonnements, messagerie,
modération. **Atlas est un jeu de répliques même sur son offre gratuite M0.** Monter un jeu
de répliques à la main sur un VPS, c'est trois nœuds à surveiller pour le même résultat.

### Les gestes, étape par étape

> **Compter vingt minutes.** Chaque étape se vérifie avant de passer à la suivante : c'est
> plus lent une fois, et cela évite de chercher ensuite laquelle des cinq a échoué.

#### Étape 1 — Le compte et le cluster

1. Créer un compte sur `cloud.mongodb.com`. L'offre **M0 est gratuite et sans carte**.
2. **Créer un cluster `M0`**, région **`eu-west-1` (Irlande)** ou `eu-west-3` (Paris) si
   proposée.

   > **Pourquoi la région compte** : chaque requête de l'API fait l'aller-retour. Un cluster
   > aux États-Unis ajoute environ 100 ms à **chaque** appel, et une page qui en fait dix
   > devient perceptiblement lente sans qu'aucune mesure du code ne l'explique.

3. **Nommer le cluster**, par exemple `coachconnect`. Le nom apparaîtra dans la chaîne de
   connexion.

   > **M0 est un JEU DE RÉPLIQUES à trois nœuds**, et c'est la raison pour laquelle on passe
   > par Atlas : les 20 transactions de l'application l'exigent. Rien à configurer pour cela,
   > c'est le comportement par défaut.

#### Étape 2 — L'utilisateur de la base

4. Menu **« Database Access »** → **« Add New Database User »**.
5. Méthode **mot de passe**. Nom d'utilisateur simple, par exemple `coachconnect-api`.
6. **Laisser Atlas générer le mot de passe** (bouton *Autogenerate*), puis **le copier
   immédiatement** : il ne sera plus affiché.
7. Rôle : **`readWriteAnyDatabase`**, ou `readWrite` restreint à la base `sportsocial`.

   > ⚠️ **SI LE MOT DE PASSE CONTIENT `@`, `:`, `/`, `?`, `#`, `[`, `]` OU `%`**, il doit être
   > encodé dans l'URL, sinon la chaîne de connexion est coupée au mauvais endroit et l'erreur
   > parle d'un hôte introuvable — pas d'un mot de passe. Le plus simple est de **régénérer un
   > mot de passe sans ces caractères**.

#### Étape 3 — L'accès réseau

8. Menu **« Network Access »** → **« Add IP Address »**.

   | Voie | Quand la choisir | Réserve |
   |---|---|---|
   | Les IP de sortie de l'hébergeur de l'API | il les annonce et elles sont fixes | **la plus étroite, à préférer** |
   | `0.0.0.0/0` *(« Allow access from anywhere »)* | l'hébergeur n'annonce pas d'IP fixe | **l'accès ne tient plus QUE sur le mot de passe** |

   > Si `0.0.0.0/0` est retenu, le mot de passe devient la seule barrière : il doit être long,
   > unique, et ne servir nulle part ailleurs. *Ce n'est pas une faute en soi — beaucoup
   > d'hébergements n'ont pas d'IP fixe — mais c'est un choix à faire les yeux ouverts.*

#### Étape 4 — La chaîne de connexion

9. Bouton **« Connect »** → **« Drivers »** → **Node.js**. Atlas affiche :

   ```
   mongodb+srv://<UTILISATEUR>:<MOT_DE_PASSE>@<CLUSTER>.mongodb.net/?retryWrites=true&w=majority
   ```

   > **Les quatre `<…>` sont des marques à remplacer**, pas des valeurs. Atlas affiche déjà
   > l'utilisateur et le cluster renseignés ; seul `<MOT_DE_PASSE>` reste à substituer à la
   > main — Atlas ne l'insère jamais.

10. **Trois modifications à faire dessus**, et les trois comptent :

    | À faire | Pourquoi |
    |---|---|
    | Remplacer `<db_password>` par le mot de passe | Atlas ne l'insère pas |
    | **Insérer le nom de la base avant le `?`** → `…mongodb.net/sportsocial?retry…` | sans lui, Mongoose écrit dans la base `test` et l'application paraît vide |
    | Ne rien ajouter d'autre | `mongodb+srv` **active le TLS tout seul** — aucune option de certificat à écrire |

    > **Le nom exact de la base est `sportsocial`** — c'est celui qu'affiche le contrôle en
    > développement, à la ligne « connexion à la base ».

#### Étape 5 — Vérifier AVANT de déployer quoi que ce soit

11. Depuis le poste de développement, **sans modifier `server/.env`** :

    ```bash
    cd server
    MONGO_URI="mongodb+srv://…/sportsocial?retryWrites=true&w=majority" npm run verifier:deploiement
    ```

12. **Deux lignes seules décident** :

    ```
    OK    connexion à la base                              sportsocial
    OK    LES TRANSACTIONS PASSENT (20 usages, 7 modules)  une transaction s’ouvre et se referme
    ```

    > **Si la seconde échoue avec « Transaction numbers are only allowed on a replica set
    > member or mongos »**, la base n'est pas un jeu de répliques — ce qui ne devrait jamais
    > arriver avec Atlas, mais arriverait avec un `mongod` installé à la main sur un VPS.
    > *Sept modules tomberaient : commentaires, publications, stories, événements,
    > abonnements, messagerie, modération.*

13. **Puis seulement**, poser la chaîne dans `MONGO_URI` **sur l'hébergeur de l'API** — jamais
    dans un fichier du dépôt.

### Quelle offre choisir, et pourquoi la question est tranchée

Atlas propose trois formules à la création d'un cluster. **Mesuré sur la base réelle plutôt
que supposé :**

```
base sportsocial : 16 collections · 4 784 documents
données   1,06 Mo
index     3,00 Mo
TOTAL     4,06 Mo
```

| Formule | Stockage | Coût | Verdict |
|---|---|---|---|
| **Free (M0)** | **512 Mo** | **0 €, sans carte** | **✅ le bon choix — 126 fois la place nécessaire** |
| Flex | 5 Go | à l'usage, quelques euros/mois | inutile ici |
| M10 | 10 Go, dédié | ~50 €/mois | hors sujet |

> **Et M0 est un JEU DE RÉPLIQUES à trois nœuds**, comme toutes les formules : c'est la seule
> chose qui compte vraiment, puisque les 20 transactions l'exigent. **Payer n'apporterait
> rien sur ce point.**
>
> *Ce que M0 ne donne pas : les sauvegardes planifiées, la restauration à un instant donné,
> et un processeur dédié. Aucune des trois ne concerne une soutenance.*

#### Les réglages exacts à la création

| Champ | Valeur | Pourquoi |
|---|---|---|
| **Cluster tier** | `M0` | voir ci-dessus |
| **Provider** | `AWS` | le plus fourni en régions européennes |
| **Region** | `eu-west-1` (Irlande) ou `eu-west-3` (Paris) | ~100 ms **par appel** depuis les États-Unis |
| **Name** | `coachconnect` | il apparaît dans la chaîne de connexion |
| Additional settings | **ne rien changer** | la version de MongoDB par défaut convient ; le chiffrement et les sauvegardes ne sont pas proposés en M0 |

> ⚠️ **Un seul cluster M0 par compte Atlas.** S'il en existe déjà un, Atlas refuse le second —
> il faut supprimer l'ancien ou choisir Flex.

### Reprendre les données du Mongo local

**C'est un choix, et les deux options se défendent :**

| Option | Quand la préférer |
|---|---|
| **Partir à vide** | une démonstration propre, sans trace d'essais |
| **Reprendre la base locale** | garder les comptes, les publications et les événements déjà créés |

> **Si tu reprends la base, regarde d'abord ce qu'elle contient** : sur les 4 784 documents,
> **4 436 sont du bruit d'essai** — 3 036 notifications et 1 400 accusés de webhook Stripe,
> soit **93 %**. Les exclure donne une base plus lisible sans rien perdre d'utile :
>
> ```bash
> # depuis server/, l'URI de destination passe par l'ENVIRONNEMENT
> MONGO_URI_CIBLE="mongodb+srv://…/sportsocial" \
>   npm run migrer:atlas -- --essai --sauf=notifications,processedwebhooks
> ```

#### La migration, et ce qu'elle garantit

```bash
cd server

# 1. VOIR ce qui serait fait, sans rien écrire
MONGO_URI_CIBLE="mongodb+srv://…/sportsocial" npm run migrer:atlas -- --essai

# 2. le faire
MONGO_URI_CIBLE="mongodb+srv://…/sportsocial" npm run migrer:atlas
```

**L'URI passe par l'environnement, jamais en argument** : un argument de commande est visible
de toute la machine dans la liste des processus, et celui-ci porte le mot de passe de la base.

Ce que l'outil fait, et que `mongodump` ne ferait pas tout seul :

- **Il recopie les index, APRÈS les documents.** Créer un index unique avant d'insérer
  ferait échouer l'insertion à mi-parcours ; après, s'il refuse, c'est que la source
  elle-même violait sa contrainte — et il valait mieux l'apprendre là.
- **Il reconstruit les index TEXTUELS.** `listIndexes` les décrit avec la clé interne
  `{ _fts: 'text', _ftsx: 1 }` et les vrais champs dans `weights` ; renvoyer cette clé échoue.
  **Sans cela, la recherche répondrait sans jamais rien trouver.**
- **Il relit et compare les comptages**, collection par collection, et ressort `1` sur le
  moindre écart.
- **Il refuse** une cible non vide sans `--ecraser`, une cible identique à la source, et une
  URI qui ne nomme aucune base.

> **Éprouvé le 8 novembre** sur une base d'épreuve locale : **16 collections, 4 789 documents,
> tous les comptages relus égaux, 84 index recréés**. La base migrée passe ensuite
> `verifier:deploiement` — transactions comprises — et sa recherche textuelle trouve.

#### Et ensuite, le geste qui n'est pas optionnel

```bash
MONGO_URI="mongodb+srv://…/sportsocial" npm run verifier:deploiement
```

> **Un comptage égal ne dit rien des transactions.** C'est ce contrôle qui en ouvre une vraie.

### Les données : partir à vide

La base locale ne contient que des données de développement et des comptes d'essai. **Partir
d'une base vide est plus propre qu'une migration**, et tout existe pour l'amorcer :

```bash
npm run creer-admin    # le compte d'administration
npm run coach-demo     # un coach de démonstration
```

**Et rien d'autre — vérifié plutôt que supposé :**

- **Les index se construisent seuls.** Les index textuels sont déclarés dans les schémas
  (`{ titre: 'text', description: 'text' }` dans `Post`, `SportEvent`, `User`), et
  `autoIndex` n'est désactivé nulle part : Mongoose les crée à la connexion.
- **`npm run reindexer-recherche` NE SERT PAS ICI.** Ce script ne crée aucun index : il
  recalcule le champ dérivé `termesRecherche` sur les comptes **déjà en base**. Sur une base
  neuve il affiche « Aucun compte à réindexer ». Les comptes créés ensuite le remplissent
  seuls, par le `pre('save')` de `User.js` — c'est un outil de rattrapage, pas une étape
  d'installation.

### Ce qui reste à vérifier une fois connecté

Le premier démarrage contre Atlas doit être **regardé**, pas supposé :

```
[DB] Connecte a MongoDB : <nom de la base>
```

puis **un parcours qui passe par une transaction** — publier un commentaire suffit. S'il
échoue, c'est le jeu de répliques, et le message le dira.

---

## 2. L'hébergeur de l'API

### Ce qu'il doit savoir faire

- **Tenir un processus Node en vie** — c'est tout l'enjeu : `new Server(serveurHttp)` de
  Socket.IO a besoin d'un serveur HTTP persistant.
- **Accepter les WebSockets** sans durée maximale sur la connexion.
- Servir en **HTTPS**, sans quoi le cookie `secure` ne sera pas posé.

### Les variables d'environnement

| Variable | Valeur | Piège |
|---|---|---|
| `NODE_ENV` | `production` | c'est elle qui bascule le cookie en `sameSite: none` + `secure` |
| `MONGO_URI` | la chaîne `mongodb+srv://…` | |
| `CLIENT_URL` | **le domaine Vercel EN PREMIER** | voir ci-dessous |
| `PUBLIC_URL` | l'adresse publique de l'API | laissée vide et commentée dans `.env` exprès |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | neufs, 64 octets | ne pas reprendre ceux du poste |
| `CLOUDINARY_*` | les mêmes qu'en local | le compte est déjà actif |
| `STRIPE_*` | voir §5 | |

### ⚠️ LE PIÈGE DE `CLIENT_URL`

`CLIENT_URL` sert **deux choses différentes** :

| Usage | Ce qu'il lit |
|---|---|
| CORS (`app.js`, `sockets/index.js`) | **toute** la liste |
| Stripe Checkout, onboarding Connect, **liens de mot de passe oublié** | **le PREMIER seulement** |

Ajouter le domaine Vercel **à la fin** de la liste existante ne casserait rien visiblement.
Mais l'acheteur reviendrait de Checkout sur `http://localhost:5173`, le coach finirait son
onboarding au même endroit, et **les courriels de réinitialisation partiraient à de vrais
utilisateurs avec un lien mort**. Trois échecs silencieux, chez l'utilisateur.

> **Le domaine Vercel va EN PREMIER.** Les origines locales peuvent rester derrière, elles ne
> servent qu'au CORS.

---

## 3. Vercel — le client

### Les gestes

1. **Importer le dépôt**, et régler la **racine du projet sur `client`**.
2. **`client/vercel.json` est déjà écrit** : `framework: vite`, sortie `dist`, et la
   **réécriture vers `/index.html`** — sans elle, ouvrir `/messages` directement ou
   rafraîchir la page rend un 404, alors que la navigation interne fonctionne.

   > **ET LA RÈGLE FOURRE-TOUT NE MASQUE PAS LES FICHIERS STATIQUES, SANS RIEN SUPPOSER.**
   > Vercel sert normalement un fichier qui existe avant d'appliquer une réécriture — mais
   > cette précédence n'est pas écrite noir sur blanc dans la documentation, et un cas de
   > réécriture ignorée à la racine a été rapporté. Plutôt que d'en dépendre, `vercel.json`
   > déclare **avant** la fourre-tout deux réécritures de `assets/*` et `favicon.svg` **vers
   > elles-mêmes** : des règles sans effet, dont le seul rôle est d'intercepter le chemin
   > avant la fourre-tout. Ce sont les deux seuls objets statiques à la racine du build.
   >
   > *Une configuration qui ne repose sur aucun ordre implicite ne se casse pas le jour où
   > cet ordre change.*
3. **Les variables du client** (toutes publiques, lisibles par n'importe quel visiteur) :

   | Variable | Valeur |
   |---|---|
   | `VITE_API_URL` | `https://<api>/api` — **le socket s'en déduit** |
   | `VITE_STRIPE_PUBLIC_KEY` | `pk_live_…` |
   | `VITE_SUPPORT_WEBHOOK_URL` | `https://<n8n>/webhook/coachconnect-support` |
   | `VITE_TELEGRAM_BOT` | le nom du bot |

> **`VITE_API_URL` doit se terminer par `/api`.** Le socket est construit en RETIRANT ce
> suffixe. Sans lui, le client appellerait `https://<api>/api/...` pour l'API — correct — mais
> ouvrirait le socket sur `https://<api>/api`, qui n'écoute pas.

---

## 4. n8n sur le VPS Hostinger

Tout est dans `docker/n8n/hostinger/` : `docker-compose.yml`, `Caddyfile`, `.env.example`.

### Ce que cette composition change par rapport au développement

- **Caddy devant n8n**, seul service exposé. Il obtient le certificat Let's Encrypt seul, et
  **n'ouvre publiquement que les chemins de webhook** : l'éditeur est derrière un mot de
  passe. L'image n8n est épinglée en `1.121.3`, une version choisie pour un poste **local** ;
  l'exposer à Internet sans ce filtre changerait ce raisonnement.
- **Pas de `docker-compose.override.yml`.** Il monte le certificat d'Avast et pose
  `NODE_EXTRA_CA_CERTS`. Sur un Linux sans antivirus, il désigne un fichier **inexistant** :
  n8n démarre, répond `healthz 200`, et **tous ses appels sortants échouent**.
- **`WEBHOOK_URL` et `N8N_EDITOR_BASE_URL` convergent** sur le domaine public. Elles étaient
  séparées en développement parce que le tunnel changeait d'adresse à chaque ouverture alors
  que le rappel OAuth de Google doit être enregistré d'avance. Un domaine stable supprime la
  raison de cette séparation.
- **Purge de l'historique d'exécutions** (`EXECUTIONS_DATA_PRUNE`, 14 jours). Sans elle, la
  base SQLite enfle sans que personne ne le voie — jusqu'au disque plein.

### Les gestes

1. **Un sous-domaine** (`n8n.<domaine>`) avec un enregistrement A vers l'IP du VPS.
   **Vérifier la propagation AVANT de démarrer** : `dig +short n8n.<domaine>`. Si le nom ne
   résout pas, Caddy échoue en boucle et peut atteindre la limite de l'autorité de
   certification, qui bloque alors le domaine plusieurs heures.
2. `cp .env.example .env`, puis le renseigner. **Clé de chiffrement NEUVE** :
   `openssl rand -hex 32`.
3. `docker compose up -d`, puis créer le compte propriétaire dans l'éditeur.
4. **Recréer les identifiants** — l'export des workflows ne les transporte pas. Garder les
   mêmes identifiants internes :

   ```
   ccAnthropicApi01   clé API Anthropic
   ccTelegramBot001   jeton du bot Telegram
   ccCleServiceSup1   clé de service de l'API
   ccCleAgentSupp01   clé d'agent de l'API
   (Gmail)            OAuth, à réautoriser
   ```

5. **Déclarer le rappel OAuth chez Google** :
   `https://n8n.<domaine>/rest/oauth2-credential/callback`
6. **Régénérer les flux avec les adresses publiques**, depuis le poste de développement :

   ```bash
   COACHCONNECT_API=https://<api>/api \
   COACHCONNECT_APPLI=https://<client>.vercel.app \
     node docker/n8n/workflows/construire-agent-support.mjs
   # idem pour les quatre autres générateurs
   ```

   > **Pourquoi à la génération et non par une variable du conteneur :** ces adresses
   > finissent **à l'intérieur** du code des nœuds, et n8n tourne avec
   > `N8N_BLOCK_ENV_ACCESS_IN_NODE=true` — un nœud ne peut pas lire l'environnement, parce
   > qu'il y lirait aussi la clé qui déchiffre tous les identifiants.
   >
   > **Sans ces variables, la sortie est identique à l'octet près** : c'est ce qui rend le
   > mécanisme vérifiable.

7. **Importer, activer, redémarrer** — `import:workflow` remet toujours `active: false`.
8. **Ne pas oublier `allowedOrigins`.** Le webhook du widget n'accepte que l'origine
   déclarée. Mal réglée, **le widget se tait sans aucun message d'erreur** : le navigateur
   bloque la réponse au titre du CORS. `COACHCONNECT_APPLI` la renseigne.

---

## 5. Stripe en mode réel

Détaillé au journal (`SUIVI.md`, « Les six gestes de la bascule en production ») :

1. Activer le compte en mode réel, puis **Connect** en mode réel.
2. **Les comptes des coachs sont des objets de TEST** : chacun devra refaire son onboarding.
   Rien ne se migre.
3. Remplacer `STRIPE_SECRET_KEY`, `VITE_STRIPE_PUBLIC_KEY`, `STRIPE_WEBHOOK_SECRET`.
4. Déclarer l'endpoint `https://<api>/api/webhooks/stripe` avec **les neuf événements** que
   le code traite.
5. `CLIENT_URL` : le domaine Vercel **en premier**.
6. Vérifier par **un vrai paiement**, avec un vrai remboursement derrière.

> **`test:paiement` débiterait une vraie carte** en mode réel. La suite doit rester pointée
> sur des clés de test.

---

## 6. L'ordre, et pourquoi il est contraint

```
1. Atlas              ─┐
2. Hébergeur API      ─┼─► l'API ne démarre pas sans MONGO_URI
3. Vercel (client)    ─┘   et le client a besoin de l'adresse de l'API
4. n8n / Hostinger        a besoin des DEUX adresses publiques
5. Stripe en réel         a besoin du domaine du client
```

**Une seule chose peut se faire à l'avance** : créer le cluster Atlas. Tout le reste attend
l'adresse de l'étape précédente.

### Ce qui reste local, et le redevient inutile

Une fois Atlas et Hostinger en place, **le poste de développement n'a plus besoin de Docker
pour faire tourner l'application** : le conteneur Mongo et le conteneur n8n n'y servent plus
qu'au développement. C'est la sortie du problème de disque : `docker_data.vhdx` pèse
12,37 Go, et un disque virtuel ne se libère que par compaction.
