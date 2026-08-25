# Architecture — Réseau social sportif (Coach ↔ Utilisateurs)

Document de référence. Version 2 — décisions techniques arbitrées.

## 0. Décisions techniques validées

| Sujet | Choix retenu | Conséquence |
|---|---|---|
| Stockage médias | **Cloudinary** | Upload signé côté serveur, transformations et miniatures déléguées, compatible hébergement à disque éphémère |
| Paiement | **Stripe Connect** (comptes Express) | Chaque coach possède un compte Stripe connecté ; onboarding KYC obligatoire avant monétisation ; commission plateforme prélevée via `application_fee_percent` |
| Messagerie | **Socket.io** (temps réel) | Authentification du socket par JWT, notification live incluant un extrait du message |
| CSS | **Tailwind CSS** | Approche mobile-first, pas de librairie de composants |
| Modération | **Compte admin** (`type: 'admin'`) | Vérifie les diplômes, valide les profils coachs, back-office dédié |
| Build front | **Vite** | CRA est déprécié |
| Base de données | **MongoDB Atlas** | Index `2dsphere` et TTL disponibles sans configuration |
| Modules Node | **ESM** (`import`/`export`) | Même syntaxe côté front et back |
| Express | **v4.21** (pas v5) | `express-mongo-sanitize` est incompatible avec Express 5 (`req.query` y est en lecture seule) |

### Cycle de vie d'un coach

```
inscription
  -> diplome.statut = 'en_attente'          (profil visible, pas de premium)
  -> admin vérifie le diplôme
     -> 'refuse'  : motif renvoyé, nouvel envoi possible
     -> 'verifie' : badge « coach certifié » débloqué
        -> onboarding Stripe Connect (KYC)
           -> stripeAccount.chargesEnabled = true
              -> le coach peut fixer son prix et publier du contenu premium
```

Un contenu premium ne peut donc être publié que si les **trois** conditions
sont réunies : diplôme vérifié, compte Stripe actif, prix défini.

---

## 1. Arborescence du projet

Monorepo simple à deux dossiers (`server/` et `client/`), sans outil de monorepo
(pas de Turborepo/Nx) : plus simple à défendre en soutenance, suffisant ici.

```
ProjetFinalExam2026/
├── docs/
│   └── ARCHITECTURE.md
├── .gitignore
├── README.md
│
├── server/                          # ---------- BACK-END (Node/Express) ----------
│   ├── .env                         # jamais commité
│   ├── .env.example                 # modèle des variables (commité)
│   ├── package.json
│   ├── src/
│   │   ├── server.js                # point d'entrée : connexion DB + listen()
│   │   ├── app.js                   # instance Express, middlewares globaux, montage routes
│   │   │
│   │   ├── config/
│   │   │   ├── db.js                # connexion Mongoose
│   │   │   ├── env.js               # lecture + validation des variables d'env
│   │   │   ├── cloudinary.js        # config du stockage média
│   │   │   └── stripe.js            # instance du SDK Stripe
│   │   │
│   │   ├── models/                  # schémas Mongoose
│   │   │   ├── User.js
│   │   │   ├── Follow.js
│   │   │   ├── Post.js
│   │   │   ├── Comment.js
│   │   │   ├── Story.js
│   │   │   ├── StoryView.js
│   │   │   ├── Subscription.js
│   │   │   ├── SportEvent.js
│   │   │   ├── EventRegistration.js
│   │   │   ├── Conversation.js
│   │   │   ├── Message.js
│   │   │   ├── Notification.js
│   │   │   └── ProcessedWebhook.js  # idempotence des webhooks Stripe
│   │   │
│   │   ├── controllers/             # logique HTTP (req -> service -> res)
│   │   │   ├── auth.controller.js
│   │   │   ├── user.controller.js
│   │   │   ├── post.controller.js
│   │   │   ├── comment.controller.js
│   │   │   ├── story.controller.js
│   │   │   ├── follow.controller.js
│   │   │   ├── subscription.controller.js
│   │   │   ├── stripeWebhook.controller.js
│   │   │   ├── event.controller.js
│   │   │   ├── message.controller.js
│   │   │   ├── notification.controller.js
│   │   │   ├── search.controller.js
│   │   │   └── geo.controller.js
│   │   │
│   │   ├── services/                # règles métier réutilisables (hors HTTP)
│   │   │   ├── auth.service.js      # hash, tokens, refresh
│   │   │   ├── access.service.js    # "cet utilisateur peut-il voir ce contenu ?"
│   │   │   ├── feed.service.js      # construction du fil d'actualité
│   │   │   ├── notification.service.js
│   │   │   └── stripe.service.js
│   │   │
│   │   ├── routes/
│   │   │   ├── index.js             # routeur racine, monte tous les sous-routeurs
│   │   │   ├── auth.routes.js
│   │   │   ├── user.routes.js
│   │   │   ├── post.routes.js
│   │   │   ├── comment.routes.js
│   │   │   ├── story.routes.js
│   │   │   ├── follow.routes.js
│   │   │   ├── subscription.routes.js
│   │   │   ├── webhook.routes.js    # monté AVANT express.json() (raw body requis)
│   │   │   ├── event.routes.js
│   │   │   ├── message.routes.js
│   │   │   ├── notification.routes.js
│   │   │   ├── search.routes.js
│   │   │   └── geo.routes.js
│   │   │
│   │   ├── middlewares/
│   │   │   ├── auth.middleware.js       # vérifie le JWT, injecte req.user
│   │   │   ├── role.middleware.js       # restreint aux coachs / coachs vérifiés
│   │   │   ├── validate.middleware.js   # exécute les règles express-validator
│   │   │   ├── upload.middleware.js     # Multer : type MIME + taille max
│   │   │   ├── rateLimit.middleware.js  # anti brute-force sur /auth
│   │   │   ├── notFound.middleware.js
│   │   │   └── error.middleware.js      # gestionnaire d'erreurs centralisé
│   │   │
│   │   ├── validators/                  # schémas de validation par ressource
│   │   │   ├── auth.validator.js
│   │   │   ├── post.validator.js
│   │   │   ├── event.validator.js
│   │   │   └── user.validator.js
│   │   │
│   │   ├── utils/
│   │   │   ├── ApiError.js          # classe d'erreur avec statusCode
│   │   │   ├── asyncHandler.js      # évite les try/catch répétés
│   │   │   ├── pagination.js
│   │   │   └── geocode.js           # adresse -> coordonnées (événements)
│   │   │
│   │   └── sockets/                 # temps réel (si Socket.io retenu)
│   │       ├── index.js
│   │       └── chat.handler.js
│   │
│   └── tests/
│       ├── auth.test.js
│       └── post.test.js
│
└── client/                          # ---------- FRONT-END (React + Vite) ----------
    ├── .env                         # VITE_API_URL, VITE_STRIPE_PUBLIC_KEY
    ├── index.html
    ├── vite.config.js
    ├── package.json
    └── src/
        ├── main.jsx
        ├── App.jsx                  # définition des routes
        │
        ├── api/                     # appels HTTP centralisés
        │   ├── axios.js             # instance + intercepteurs (token, refresh, 401)
        │   ├── auth.api.js
        │   ├── user.api.js
        │   ├── post.api.js
        │   ├── story.api.js
        │   ├── follow.api.js
        │   ├── subscription.api.js
        │   ├── event.api.js
        │   ├── message.api.js
        │   ├── notification.api.js
        │   └── search.api.js
        │
        ├── context/
        │   ├── AuthContext.jsx      # user courant, login/logout, token
        │   ├── NotificationContext.jsx
        │   └── SocketContext.jsx
        │
        ├── hooks/
        │   ├── useAuth.js
        │   ├── useGeolocation.js
        │   ├── useInfiniteScroll.js
        │   └── useDebounce.js       # pour la barre de recherche
        │
        ├── routes/
        │   ├── ProtectedRoute.jsx   # redirige vers /login si non authentifié
        │   └── CoachRoute.jsx       # réservé aux coachs
        │
        ├── components/
        │   ├── layout/
        │   │   ├── Navbar.jsx
        │   │   ├── Sidebar.jsx
        │   │   ├── BottomNav.jsx    # navigation mobile
        │   │   └── Layout.jsx
        │   ├── ui/                  # briques génériques réutilisables
        │   │   ├── Button.jsx
        │   │   ├── Input.jsx
        │   │   ├── Modal.jsx
        │   │   ├── Avatar.jsx
        │   │   ├── Spinner.jsx
        │   │   └── Tabs.jsx
        │   ├── post/
        │   │   ├── PostCard.jsx
        │   │   ├── PostForm.jsx
        │   │   ├── LikeButton.jsx
        │   │   ├── CommentList.jsx
        │   │   └── PremiumLock.jsx  # overlay "contenu réservé aux abonnés"
        │   ├── story/
        │   │   ├── StoryBar.jsx
        │   │   └── StoryViewer.jsx
        │   ├── profile/
        │   │   ├── ProfileHeader.jsx
        │   │   ├── ProfileTabs.jsx
        │   │   ├── EditProfileForm.jsx
        │   │   └── SubscribeButton.jsx
        │   ├── map/
        │   │   ├── CoachMap.jsx
        │   │   └── CoachPopup.jsx   # mini aperçu au clic sur un point
        │   ├── event/
        │   │   ├── EventCard.jsx
        │   │   └── EventForm.jsx
        │   ├── message/
        │   │   ├── ConversationList.jsx
        │   │   ├── ChatWindow.jsx
        │   │   └── ChatRequestBanner.jsx
        │   └── notification/
        │       └── NotificationItem.jsx
        │
        ├── pages/
        │   ├── auth/
        │   │   ├── Login.jsx
        │   │   └── Register.jsx
        │   ├── Home.jsx             # /home  — fil d'actualité
        │   ├── Maps.jsx             # /maps
        │   ├── Profile.jsx          # /profile/:id
        │   ├── Search.jsx           # /search
        │   ├── Messages.jsx         # /messages
        │   ├── Notifications.jsx    # /notifications
        │   ├── Events.jsx           # /events
        │   ├── EventDetail.jsx      # /events/:id
        │   ├── Settings.jsx
        │   ├── PaymentSuccess.jsx   # retour Stripe Checkout
        │   └── NotFound.jsx
        │
        ├── styles/
        │   ├── index.css
        │   └── variables.css        # couleurs, breakpoints
        │
        └── utils/
            ├── formatDate.js
            └── constants.js
```

---

## 2. Schéma de base de données

### 2.1 Vue d'ensemble des relations

```
User 1──n Post 1──n Comment
User n──n User      (via Follow : suivi gratuit, avec statut en_attente/accepte)
User n──n User      (via Subscription : abonnement premium payant Stripe)
User 1──n Story
User 1──n SportEvent 1──n EventRegistration n──1 User
User n──n Conversation 1──n Message
User 1──n Notification
```

Deux relations distinctes entre utilisateurs, c'est le cœur du projet :

| | Follow | Subscription |
|---|---|---|
| Coût | gratuit | payant (Stripe) |
| Donne accès à | posts publics (`estPremium: false`) | posts premium (`estPremium: true`) |
| Cible | tout profil | coachs vérifiés uniquement |
| Cycle de vie | manuel (unfollow) | géré par Stripe (renouvellement, échec, résiliation) |

### 2.2 Corrections apportées au modèle initial

1. **`followers` / `following` sortis de `User` → collection `Follow`.**
   Un tableau dans le document User ne permet pas de stocker un statut
   `en_attente`, or le cahier des charges exige des demandes de follow
   (profil privé + notification « demande d'abonnement »). Une collection
   dédiée gère aussi la date de suivi et évite les écritures concurrentes
   sur un même document.

2. **`abonnesPremium` supprimé de `User`.**
   Cette liste ferait doublon avec `Subscription` et se désynchroniserait du
   statut réel chez Stripe. `Subscription` devient l'unique source de vérité ;
   les compteurs affichés sont dénormalisés dans `User.stats`.

3. **`commentaires` sortis de `Post` → collection `Comment`.**
   Un post très commenté ferait grossir le document sans limite (plafond
   16 Mo) et interdirait la pagination des commentaires.

4. **`likes` reste un tableau dans `Post`.** À l'échelle du projet c'est le
   bon compromis : test d'appartenance immédiat côté client, pas de jointure.

5. **`messages` sortis de `Conversation` → collection `Message`.** Même raison
   que les commentaires, en plus critique (une conversation vit des mois).

6. **`diplome` devient un sous-document avec workflow de vérification**
   (`en_attente` / `verifie` / `refuse`), condition d'accès à la monétisation.

7. **Ajout de `ProcessedWebhook`** pour l'idempotence : Stripe peut renvoyer
   plusieurs fois le même événement, il ne faut pas le traiter deux fois.

8. **Ajout des tarifs premium sur le coach** (`premium.stripePriceId`) :
   sans prix, impossible de créer un abonnement récurrent Stripe.

### 2.3 Modèles détaillés

#### User
```
type            : 'utilisateur' | 'coach' | 'admin'  (immuable après création)
nom, prenom, pseudo (unique, lowercase), email (unique, lowercase)
password        : String, select: false            (hash bcrypt, jamais renvoyé)
avatar          : { url, publicId }
bio             : String, max 300
sports          : [String]                          (filtres et recommandations)
ville           : String
localisation    : { type: 'Point', coordinates: [lng, lat] }   /!\ ordre GeoJSON
visibilite      : 'public' | 'prive'    (défaut 'public')
diplome         : {                                 (coachs)
                    intitule, organisme, url, publicId,
                    statut: 'non_soumis'|'en_attente'|'verifie'|'refuse',
                    motifRefus, dateSoumission,
                    dateVerification, verifiePar: ref User (admin)
                  }
premium         : {                                 (coachs)
                    actif: Boolean,
                    prixMensuel: Number,            (en centimes)
                    devise: 'eur',
                    stripeProductId, stripePriceId
                  }
stripeCustomerId : String                           (côté payeur)
stripeAccount   : {                                 (Stripe Connect, coachs)
                    id: String,                     (acct_xxx)
                    statut: 'non_cree'|'en_attente'|'actif'|'restreint',
                    chargesEnabled: Boolean,        (peut encaisser)
                    payoutsEnabled: Boolean,        (peut être viré)
                    dateOnboarding
                  }
stats           : { followersCount, followingCount,
                    postsCount, abonnesPremiumCount }
refreshTokenVersion : Number                        (invalide les refresh tokens)
isActive        : Boolean
derniereConnexion : Date
timestamps
```
Index : `2dsphere` sur `localisation` · unique sur `email` et `pseudo` ·
texte sur `pseudo`, `nom`, `prenom` (recherche) · `{ type: 1, ville: 1 }`.

#### Follow
```
follower  : ref User          (celui qui suit)
following : ref User          (celui qui est suivi)
statut    : 'en_attente' | 'accepte'
timestamps
```
Index : unique `{ follower, following }` (anti-doublon) ·
`{ following, statut }` · `{ follower, statut }`.
Règle : profil public → `accepte` direct ; profil privé → `en_attente`
plus notification.

#### Post
```
auteur      : ref User
titre       : String
description : String
medias      : [{ url, publicId, type: 'image'|'video', largeur, hauteur, duree }]
estPremium  : Boolean          (réservé aux coachs vérifiés + premium actif)
likes       : [ref User]
commentsCount : Number         (compteur dénormalisé)
timestamps
```
Index : `{ auteur, createdAt: -1 }` · `{ estPremium, createdAt: -1 }`.

#### Comment
```
post   : ref Post
auteur : ref User
texte  : String, max 1000
parent : ref Comment | null    (réponses à un commentaire)
timestamps
```
Index : `{ post, createdAt: -1 }`.

#### Story
```
auteur     : ref User
media      : { url, publicId, type: 'image'|'video' }
estPremium : Boolean
vuesCount  : Number
expireAt   : Date              (défaut : maintenant + 24h)
timestamps
```
Index : `{ expireAt: 1 }, expireAfterSeconds: 0` → suppression automatique.
/!\ Le TTL MongoDB supprime le document mais **ne déclenche aucun hook
Mongoose** : les fichiers restent sur le service de stockage. Prévoir une
tâche planifiée de nettoyage des médias orphelins.

#### StoryView
```
story, spectateur : ref User  |  timestamps
```
Index : unique `{ story, spectateur }`.

#### Subscription
```
utilisateur          : ref User
coach                : ref User
statut               : 'incomplete'|'actif'|'impaye'|'annule'|'expire'
                       (aligné sur les statuts Stripe)
dateDebut, dateFin   : Date
periodeFin           : Date        (current_period_end)
annuleALaFinPeriode  : Boolean
stripeCustomerId, stripeSubscriptionId, stripePriceId
montant, devise
timestamps
```
Index : unique partiel `{ utilisateur, coach }` où `statut: 'actif'`
(interdit deux abonnements actifs au même coach) ·
unique `{ stripeSubscriptionId }` · `{ coach, statut }`.

#### SportEvent
```
organisateur : ref User (coach)
type         : 'public' | 'prive'
titre, description
dateDebut, dateFin
lieu         : { adresse, ville, codePostal,
                 localisation: { type:'Point', coordinates:[lng,lat] } }
capaciteMax  : Number | null
inscritsCount : Number
image        : { url, publicId }
statut       : 'planifie' | 'annule' | 'termine'
timestamps
```
Index : `2dsphere` sur `lieu.localisation` · `{ dateDebut: 1 }` ·
`{ organisateur, dateDebut: -1 }`.
Validation : `dateFin > dateDebut` ; événement `prive` visible seulement
des abonnés premium du coach.

#### EventRegistration
```
event, utilisateur : ref
statut : 'inscrit' | 'annule' | 'en_attente'
timestamps
```
Index : unique `{ event, utilisateur }`.
Séparé du tableau `inscrits` pour éviter les inscriptions concurrentes
en double et garder l'historique.

#### Conversation
```
participants        : [ref User]  (exactement 2)
statut              : 'en_attente' | 'accepte' | 'refuse'
demandeur           : ref User    (qui a initié)
dernierMessage      : { texte, expediteur, date }
nonLus              : Map<userId, Number>
timestamps
```
Index : `{ participants: 1 }` · `{ 'dernierMessage.date': -1 }`.
Règle métier : si la cible suit déjà l'initiateur → `accepte` immédiat,
sinon `en_attente` plus notification de demande de chat.

#### Message
```
conversation : ref Conversation
expediteur   : ref User
contenu      : String
media        : { url, publicId, type } | null
lu           : Boolean
timestamps
```
Index : `{ conversation, createdAt: -1 }`.

#### Notification
```
destinataire : ref User
emetteur     : ref User
type         : 'follow' | 'demande_follow' | 'like' | 'commentaire'
             | 'demande_chat' | 'message' | 'inscription_event'
             | 'nouvel_abonne_premium' | 'diplome_verifie'
cibleType    : 'Post'|'Comment'|'SportEvent'|'User'|'Conversation'
cible        : ObjectId (refPath: 'cibleType')
lu           : Boolean
timestamps
```
Index : `{ destinataire, lu, createdAt: -1 }`.

#### ProcessedWebhook
```
stripeEventId : String (unique)
type          : String
createdAt     : Date (TTL 30 jours)
```

### 2.4 Règle d'accès à un contenu (service `access.service.js`)

Un utilisateur A peut voir un post P de l'auteur B si :

```
A === B                                                    -> oui
P.estPremium  -> Subscription(A, B, statut 'actif') existe -> sinon non
B.visibilite === 'public'                                  -> oui
B.visibilite === 'prive'  -> Follow(A->B, 'accepte') existe -> sinon non
```

Cette logique est centralisée dans un seul service, appelé par tous les
contrôleurs, pour éviter les fuites de contenu premium.

---

## 3. Dépendances npm

### Back-end
```
express mongoose dotenv bcryptjs jsonwebtoken cors helmet
express-validator express-rate-limit express-mongo-sanitize
multer cloudinary multer-storage-cloudinary
stripe cookie-parser compression morgan
socket.io
--dev  nodemon jest supertest cross-env
```

### Front-end
```
react react-dom react-router-dom axios
leaflet react-leaflet
@stripe/stripe-js @stripe/react-stripe-js
date-fns react-hot-toast socket.io-client
--dev  vite @vitejs/plugin-react eslint
```

---

## 4. Ordre de développement

| # | Module | Contenu |
|---|---|---|
| 1 | Socle | config, connexion DB, app Express, middlewares erreurs, modèle User |
| 2 | Auth back | register/login/refresh/logout, bcrypt, JWT, validation |
| 3 | Auth front | Context, routes protégées, pages Login/Register, intercepteurs Axios |
| 4 | Profils | consultation, édition, visibilité, upload avatar |
| 5 | Posts & stories | upload médias, likes, commentaires, fil d'actualité |
| 6 | Follow | demandes, acceptation, compteurs |
| 7 | Premium Stripe | Checkout, webhooks, déverrouillage du contenu |
| 8 | Géolocalisation | recherche `$near`, carte Leaflet |
| 9 | Événements | création, inscription, compteur |
| 10 | Recherche | index texte, autocomplétion |
| 11 | Messagerie | conversations, demandes de chat, temps réel |
| 12 | Notifications | génération centralisée, badge, liste |
| 13 | Finitions | responsive, tests, README, déploiement |
