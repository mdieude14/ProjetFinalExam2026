# CoachConnect — réseau social sportif

Application web reliant des **sportifs** et des **coachs certifiés** :
publications et stories, suivi, abonnements premium payants, carte des coachs,
événements sportifs, recherche, messagerie temps réel et notifications.

Projet d'examen — React 19 + Vite côté client, Express 4 + MongoDB côté
serveur, Socket.io pour le temps réel, Stripe Connect pour les paiements.

---

## Ce que fait l'application

| Module | Fonctionnalité |
|---|---|
| 1–3 | Comptes, JWT avec rotation de refresh token, routes protégées |
| 4 | Profils, visibilité publique/privée, quatre niveaux de vue des données |
| 5 | Publications, stories, likes, commentaires, médias sur Cloudinary |
| 6 | Suivi gratuit, demandes d'abonnement pour les comptes privés |
| 7 | Abonnements premium payants via **Stripe Connect** (le coach encaisse, la plateforme prend 15 %) |
| 8 | Géolocalisation et carte Leaflet des coachs, position volontairement floutée |
| 9 | Événements sportifs à capacité limitée, sans surréservation possible |
| 10 | Recherche de personnes, publications et événements, avec autocomplétion |
| 11 | Messagerie privée temps réel, avec sas anti-harcèlement |
| 12 | Notifications centralisées, pastille en direct |
| 13 | Reprise du projet sur une machine vierge : installation, semis de données, diagnostics |
| 14 | Modération personnelle — bloquer, restreindre, signaler, depuis le profil et la conversation |
| 15 | **Assistance automatisée** : un agent de support orchestré par n8n et rédigé par Claude, sur quatre canaux |

### Le module 15 en deux mots

C'est la seule partie de l'application qui ne tient pas dans `server/` et
`client/`. Quatre workflows n8n, versionnés dans [`docker/n8n/workflows/`](docker/n8n/workflows/),
relient Claude à l'API :

| Canal | Ce qu'il fait |
|---|---|
| **Widget** | Une pastille d'assistance sur toutes les pages. L'agent classe la demande, consulte le compte de la personne en lecture seule, répond, ou remonte le dossier à un humain |
| **Courriel** | Relève la boîte de l'assistance, rédige une réponse, et la **dépose en brouillon** — rien ne part sans validation humaine |
| **Telegram** | Alerte l'équipe dès qu'un dossier est escaladé, et lui permet de répondre depuis la conversation |
| **Messagerie** | Tri et corbeille assistés sur la messagerie interne |

Deux garde-fous structurent tout le module :

1. **L'agent n'interroge jamais MongoDB.** Il passe par les routes de l'API,
   avec le jeton de la personne : il ne peut donc lire que ce qu'elle pourrait
   lire elle-même, et une faille d'invite ne devient pas une fuite de données.
2. **L'agent ne décide pas de ce qui le dépasse.** Un remboursement, un
   litige, un signalement partent à un humain, et c'est le **serveur** qui en
   décide — pas une consigne de prompt, que le modèle pourrait désactiver.
   De même, une personne qui clique « Contacter le support client » obtient
   un dossier humain quoi qu'en pense le classifieur.

> Le support est une **couche en plus, pas une dépendance**. Sans URL d'agent
> configurée, le widget est masqué et le reste de l'application fonctionne à
> l'identique.

---

## Prérequis

| Outil | Version | Pourquoi |
|---|---|---|
| **Node.js** | **24 LTS** (testé en 24.19) | `npm` 11 ; le projet utilise les modules ES et `fetch` natif |
| **Docker Desktop** | récent | fait tourner MongoDB en conteneur |
| **MongoDB** | 8 | fourni par le conteneur ci-dessous |
| **Stripe CLI** | ≥ 1.19 | relaie les webhooks vers `localhost` — indispensable aux paiements |

> **MongoDB doit tourner en replica set**, même à un seul nœud. Le projet
> utilise des **transactions** (compteurs de likes, places d'événement,
> messages non lus), et MongoDB les refuse sur une instance autonome. C'est le
> piège d'installation le plus fréquent : tout fonctionne jusqu'à la première
> écriture transactionnelle, qui échoue sur un message parlant de « replica
> set » sans dire quoi faire.

---

## Installation

### 1. La base de données

```bash
docker run -d --name sportsocial-mongo \
  -p 27017:27017 \
  -v sportsocial-mongo-data:/data/db \
  --restart unless-stopped \
  mongo:8 --replSet rs0

# Initialiser le replica set — UNE SEULE FOIS
docker exec sportsocial-mongo mongosh --eval 'rs.initiate()'
```

Vérifier que le nœud est bien primaire :

```bash
docker exec sportsocial-mongo mongosh --eval 'rs.status().myState'   # doit rendre 1
```

### 2. Le serveur

```bash
cd server
npm install
cp .env.example .env      # puis remplir (voir la section suivante)
npm run dev
```

### 3. Le client

```bash
cd client
npm install
cp .env.example .env
npm run dev               # http://localhost:5173
```

### 4. Un compte administrateur

Il n'existe **aucune route** pour créer un administrateur : c'est lui qui
valide les diplômes des coachs, donc qui décide qui peut vendre du contenu.
Exposer sa création ajouterait une surface d'attaque permanente pour une
opération qui n'a lieu qu'une fois.

```bash
cd server
npm run creer-admin -- --email=admin@exemple.fr --pseudo=admin \
                       --password=MotDePasseAdmin123 --nom=Nom --prenom=Prenom
```

Le `--` supplémentaire est indispensable : il indique à npm que les arguments
qui suivent sont destinés au script, pas à npm.

---

## Variables d'environnement

Toutes sont documentées dans `server/.env.example`. Les trois blocs qui
demandent une décision :

### Obligatoires

`MONGO_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`. Les deux secrets
doivent être **différents l'un de l'autre** : signés avec le même, une fuite
du secret d'accès permettrait de forger des refresh tokens.

**Et `PUBLIC_URL` dès que `NODE_ENV=production`** — l'adresse publique de
l'application, distincte des origines CORS. Voir [Déploiement](#déploiement) :
le serveur refuse de démarrer si elle est restée locale.

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Cloudinary — facultatif, mais la dégradation est visible

Sans `CLOUDINARY_*`, le serveur bascule sur un **stockage local** dans
`server/uploads`. L'application fonctionne, mais les fichiers ne survivent pas
à un redéploiement. Le mode actif est annoncé au démarrage :

```
[MEDIAS] Mode actif : cloudinary
```

### Stripe — facultatif, et le reste continue de tourner

Sans `STRIPE_SECRET_KEY`, tout fonctionne **sauf** les abonnements premium.
Le serveur le dit au démarrage plutôt que d'échouer à la première tentative
de paiement.

`STRIPE_WEBHOOK_SECRET` doit correspondre à celui qu'affiche `stripe listen` —
voir la section suivante.

---

## Lancer les tests

```bash
npm test          # à la racine : les trente-six suites, une par une
```

La commande **vérifie d'abord les prérequis** et s'arrête avec un message
clair si l'un manque, plutôt que de laisser échouer des dizaines de
vérifications sans rapport avec la cause.

Trois de ces contrôles portent sur le banc d'essai lui-même, et ils bloquent :

- **toute suite déclarée dans un `package.json` doit être enregistrée** dans la
  campagne — une suite oubliée ne tourne jamais, et ses vérifications au vert
  rassurent sans rien prouver ;
- **chaque fichier de suite doit se compiler** (`node --check`) — une
  déclaration en double est une `SyntaxError`, donc le fichier entier est
  refusé, **aucune** vérification ne s'exécute et la sortie ne contient aucun
  « ECHEC » ;
- **une suite n'est au vert que si son code de sortie vaut zéro ET qu'elle a
  imprimé une ligne de score.** Compter les « ECHEC » dans la sortie lirait
  zéro sur une pile d'erreur.

### Ce qui doit tourner avant

| Prérequis | Commande |
|---|---|
| MongoDB | `docker start sportsocial-mongo` |
| API | `cd server && npm run dev` |
| Client | `cd client && npm run dev` |
| Webhooks Stripe | `stripe listen --forward-to localhost:5000/api/webhooks/stripe` |
| Compte admin | `npm run creer-admin -- …` (voir plus haut) |

Les suites peuvent aussi se lancer une par une :

```bash
cd server && npm run test:api          # régression générale
cd server && npm run test:notifications
cd client && npm run test:parcours-10-11
```

---

## Pièges d'environnement déjà rencontrés

Ces quatre-là ont coûté du temps, et aucun ne se diagnostique en lisant le
code. Ils sont réunis ici pour cette raison.

### `test:paiement` échoue à mi-parcours, sans raison apparente

Treize vérifications rouges d'un coup, toutes après « attente du webhook ».
La cause est en amont et hors du code : **`stripe listen` n'est pas lancé**,
donc aucun webhook n'arrive. Avec le relais actif, la suite passe sans rien
changer d'autre.

> Le premier réflexe devant une cascade d'échecs n'est pas de lire le code,
> mais de vérifier que les prérequis tournent.

### Les suites navigateur expirent toutes au premier `page.goto`

Deux processus Vite orphelins peuvent subsister d'une session précédente.
Celui qui tient le port 5173 a perdu son parent et **ne relaie plus `/api`** :
Vite sert les pages, le proxy ne transmet rien, et le second s'est rabattu sur
5174 sans que personne le remarque. L'API répond pourtant parfaitement en
direct.

```bash
# Windows — qui écoute réellement sur 5173 ?
Get-NetTCPConnection -LocalPort 5173 -State Listen | Select LocalPort,OwningProcess
```

Comparer un appel **direct** à l'API et le même appel **via le proxy** désigne
la cause en deux commandes.

### Une suite rend `0/0` ou « INTERROMPU » en campagne, et passe seule

Trois causes réelles, trouvées en les mesurant — et **aucune n'était celle
qu'on soupçonnait d'abord**.

**1. Un fichier modifié pendant la campagne redémarre l'API.** `nodemon`
surveillait tout `server/`, pas seulement `server/src` : éditer un fichier de
test coupait l'API sous les pieds des suites en vol. Corrigé — le script `dev`
porte désormais `--watch src`. Par prudence, **ne rien éditer pendant une
campagne**.

**2. Un processus orphelin sature la machine.** Arrêter une tâche tue le
processus lancé, **pas** ses enfants ni ce qui tourne dans un conteneur. Une
CLI oubliée a déjà occupé un cœur entier pendant plus d'une heure, jusqu'à
faire expirer la sélection de serveur MongoDB d'une suite.

```bash
docker stats --no-stream          # un conteneur au repos au-dessus de quelques % est suspect
docker top coachconnect-n8n       # la colonne TIME nomme le coupable
```

**3. Une attente fixe mesure la machine, pas le code.** Un
`waitForTimeout(2000)` suffit quand la suite tourne seule et pas en trentième
position d'une campagne. **Attendre une condition, jamais une durée.**

Cette règle était écrite ici bien avant d'être appliquée partout : six suites
l'ignoraient encore au 28 octobre 2026. Le signe qui l'a trahi est précis —
**seules les vérifications placées juste après un `goto` tombaient**, jamais
celles qui suivent un clic ou un `waitForURL`, qui attendent d'eux-mêmes.
`count()` et `content()`, eux, sont des instantanés : ils ne réessaient pas.

Et le coût ne se lisait pas dans le rouge. Une assertion d'**absence**
(`count() === 0`, `!html.includes(…)`) est **satisfaite par une page vide** :
huit d'entre elles étaient comptées vertes sans rien mesurer, dont quatre
contrôles d'autorisation et l'absence de l'adresse d'un événement privé dans
le HTML. **Toute assertion d'absence doit donc s'ancrer sur une présence**, et
dire en clair qu'elle ne conclut rien quand cet ancrage manque.

Enfin, un compteur alimenté par un **événement socket** ne s'attend pas en
sondant : l'événement émis avant la connexion est perdu pour de bon. On attend
`page.waitForEvent('websocket')`, posé **avant** la navigation.

**La mémoire libre est un prérequis annoncé**, au même titre que `stripe
listen` : sous 2 Go, `npm test` avertit avant de lancer quoi que ce soit. Le
seuil des suites de performance, lui, ne se relève pas pour obtenir du vert —
ce serait truquer l'instrument.

`npm test` lance par ailleurs les suites **une par une**, et ménage une pause
entre deux suites navigateur : Chromium met un instant à rendre mémoire et
sockets.

### Le port 5000 reste occupé après l'arrêt du serveur

Même mécanisme que le point 2 ci-dessus : `nodemon` meurt, son enfant garde le
port, et `GET /api/health` répond **200 depuis l'ancien processus** — avec
l'ancienne configuration. Le symptôme accuse le code.

`npm run dev` exécute donc `predev` → `scripts/liberer-port.mjs`, qui libère le
port 5000. Il ne tue que `node`/`nodemon` : **tout autre occupant est nommé et
l'opération s'interrompt**, plutôt que de tuer à l'aveugle le processus de
quelqu'un d'autre.

### L'autocomplétion ne trouve rien sur les comptes existants

Le champ `termesRecherche` est alimenté par un crochet `pre('save')` : il ne
concerne que les documents enregistrés **après** son introduction. Les comptes
antérieurs restent invisibles jusqu'à la reprise :

```bash
cd server && npm run reindexer-recherche
```

---

## Structure

```
server/
  src/
    config/        environnement, base, Cloudinary, Stripe
    models/        schémas Mongoose — les règles vivent ici
    services/      logique métier, hors HTTP
    controllers/   traduction HTTP ↔ services
    routes/        déclaration des URL
    middlewares/   auth, rôles, validation, upload, erreurs
    sockets/       temps réel (module 11)
    validators/    bornes de forme des entrées
  scripts/         admin, reprise de données, diagnostics
  tests/           dix-neuf suites d'API

client/
  src/
    api/           un fichier par domaine, tous sur un Axios centralisé
    context/       session, socket, notifications
    components/    par domaine : post, profile, map, event, message, …
    pages/         un écran par route
    routes/        gardes de navigation
  tests/           dix-sept suites Playwright

docker/
  n8n/workflows/   les quatre workflows, et les scripts qui les GÉNÈRENT
                   — la source de vérité est le `.mjs`, jamais le `.json`

docs/SUIVI.md      le journal de bord : les décisions, et pourquoi
captures/          sorties de campagne et captures d'écran des suites
scripts/           la campagne de test complète (`npm test`)
```

---

## Décisions techniques notables

Le détail — et surtout **pourquoi** — est consigné module par module dans
[`docs/SUIVI.md`](docs/SUIVI.md). Les quatre plus structurantes :

- **L'access token vit en mémoire, jamais dans `localStorage`**, lisible par
  n'importe quel script de la page. Le refresh token est dans un cookie
  `httpOnly`, et la session se reconstitue au rechargement.
- **Un contenu premium verrouillé est retiré de la réponse HTTP**, pas masqué
  à l'écran : une URL laissée dans la charge utile est lisible dans l'onglet
  réseau.
- **Le socket ne fait que diffuser** ; toute écriture passe par HTTP. Deux
  chemins d'écriture finiraient par diverger, et c'est la voie temps réel — la
  moins testée — qui resterait ouverte.
- **Les compteurs dénormalisés sont écrits dans la même transaction** que ce
  qu'ils comptent. Vingt inscriptions simultanées sur cinq places donnent
  exactement cinq inscrits.

---

## Déploiement

### Ce qui change entre le développement et la production

Rien à modifier dans le code : tout se règle par `NODE_ENV` et les variables
d'environnement. Ce que le passage en production déclenche :

| Réglage | Développement | Production | Pourquoi |
|---|---|---|---|
| Cookie du refresh token | `sameSite: 'lax'`, `secure: false` | `sameSite: 'none'`, `secure: true` | En local, front et API partagent `localhost`. En production ils sont sur deux domaines : le navigateur exige alors `secure` pour accepter `sameSite: 'none'`. |
| Limiteurs de débit | neutralisés | actifs | Cinq connexions de test suffiraient sinon à se bloquer soi-même un quart d'heure. `RATE_LIMIT_DEV=true` les réactive en local pour les vérifier. |
| Origines CORS | `http://localhost:5173` | domaine du front | Lues dans `CLIENT_URL`, séparées par des virgules. **Qui a le droit d'entrer.** |
| **Adresse publique** | repli sur la 1ʳᵉ origine | **`PUBLIC_URL` obligatoire** | **Où l'on renvoie les gens** : retours Stripe, onboarding Connect, liens des courriels. Le serveur **refuse de démarrer** si elle est locale en production. |
| Stockage des médias | local si Cloudinary absent | Cloudinary | Le stockage local ne survit pas à un redéploiement. |

#### `CLIENT_URL` et `PUBLIC_URL` répondent à deux questions différentes

`CLIENT_URL` est une **liste** : les origines autorisées à appeler l'API.
`PUBLIC_URL` est une **adresse unique** : celle vers laquelle on renvoie les
gens.

Elles ont longtemps été la même variable, et le piège était réel. `CLIENT_URL`
contient déjà deux origines locales : **ajouter le domaine de production à la
fin** — le geste naturel, puisqu'il s'agit d'autoriser une origine de plus —
laissait l'adresse publique sur `localhost`. Conséquences :

- l'acheteur revient sur `localhost` après avoir payé ;
- le coach termine son onboarding Connect sur `localhost` ;
- **les courriels de réinitialisation partent à de vrais utilisateurs avec un
  lien mort.**

Rien ne plante. Les trois échouent **chez l'utilisateur**, invisibles depuis le
serveur. D'où la variable dédiée, et le refus de démarrer.

### Serveur

1. **Base** — un cluster MongoDB Atlas suffit ; il est déjà en replica set,
   donc les transactions fonctionnent sans réglage.
2. **Variables** — reprendre `server/.env.example`. Regénérer les deux secrets
   JWT : ceux du développement ne doivent jamais partir en production.
3. **Démarrage** — `npm ci --omit=dev && npm start`.
4. **Sonde de santé** — `GET /api/health` répond l'état du processus **et**
   celui de la connexion Mongo. C'est cette route qu'il faut donner à
   l'hébergeur : un processus vivant mais sans base n'est pas un service en
   état de marche.
5. **L'API doit rester joignable par n8n, et ce n'est pas un oubli.** Les
   workflows l'appellent de l'extérieur du processus — en local par
   `host.docker.internal:5000`, en production par son domaine. **La lier à
   `127.0.0.1` couperait les quatre agents.** L'exposition est structurelle :
   c'est au pare-feu ou au groupe de sécurité de la borner, jamais au code.

### Client

```bash
cd client && npm ci && npm run build     # produit dist/
```

`dist/` est un site statique. **Il faut renvoyer `index.html` sur toutes les
routes inconnues** : les URL comme `/evenements/abc` n'existent pas côté
serveur, elles sont résolues par React Router. Sans cette règle, un
rafraîchissement sur une page interne rend un 404.

En production, `VITE_API_URL` doit pointer vers l'URL complète de l'API — le
proxy Vite n'existe qu'en développement.

### Webhooks Stripe

Le relais `stripe listen` ne sert **qu'en local**. En production :

1. Déclarer l'URL `https://<api>/api/webhooks/stripe` dans le tableau de bord
   Stripe.
2. Reporter le secret de signature affiché dans `STRIPE_WEBHOOK_SECRET`.
3. Vérifier que **les neuf événements que le code traite** sont abonnés :

```
checkout.session.completed        customer.subscription.updated
customer.subscription.deleted     invoice.payment_succeeded
invoice.payment_failed            account.updated
v2.core.account.updated           capability.updated
account.external_account.created
```

> `capability.updated` est facile à oublier et son absence a déjà été
> constatée : sans lui, un coach dont Stripe vient de valider le dossier reste
> bloqué en « en attente » jusqu'à un rafraîchissement manuel.

**Le secret du tableau de bord n'est PAS celui de la CLI.** C'est le même
piège qu'en local, à l'envers : une signature refusée ressemble à un webhook
qui n'arrive pas.

**Et les trois adresses doivent désigner le même domaine** — `PUBLIC_URL`,
l'URL de l'endpoint Stripe, et le domaine du front. Si l'une diverge, soit le
webhook arrive sans que l'acheteur ne revienne, soit l'inverse : dans les deux
cas **l'abonnement n'est pas créé alors que le paiement a abouti**.

#### En local, sans `stripe login`

La CLI accepte la clé de test directement, ce qui évite le passage par le
navigateur :

```bash
stripe listen --api-key sk_test_… --forward-to localhost:5000/api/webhooks/stripe
```

Comparer le `whsec_…` affiché avec `STRIPE_WEBHOOK_SECRET` **avant** de lancer
`test:paiement` : s'ils diffèrent, les treize vérifications d'abonnement
échouent sur une cause qu'aucun de leurs messages ne nomme.

### Poids du paquet client

```
index          360 ko  (103 ko gzip)   React, Router, Axios, Socket.io
etalerPositions 156 ko  (46 ko gzip)   Leaflet — chargé à la demande
distance       103 ko  (37 ko gzip)    dépendances partagées des écrans carte
```

**Leaflet est absent du paquet principal** — vérifiable par
`grep -c leaflet dist/assets/index-*.js`, qui doit rendre `0`. Les trois
écrans qui l'utilisent sont chargés à la demande. Socket.io, lui, est bien
dans le principal : il se connecte sur toutes les pages, pour les pastilles
de messages et de notifications.

---

## Licence

Projet réalisé dans un cadre scolaire.
