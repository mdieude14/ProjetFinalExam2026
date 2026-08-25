# Suivi d'avancement

Journal des tâches par module. Mis à jour à chaque étape.
Légende : `[x]` terminé et vérifié · `[~]` en cours · `[ ]` à faire

---

## Module 0 — Cadrage  `TERMINÉ`

- [x] Arborescence complète front + back proposée et validée
- [x] Schéma de base de données final rédigé ([ARCHITECTURE.md](ARCHITECTURE.md))
- [x] 8 corrections apportées au modèle initial (Follow, Comment, Message,
      EventRegistration en collections séparées ; `abonnesPremium` supprimé ;
      diplôme avec workflow ; `ProcessedWebhook` ; tarifs Stripe)
- [x] Décisions techniques arbitrées : Cloudinary · Stripe Connect · Socket.io ·
      Tailwind · compte admin · Vite · ESM · Express 4

---

## Module 1 — Socle back-end  `TERMINÉ`

### Environnement
- [x] Node mis à jour : 18.13.0 → **24.19.0 LTS** (npm 11.17.0)
- [x] Docker Desktop démarré
- [x] MongoDB 8 lancé en conteneur `sportsocial-mongo`
- [x] Configuré en **replica set mono-nœud `rs0`** (transactions + change streams)
- [x] Volume persistant `sportsocial-mongo-data`, redémarrage automatique
- [x] 148 dépendances installées sans avertissement

### Fichiers créés
- [x] `server/package.json` — ESM, Express 4.21, scripts `dev` / `start`
- [x] `server/.env.example` — modèle documenté de toutes les variables
- [x] `server/.env` — configuration locale réelle (ignoré par git)
- [x] `server/src/config/env.js` — validation des variables au démarrage
- [x] `server/src/config/db.js` — connexion Mongoose + événements + arrêt propre
- [x] `server/src/utils/ApiError.js` — erreurs applicatives typées
- [x] `server/src/utils/asyncHandler.js` — capture des rejets de promesses
- [x] `server/src/middlewares/error.middleware.js` — gestionnaire centralisé
- [x] `server/src/middlewares/notFound.middleware.js` — 404 propre
- [x] `server/src/models/User.js` — modèle complet 3 types de comptes
- [x] `server/src/routes/index.js` — routeur racine + `/api/health`
- [x] `server/src/app.js` — pipeline Express complet
- [x] `server/src/server.js` — démarrage, signaux système, arrêt propre
- [x] `.gitignore` — `.env` et `node_modules` exclus (vérifié)

### Sécurité mise en place
- [x] Helmet (en-têtes HTTP)
- [x] CORS restreint aux origines déclarées, avec `credentials`
- [x] `express-mongo-sanitize` (anti-injection NoSQL)
- [x] Limite de corps à 1 Mo
- [x] `trust proxy` pour un rate limiting correct derrière un reverse proxy
- [x] Pile d'appels masquée en production
- [x] Emplacement du webhook Stripe réservé **avant** `express.json()`

### Vérifications passées — 20/20
- [x] Hachage bcrypt automatique, `comparePassword` OK dans les deux sens
- [x] Mot de passe absent des requêtes et du JSON
- [x] `refreshTokenVersion` et justificatif de diplôme masqués
- [x] Doublon de pseudo → erreur 11000
- [x] Coordonnées GeoJSON hors limites → `ValidationError`
- [x] Requête `$near` fonctionnelle (index 2dsphere actif)
- [x] Index texte et index de modération créés
- [x] Transactions opérationnelles (replica set validé)
- [x] `GET /api/health` → `"base": "connecte"`
- [x] `GET /api/inexistante` → 404 JSON structuré

---

## Module 2 — Authentification back-end  `TERMINÉ`

### 2.1 Service de tokens
- [x] `services/auth.service.js`
  - [x] Access token 15 min, renvoyé en JSON (stocké en mémoire par le front)
  - [x] Refresh token 7 j en cookie httpOnly, portant `refreshTokenVersion`
  - [x] Secrets **différents** pour les deux types de jetons
  - [x] Vérification et décodage
  - [x] Pose/suppression/lecture du cookie, options adaptées dev vs production
  - [x] `emettreSession()` mutualisée entre register, login et refresh

### 2.2 Validation des entrées
- [x] `middlewares/validate.middleware.js` — agrège les erreurs par champ
- [x] `validators/auth.validator.js`
  - [x] Inscription : type, nom, prénom, pseudo, email, mot de passe fort
  - [x] Connexion : identifiant (email **ou** pseudo) + mot de passe
  - [x] Changement de mot de passe, avec refus d'un mot de passe identique
  - [x] Normalisation (trim, minuscules) et échappement HTML
  - [x] Borne haute à 128 caractères (bcrypt tronque à 72 octets)

### 2.3 Middlewares de protection
- [x] `middlewares/auth.middleware.js`
  - [x] `protect` — Bearer token, rechargement en base, rejet des comptes désactivés
  - [x] `protectOptionnel` — enrichit la requête si connecté, sans l'exiger
- [x] `middlewares/role.middleware.js`
  - [x] `autoriser(...types)` — restriction par type de compte
  - [x] `coachCertifie` — diplôme vérifié requis, message selon le statut
  - [x] `peutMonetiser` — diplôme + Stripe + tarif
  - [x] `proprietaireOuAdmin` — propriétaire de la ressource ou modérateur
- [x] `middlewares/rateLimit.middleware.js`
  - [x] Connexion : 5 échecs / 15 min (les succès ne comptent pas)
  - [x] Inscription : 10 / heure
  - [x] Refresh : 30 / 15 min
  - [x] Global : 300 / 15 min — **monté sur `/api` dans `app.js`**
        (lacune détectée à l'audit : le limiteur était écrit mais jamais
        appliqué ; placé après l'emplacement des webhooks Stripe, qui ne
        doivent jamais être bloqués sous peine de perdre des paiements)
  - [x] Neutralisé en développement, réactivable via `RATE_LIMIT_DEV=true`

### 2.4 Contrôleur
- [x] `controllers/auth.controller.js`
  - [x] `POST /register` — utilisateur ou coach ; admin refusé en 403
  - [x] `POST /login` — email ou pseudo, message générique, hash leurre anti-timing
  - [x] `POST /refresh` — rotation du refresh token, contrôle de version
  - [x] `POST /logout` — suppression du cookie
  - [x] `POST /logout-all` — révocation de toutes les sessions
  - [x] `GET /me` — restauration de session au démarrage du front
  - [x] `PATCH /password` — ancien mot de passe exigé, autres appareils déconnectés

### 2.5 Routes
- [x] `routes/auth.routes.js` — 7 routes, ordre des middlewares documenté
- [x] Branché sur `/api/auth` dans `routes/index.js`

### 2.6 Compte administrateur
- [x] `scripts/creerAdmin.js` — création en ligne de commande uniquement
- [x] Script npm `creer-admin`
- [x] Vérifie la robustesse du mot de passe, alerte si un admin existe déjà

### 2.7 Vérifications — 49/49 en HTTP réel
- [x] Inscription utilisateur (201) et coach (diplôme en file de modération)
- [x] Inscription en tant qu'admin refusée, aucun admin créé en base
- [x] Mots de passe faibles, emails et pseudos invalides rejetés en 400
- [x] Doublons email et pseudo → 409 avec message en français
- [x] Connexion par email et par pseudo, casse ignorée
- [x] Message identique pour compte inconnu et mauvais mot de passe
- [x] Écart de temps de réponse de 36 ms (anti-attaque temporelle)
- [x] Injection NoSQL `{ $gt: "" }` neutralisée
- [x] `/me` : 401 sans token, 401 token falsifié, 401 token malformé, 200 valide
- [x] Refresh avec rotation ; 401 sans cookie
- [x] Ancien refresh token révoqué après changement de mot de passe
- [x] `logout-all` révoque toutes les sessions
- [x] Cookie effacé à la déconnexion
- [x] **Rate limiting** : 5 tentatives passent, la 6ᵉ renvoie 429
- [x] Script admin : 4 cas testés (args manquants, mot de passe faible,
      création, doublon) — l'admin se connecte ensuite normalement via l'API
- [x] Attributs du cookie vérifiés : `HttpOnly`, `Path=/api/auth`, `SameSite=Lax`

---

## Module 3 — Authentification front-end  `TERMINÉ`

### 3.1 Initialisation du projet
- [x] Vite 8 + React 19 dans `client/`
- [x] `react-router-dom` 7, `axios` 1.19
- [x] Tailwind 4 via le plugin `@tailwindcss/vite`
      (plus de `tailwind.config.js` : le thème se déclare en CSS)
- [x] Palette du projet dans `@theme` — `marque-*` (orange), `ardoise-*`,
      couleurs de statut, rayon `--radius-carte`
- [x] `client/.env` et `.env.example` — `VITE_API_URL`
- [x] Proxy Vite `/api` → `localhost:5000` : même origine en développement,
      le cookie httpOnly circule sans contrainte CORS
- [x] Alias d'import `@/` → `src/`
- [x] Fichiers de démonstration Vite supprimés, `index.html` en français

### 3.2 Couche API
- [x] `api/axios.js`
  - [x] `baseURL` + `withCredentials: true`
  - [x] Intercepteur de requête : injection du header `Authorization`
  - [x] Intercepteur de réponse : sur 401, refresh puis rejeu transparent
  - [x] **Mutualisation** : plusieurs 401 simultanés ne déclenchent qu'un
        seul `/auth/refresh`, les autres attendent la même promesse
  - [x] Drapeau `_dejaRejouee` : pas de boucle infinie sur 401 persistant
  - [x] `/auth/login`, `/register` et `/refresh` exclus du renouvellement
  - [x] Token en mémoire, jamais dans `localStorage`
  - [x] Message dédié quand le serveur est injoignable
  - [x] Normalisation des erreurs (`message`, `details` au premier niveau)
- [x] `api/auth.api.js` — 7 appels nommés

### 3.3 État d'authentification global
- [x] `context/AuthContext.jsx`
  - [x] État `utilisateur`, `chargement`, `estConnecte`, `estCoach`, `estAdmin`
  - [x] Restauration de session au démarrage via `/auth/refresh`
  - [x] Actions `connexion`, `inscription`, `deconnexion`, `majUtilisateur`
  - [x] Drapeau `annule` pour le double montage du StrictMode
  - [x] Branchement du gestionnaire de session expirée de l'intercepteur
  - [x] `useMemo` sur la valeur du contexte (évite les rendus inutiles)
- [x] `hooks/useAuth.js` — message explicite si utilisé hors provider

### 3.4 Routage
- [x] `App.jsx` — gardes déclarées en **routes parentes** : impossible
      d'ajouter une page protégée en oubliant de la protéger
- [x] `routes/ProtectedRoute.jsx` — attend la fin du chargement, mémorise
      la page demandée dans `state.depuis`
- [x] `routes/PublicRoute.jsx` — un connecté ne revoit pas `/login`
- [x] `routes/RoleRoute.jsx` — exporte `CoachRoute` et `AdminRoute`
- [x] `pages/NotFound.jsx` — 404 côté front

### 3.5 Composants d'interface réutilisables
- [x] `components/ui/Button.jsx` — 4 variantes, 3 tailles, `aria-busy`,
      désactivation pendant le chargement (anti double soumission)
- [x] `components/ui/Input.jsx` — `useId`, `aria-invalid`, `aria-describedby`,
      affichage/masquage du mot de passe
- [x] `components/ui/Spinner.jsx` + `EcranChargement`
- [x] `components/ui/Alert.jsx` — 4 variantes, couleur **et** pictogramme
- [x] `utils/erreurs.js` — mapping des erreurs API vers les champs,
      évaluation de la robustesse du mot de passe

### 3.6 Pages d'authentification
- [x] `pages/auth/Login.jsx` — identifiant email **ou** pseudo, erreurs
      globales et par champ, retour vers la page initialement demandée
- [x] `pages/auth/Register.jsx` — choix visuel du type de compte, champs
      diplôme conditionnels, indicateur de robustesse en 4 critères,
      géolocalisation facultative avec inversion lat/lng documentée
- [x] `pages/Home.jsx` — provisoire, affiche le compte et le statut du diplôme
- [x] Design responsive mobile-first sur toutes les pages

### 3.7 Vérifications
**Build** — `npm run build` : 92 modules, aucune erreur.

**Parcours via le proxy Vite — 14/14**
- [x] Inscription et connexion à travers `localhost:5173/api`
- [x] Cookie httpOnly transmis, attribut `Path=/api/auth` préservé
- [x] Restauration de session, `/me` avec Bearer token
- [x] Format des erreurs exploitable par les formulaires

**Parcours dans un vrai Chromium (Playwright) — 32/32**
- [x] Racine et `/home` redirigent un visiteur vers `/login`
- [x] Bouton « Afficher » bascule bien le type du champ mot de passe
- [x] Erreur serveur affichée dans une alerte
- [x] Champs diplôme masqués pour un sportif, affichés pour un coach
- [x] Indicateur de robustesse : critères au vert en direct
- [x] Erreurs de validation serveur affichées sous les bons champs
- [x] Inscription → redirection `/home`, prénom et statut du diplôme affichés
- [x] **Session restaurée après F5**
- [x] Un connecté est renvoyé de `/login` vers `/home`
- [x] Déconnexion → `/login`, `/home` de nouveau inaccessible
- [x] Reconnexion, page 404
- [x] Aucun débordement horizontal en 375, 768 et 1440 px
- [x] Prénom/nom empilés en mobile, côte à côte en desktop
- [x] Console navigateur propre, aucune erreur JavaScript

**Captures d'écran** vérifiées visuellement : login desktop, inscription
coach desktop, inscription mobile, accueil mobile.

Base de données laissée vide, scripts temporaires supprimés.

---

## Module 4 — Gestion des profils  `TERMINÉ`

### 4.1 Modèle — trois niveaux de visibilité des données
- [x] `User.versionPublique()` — sans email ni données de paiement ;
      inclut le tarif premium du coach (information commerciale)
- [x] `User.versionPrivee()` — vue du propriétaire, **justificatif de diplôme
      compris** : correction du `transform` trop strict signalé au module 2
- [x] `User.versionAdmin()` — tout sauf le hash du mot de passe
- [x] `/auth/*` bascule sur `versionPrivee()`
- [x] Modèle `Follow` (schéma + index + `suitDeja` / `statutRelation`) ;
      les routes de suivi viendront au module 6

### 4.2 Service de contrôle d'accès
- [x] `services/access.service.js`
  - [x] `relationAvec()` → soi / admin / abonné / en_attente / aucune
  - [x] `peutVoirProfil()` — un profil privé reste **identifiable**, seul son
        contenu est masqué (sinon personne ne pourrait demander à le suivre)
  - [x] `peutVoirContenu()` — public, propriétaire, admin ou abonné accepté
  - [x] `peutVoirPremium()` — préparé pour le module 7
  - [x] `construireVueProfil()` — point d'entrée unique des contrôleurs

### 4.3 Validation
- [x] `validators/user.validator.js` — édition, visibilité, position,
      diplôme, décision de modération, statut de compte, pagination
- [x] `utils/pagination.js` — bornes et enveloppe de réponse standard

### 4.4 Contrôleur utilisateurs
- [x] `GET /users/me`
- [x] `GET /users/:identifiant` — ObjectId **ou** pseudo, `protectOptionnel`
- [x] `PATCH /users/me` — liste blanche `CHAMPS_MODIFIABLES`
- [x] `PATCH /users/me/visibilite` — les abonnés existants sont conservés
- [x] `PATCH /users/me/localisation`
- [x] `POST /users/me/diplome` — refus si déjà vérifié ou en cours
- [x] `DELETE /users/me` — désactivation, jamais suppression

### 4.5 Back-office de modération
- [x] `GET /admin/diplomes` — file triée du plus ancien au plus récent
- [x] `PATCH /admin/diplomes/:id` — décision + traçabilité (qui, quand)
- [x] `PATCH /admin/users/:id/statut` — révoque les sessions à la désactivation
- [x] `GET /admin/stats` — 8 indicateurs, requêtes en parallèle
- [x] Un admin ne peut pas se désactiver lui-même

### 4.6 Routes
- [x] `routes/user.routes.js` — routes fixes déclarées **avant** `/:identifiant`
- [x] `routes/admin.routes.js` — `router.use(protect, autoriser('admin'))`
      applique la protection à tout le routeur, présent et futur

### 4.7 Front — couche API et navigation
- [x] `api/user.api.js`, `api/admin.api.js`
- [x] `components/layout/Navbar.jsx` — liens en haut sur desktop,
      barre fixe en bas sur mobile, menu de compte selon le rôle
- [x] `components/layout/Layout.jsx` — coquille commune
- [x] `CoachRoute` et `AdminRoute` branchées dans `App.jsx`

### 4.8 Front — pages
- [x] `pages/Profile.jsx` — badges, statistiques, bloc coach, offre premium,
      état « compte privé »
- [x] `pages/Settings.jsx` — 5 sections indépendantes, confirmation par saisie
      du mot « DESACTIVER » pour la désactivation
- [x] `pages/coach/Diplome.jsx` — écran adapté aux 4 statuts
- [x] `pages/admin/Moderation.jsx` — tableau de bord, onglets, refus motivé
- [x] `components/ui/Textarea.jsx` (compteur), `Badge.jsx`, `Avatar.jsx`
- [x] `pages/Home.jsx` refondue — liste d'actions à mener

### 4.9 Vérifications — 141 au total

**Back-end en HTTP réel — 80/80**
- [x] Le coach revoit son justificatif ; un tiers et un anonyme ne le voient pas
- [x] Email, `refreshTokenVersion`, `stripeCustomerId`, `derniereConnexion`
      absents des vues publiques
- [x] Profil par pseudo et par ObjectId, anonyme accepté, 404 si inexistant
- [x] Profil privé : identité visible, contenu masqué ; visible pour un abonné
      accepté, masqué pour une demande en attente, visible pour l'admin
- [x] **Injection de `type: 'admin'`, `email`, `stats`, `diplome.statut`,
      `isActive`, `stripeCustomerId` → tous ignorés**, seul `bio` recopié
- [x] Coordonnées hors bornes rejetées ; recherche `$near` fonctionnelle
- [x] Re-soumission pendant instruction → 409 ; sportif → 403
- [x] Non-admin, coach et anonyme refusés sur `/api/admin`
- [x] Refus sans motif → 400 ; refus motivé → le coach lit le motif
- [x] Validation → `estCertifie` vrai, traçabilité écrite, badge public
- [x] `peutMonetiser` reste faux (Stripe et tarif manquants)
- [x] Dossier déjà traité → 409 ; admin ne peut pas s'auto-désactiver
- [x] Compte désactivé → connexion impossible, profil en 404 pour les tiers,
      toujours visible pour l'admin, document conservé

**Navigateur (Playwright), 3 acteurs simultanés — 61/61**
- [x] Parcours coach : inscription, édition, bascule de visibilité,
      soumission de diplôme, formulaire verrouillé pendant l'instruction
- [x] Bio de 400 caractères refusée par le **serveur** (contournement du
      `maxLength` du navigateur pour le prouver)
- [x] Menu du compte adapté au rôle ; sportif redirigé hors de `/admin` et `/coach`
- [x] Email du coach absent du HTML de la page profil, avant et après certification
- [x] Cycle complet refus motivé → lecture du motif → re-soumission → validation
- [x] Aucun débordement sur 3 pages × 3 tailles d'écran
- [x] Barre de navigation mobile en bas (y = 750), masquée en desktop
- [x] Console navigateur propre

**Captures d'écran** vérifiées : back-office de modération, profil de coach
certifié, page diplôme, paramètres en mobile.

Base nettoyée des comptes de test. Le compte réel `mdieude14` a été préservé.

---

## Module 5 — Posts, stories, likes et commentaires  `TERMINÉ`

### 5.1 Modèles
- [x] `models/Post.js` — médias multiples (1 à 10), `estPremium`, likes,
      `commentsCount`, méthode `versionPour(visiteur, accesPremium)`
- [x] `models/Comment.js` — collection séparée, réponses à un seul niveau
- [x] `models/Story.js` — **index TTL** sur `expireAt` (24 h)
- [x] `models/StoryView.js` — index unique `{ story, spectateur }` + TTL
- [x] Compteurs tenus à jour dans des **transactions** (replica set du module 1)

### 5.2 Stockage des médias
- [x] `services/storage.service.js` — adaptateur à deux implémentations
  - [x] **Cloudinary** dès que les 3 clés sont dans `.env`
  - [x] **Disque local** en repli automatique, pour développer sans compte
  - [x] Interface unique `televerser()` / `supprimer()` : le reste du code
        ignore lequel est actif ; basculer ne demande aucune modification
  - [x] `supprimer()` n'échoue jamais de façon bloquante (un fichier orphelin
        est un désagrément, un post ineffaçable est un vrai problème)
- [x] `config/cloudinary.js` — vérification des clés au démarrage
- [x] **Cloudinary activé et vérifié de bout en bout — 22/22**
      (compte `wxyexp7t`, journal au démarrage : `[MEDIAS] Cloudinary connecte`)
  - [x] URL en `https://res.cloudinary.com/…`, dossier `sportsocial/posts`
  - [x] Dimensions et poids renvoyés par Cloudinary (900 × 600, 111 574 o)
  - [x] Fichier téléchargeable depuis le CDN, signature PNG intacte
  - [x] Miniature 200 × 200 générée à la volée par transformation d'URL
  - [x] Suppression du post → fichier réellement effacé (API en 404)
  - [x] Remplacement d'avatar → ancien fichier effacé
  - [x] **`invalidate: true` ajouté à `destroy()`** : sans lui, le fichier
        disparaissait du stockage mais le CDN continuait de servir sa copie
        en cache — un contenu premium supprimé serait resté accessible à qui
        avait relevé l'URL. Constaté en test, corrigé.
- [x] `utils/dimensionsImage.js` — lecture des dimensions PNG/JPEG/GIF/WebP
      dans les premiers octets, sans bibliothèque native (5/5 formats testés)
- [x] `middlewares/upload.middleware.js` — Multer **en mémoire**
  - [x] Liste blanche MIME ; `image/svg+xml` volontairement exclu (XSS)
  - [x] 10 Mo par image, 100 Mo par vidéo, vérifiés fichier par fichier
  - [x] 10 fichiers max par publication, nombre de champs borné
  - [x] Extension recalculée depuis le MIME, nom du client jamais utilisé

### 5.3 Service de fil d'actualité
- [x] `services/feed.service.js`
  - [x] Publications des comptes suivis + les siennes
  - [x] Règles d'accès du module 4 appliquées (public/privé)
  - [x] Contenu premium **verrouillé** : médias retirés de la réponse
  - [x] Pagination par curseur sur `_id` (ObjectId chronologique)
  - [x] `abonnementsPremiumActifs()` — point unique à brancher au module 7

### 5.4 Contrôleur des publications
- [x] `POST /posts` — téléversement avant écriture, rattrapage si échec
- [x] `GET /posts/feed` · `GET /posts/utilisateur/:identifiant` · `GET /posts/:id`
- [x] `DELETE /posts/:id` — transaction (post + commentaires + compteur),
      puis suppression des fichiers hors transaction
- [x] `POST /posts/:id/like` — `$addToSet` / `$pull` atomiques

### 5.5 Commentaires
- [x] `POST /posts/:id/comments` — transaction avec le compteur du post
- [x] `GET /posts/:id/comments` — racines paginées, réponses à la demande
- [x] `DELETE /comments/:id` — auteur du commentaire, **auteur du post**
      (modération de sa section) ou admin ; les réponses suivent le parent

### 5.6 Stories
- [x] `POST /stories` · `GET /stories` (groupées par auteur) · `POST /:id/vue`
- [x] `GET /stories/:id/vues` — réservé à l'auteur
- [x] `DELETE /stories/:id` · `GET /stories/utilisateur/:identifiant`
- [x] Filtre explicite sur `expireAt` : le TTL ne passe qu'une fois par minute
- [x] `scripts/nettoyerMedias.js` — mode simulation par défaut, `--confirmer`
      pour agir ; gère les deux modes de stockage

### 5.7 Dépendance du module 4
- [x] `POST /users/me/diplome/justificatif` — image ou PDF
- [x] `PATCH /users/me/avatar` — l'ancienne image est effacée du stockage

### 5.8 Front — couche API et composants
- [x] `api/post.api.js`, `api/story.api.js` — barre de progression d'envoi
- [x] `components/post/PostCard.jsx` — carrousel, like optimiste, suppression
- [x] `components/post/PostForm.jsx` — aperçus, limites vérifiées avant envoi,
      libération des `objectURL` au démontage
- [x] `components/post/PremiumLock.jsx`
- [x] `components/post/CommentList.jsx` — réponses dépliables
- [x] `components/story/StoryBar.jsx` et `StoryViewer.jsx` — défilement auto,
      navigation clavier, vue enregistrée une seule fois
- [x] `components/ui/Modal.jsx` — portail, Échap, défilement bloqué

### 5.9 Front — pages
- [x] `pages/Home.jsx` — fil avec **défilement infini** (IntersectionObserver)
- [x] `pages/Profile.jsx` — publications du profil, chargement indépendant
- [x] Avatar dans `pages/Settings.jsx`
- [x] Justificatif dans `pages/coach/Diplome.jsx`

### 5.10 Corrections issues des tests

Trois bugs réels trouvés et corrigés pendant la vérification :

1. **`Content-Type` forcé dans l'instance Axios.** `application/json` était
   appliqué à toutes les requêtes, y compris aux `FormData` : le navigateur
   ne pouvait plus générer la frontière multipart et Multer ne recevait aucun
   fichier. L'en-tête par défaut a été retiré ; Axios choisit correctement.
2. **Proxy Vite absent sur `/uploads`.** En stockage local, le serveur renvoie
   des URL relatives ; le navigateur les demandait à Vite, qui répondait par
   `index.html`. **Toutes les images étaient cassées** alors que 53 tests
   passaient — ils vérifiaient l'API et le DOM, jamais le rendu.
3. **Images recadrées en carré.** Sans dimensions, le front retombait sur un
   ratio 1:1 et un paysage perdait un tiers de son contenu. Corrigé par
   `utils/dimensionsImage.js`.

Le point 2 a conduit à ajouter une assertion sur `naturalWidth > 0` : c'est
le seul moyen fiable de distinguer une image affichée d'un lien mort.

### 5.11 Vérifications — 144 au total

**Back-end en HTTP réel — 89/89**
- [x] Publication avec 1 image, 3 médias mixtes, vidéo reconnue
- [x] `.exe` et **SVG** rejetés · image de 12 Mo rejetée · sans média rejetée
- [x] Nom `../../../../etc/passwd` neutralisé → `posts/<32 hex>.png`
- [x] Premium refusé sans les 3 conditions, accepté une fois réunies
- [x] **URL des médias absente de la réponse pour un non-abonné**, description
      masquée, aucune occurrence de `/uploads/` dans le corps brut
- [x] Like et commentaire impossibles sur un contenu verrouillé
- [x] Fil : vide sans abonnement, alimenté ensuite, premium verrouillé dedans
- [x] Pagination par curseur sans recouvrement entre pages
- [x] Publication d'un profil privé inaccessible (403), liste vide
- [x] Like/unlike, pas de doublon, liste des likes non exposée
- [x] Commentaires : vide et 1100 caractères rejetés, réponses supprimées
      avec le parent, compteur cohérent
- [x] Suppression : tiers refusé, auteur et admin autorisés, **fichiers
      effacés du stockage**, commentaires supprimés dans la transaction
- [x] Story à +24 h, index TTL vérifié, vue comptée une seule fois,
      auteur non compté, spectateurs réservés à l'auteur
- [x] Avatar remplacé → **ancien fichier effacé** ; vidéo refusée en avatar

**Navigateur (Playwright) — 55/55**
- [x] Aperçus avant envoi, compteur de médias, carrousel 1/2
- [x] `.exe` et image de 11 Mo rejetés **avant l'envoi**
- [x] Case premium désactivée sans les 3 conditions, avec la raison affichée
- [x] Like optimiste, `aria-pressed`, commentaire publié
- [x] Story publiée, lecteur ouvert, fermeture par Échap
- [x] **Réponse HTTP inspectée** : `medias: []`, `description: null`,
      aucune URL de média de publication
- [x] **4/4 images se chargent réellement** (`naturalWidth > 0`)
- [x] Proxy `/uploads` renvoie bien `image/png`
- [x] Aucun débordement sur 2 pages × 3 tailles · console propre

**Captures d'écran** vérifiées : fil desktop avec verrou premium, fil mobile.

Base nettoyée, 32 médias orphelins supprimés par le script de nettoyage.
Le compte réel `mdieude14` est préservé.

---

## Module 6 — Follow (suivi gratuit)  `TERMINÉ`

> Rappel de conception : le **follow** est gratuit et donne accès au contenu
> public. L'**abonnement premium** est payant, passe par Stripe et donne accès
> au contenu exclusif. Deux relations distinctes, deux collections séparées.
> Ce module ne traite que la première ; la seconde arrive au module 7.

### 6.1 Service de suivi
- [x] `services/follow.service.js`
  - [x] `suivre()` — public → `accepte` direct, privé → `en_attente`
  - [x] `accepter()` / `refuser()` — la vérification du destinataire est faite
        dans le service, pas le contrôleur : aucun appelant ne peut l'omettre
  - [x] `retirer()` — se désabonner ou annuler une demande
  - [x] `retirerAbonne()` — opération symétrique, vue de l'autre côté
  - [x] **Compteurs mis à jour en transaction** avec la relation elle-même
  - [x] `recompter()` — filet de sécurité si un écart apparaît malgré tout
  - [x] Erreur 11000 sur double clic traitée comme un doublon inoffensif

### 6.2 Règles métier
- [x] Se suivre soi-même → 400
- [x] Doublon → 200 sans effet, une seule relation en base (index unique)
- [x] Suivre un compte désactivé → 404
- [x] Accepter la demande d'un tiers → 403
- [x] Accepter deux fois → 409
- [x] **Les compteurs ne bougent que pour un suivi « accepté »** : une demande
      en attente n'est pas un abonnement
- [x] Privé → public : demandes en attente **acceptées automatiquement**
- [x] Public → privé : les suivis existants sont conservés

### 6.3 Contrôleur et routes
- [x] 10 routes montées sur `/api/follows`, segments fixes déclarés avant
      `/:identifiant` (sinon « demandes » serait lu comme un pseudo)
- [x] `GET /follows/demandes/nombre` — endpoint dédié à la pastille
- [x] Listes soumises aux règles de visibilité du module 4
- [x] Champ `maRelation` calculé en une requête pour toute la page,
      au lieu d'un appel par ligne

### 6.4 Front — couche API et composants
- [x] `api/follow.api.js` — 9 appels nommés
- [x] `components/profile/BoutonSuivre.jsx` — 4 états, mise à jour optimiste,
      libellé qui annonce l'action au survol, `aria-label` stable
- [x] `components/profile/ListeUtilisateurs.jsx` — réutilisable, action
      personnalisable
- [x] `components/profile/ModaleAbonnes.jsx` — onglets, chargement à
      l'ouverture seulement
- [x] `components/profile/Suggestions.jsx` — se retire s'il n'a rien à proposer

### 6.5 Front — pages
- [x] `pages/Profile.jsx` — bouton **fonctionnel**, compteurs cliquables,
      rechargement du contenu quand l'accès change sur un profil privé
- [x] `pages/Demandes.jsx` — accepter/refuser, explication si profil public
- [x] `pages/Home.jsx` — suggestions affichées quand le fil est vide
- [x] Navbar — entrée « Demandes de suivi » + pastille, rafraîchie au
      changement de page (pas de `setInterval`), et seulement en profil privé

### 6.6 Vérifications — 123 au total

**Back-end en HTTP réel — 75/75**
- [x] Suivi d'un profil public → accepté, compteurs à 1 des deux côtés
- [x] Doublon sans effet, une seule relation en base
- [x] Se suivre soi-même, profil inexistant, compte désactivé, sans auth
- [x] Profil privé → en attente, **aucun compteur incrémenté**, contenu masqué
- [x] Liste et compteur de demandes, isolation entre utilisateurs
- [x] Acceptation → contenu visible, compteurs à jour ; double acceptation → 409
- [x] Refus → document supprimé, aucun compteur touché, nouvelle demande possible
- [x] Désabonnement, annulation de demande, retrait d'un abonné
- [x] **Bascule privé → public : 2 demandes acceptées automatiquement**
- [x] Public → privé ne rompt pas les abonnements existants
- [x] Listes d'abonnés/abonnements, `maRelation` par ligne
- [x] **Liste d'un profil privé refusée à un non-abonné (403)**
- [x] Suggestions : déjà suivis exclus, soi-même exclu, coachs certifiés
- [x] **Compteur exact après 20 opérations enchaînées**
- [x] Le fil se remplit après un suivi, se vide après désabonnement

**Navigateur (Playwright), 3 acteurs — 48/48**
- [x] Suggestions sur fil vide, badge « Votre ville »
- [x] Suivi depuis les suggestions → le fil se remplit, suggestions disparaissent
- [x] Bouton annonçant l'action au survol
- [x] Compteurs cliquables → modale, onglets, fermeture par Échap
- [x] Demande sur profil privé → « Demande envoyée », contenu toujours masqué
- [x] **Pastille dans la navigation**, page des demandes, acceptation
- [x] Accès au contenu obtenu puis perdu après retrait de l'abonné
- [x] Refus → retour à l'état « Suivre »
- [x] Profil public : explication affichée au lieu d'une liste vide
- [x] Aucun débordement sur 3 pages × 2 tailles · console propre

### 6.7 Passe d'accentuation  `TERMINÉ`

L'interface mélangeait deux orthographes : les composants du module 6 étaient
accentués, ceux des modules 3 à 5 non. Corrigé en trois passages, plus des
retouches manuelles.

- [x] **190 chaînes corrigées dans 40 fichiers** (littéraux, texte JSX,
      messages d'API), plus l'apostrophe typographique `’` — qui ne demande
      aucun échappement dans une chaîne JavaScript
- [x] Les **noms de variables** (`reponse`, `donnees`, `evenement`) restent
      sans accent : c'est la convention correcte pour un identifiant
- [x] Les **valeurs d'énumération** (`'prive'`, `'accepte'`, `'verifie'`)
      restent sans accent : elles sont stockées en base et transportées par
      l'API — vérifié explicitement par la suite de régression

**Cinq dégâts évités grâce au mode simulation**, avant toute écriture :
`npm run creer-admin` → `créer-admin` (nom de script npm) ·
`diplome.publicId` → `diplôme.publicId` (clé de projection MongoDB) ·
`${resultat.supprimes}` → `${resultat.supprimés}` (accès de propriété) ·
`lien: '/coach/diplome'` → chemin de route · `setRelation(precedente)` →
nom de variable. Le détecteur a été durci après chaque découverte.

**Un bug introduit par ma propre prudence, trouvé par les tests :** dans
`Passer en {visibilite === 'prive' ? 'public' : 'prive'}`, le même littéral
sert de valeur de comparaison **et** de texte affiché. En le protégeant comme
enum, je laissais « Passer en prive » à l'écran. Corrigé à la main.

### 6.8 Suites de régression permanentes

Les scripts de vérification étaient jusqu'ici jetables, supprimés après
chaque module. Ils sont désormais versionnés et rejouables.

- [x] `server/tests/regression.mjs` — `npm run test:api` — **73/73**
      Modules 2 à 6 en HTTP réel, plus une section « Typographie » qui vérifie
      que les messages sont accentués **et** que les valeurs d'énumération ne
      le sont pas
- [x] `client/tests/parcours.mjs` — `npm run test:ui` — **45/45**
      Parcours navigateur : session restaurée au F5, publication, verrou
      premium inspecté dans la réponse HTTP, chargement réel des images
      (`naturalWidth > 0`), suivi et demandes, responsive, console propre
- [x] Chaque exécution crée ses propres comptes en `@regression.local` et les
      supprime à la fin ; les comptes réels ne sont jamais touchés

---

## Module 7 — Abonnements premium (Stripe Connect)  `EN COURS`

> **Ce qu'il faut de toi** : une clé secrète Stripe de **test**
> (`sk_test_…`), puis un secret de webhook (`whsec_…`) obtenu avec la CLI
> Stripe. Détail des étapes en fin de module. Tant qu'elles manquent, tout
> est écrit mais rien n'est vérifiable.

> Rappel de conception : le **follow** (module 6) est gratuit et donne accès
> au contenu public. L'**abonnement premium** est payant, récurrent, et donne
> accès au contenu `estPremium`. Les deux sont indépendants : on peut être
> abonné payant sans suivre, et inversement.

### 7.1 Configuration
- [ ] `config/stripe.js` — instance du SDK, vérification des clés au démarrage
- [ ] Variables `.env` : clé secrète, secret de webhook, taux de commission
- [ ] Journal de démarrage indiquant si Stripe est actif, comme pour Cloudinary

### 7.2 Modèles
- [ ] `models/Subscription.js` — statuts alignés sur ceux de Stripe,
      index unique partiel sur `{ utilisateur, coach }` où `statut: 'actif'`
- [ ] `models/ProcessedWebhook.js` — **idempotence** : Stripe rejoue ses
      événements, un paiement ne doit pas être crédité deux fois
- [ ] TTL de 30 jours sur les webhooks traités

### 7.3 Onboarding Stripe Connect (coach)
- [ ] `POST /stripe/connect/onboarding` — crée un compte Express et renvoie
      un lien d'inscription hébergé par Stripe
- [ ] `GET /stripe/connect/statut` — rafraîchit `chargesEnabled` depuis Stripe
- [ ] Réservé aux coachs dont le diplôme est **vérifié** (`coachCertifie`)
- [ ] Le lien d'onboarding expire : en régénérer un à chaque demande

### 7.4 Tarif du coach
- [ ] `PATCH /stripe/premium/tarif` — crée un `Product` et un `Price` Stripe
- [ ] **Un prix Stripe est immuable** : changer de tarif crée un nouveau
      `Price` et archive l'ancien ; les abonnés en cours gardent le leur
- [ ] `PATCH /stripe/premium/actif` — suspendre les nouvelles souscriptions

### 7.5 Souscription
- [ ] `POST /subscriptions/:identifiant/checkout` — session Stripe Checkout
- [ ] **Commission plateforme** via `application_fee_percent`
- [ ] Refus si : coach non monétisable, abonnement déjà actif, soi-même
- [ ] `GET /subscriptions` — mes abonnements · `GET /subscriptions/abonnes`
- [ ] `DELETE /subscriptions/:id` — résiliation **à la fin de la période
      payée**, pas immédiate : l'utilisateur a payé jusque-là

### 7.6 Webhooks
- [ ] Route montée **avant `express.json()`** avec `express.raw` — la
      signature porte sur le corps brut (emplacement déjà réservé au module 1)
- [ ] Vérification de la signature `stripe-signature`
- [ ] Idempotence : événement déjà traité → 200 sans effet
- [ ] `checkout.session.completed` → abonnement actif
- [ ] `customer.subscription.updated` / `.deleted` → statut synchronisé
- [ ] `invoice.payment_succeeded` → période prolongée
- [ ] `invoice.payment_failed` → statut `impaye`, contenu reverrouillé
- [ ] `account.updated` → `chargesEnabled` du coach

### 7.7 Déverrouillage du contenu
- [ ] Brancher `abonnementsPremiumActifs()` dans `feed.service.js` — le point
      unique laissé au module 5, qui renvoie un ensemble vide pour l'instant
- [ ] Vérifier que le contenu premium se déverrouille **et se reverrouille**
      quand l'abonnement passe à `impaye` ou `annule`

### 7.8 Front
- [ ] `api/subscription.api.js`
- [ ] `pages/coach/Premium.jsx` — onboarding Stripe, tarif, revenus
- [ ] `components/profile/BoutonAbonnement.jsx` — remplace le bouton inerte
- [ ] `pages/PaymentSuccess.jsx` — retour de Checkout, attente du webhook
- [ ] `pages/Abonnements.jsx` — mes abonnements, résiliation
- [ ] Entrée « Premium » dans le menu des coachs

### 7.9 Vérifications
- [ ] Onboarding refusé à un coach non certifié
- [ ] Tarif hors bornes rejeté ; changement de tarif → nouveau `Price`
- [ ] Checkout refusé : sur soi-même, coach non monétisable, doublon actif
- [ ] Webhook sans signature valide → 400
- [ ] **Même événement rejoué deux fois → traité une seule fois**
- [ ] `checkout.session.completed` → contenu premium déverrouillé
- [ ] `invoice.payment_failed` → **contenu reverrouillé**
- [ ] Résiliation → accès conservé jusqu'à la fin de la période
- [ ] Index unique partiel : deux abonnements actifs au même coach impossibles
- [ ] Parcours complet dans le navigateur avec carte de test `4242…`
