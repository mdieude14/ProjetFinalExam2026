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
      (journal au démarrage : `[MEDIAS] Cloudinary connecte`)
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

#### 5.6 bis — Prise de photo par la caméra *(ajout après clôture du module)*

- [x] Le « + » ouvre un **choix de source** : importer un fichier, ou prendre
      une photo. L'import existant est inchangé.
- [x] Les deux boutons sont **blancs au repos (`#ffffff`), marque au survol
      (`#f97316`)**, avec curseur main. Portés par une variante `choix`
      ajoutée à `components/ui/Button.jsx` plutôt que par des classes
      surchargées à l'appel : deux utilitaires Tailwind de même spécificité se
      contrediraient, et c'est l'ordre de la feuille générée qui trancherait —
      invisible dans le JSX. Les deux sources étant de rang égal, aucune n'est
      présentée comme la bonne.
- [x] `components/story/CapturePhoto.jsx` — aperçu en direct, déclencheur,
      relecture avec « Reprendre », bascule avant/arrière quand l'appareil a
      plusieurs caméras
- [x] **Le flux est coupé dès la photo prise, et au démontage.** C'est le
      défaut classique de ce composant : la modale se ferme, le voyant de la
      caméra reste allumé. Fermer le `<video>` ne suffit pas — il faut arrêter
      les pistes. Couvert par un test dédié.
- [x] **Photo bornée à 1920 px** sur son plus grand côté, encodée en JPEG 0,9.
      Sans ce cadrage, une caméra 4K produit un fichier que le serveur refuse
      (10 Mo) — après un téléversement complet, donc après l'attente.
- [x] **L'aperçu de la caméra frontale est miroité, la photo aussi** : sinon
      le résultat ne correspond pas au cadrage que l'on vient de voir.
- [x] Causes d'échec distinguées et assorties d'une consigne : permission
      refusée, aucune caméra, caméra déjà utilisée, page non sécurisée. Un
      message unique laisserait l'utilisateur sans rien à faire.
- [x] **Le « + » est devenu un bouton à part**, hors du bouton d'avatar.
      Imbriqué, il produisait du HTML invalide et devenait inatteignable dès
      qu'une story existait : le bouton unique ouvrait alors le lecteur, et
      publier une seconde story était impossible depuis la barre.
- [x] Voie d'envoi unique : fichier importé et photo prise passent par la même
      fonction — deux chemins finiraient par diverger sur la gestion d'erreur.
- [x] Aucune modification du serveur : `image/jpeg` était déjà dans la liste
      blanche MIME du module 5.2.
- [x] **Libellés des pastilles recentrés.** Le bloc avatar mesure 88 px, le
      paragraphe `w-16` en fait 64 : `text-center` centrait le texte *dans*
      le paragraphe, mais la boîte restait calée à gauche — décalage mesuré de
      `(88 − 64) / 2 = 12 px`. Corrigé par `mx-auto`, sur « Ma story » et
      sur les comptes suivis, qui portaient le même défaut. Vérifié au
      `getBoundingClientRect` : centres alignés, écart 0 px.
- [x] Motif du compositeur rendu insensible à la casse dans `parcours.mjs` —
      le libellé « Partagez votre séance… » est devenu « Ajouter un post,
      partagez… », et l'assertion porte sur la présence du prénom, pas sur la
      phrase d'accroche.

> **Contrainte de déploiement.** `getUserMedia` n'est disponible qu'en
> contexte sécurisé. En développement `localhost` suffit ; **en production, la
> prise de photo exige HTTPS**. Sans lui, le composant l'annonce et renvoie
> vers l'import de fichier plutôt que d'échouer sans explication.

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

#### 5.9 bis — Bascule du compositeur *(ajout après clôture du module)*

Le bouton d'invitation n'ouvrait que dans un sens ; il **bascule** désormais.

- [x] Un clic ouvre le formulaire, un second le referme. Le bouton reste
      affiché au même endroit dans les deux états, et change de libellé
      (« Ajouter un post, partagez votre séance, X… » ↔ « Fermer la
      publication ») et d'apparence (gris discret ↔ orange marque).
- [x] **La bascule est portée par le bouton, pas par la surface du
      formulaire.** La demande initiale était « cliquer sur le formulaire
      ouvert le referme » ; appliquée telle quelle, cliquer dans la zone de
      texte pour écrire l'aurait fermé aussi, rendant la publication
      impossible. Un test dédié verrouille ce point.
- [x] **Transition par `grid-rows-[0fr] → [1fr]`**, et non par une
      `max-height`. La hauteur du formulaire varie dès qu'un aperçu de média
      s'ajoute : une valeur arbitraire saccaderait. Mesuré : 280 px à
      mi-course pour 408 px à l'arrivée.
- [x] **`inert` sur le bloc replié.** Le formulaire reste monté pour pouvoir
      s'animer ; sans `inert`, on tabulerait au clavier dans un formulaire
      invisible. `aria-expanded` et `aria-controls` sur le bouton.
- [x] Le brouillon en cours survit à une fermeture accidentelle — le
      formulaire restant monté, la saisie n'est pas perdue. Vérifié que
      `PostForm` se vide bien lui-même après publication réussie, donc aucun
      résidu après envoi.
- [x] Le bouton « Publier » du fil vide continue d'**ouvrir** sans basculer :
      c'est un appel à l'action, pas un interrupteur.
- [x] `data-test="bascule-publication"` : le libellé changeant avec l'état, un
      test ne peut pas s'y accrocher par le texte.

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

### 5.12 Story par la caméra — 31 vérifications

`npm run test:story-camera` — suite dédiée, ajoutée au lanceur `npm test`.
La caméra est **simulée par Chromium** (`--use-fake-device-for-media-stream`) :
la prise de vue est donc réellement exécutée, sans matériel.

- [x] Le « + » ouvre le choix de source ; les deux options sont proposées
- [x] **Styles lus dans le style calculé, pas dans les classes** : blanc
      `rgb(255,255,255)` au repos, `rgb(249,115,22)` au survol, curseur
      `pointer` — pour les deux boutons
- [x] Le flux s'ouvre et **fournit de vraies images** (`videoWidth > 0`) —
      déclencher avant la première trame produirait une photo noire, et un
      test qui se contenterait de vérifier la présence du `<video>` passerait
- [x] La photo prise s'affiche en relecture (`naturalWidth > 0`), bornée à
      1920 px, et « Reprendre » est proposé
- [x] **Le déclencheur « Prendre la photo » affiche le curseur main**, vérifié
      sur le style calculé et dans l'état actif — Tailwind 4 pose
      `cursor: default` sur les boutons, et l'oubli ne se voit sur aucune
      capture d'écran
- [x] **La caméra est relâchée dès la photo prise**, et après fermeture par
      Échap : aucune piste ne reste en `live`
- [x] La story arrive **en base** ; son image **se charge réellement** —
      l'URL correcte dans une réponse JSON ne prouve rien, c'est la leçon
      du §5.10
- [x] Le « + » reste atteignable alors qu'une story existe, et ouvre le choix
      de source et non le lecteur *(régression corrigée par cet ajout)*
- [x] La voie « import de fichier » publie toujours — non régressée
- [x] Console propre ; le 401 attendu de `/auth/refresh` au démarrage est
      écarté nommément, pas par un filtre général sur les 401

### 5.13 Bascule du compositeur — 19 vérifications

`npm run test:publication-toggle` — suite dédiée, ajoutée au lanceur.

- [x] État replié : hauteur nulle, `aria-expanded=false`, bloc `inert`, et le
      champ **refuse réellement le focus** — seul un test qui tente le focus
      le montre
- [x] Ouverture : formulaire déplié, `aria-expanded=true`, `inert` retiré,
      libellé du bouton inversé
- [x] **Le dépliement est animé** — 280 px à mi-course pour 408 px à
      l'arrivée. Une capture d'écran ne distinguerait pas une transition d'un
      affichage instantané
- [x] **Le piège : cliquer et écrire dans le formulaire ne le referme pas**,
      ni cliquer sur son titre. C'est la vérification centrale : sans elle,
      une « simplification » rendant toute la surface cliquable casserait la
      publication sans qu'aucun autre test ne bronche
- [x] Fermeture : repli complet, libellé d'invitation retrouvé, `inert`
      rétabli, brouillon conservé
- [x] Console propre

**Régression du module 5 rejouée après modification : `npm run test:ui` — 45/45.**

Le paquet client passe de **100 à 105 ko compressés** (budget : 150 ko).

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

### 6.9 Correction après signalement — les listes d'abonnés  `TERMINÉ`

Défaut remonté à l'usage : *« la liste ne s'actualise pas et n'affiche pas
toutes les personnes »*. Il était **double**, et aucune des suites du module 6
ne pouvait l'attraper : toutes vérifiaient que suivre, accepter et refuser
fonctionnent, **aucune ne comparait le compteur affiché au nombre de lignes
rendues**.

#### Le tri s'appliquait APRÈS la pagination

```js
Follow.find(filtre).skip().limit().populate(...)   // 20 relations lues
  .filter((r) => r[champ]?.isActive)               // puis on en jette
```

- [x] **Une page de vingt pouvait rendre dix-sept lignes.** Le `.filter()`
      retirait des éléments déjà découpés en pages.
- [x] **Le total ne correspondait pas à la liste.** Il venait d'un
      `countDocuments` sur le filtre brut, sans ce tri : le profil annonçait
      « 25 abonnés » au-dessus d'une liste de 23.
- [x] **Une relation orpheline passait le comptage et disparaissait de
      l'affichage.** L'utilisateur ayant été supprimé, `populate` rendait
      `null`. C'est le cas le plus fréquent en pratique, et le plus déroutant :
      rien dans l'interface ne laisse deviner que la personne n'existe plus.
- [x] Remplacé par une **agrégation** : `$lookup` puis `$unwind` — sans
      `preserveNullAndEmptyArrays`, ce qui écarte les orphelines — puis
      `$match` sur `isActive`. Le tri précède la pagination.
- [x] **`$facet` calcule la page ET le total depuis le même pipeline.** C'est
      ce qui garantit qu'ils ne peuvent plus diverger : le total n'est plus un
      second comptage écrit ailleurs, c'est le même filtre compté au lieu
      d'être paginé.
- [x] `recompter()` adopte la même définition — sans quoi le filet de sécurité
      aurait réintroduit l'écart qu'il est censé corriger
- [x] `estCertifie` reconstitué à la main : l'agrégation ne construit pas les
      virtuels de Mongoose

#### Le compteur du profil ne se recalait jamais

- [x] `stats.followersCount` s'incrémente à chaque relation créée, mais rien
      ne le corrige quand un compte suivi est **désactivé ou supprimé**.
- [x] **Recalculer pour tous les abonnés à chaque désactivation serait un
      travail non borné**, déclenché par une action anodine : sur un compte
      très suivi, une seule désactivation invaliderait des milliers de
      compteurs.
- [x] On répare donc **au moment où l'écart devient visible** : le total vient
      d'être calculé pour la réponse ; s'il diffère du compteur stocké, c'est
      ce dernier qui a tort. Ouvrir la liste suffit à remettre le profil
      d'aplomb.
- [x] L'écriture ne bloque pas la réponse — la liste est déjà juste, et un
      échec de recalage n'a aucune conséquence

#### Côté client — « ne s'actualise pas »

- [x] **Changer d'onglet laissait la liste précédente affichée** pendant tout
      le chargement : l'indicateur d'attente ne se montre que sur une liste
      vide. On voyait donc les abonnés sous l'onglet « Abonnements », et si la
      requête échouait, ils y restaient.
- [x] **Retirer un abonné ne mettait pas à jour le compteur** : la ligne
      disparaissait, le nombre au-dessus gardait l'ancien total jusqu'au
      prochain rechargement de page.
- [x] Le total est remonté au profil, qui recale son affichage sans
      rechargement
- [x] Le total réel est affiché sur l'onglet actif — il vient de la liste
      elle-même, pas du compteur dénormalisé
- [x] On décrémente **le total connu**, jamais la longueur de la liste
      affichée : celle-ci ne contient que les pages chargées, et sur cent
      abonnés le compteur serait tombé de cent à dix-neuf

#### Deux pièges React évités au passage

- [x] **Le rappel vers le parent est gardé dans une référence.** Dans les
      dépendances de `charger`, un parent qui le passe en fonction anonyme —
      l'écriture la plus naturelle — lui donnerait une identité neuve à chaque
      rendu : `charger` changerait, l'effet se rejouerait, un `setState`
      suivrait, et l'on martèlerait le serveur en boucle.
- [x] **Il est appelé hors de la phase de rendu.** Placé dans la fonction de
      mise à jour de `setTotal`, il déclenchait le `setState` du parent
      pendant que React calculait le nouvel état — « Cannot update a component
      while rendering a different component ». Le symptôme était discret :
      l'affichage restait juste, seule la console le trahissait, mais l'ordre
      des mises à jour n'était plus garanti.

#### Vérifications

Deux suites dédiées, écrites autour du symptôme signalé.

`npm run test:relations` (serveur) — **28/28** :

- [x] 25 abonnés, page de 20, total annoncé 25, page suivante annoncée
- [x] **Toutes les pages parcourues rendent 25 personnes, et le total
      correspond au nombre réellement rendu**
- [x] Trois comptes désactivés : liste **et** total descendent ensemble à 22
- [x] **La première page reste pleine** — le tri précède la pagination
- [x] Une relation orpheline ne compte plus et n'apparaît pas
- [x] **Ouvrir la liste recale le compteur du profil** (99 forcé → 22)
- [x] La même règle vaut pour les abonnements
- [x] Chaque ligne porte l'état de ma relation · aucune adresse email
- [x] Un compte privé refuse sa liste à un non-abonné, l'accorde à son
      propriétaire

`npm run test:relations` (client) — **21/21** :

- [x] Le profil annonce 25 (valeur périmée), **puis se recale sur 22** à
      l'ouverture de la liste
- [x] L'onglet actif affiche le total réel
- [x] **Aucune boucle de rechargement** — un seul appel à la liste, mesuré en
      comptant les requêtes : aucune réponse HTTP ne l'aurait montré
- [x] **La liste précédente disparaît pendant le chargement** d'un autre
      onglet — vérifié à 120 ms, seul instant où le défaut était visible
- [x] « Voir plus » complète la liste sans l'effacer
- [x] Retirer un abonné : la ligne part, **et le compteur suit** (22 → 21)
- [x] **La correction survit au rechargement** — elle vient du serveur
- [x] Sans débordement en 375 et 768 px · console propre


---

## Module 7 — Abonnements premium (Stripe Connect)  `TERMINÉ`

> Rappel de conception : le **follow** (module 6) est gratuit et donne accès
> au contenu public. L'**abonnement premium** est payant, récurrent, et donne
> accès au contenu `estPremium`. Les deux sont indépendants : on peut être
> abonné payant sans suivre, et inversement.

### 7.0 Architecture imposée par Stripe — décidée après essais

Les tâches de ce module ont été **réécrites** : leur première version décrivait
l'API Connect v1, que Stripe refuse désormais pour toute nouvelle intégration.
Deux contraintes ont été découvertes en testant, pas en lisant :

**1. Accounts v1 est fermé aux nouvelles intégrations.**
```
Stripe no longer recommends Accounts v1 for new Connect integrations.
Create connected accounts with POST /v2/core/accounts instead.
```
La quasi-totalité des tutoriels en ligne décrit encore la v1. Le code utilise
`stripe.v2.core.accounts`.

**2. Une plateforme française ne peut pas créer de compte « marchand ».**
```
Connect platforms based in FR can only update certain identity information
on a v2 account with a merchant configuration via account tokens.
```
Passer par des *account tokens* obligerait à collecter l'identité et l'IBAN
des coachs dans notre propre interface — exactement ce qu'on veut éviter.

**Solution retenue et vérifiée : configuration `recipient` + destination charges.**

| | |
|---|---|
| Qui débite la carte du sportif | la **plateforme** |
| Qui reçoit l'argent | le **coach**, par virement automatique |
| Commission de 15 % | prélevée au passage via `application_fee_amount` |
| Où le coach saisit identité et IBAN | formulaire **hébergé par Stripe** |
| Ce qui transite par notre serveur | **aucune donnée bancaire** |

Le coach n'encaisse donc pas lui-même : il reçoit des virements. C'est le
modèle des **destination charges**, standard pour une place de marché, et il
dispense l'application de toute contrainte PCI-DSS.

### 7.1 Configuration  `TERMINÉ`
- [x] `config/stripe.js` — instance du SDK, `exigerStripe()` renvoyant 503
      quand la clé manque, vérification au démarrage
- [x] Version d'API **figée** à `2026-07-29.dahlia`, celle du SDK v22 : sans
      cela Stripe applique la version du compte, qui peut changer côté
      tableau de bord et modifier les réponses sans qu'une ligne bouge
- [x] Clés placées dans `server/.env` (secrète) et `client/.env` (publiable),
      les deux exclus de git — vérifié après le push
- [x] Journal de démarrage : `[PAIEMENTS] Stripe connecte (compte acct_…)`
- [x] `scripts/diagnosticStripe.js` — `npm run diag-stripe` — **9/9**
      compte, mode test confirmé (`livemode = false`), création et fermeture
      d'un compte connecté, génération d'un lien d'inscription, produit et
      prix récurrent, archivage, accès aux webhooks

### 7.2 Modèles  `TERMINÉ`
- [x] `models/Subscription.js`
  - [x] Statuts calqués sur ceux de Stripe : la synchronisation par webhook
        devient une correspondance, pas une interprétation
  - [x] **Index unique partiel** sur `{ utilisateur, coach }` où
        `statut: 'actif'` — un seul abonnement actif, mais l'historique des
        résiliations reste possible (sans quoi on ne pourrait jamais se
        réabonner)
  - [x] Virtuel `donneAcces` : un abonnement **résilié garde son accès**
        jusqu'à `periodeFin`, un abonnement `impaye` le perd aussitôt
  - [x] `coachsAccessibles()` — requête unique pour le déverrouillage
- [x] `models/ProcessedWebhook.js` — index unique sur `stripeEventId`,
      TTL de 30 jours

### 7.3 Service Stripe et onboarding des coachs  `TERMINÉ`
- [x] `services/stripe.service.js` — 11 fonctions, toute la logique Stripe en
      un point ; les contrôleurs expriment une intention métier, le service
      traduit en appels d'API
- [x] `POST /stripe/connect/onboarding` — compte connecté en **v2**,
      configuration `recipient`, lien hébergé renvoyé
- [x] `GET /stripe/connect/statut` — interroge Stripe et met à jour
      `chargesEnabled` ; expose aussi ce qui manque encore au coach
- [x] Routeur **entièrement** protégé par `coachCertifie` — le middleware
      écrit au module 2, jusqu'ici sans consommateur
- [x] Un lien **neuf** est régénéré à chaque appel : un lien d'inscription
      expire en quelques minutes, en stocker un serait inutile
- [x] `metadata.utilisateurId` sur le compte connecté : les webhooks
      retrouveront l'utilisateur sans requête sur un champ non indexé

### 7.4 Tarif du coach  `TERMINÉ`
- [x] `PUT /stripe/premium/tarif` — `Product` créé une fois, `Price` récurrent
- [x] **Un prix Stripe est immuable** : changer de tarif crée un nouveau
      `Price` et archive l'ancien — vérifié, l'ancien passe à `active: false`
- [x] Les abonnés en cours conservent leur prix ; le message le dit
- [x] `PATCH /stripe/premium/actif` — suspend les nouvelles souscriptions
      **sans** résilier les abonnements en cours (ce serait rompre un
      contrat déjà payé)
- [x] `GET /stripe/premium/revenus` — brut, commission, net, calculés depuis
      notre base plutôt qu'en interrogeant Stripe à chaque affichage
- [x] Bornes 5 € à 500 €, saisie en euros, conversion en centimes en un seul
      point

### 7.5 Souscription  `TERMINÉ`
- [x] `POST /subscriptions/:identifiant/checkout` — session Stripe Checkout
- [x] `application_fee_percent` + `transfer_data.destination`
- [x] **Aucun abonnement n'est créé en base avant le paiement** : c'est le
      webhook qui l'enregistrera. Créer un document « en attente » laisserait
      des abonnements fantômes à chaque page de paiement abandonnée
- [x] `Customer` Stripe réutilisé d'un abonnement à l'autre — vérifié
- [x] Refus : soi-même (400), coach non certifié (403), abonnement déjà
      actif (409)
- [x] `GET /subscriptions` · `GET /subscriptions/abonnes` (coachs)
      · `GET /subscriptions/statut/:identifiant` pour le bouton du profil
- [x] `DELETE /subscriptions/:id` — `cancel_at_period_end`, l'accès court
      jusqu'à la fin de la période payée
- [x] `POST /subscriptions/:id/reprendre` — annuler une résiliation

### 7.5 bis Vérifications — 50/50  (`npm run test:stripe`)
- [x] Onboarding refusé à un coach non certifié, à un sportif, sans session
- [x] Lien `connect.stripe.com` généré ; second appel réutilise le compte
      mais **régénère un lien neuf**
- [x] Compte créé en configuration `recipient`, métadonnée reliée à notre base
- [x] Statut : `chargesEnabled` faux tant que le formulaire n'est pas rempli,
      12 exigences remontées, `manque` détaillé au coach
- [x] Tarif refusé tant que Stripe n'encaisse pas · 2 € et 900 € rejetés
- [x] 19,90 € → 1990 centimes, `Product` et `Price` créés, `peutMonetiser`
      passe à vrai
- [x] **Changement de tarif → nouveau `Price`, ancien archivé chez Stripe**,
      produit inchangé
- [x] Suspension et réactivation de l'offre ; revenus à 15 % de commission
- [x] S'abonner à soi-même (400), à un coach non certifié (403)
- [x] **Checkout refusé tant que le compte du coach n'est pas validé par
      Stripe** — garantie qu'on ne vend pas un abonnement dont l'argent
      n'arriverait jamais au coach
- [x] Client Stripe créé puis **réutilisé** au second appel
- [x] Liste des abonnés refusée à un sportif, accessible au coach

> **Limite connue.** Le parcours de paiement complet — carte `4242…`, webhook,
> déverrouillage — exige un compte coach ayant **réellement finalisé** son
> inscription Stripe (identité, IBAN). Tant que ce n'est pas fait, Stripe
> refuse toute session de paiement vers ce compte. À faire une fois, via le
> lien d'inscription, avant les tests de la section 7.9.

### 7.6 Webhooks  `TERMINÉ`

**Mise en place de l'outillage**
- [x] CLI Stripe 1.50.5 installée via winget
- [x] `stripe listen --api-key … --forward-to localhost:5000/api/webhooks/stripe`
      — l'option `--api-key` **évite l'étape `stripe login`** et son
      authentification par navigateur, la clé secrète suffit
- [x] Secret de signature `whsec_…` récupéré et placé dans `server/.env`
- [x] Le tunnel annonce la **même version d'API** que celle épinglée dans
      `config/stripe.js` — cohérence vérifiée

**Code**
- [x] `routes/webhook.routes.js` monté sur `/api/webhooks` **avant
      `express.json()`**, avec `express.raw` (emplacement réservé au module 1)
- [x] Aucune authentification sur cette route — ce n'est pas un oubli :
      Stripe n'a pas de session chez nous, l'authenticité vient de la
      signature cryptographique, plus solide qu'un jeton qui pourrait fuiter
- [x] Le limiteur de débit global reste monté **après** : bloquer Stripe
      ferait perdre des paiements
- [x] `controllers/stripeWebhook.controller.js` — 6 types traités
  - [x] `checkout.session.completed` → création de l'abonnement
  - [x] `customer.subscription.updated` / `.deleted` → statut synchronisé
  - [x] `invoice.payment_succeeded` → période prolongée, `impaye` levé
  - [x] `invoice.payment_failed` → `impaye`, accès retiré **immédiatement**
        (pas de période payée à honorer, contrairement à une résiliation)
  - [x] `account.updated` → état du compte coach relu auprès de Stripe
- [x] **Réponse 200 même en cas d'échec métier** : un code d'erreur ferait
      rejouer l'événement en boucle par Stripe pendant des jours. L'échec est
      journalisé dans `ProcessedWebhook.resultat = 'erreur'`
- [x] Compteur d'abonnés **recalculé** plutôt qu'incrémenté : les webhooks
      peuvent arriver dans le désordre, un `$inc` ferait dériver le total

**Vérifications en conditions réelles**
- [x] Route montée : répond 503 sans secret, **pas 404**
- [x] **Signature falsifiée → 400** (et non 200 : Stripe doit savoir que le
      message est refusé)
- [x] 7 événements réels reçus par le tunnel, tous en **200**
- [x] Types non concernés journalisés puis ignorés (`resultat: 'ignore'`)
- [x] `checkout.session.completed` sans métadonnées correctement rejeté —
      l'événement synthétique de `stripe trigger` n'en porte pas
- [x] **IDEMPOTENCE : même événement rejoué via `stripe events resend`**
      → journal `déjà traité, ignoré`, compteur inchangé (7 → 7), aucun
      doublon en base

> **Éprouvé en 7.9** : les gestionnaires métier ont été exercés avec de
> vraies données, via le coach `coachdemo` dont l'inscription Stripe est
> finalisée (`acct_1U8g8HJQ8AUWtMKm`). Un paiement réel par carte `4242…`
> traverse toute la chaîne — voir `npm run test:paiement`, 46/46.

### 7.7 Déverrouillage du contenu
- [x] `abonnementsPremiumActifs()` branché dans `feed.service.js` sur
      `Subscription.coachsAccessibles()` — le point unique laissé au module 5
- [x] Contenu premium déverrouillé après paiement : médias, description et URL
      réapparaissent dans la réponse HTTP, sur la publication **et** dans le fil
- [x] **Reverrouillé dès le passage à `impaye`** — médias retirés, description
      masquée, `abonne: false` côté statut
- [x] Accès **conservé** sur un abonnement `annule` tant que `periodeFin` court

> **Ce que couvre exactement `coachsAccessibles()`.** L'accès n'est pas
> « statut === actif ». Un abonnement résilié garde l'accès jusqu'au terme
> déjà payé ; un abonnement impayé le perd immédiatement, puisqu'aucun
> prélèvement n'a eu lieu. Ces deux cas sont dans la même requête, et c'est le
> seul endroit du code qui décide de l'accès premium.

> **Bogue rencontré — l'API Stripe a déplacé la période.** Depuis la version
> `2026-07-29.dahlia`, `current_period_end` a quitté la racine de
> l'abonnement pour ses *items*. `periodeFin` restait donc vide, et un
> abonnement résilié perdait aussitôt l'accès qu'il avait pourtant payé.
> Corrigé par `stripe.service.js → finDePeriode()`, qui interroge les deux
> emplacements et centralise le repli.

### 7.8 Front
- [x] `api/subscription.api.js` — `subscriptionApi` (abonné) et
      `monetisationApi` (coach), séparés parce qu'ils vivent sous deux
      préfixes distincts : `/subscriptions` et `/stripe`
- [x] `utils/prix.js` — formatage des montants **en centimes**, et
      documentation de l'asymétrie : le tarif s'envoie en euros, se relit en
      centimes
- [x] `pages/coach/Premium.jsx` — inscription Stripe, tarif, revenus, abonnés,
      et surtout la liste explicite de **ce qui manque encore** pour vendre
- [x] `components/profile/BoutonAbonnement.jsx` — cinq états distincts, tous
      lus du serveur : pas d'offre, non abonné, abonné, résilié, impayé
- [x] `pages/PaymentSuccess.jsx` — la route `/paiement/succes` renvoyait 404
- [x] `pages/Abonnements.jsx` — mes abonnements, résiliation et reprise
- [x] Entrées « Mes abonnements » (tous) et « Contenu premium » (coachs) au menu
- [x] `Profile.jsx` recharge ses publications après un changement d'abonnement

> **Pourquoi `PaymentSuccess` attend au lieu d'annoncer.** Cette page est la
> `success_url` de Stripe : n'importe qui peut l'ouvrir à la main sans avoir
> payé. Elle ne crée donc rien et ne valide rien — c'est le webhook, signature
> vérifiée, qui fait foi. Elle se contente d'interroger la base quelques
> secondes, parce que la redirection et le webhook partent en même temps et
> que rien ne garantit lequel arrive le premier.

> **Pourquoi le profil recharge ses publications.** Le verrouillage premium
> retire les médias de la **réponse HTTP** ; il ne les masque pas à l'écran.
> Un abonnement qui commence ne peut donc pas se refléter par une mise à jour
> d'état local : il faut redemander les publications au serveur.

### 7.9 Vérifications
- [x] Onboarding refusé à un coach non certifié
- [x] Tarif hors bornes rejeté ; changement de tarif → nouveau `Price`
- [x] Checkout refusé : sur soi-même, coach non monétisable, doublon actif
- [x] Webhook sans signature valide → 400
- [x] **Même événement rejoué deux fois → traité une seule fois**
- [x] `checkout.session.completed` → contenu premium déverrouillé
- [x] Échec de prélèvement → **contenu reverrouillé**
- [x] Résiliation → accès conservé jusqu'à la fin de la période, puis reprise
- [x] Index unique partiel : deuxième abonnement actif refusé en 409
- [x] **Parcours complet dans le navigateur avec carte de test `4242…`**
- [x] Répartition des revenus exacte : 1990 brut / 299 commission / 1691 net
- [x] Écrans de monétisation vérifiés au navigateur, gardes de rôle comprises

**Suites permanentes ajoutées par ce module**

| Commande | Portée | Résultat |
|---|---|---|
| `npm run test:stripe` (serveur) | API des abonnements, refus, signatures | 50/50 |
| `npm run test:paiement` (client) | paiement réel de bout en bout | 46/46 |
| `npm run test:premium` (client) | rendu des trois écrans, gardes de rôle | 18/18 |

**Contrôle final du module 7** — les cinq suites rejouées à la suite :
`test:api` 73/73 · `test:stripe` 50/50 · `test:ui` 45/45 ·
`test:premium` 18/18 · `test:paiement` 46/46 → **232/232**.

> **Défaut d'isolation corrigé dans `test:paiement`.** La suite passait à la
> première exécution puis échouait aux suivantes sur les revenus (2 abonnés,
> puis 3…). Aucune régression du produit : les deux routes de nettoyage font
> exactement leur travail — `DELETE /subscriptions/:id` résilie **en fin de
> période** et `DELETE /users/me` **désactive** sans supprimer. L'abonnement
> restait donc `actif` un mois de plus, et s'accumulait. Le nettoyage descend
> désormais en base retirer ce qu'aucune API n'a vocation à retirer, et balaie
> au passage les restes d'exécutions interrompues. **Vérifié par deux
> exécutions consécutives sans purge manuelle : 46/46 les deux fois.**

> **Dette technique remboursée au passage.** `tests/parcours.mjs` forçait
> certains états par `docker exec … mongosh`. Cet appel n'a pas de délai
> d'expiration : quand le CLI Docker ne répondait plus, la suite se **figeait
> indéfiniment** au lieu d'échouer. Elle parle désormais au pilote MongoDB
> directement, en empruntant l'URI au serveur.

---

## Module 8 — Géolocalisation et carte interactive  `TERMINÉ`

> Ce que le module 1 a déjà posé, et qu'il s'agit maintenant d'exploiter :
> le champ `localisation` en **Point GeoJSON**, l'index **2dsphere**, la route
> `PATCH /users/me/localisation`, et la capture de position du navigateur dans
> l'inscription et les paramètres. Rien n'interroge encore ces données.

### 8.0 Décision de conception — la confidentialité des coordonnées

`versionPublique()` **exclut délibérément** `localisation` depuis le module 4 :
aucune coordonnée exacte ne sort de l'API aujourd'hui. Une carte des coachs ne
doit pas revenir sur cette décision — la position d'un particulier, c'est très
souvent son domicile.

- [x] **Position approchée pour l'affichage public.** Les coordonnées exactes
      restent en base et servent au calcul de distance côté serveur ; l'API ne
      renvoie qu'une position arrondie. Trois décimales ≈ 110 m : assez précis
      pour situer un quartier, trop grossier pour désigner une porte.
- [x] **Consentement explicite** : un coach n'apparaît sur la carte que s'il
      l'a activé (`carteVisible`). Avoir renseigné sa position pour trouver des
      coachs près de chez soi n'est pas consentir à y être trouvé.
- [x] **Distance calculée par le serveur**, jamais reconstituée par le client :
      renvoyer une position floue *et* une distance exacte annulerait le flou
      par trilatération depuis plusieurs points.

### 8.1 Modèle
- [x] `User.carteVisible` — booléen, `false` par défaut (opt-in)
- [x] `User.versionCarte()` — quatrième niveau de vue : identité publique
      minimale + position **arrondie** + distance, sans bio ni statistiques
- [x] Index composé `{ carteVisible, type, visibilite, isActive }` pour le
      filtre appliqué avant le tri par distance

### 8.2 Service de recherche géographique
- [x] `services/geo.service.js`
- [x] **`$geoNear` en agrégation plutôt que `$near` en requête** : seul
      `$geoNear` renvoie la distance calculée (`distanceField`), qui est
      précisément ce qu'on veut afficher. Avec `$near`, il faudrait la
      recalculer côté client — donc exposer la position exacte.
- [x] Filtres cumulables : rayon, sport, coach certifié, offre premium
- [x] Rayon borné (1 à 100 km) et nombre de résultats plafonné
- [x] Exclusion des comptes désactivés, privés et sans position

### 8.3 Endpoints
- [x] `GET /api/geo/coachs` — coachs autour d'un point, avec distance
- [x] `GET /api/geo/villes` — regroupement par ville, pour un rendu dézoomé
- [x] `PATCH /geo/carte-visible` — consentement d'affichage (la route vit
      sous `/geo` et non sous `/users` : c'est une propriété de la carte,
      pas du profil, et elle est réservée aux coachs)
- [x] `GET /api/geo/sports` — sports réellement proposés, pour le filtre
- [x] `validators/geo.validator.js` — bornes des coordonnées et du rayon

### 8.4 Front — dépendances et couche API
- [x] `leaflet` et `react-leaflet`, plus la feuille de style de Leaflet
- [x] Correctif des icônes de marqueur : Leaflet référence ses images par des
      chemins relatifs que les empaqueteurs cassent — panne classique où les
      marqueurs deviennent invisibles sans la moindre erreur en console
- [x] `api/geo.api.js`
- [x] `hooks/usePosition.js` — géolocalisation du navigateur, avec les trois
      refus possibles distingués (indisponible, refusée, expirée)

### 8.5 Front — carte
- [x] `components/map/CarteCoachs.jsx` — fond OpenStreetMap, attribution
      conservée (elle est exigée par la licence, pas décorative)
- [x] `components/map/MarqueurCoach.jsx` — fiche avec avatar, nom, pseudo,
      certification, distance, sports, tarif, lien vers le profil
- [x] `components/map/CercleRayon.jsx` — matérialise la zone de recherche
- [x] `components/map/etalerPositions.js` — écarte les marqueurs superposés
- [x] Plafonnement des résultats (50 par défaut, 100 au maximum)

### 8.6 Front — page
- [x] `pages/Carte.jsx` — carte et liste synchronisées
- [x] Filtres : rayon, sport, certification, offre premium
- [x] Repli lisible quand la position est refusée : recherche par ville
- [x] Entrée « Carte » dans la navigation
- [x] Case « apparaître sur la carte » dans les paramètres du coach

### 8.7 Vérifications
- [x] Recherche `$geoNear` : ordre par distance croissante, rayon respecté
- [x] **Coordonnées exactes absentes de toutes les réponses HTTP**
- [x] Coach non consentant absent de la carte, même dans le rayon
- [x] Comptes privés, désactivés et sans position exclus
- [x] Rayon hors bornes et coordonnées invalides rejetés en 400
- [x] Filtres cumulés cohérents
- [x] Marqueurs réellement affichés dans le navigateur (icônes chargées)
- [x] Carte utilisable en mobile 375 px, sans débordement
- [x] Refus de géolocalisation → repli fonctionnel, pas d'écran vide

### 8.8 Ce que le module a produit

**Fichiers créés**

| Côté | Fichier | Rôle |
|---|---|---|
| serveur | `services/geo.service.js` | `$geoNear`, filtres, villes, sports |
| serveur | `controllers/geo.controller.js` | 4 points d'entrée |
| serveur | `routes/geo.routes.js` | 3 routes publiques, 1 protégée |
| serveur | `validators/geo.validator.js` | bornes des coordonnées et du rayon |
| client | `api/geo.api.js` | couche d'appel |
| client | `hooks/usePosition.js` | géolocalisation, 3 échecs distingués |
| client | `components/map/CarteCoachs.jsx` | carte, marqueurs, infobulles |
| client | `components/map/iconesLeaflet.js` | icônes SVG, contournement du bogue |
| client | `pages/Carte.jsx` | carte et liste synchronisées |
| client | `tests/carte.mjs` | suite de régression — **37/37** |

**Modifiés** : `models/User.js` (`carteVisible`, `versionCarte()`),
`routes/index.js`, `App.jsx`, `Navbar.jsx`, `Settings.jsx`, `index.css`.

**Trois décisions techniques à retenir**

1. **`$geoNear` plutôt que `$near`.** Les deux trient par distance ; seul
   `$geoNear` la *renvoie*. Avec `$near`, il aurait fallu la recalculer côté
   client — donc lui livrer la position exacte, exactement ce qu'on refuse.
   MongoDB calcule sur les coordonnées réelles, l'API ne publie que l'arrondi.

2. **Icônes SVG en `data:` plutôt que les images de Leaflet.** Leaflet
   référence ses marqueurs par des chemins relatifs que Vite renomme à la
   compilation : les marqueurs deviennent invisibles **sans la moindre erreur
   en console**. La suite vérifie donc `naturalWidth > 0` sur chaque icône,
   pas seulement leur présence dans le DOM.

3. **Carte chargée à la demande.** Leaflet pèse ~49 ko compressés, soit un
   tiers de l'application. `lazy()` la sort du paquet principal, qui repasse
   de 166 à **117,8 ko** — le poids d'avant le module.

**Limite connue** : les tuiles viennent de `tile.openstreetmap.org`. Sans
accès Internet, la carte s'affiche mais reste vide. La suite sonde le serveur
de tuiles avant de conclure, plutôt que de produire un échec rouge trompeur.

### 8.9 Contrôle de non-régression

Les six suites rejouées après le module :

| Commande | Résultat |
|---|---|
| `npm run test:api` (serveur) | 73/73 |
| `npm run test:stripe` (serveur) | 50/50 |
| `npm run test:ui` (client) | 45/45 |
| `npm run test:premium` (client) | 18/18 |
| `npm run test:paiement` (client) | 46/46 |
| `npm run test:carte` (client) | 37/37 |

**269/269.**

### 8.10 Audit d'affichage — points et fiche profil

Contrôle demandé après coup : les points du visiteur et des coachs
s'affichent-ils, et la fiche s'ouvre-t-elle au clic ? Vérifié dans un vrai
Chromium, capture à l'appui (`client/captures/carte-fiche-coach.png`).

- [x] **Pastille de position du visiteur** affichée, et centrée sur le point
      de recherche (tolérance 60 px)
- [x] **Marqueurs des coachs** affichés, icônes réellement rendues
- [x] **Fiche ouverte au clic** sur un point : avatar, nom, pseudo,
      certification, distance, ville, sports, tarif, lien vers le profil
- [x] Avatar de la fiche réellement rendu (image ou initiales)
- [x] Le lien mène bien à `/profile/<pseudo>` du coach cliqué
- [x] Cercle du rayon dessiné, attribution OpenStreetMap présente

**Trois cases avaient été cochées à tort.** Le module 8 avait été validé en
bloc par une expression régulière, sans relire ligne à ligne. Trois entrées ne
correspondaient à rien de livré : `MarqueurCoach.jsx` et `CercleRayon.jsx`
n'existaient pas — leur contenu était resté dans `CarteCoachs.jsx` — et
aucun index composé n'avait été créé. Les trois ont été réellement faites, et
le chemin de la route de consentement corrigé (`/geo/…`, pas `/users/me/…`).

**Un défaut réel trouvé pendant cet audit — et causé par le module lui-même.**
L'arrondi de confidentialité à ~110 m fait que deux coachs séparés de moins de
110 mètres reçoivent des coordonnées **identiques**. Leurs marqueurs se
superposaient au pixel près, et celui du dessous devenait littéralement
inatteignable : impossible à cliquer, impossible à voir. Dans une salle de
sport ou un quartier dense, c'est le cas courant.

`etalerPositions.js` dispose les marqueurs partageant une position sur un
petit cercle d'une trentaine de mètres — bien en deçà du flou déjà appliqué,
donc sans rien révéler de plus. Le décalage est **déterministe** (déduit du
rang, jamais d'un tirage aléatoire) : sans quoi la carte danserait à chaque
changement de filtre. La fiche annonce « position approchée — plusieurs coachs
dans ce secteur » plutôt que de laisser croire à une précision qu'elle n'a pas.

> **Limite assumée.** L'écartement ne sépare visuellement les marqueurs qu'à
> partir d'un certain niveau de zoom : à 25 km de rayon, trente mètres restent
> sous le pixel. Aucun coach n'est pour autant introuvable — **la liste sous
> la carte présente tous les résultats**, sans superposition possible. Un vrai
> regroupement de marqueurs (*clustering*) demanderait une dépendance
> supplémentaire ; il n'a pas été retenu à ce stade.

**Deux pièges d'outillage corrigés au passage**

1. **`$geoNear` et le second index géographique.** L'index composé aurait pu
   être un `{ localisation: '2dsphere', … }`. C'était un piège : deux index
   2dsphere sur la même collection font échouer `$geoNear` — « more than one
   2dsphere index, not sure which to run geoNear on ». La carte serait tombée
   en panne au premier appel. On garde **un seul** index géographique, on
   indexe les champs du filtre à part, et le service précise désormais
   `key: 'localisation'` pour lever l'ambiguïté par avance.

2. **La suite ne se purgeait qu'en sortie.** Une exécution interrompue laissait
   ses comptes en base ; la suivante trouvait deux coachs homonymes et un
   sélecteur censé désigner une personne en désignait deux. Échec
   incompréhensible, sans rapport avec le code testé. La purge se fait
   désormais aussi **au démarrage** — même correction que pour
   `test:paiement`. Et l'infobulle des marqueurs affiche le pseudo en plus du
   nom, ce qui règle le même problème pour un utilisateur réel : deux coachs
   peuvent parfaitement s'appeler « Marc Bernard ».

`npm run test:carte` passe de 37 à **50/50**.

---

## Module 9 — Événements sportifs  `TERMINÉ`

> Ce que les modules précédents rendent possible ici : la **position** et
> l'index 2dsphere (module 8) pour trouver les événements proches, le
> **contrôle d'accès premium** (module 7) pour les événements réservés aux
> abonnés, le **stockage Cloudinary** (module 5) pour l'affiche, et les
> **transactions** (module 1) pour les compteurs de participants.

### 9.0 Le problème central — la concurrence sur les places

Un événement à capacité limitée est le cas d'école de la **course critique** :
deux personnes cliquent sur « Je participe » à la même milliseconde alors
qu'il reste une place. Lues séparément, les deux requêtes voient « 9 inscrits
sur 10 », et les deux acceptent. L'événement se retrouve en surréservation.

- [x] **`EventRegistration` en collection séparée**, jamais un tableau
      `inscrits` dans l'événement. Un tableau se lit puis se réécrit : la
      fenêtre entre les deux est précisément la faille.
- [x] **Index unique `{ event, utilisateur }`** — la base refuse le doublon,
      quel que soit le nombre de requêtes simultanées
- [x] **La place est réservée dans une transaction** avec l'incrément du
      compteur. La réservation est un `$inc` **sous condition de capacité** :
      filtre et incrément forment une seule opération indivisible, et `$expr`
      compare `inscritsCount` à `capaciteMax` — deux champs du même document,
      ce qu'une requête ordinaire ne sait pas faire.
- [x] **La place est réservée AVANT la création de l'inscription.** L'ordre
      inverse laisserait une inscription orpheline si la place venait à
      manquer : un document en base pour quelqu'un qui n'a rien obtenu.
- [x] Surréservation vérifiée par un **test de charge réel** :
      **20 requêtes simultanées sur 5 places → exactement 5 acceptées,
      15 refusées en 409**, compteur et documents en base concordants

### 9.1 Modèles
- [x] `models/SportEvent.js` — organisateur, type, dates, lieu, capacité,
      image, statut
- [x] Point GeoJSON en **sous-schéma avec `default: undefined`** — même piège
      qu'au module 1 : déclaré en ligne, Mongoose fabriquerait un point
      dégénéré sur chaque événement et l'index 2dsphere buterait dessus
- [x] `capaciteMax: null` signifie « sans limite » — distingué de `0`, qui
      serait un événement auquel personne ne peut s'inscrire
- [x] `dateFin > dateDebut` validé **au niveau du schéma** (`pre('validate')`)
      et pas seulement dans `express-validator` : un script ou un import de
      données passeraient à côté d'une règle qui ne vivrait que côté HTTP
- [x] Index `2dsphere` sur `lieu.localisation`, `{ dateDebut: 1 }`,
      `{ organisateur, dateDebut: -1 }`, `{ statut, type, dateDebut }`
- [x] Virtuels `estComplet`, `estPasse`, `placesRestantes`,
      `inscriptionOuverte` — `estPasse` se fie à `dateFin` et non à
      `dateDebut` : une sortie de 9 h à 17 h est encore en cours à midi
- [x] `versionPour(visiteur, aAccesPremium)` — un événement `prive` masque son
      **adresse exacte** aux non-abonnés, mais garde titre, ville et date
      visibles : c'est ce qui donne envie de s'abonner. Le champ est retiré de
      la **réponse HTTP**, pas seulement de l'écran (même règle qu'au module 7).
- [x] `detailsVerrouilles` signalé explicitement, pour que l'interface explique
      ce qui manque au lieu d'afficher un vide inexpliqué
- [x] `models/EventRegistration.js` — index unique `{ event, utilisateur }`,
      statuts `inscrit` / `annule`, `versionPublique()`

### 9.2 Service
- [x] `services/event.service.js`
- [x] `inscrire()` — transaction : contrôle de capacité, création, compteur
- [x] Retour après désistement : l'inscription `annule` est **réactivée**, pas
      dupliquée — l'index unique le refuserait de toute façon
- [x] Double clic intercepté par l'index unique (code 11000) et traduit en
      message métier plutôt qu'en erreur de base
- [x] `desinscrire()` — bascule en `annule` et décrémente **dans la même
      transaction** ; séparés, un incident laisserait une place fantôme.
      Filtre `inscritsCount > 0` en ceinture de sécurité.
- [x] `recompter()` — filet de sécurité, à l'image du module 6
- [x] `listeAVenir()` — filtre sur `dateFin` (un événement en cours reste
      d'actualité), tri par `dateDebut` croissante, filtres ville/sport/type
- [x] Les événements `annule` restent dans la liste : les masquer priverait
      les inscrits de l'information qui les concerne le plus
- [x] `evenementsAutourDe()` — réutilise `$geoNear` du module 8, `key` désigné
      explicitement. **Ici la position n'est pas floutée** : un lieu de
      rendez-vous collectif est public, contrairement au domicile d'un coach.
- [x] Un événement passé ou annulé n'accepte plus d'inscription

### 9.3 Règles d'accès
- [x] Seuls les **coachs certifiés** créent des événements (`coachCertifie`)
- [x] Un événement `prive` n'est visible que des **abonnés premium** du coach —
      contrôle délégué à `abonnementsPremiumActifs()` du module 7, jamais
      redupliqué : deux implémentations finiraient par diverger
- [x] L'organisateur ne s'inscrit pas à son propre événement
- [x] Modifier ou annuler : organisateur ou admin uniquement
- [x] **Liste blanche des champs modifiables** — sans elle, un `Object.assign`
      laisserait réécrire `inscritsCount`, `organisateur` ou `statut`
- [x] Capacité refusée si elle passe **sous le nombre d'inscrits** : on ne
      choisit pas à la place de l'organisateur lesquels perdent leur place
- [x] Annuler ≠ supprimer : les inscrits constatent l'annulation et son motif
- [x] **La liste des participants n'est pas publique** — elle révèle qui
      pratique quoi, où et quand ; réservée à l'organisateur et à l'admin

### 9.4 Endpoints
- [x] `POST /api/events` — création, affiche facultative. Ordre des
      middlewares non interchangeable : `protect` → `coachCertifie` →
      `upload` → `validate`. Téléverser avant de vérifier le droit laisserait
      un fichier orphelin chez Cloudinary pour un appelant qu'on refuse.
- [x] Nettoyage de l'affiche si l'écriture en base échoue
- [x] `GET /api/events` — à venir, filtres ville/sport/type, paginé
- [x] Accès premium calculé **une fois pour toute la page**, pas par carte
- [x] `GET /api/events/proches` — autour d'un point, distance renvoyée
- [x] `GET /api/events/:id` — détail, `monInscription`, participants réservés
- [x] `PATCH /api/events/:id` · `DELETE /api/events/:id` (annulation)
- [x] `POST /api/events/:id/inscription` · `DELETE /api/events/:id/inscription`
- [x] `GET /api/events/mes-inscriptions`
- [x] Segments fixes déclarés **avant** `/:id` — sans quoi `/events/proches`
      serait lu comme un identifiant (même piège qu'aux modules 6 et 7)
- [x] `validators/event.validator.js` — dates, capacité, coordonnées par paire,
      rayon borné
- [x] Routeur monté dans `routes/index.js`

### 9.5 Front
- [x] `api/event.api.js`
- [x] **Champs imbriqués en notation à crochets dans le `FormData`** —
      `lieu[ville]`, jamais `lieu.ville`. Multer reconstruit l'objet à partir
      des crochets ; avec un point il crée une clé plate littérale, le serveur
      ne trouve aucune ville et refuse un champ pourtant rempli. Détail
      minuscule, panne totale — comportement vérifié en conditions réelles.
- [x] `utils/dates.js` — créneau condensé quand début et fin tombent le même
      jour, délai en clair (« demain », « dans 3 jours »), et conversion vers
      `datetime-local`, **qui travaille en heure locale et refuse tout fuseau** :
      lui passer un `toISOString()` décale la séance de l'écart horaire, sans
      le moindre avertissement
- [x] `components/map/CarteBase.jsx` — **socle extrait de `CarteCoachs`**,
      désormais partagé avec la carte des événements : fond de plan,
      attribution, recentrage, recalcul de taille, cercle de recherche,
      pastille de position. Recopié, ce socle aurait vécu en deux exemplaires —
      corriger l'un aurait laissé le défaut dans l'autre.
- [x] `etalerPositions` généralisé par accesseurs : les événements souffrent du
      même recouvrement de marqueurs, pour une autre raison — un cours
      hebdomadaire dans la même salle produit des coordonnées identiques
- [x] `components/map/CarteEvenements.jsx` · `MarqueurEvenement.jsx` — teinte
      indigo, franchement distincte de l'orange des coachs
- [x] `components/event/EventCard.jsx` — quand, où, places restantes : les
      trois questions qui décident d'y aller. L'état est dit par un **mot**
      (« Complet », « Annulé »), jamais par la seule couleur.
- [x] `components/event/EventForm.jsx` — création avec affiche, position
      facultative, dates pré-remplies (un formulaire vide invite à saisir une
      date passée, refusée pour une raison que rien n'annonçait)
- [x] `pages/Events.jsx` — trois onglets, parce que ce sont trois questions
      différentes : « à venir », « autour de moi », « mes inscriptions ».
      Chacun ne charge que ses propres données.
- [x] `pages/EventDetail.jsx` — détail, inscription, participants, plus
      modification et annulation pour l'organisateur
- [x] Un événement privé garde sa place dans la liste « autour de moi » même
      sans coordonnées : le retirer des deux vues laisserait croire qu'il
      n'existe pas — et supprimerait l'argument qui donne envie de s'abonner
- [x] Le bloc d'inscription est **une fonction qui rend du balisage, pas un
      composant déclaré dans le rendu** : ce dernier reçoit une identité neuve
      à chaque passage, et le champ de message perdrait le focus à chaque frappe
- [x] Entrée « Événements » dans la navigation
- [x] Les deux écrans sont chargés **à la demande** (`lazy`), comme `/carte` :
      ils embarquent Leaflet, et un import statique aurait ramené ses 150 ko
      dans le paquet principal par une autre porte

### 9.6 Vérifications

Suite serveur `npm run test:evenements` — **76/76 réussies**.

- [x] Création refusée à un sportif et à un coach non certifié
- [x] `dateFin` antérieure à `dateDebut` rejetée · capacité nulle rejetée ·
      longitude sans latitude rejetée
- [x] **Surréservation impossible : 20 inscriptions simultanées sur 5 places,
      exactement 5 acceptées**
- [x] Double inscription refusée · double désinscription refusée
- [x] Inscription à un événement passé, annulé, ou au sien : refusée
- [x] Désinscription libère la place, compteur exact, documents concordants
- [x] Une place libérée profite bien à un candidat précédemment refusé
- [x] Retour après désistement : **un seul document** malgré l'aller-retour
- [x] Événement privé : adresse absente de la réponse pour un non-abonné,
      ville et titre conservés, inscription refusée en 403
- [x] Liste des participants masquée à un simple inscrit
- [x] Modification et annulation refusées à un tiers
- [x] Capacité sous le nombre d'inscrits refusée
- [x] Annulation : événement conservé, statut `annule`, motif visible
- [x] Recherche par proximité cohérente avec le module 8, distance renvoyée
- [x] `/events/proches` et `/events/mes-inscriptions` non confondus avec un
      identifiant ; identifiant réellement invalide rejeté en 400

Parcours navigateur `npm run test:evenements` côté client — **38/38 réussies**.

- [x] Parcours complet : liste, fiche, inscription, désinscription, agenda
- [x] **L'adresse d'un événement privé est absente du HTML lui-même**, pas
      seulement masquée à l'écran — la masquer en CSS ne protégerait personne
- [x] Marqueurs réellement rendus sur la carte des événements
- [x] Bouton de création absent pour un sportif et pour un coach non certifié
- [x] Création, modification, annulation depuis le navigateur ; l'événement
      annulé reste consultable avec son motif
- [x] `/evenements` et la fiche sans débordement en 375 et 768 px
- [x] Console propre
- [x] Aucune régression : `test:carte` 50/50, `test:api` 73/73

### 9.7 Contrôle de non-régression

Les huit suites rejouées après le module :

| Commande | Résultat |
|---|---|
| `npm run test:api` (serveur) | 73/73 |
| `npm run test:stripe` (serveur) | 50/50 |
| `npm run test:relations` (serveur) | 28/28 |
| `npm run test:evenements` (serveur) | 76/76 |
| `npm run test:ui` (client) | 45/45 |
| `npm run test:premium` (client) | 18/18 |
| `npm run test:paiement` (client) | 46/46 |
| `npm run test:carte` (client) | 50/50 |
| `npm run test:evenements` (client) | 38/38 |

**396/396.** `npm run lint` et `npm run build` passent également : Leaflet reste
dans un fragment séparé, le paquet principal n'a pas grossi.

> **Piège d'environnement, à retenir.** `test:paiement` a d'abord échoué à
> 18/31 — et l'échec ne désignait rien de juste : treize vérifications rouges
> en cascade, toutes après « attente du webhook ». La cause était en amont et
> hors du code : `stripe listen --forward-to localhost:5000/api/webhooks/stripe`
> n'était pas lancé, donc aucun webhook n'arrivait. Avec le relais actif,
> 46/46 sans rien changer. **Le premier réflexe devant une cascade d'échecs
> n'est pas de lire le code, mais de vérifier que les prérequis tournent.**
>
> Deux exécutions ont par ailleurs expiré au premier `page.goto` lorsque
> plusieurs suites navigateur s'enchaînaient dans la même commande : c'est la
> machine qui sature, pas l'application. Les lancer une par une suffit.

---

## Module 10 — Recherche  `TERMINÉ`

> Ce que les modules précédents rendent possible ici : l'**index texte** sur
> `pseudo`, `nom`, `prenom` posé dès le module 1, les **règles de visibilité**
> du module 4, le **contrôle d'accès premium** du module 7, et les contenus à
> parcourir — publications (module 5), coachs (module 8), événements (module 9).

### 10.0 Le problème central — un index texte ne fait PAS d'autocomplétion

C'est la méprise fondatrice du module, et elle coûte cher à qui la découvre
tard. `$text` de MongoDB travaille sur des **mots entiers**, après
segmentation et désuffixation : chercher `mar` ne trouve **jamais** « Martin ».
Or une barre de recherche moderne doit répondre dès la troisième lettre.

- [x] **Deux mécanismes distincts, pour deux usages distincts**, et non un
      seul étiré : `$text` pour la recherche *lancée* (mots entiers, résultats
      classés par pertinence), une **expression rationnelle ancrée** pour
      l'autocomplétion (`^mar`, préfixe, donc indexable)
- [x] **L'ancrage `^` n'est pas cosmétique** : sans lui, MongoDB ne peut pas
      se servir de l'index et parcourt la collection entière à chaque frappe
- [x] **Et une expression ancrée n'utilise l'index QUE si elle est sensible à
      la casse.** `$options: 'i'` annule le bénéfice ; une collation
      insensible ne sauve pas non plus la mise, MongoDB refusant l'index pour
      toute expression rationnelle dès que la collation n'est pas simple.
- [x] **D'où le champ `termesRecherche`** : une liste de termes déjà mis en
      minuscules et désaccentués. La comparaison s'y fait en casse exacte —
      donc indexée — et se trouve néanmoins insensible à la casse et aux
      accents, puisque les deux côtés ont subi le même traitement.
- [x] **Vérifié par le plan d'exécution, pas par déduction** :
      `explain()` sur `{ isActive, termesRecherche: /^mar/ }` renvoie
      `IXSCAN isActive_1_termesRecherche_1` — l'index est bien parcouru par
      plage, et non la collection balayée
- [x] **La requête est retardée côté client** (`useDebounce`, 300 ms) :
      une frappe = une requête ferait neuf appels pour « martineau ».
      Mesuré dans le navigateur : **1 requête pour 9 lettres**.

### 10.1 Index et données
- [x] Index texte sur `User` — en place depuis le module 1, poids
      `pseudo: 10`, `prenom: 3`, `nom: 3`
- [x] `User.termesRecherche` — tableau normalisé, `select: false` (ce champ ne
      regarde que le moteur de recherche, pas les réponses HTTP)
- [x] Index multiclé `{ isActive: 1, termesRecherche: 1 }` — `isActive` en
      tête écarte d'emblée les comptes désactivés
- [x] Crochet `pre('save')` **déclenché par champ modifié**, pas à chaque
      enregistrement : un `save()` qui ne touche qu'à `derniereConnexion` n'a
      aucune raison de réécrire un tableau identique
- [x] `utils/texte.js` — `normaliser()`, `termesDe()`, `echapperRegex()`,
      `motifPrefixe()`. On indexe **les mots, pas la chaîne entière** : sur
      « martin dupont », un préfixe `dup` ne matcherait rien autrement.
- [x] Index texte sur `Post` (titre 8, description 2) et sur `SportEvent`
      (titre 8, sport 8, description 2) — la limite d'un index texte est **par
      collection**, pas globale
- [x] **`scripts/reindexerRecherche.js` + `npm run reindexer-recherche`** —
      le crochet n'alimente que les documents enregistrés APRÈS lui : sans
      reprise, tous les comptes antérieurs resteraient introuvables. C'est le
      piège classique d'une dénormalisation ajoutée après coup — la
      fonctionnalité marche sur les comptes de test créés pendant le
      développement, et ne trouve rien en production. Écriture groupée,
      idempotent.

### 10.2 Service
- [x] `services/search.service.js`
- [x] `suggestions()` — préfixe ancré, huit résultats, tri par nombre
      d'abonnés (à préfixe égal, le compte le plus suivi est presque toujours
      celui qu'on cherchait)
- [x] `utilisateurs()` — `$text` classé par pertinence, **complété par le
      préfixe en filet** : sans lui, valider « mar » ne donnerait rien
- [x] L'ordre de fusion porte la priorité : les résultats notés passent
      devant, le repli comble la suite sans jamais déloger un mieux classé
- [x] `publications()` — les deux verrous cumulés : visibilité du profil de
      l'auteur, puis verrou premium délégué à `versionPour()`
- [x] `evenements()` — à venir seulement, filtre sur `dateFin` comme au
      module 9
- [x] `globale()` — les trois en parallèle (`Promise.all`) : enchaînées,
      l'écran d'ensemble attendrait la somme de trois latences indépendantes
- [x] Limites bornées (20 par défaut, 50 au maximum, 8 en suggestion)

### 10.3 Règles de visibilité
- [x] Les comptes **désactivés** n'apparaissent jamais
- [x] Un profil **privé** reste trouvable mais ne livre que sa version
      publique : être trouvable et être lisible sont deux choses différentes
- [x] Les auteurs interrogeables sont restreints **en amont** de la requête :
      filtrer après coup obligerait à charger des documents pour les jeter, et
      fausserait le compte de résultats
- [x] Une publication **premium** n'expose ni description ni médias à qui
      n'est pas abonné — point unique du module 7, jamais redupliqué
- [x] Un événement **privé** garde son adresse masquée, comme au module 9
- [x] La recherche n'est **pas** une porte dérobée : chaque verrou des modules
      4, 7 et 9 a sa vérification dédiée dans la suite

### 10.4 Endpoints
- [x] `GET /api/search` — recherche globale
- [x] `GET /api/search/utilisateurs` (filtres type et ville) ·
      `/publications` · `/evenements`
- [x] `GET /api/search/suggestions` — autocomplétion, **route à part** : ni le
      même coût, ni la même forme de réponse, ni la même fréquence d'appel
- [x] `protectOptionnel` partout — chercher ne demande pas de compte, mais la
      session **change les résultats** : comptes privés suivis, contenu
      premium, adresses d'événements réservés
- [x] Requête vide, trop courte (< 2) ou trop longue (> 80) rejetée en 400
- [x] `validators/search.validator.js` — **sans `.escape()`, délibérément** :
      il transformerait l'apostrophe de « l'entraînement » en `&#x27;`, et la
      recherche ne trouverait plus rien. Le terme interroge, il n'est ni
      stocké ni réaffiché ; le risque réel est le ReDoS, traité par
      `echapperRegex()`.
- [x] Pas de limiteur spécifique : la route la plus appelée du projet reste
      couverte par le limiteur global, et la vraie réduction du trafic se fait
      par le délai d'attente côté client
- [x] Routeur monté dans `routes/index.js`

### 10.5 Front
- [x] `api/search.api.js` — chaque appel accepte un `signal`
- [x] `hooks/useDebounce.js` — 300 ms. En dessous de 200 ms une frappe normale
      passe encore à travers ; au-delà de 400 ms l'interface traîne. Le
      nettoyage `clearTimeout` **est l'essentiel du hook** : sans lui, chaque
      lettre programmerait son propre déclenchement et les neuf requêtes
      partiraient quand même, avec 300 ms de retard.
- [x] `components/search/BarreRecherche.jsx` — motif ARIA `combobox`,
      navigation aux flèches, `aria-activedescendant` (sans quoi un lecteur
      d'écran n'annonce pas la suggestion survolée au clavier)
- [x] **`onMouseDown` et non `onClick`** sur les suggestions : le clic retire
      d'abord le focus, ce qui ferme la liste — le bouton disparaîtrait avant
      d'avoir reçu le clic
- [x] **Annulation des requêtes obsolètes** (`AbortController`) : rien ne
      garantit que la réponse à « nat » revienne avant celle à « natation ».
      Sans annulation, la liste régresse sous les yeux de l'utilisateur.
- [x] `pages/Search.jsx` — **le terme vit dans l'URL** (`?q=`), donc partageable,
      rechargeable et navigable au bouton « précédent »
- [x] Quatre onglets, chacun ne chargeant que ses propres données
- [x] Le message de liste vide **nomme la famille interrogée** : « Aucun
      résultat » sur l'onglet « Personnes » laisserait croire que le terme
      n'existe nulle part, alors que l'événement cherché est dans l'onglet
      voisin
- [x] Entrée « Recherche » active dans la navigation, route `/recherche`

#### Deux défauts trouvés à l'exécution, invisibles à la lecture

- [x] **Échap vidait le champ.** Sur un `input type="search"`, Échap a une
      action **native** : effacer la saisie. Elle déclenchait `onChange`, qui
      rouvrait la liste — Échap effaçait donc le texte *et* laissait les
      suggestions ouvertes, l'inverse exact des deux intentions. Le code disait
      « fermer » ; c'est le navigateur qui faisait autre chose derrière.
      Corrigé par `preventDefault()`, et le test vérifie désormais que le
      **texte survit** — sans quoi il passait pour la mauvaise raison.
- [x] **`formaterDistance` traînait Leaflet dans la recherche.** `EventCard`
      l'importait depuis `MarqueurCoach`, un composant `react-leaflet` :
      l'import avait l'air anodin et embarquait 150 ko de cartographie dans
      tout écran affichant une carte d'événement. Déplacée dans
      `utils/distance.js`. Le paquet principal passe de **387 ko à 297 ko**,
      et `grep leaflet` sur le fragment principal ne renvoie plus rien.

### 10.6 Vérifications

Suite serveur `npm run test:recherche` — **54/54**.

- [x] `$text` trouve un mot entier · un préfixe validé aboutit par le repli
- [x] **Un fragment au MILIEU d'un mot ne remonte pas** : c'est un préfixe,
      pas une sous-chaîne, et la distinction est assumée
- [x] Classement par pertinence : le pseudo (poids 10) passe devant le nom (3)
- [x] Accents et casse ignorés dans les deux sens
- [x] Compte désactivé absent · profil privé trouvable, sans email dans la
      réponse
- [x] Publication d'un compte privé absente pour un anonyme, visible de son
      auteur
- [x] Publication premium : verrouillée, médias retirés, description masquée ;
      le coach relit la sienne
- [x] Événement passé absent · événement privé sans adresse exacte, adresse
      visible pour l'organisateur
- [x] Requête vide, d'une lettre, de 120 caractères, limite hors bornes :
      toutes rejetées en 400
- [x] **Motif ReDoS `(a+)+$` traité en 20 ms** — échappé, il n'est plus qu'une
      chaîne littérale
- [x] Apostrophe non transformée en entité HTML

Parcours navigateur `npm run test:recherche` côté client — **36/36**.

- [x] **1 requête pour 9 lettres frappées** — la mesure qui justifie le hook :
      une barre sans délai passerait tous les autres tests sans exception,
      puisqu'elle afficherait exactement les mêmes résultats
- [x] Préfixe de trois lettres, accents ignorés à l'écran aussi
- [x] Clavier complet : flèches, `aria-activedescendant`, Échap, Entrée sur
      une suggestion ouvrant le profil
- [x] **La description premium est absente du HTML lui-même**, pas seulement
      masquée à l'écran
- [x] Le terme vient de l'URL · onglets cloisonnés · message vide explicite
- [x] La liste correspond au dernier terme saisi, pas à un terme abandonné
- [x] `/recherche` sans débordement en 375 et 768 px · console propre

### 10.7 Contrôle de non-régression

Les dix suites rejouées après le module :

| Commande | Résultat |
|---|---|
| `npm run test:api` (serveur) | 73/73 |
| `npm run test:stripe` (serveur) | 50/50 |
| `npm run test:evenements` (serveur) | 76/76 |
| `npm run test:recherche` (serveur) | 54/54 |
| `npm run test:ui` (client) | 45/45 |
| `npm run test:premium` (client) | 18/18 |
| `npm run test:paiement` (client) | 46/46 |
| `npm run test:carte` (client) | 50/50 |
| `npm run test:evenements` (client) | 38/38 |
| `npm run test:recherche` (client) | 36/36 |

**486/486.** `npm run lint` et `npm run build` passent ; Leaflet reste confiné
au fragment cartographique, absent du paquet principal.

> **Piège d'environnement, à retenir — deuxième occurrence.** Après un
> redémarrage, aucune suite navigateur ne passait : la connexion restait
> bloquée sur `/login`. Le code n'était pas en cause. Deux processus Vite
> orphelins subsistaient d'une session précédente ; celui qui tenait le port
> 5173 avait perdu son parent et ne relayait plus `/api` — Vite servait les
> pages, le proxy ne forwardait rien, et le second s'était rabattu sur 5174
> sans que personne le remarque. L'API répondait parfaitement en direct.
>
> **Le symptôme accusait l'application, la cause était deux ports plus loin.**
> Le réflexe utile : comparer un appel *direct* à l'API et le même appel *via
> le proxy*, puis vérifier qui écoute réellement sur le port
> (`Get-NetTCPConnection -LocalPort 5173`).

---

## Module 11 — Messagerie  `TERMINÉ`

> Ce que les modules précédents rendent possible ici : le **JWT** du module 2
> pour authentifier le socket, la relation de **suivi** du module 6 pour
> décider si un message est sollicité, le **stockage** du module 5 pour les
> pièces jointes, et les **transactions** du module 1 pour les compteurs de
> messages non lus.

### 11.0 Les deux décisions structurantes

**1. Le socket n'est pas une voie d'écriture.**
La tentation est d'écrire le message dans le gestionnaire de socket : c'est
plus direct, et tous les tutoriels le font. C'est aussi le moyen le plus sûr
de se retrouver avec **deux chemins d'écriture divergents** — l'un en HTTP,
l'autre en socket — chacun avec sa validation, ses contrôles d'accès, et ses
oublis. Le jour où l'on corrige une règle dans l'un, l'autre reste faux, et
c'est la voie temps réel, la moins testée, qui reste ouverte.

Ici, **le message s'écrit par HTTP, le socket ne fait que notifier.** Le
fichier `chat.handler.js` ne contient aucune écriture en base, et ce n'est pas
un oubli : les seuls événements acceptés du client sont éphémères.

**2. Rien de ce que le client envoie ne désigne un destinataire.**
Router un message vers un identifiant reçu du navigateur reviendrait à laisser
n'importe qui écrire à n'importe qui. L'identité vient du **JWT vérifié à la
poignée de main**, et les destinataires sont relus **en base**.

- [x] Authentification du socket à la connexion, jamais après
- [x] L'utilisateur est **relu en base** au lieu de croire le jeton : un
      compte désactivé garderait sinon un accès valide jusqu'à expiration
- [x] **Une salle par personne, pas par conversation** — un socket rejoint la
      sienne à la connexion et rien d'autre. Il n'existe aucun événement
      « rejoindre » : s'inviter dans un échange est donc impossible par
      construction, et non par contrôle.
- [x] Diffusion vers les salles des participants relus en base
- [x] Une seule voie d'écriture : le contrôleur HTTP
- [x] **Le jeton expire, pas la connexion.** L'access token vaut 15 minutes,
      un onglet reste ouvert des heures. Fermer le socket à l'expiration
      déconnecterait quelqu'un au milieu d'une phrase. On accepte donc qu'une
      session socket survive à son jeton : elle ne peut rien écrire, et toute
      action réelle repasse par HTTP où le jeton périmé est refusé puis
      renouvelé.
- [x] `diffuserA()` tolère l'absence de Socket.io : les suites de tests
      importent les contrôleurs sans démarrer le temps réel

### 11.1 Modèles
- [x] `models/Conversation.js` — deux participants, statut, demandeur,
      dernier message dénormalisé, compteurs de non-lus
- [x] Participants **triés** dans `pre('validate')` : sans tri, `[a,b]` et
      `[b,a]` décrivent le même échange sous deux formes
- [x] `nonLus` en **`Map` plutôt qu'en deux champs nommés** : `{ nonLusA,
      nonLusB }` obligerait à savoir en permanence qui est « A »
- [x] `models/Message.js` — texte OU média, jamais vide, suppression douce
- [x] Index `{ conversation, createdAt: -1 }` · `{ conversation, expediteur, lu }`
- [x] Les messages **hors** du document conversation : un fil vit des mois et
      un document MongoDB plafonne à 16 Mo

#### Le piège de l'index unique sur un tableau

- [x] **`index({ participants: 1 }, { unique: true })` ne fait PAS ce qu'il
      semble dire.** Un index sur un tableau est **multiclé** : MongoDB indexe
      chaque élément séparément, et `unique` interdit alors qu'une même valeur
      apparaisse dans deux documents — c'est-à-dire qu'une personne participe
      à plus d'**une** conversation, pour toute sa vie.
- [x] Le symptôme trompe : la première conversation d'Alice passe, la seconde
      échoue en 11000, et le service — qui rattrape le 11000 en relisant la
      paire — renvoie `null`. L'erreur affichée parle d'un `populate` sur
      `null`, trois couches plus loin que la cause.
- [x] **Corrigé par une clé canonique scalaire** `cle: "<idA>_<idB>"`, calculée
      à la validation depuis la paire triée, avec `unique` dessus. L'index sur
      `participants` demeure, non unique — c'est justement ce qui le rend
      correct sur un tableau.

### 11.2 La demande de chat
- [x] Si la cible **suit déjà** l'initiateur → conversation `accepte`
- [x] Le sens compte : c'est « la CIBLE suit l'INITIATEUR ». L'inverse ne
      prouve rien — suivre quelqu'un n'est pas consentir à recevoir ses
      messages privés.
- [x] Sinon → `en_attente` : **un** message passe, il faut bien pouvoir se
      présenter, les suivants sont bloqués. Sans ce plafond, « en attente » ne
      changerait rien pour l'expéditeur.
- [x] La cible, elle, écrit librement : **répondre vaut acceptation**
- [x] Une conversation `refuse` n'accepte plus rien, des deux côtés
- [x] Accepter ou refuser est réservé à la cible — laisser le demandeur
      accepter sa propre demande serait un bouton « ignorer le consentement »

### 11.3 Service et endpoints
- [x] `services/message.service.js`
- [x] `envoyer()` — **trois écritures dans une seule transaction** : le
      message, l'extrait du fil, le compteur de non-lus. Séparées, un incident
      laisse un message invisible dans la liste, ou une pastille que plus
      aucune lecture ne remet à zéro.
- [x] `$inc` sur une clé de `Map` en notation pointée : relire puis réécrire
      la Map rouvrirait la course que la transaction ferme
- [x] La course à l'ouverture tranchée par la base (index unique), pas par un
      « chercher puis créer » qui laisse la fenêtre ouverte
- [x] `marquerLu()` — **deux portées distinctes** : le compteur du fil retombe
      à zéro, les messages *reçus* passent à `lu`. Lire n'est pas être lu.
- [x] `totalNonLus()` — `.lean()` rend la `Map` sous forme d'objet simple :
      `get()` n'y existe pas, et l'appeler planterait à la première pastille
- [x] `rafraichirExtrait()` — appelé après une suppression (voir 11.6)
- [x] `POST /api/messages/conversations` · `GET` (liste)
- [x] `GET /api/messages/conversations/:id/messages` — curseur, pas `skip`
- [x] `POST /api/messages/conversations/:id/messages` — texte ou pièce jointe
- [x] `PATCH /api/messages/conversations/:id` — accepter / refuser
- [x] `POST /api/messages/conversations/:id/lu` · `GET /api/messages/non-lus`
- [x] `DELETE /api/messages/:id` — suppression douce
- [x] Segments fixes avant `/:id`, comme aux modules 6, 7, 9 et 10
- [x] `validators/message.validator.js` — **sans `.escape()`** : il stockerait
      « l&#x27;entraînement » **en base**, abîmé pour toujours. Le XSS se
      traite à l'affichage, et React échappe déjà tout ce qu'il rend.
- [x] `uploadPieceJointe` — plafond plus bas qu'ailleurs (5 Mo) : une
      conversation accumule des centaines de pièces jointes là où une
      publication en compte dix

### 11.4 Temps réel
- [x] `sockets/index.js` — attaché au serveur HTTP d'Express, pas sur un
      second port : un port distinct imposerait une seconde configuration
      CORS et casserait le partage du cookie de session
- [x] `sockets/chat.handler.js` — indicateur de saisie uniquement
- [x] L'indicateur est **émis vers l'autre, jamais vers soi**
- [x] Il est aussi contrôlé : émettre une saisie dans un fil étranger
      révélerait son existence et permettrait de se signaler à quelqu'un qui a
      refusé le contact
- [x] Diffusion `message:nouveau`, `conversation:maj`, `messages:lus`,
      `message:supprime`
- [x] **L'expéditeur est notifié lui aussi** : sans cela, le message écrit sur
      le téléphone n'apparaîtrait jamais dans l'onglet resté ouvert
- [x] Chaque participant reçoit **sa** vue : les non-lus n'ont pas la même
      valeur des deux côtés
- [x] La diffusion vient **après** l'écriture et la réponse HTTP : si le temps
      réel est indisponible, le message est déjà en base

### 11.5 Front
- [x] `socket.io-client`, `context/SocketContext.jsx`, `hooks/useSocket.js`
- [x] **Un seul socket pour toute l'application** — un par écran multiplierait
      les connexions maintenues, et un message reçu ailleurs ne mettrait à
      jour aucune pastille
- [x] `SocketProvider` **sous** `AuthProvider` : il lit la session pour
      décider de se connecter. Placé au-dessus, il boucherait la console de
      reconnexions refusées.
- [x] Le jeton est lu **au moment de la connexion**, jamais mémorisé : il
      tourne toutes les 15 minutes
- [x] `ecouter()` rend une fonction de désabonnement — en StrictMode, l'oubli
      produit deux abonnements et chaque message s'affiche en double
- [x] `api/message.api.js` — aucun `emit` d'envoi, la règle du 11.0 se lit
      aussi côté client
- [x] `components/message/ConversationList.jsx` — qui, quand, quoi ; pastille
      **doublée d'une mise en gras** et d'un libellé accessible
- [x] `ChatWindow.jsx` — historique par HTTP **puis** socket : l'un sans
      l'autre donne un fil vide ou un fil figé
- [x] **Les messages reçus sont filtrés par conversation** : le socket diffuse
      par utilisateur, tous fils confondus
- [x] Message ajouté localement à l'envoi, dédoublonné par `_id` au retour du
      socket
- [x] L'indicateur « écrit… » s'éteint sur minuteur : si l'autre ferme son
      onglet entre le début et la fin, le second événement n'arrive jamais
- [x] Entrée envoie, Maj+Entrée passe à la ligne
- [x] `ChatRequestBanner.jsx` — trois situations, trois messages ; la
      conséquence du refus est annoncée **avant** le clic
- [x] `pages/Messages.jsx` — deux colonnes en grand écran, une seule en
      mobile avec retour explicite ; le fil ouvert vit dans l'URL (`?c=`)
- [x] Liste mise à jour **en place** sur `conversation:maj`, pas rechargée
- [x] Pastille de non-lus dans la navigation, alimentée par **deux sources** :
      le socket pour l'immédiat, HTTP au montage pour ce qui est arrivé avant
      la connexion. N'en garder qu'une donne une pastille figée, ou toujours
      à zéro au démarrage.
- [x] Entrée « Messages » active dans la navigation
- [x] **`components/profile/BoutonMessage.jsx` — le point d'entrée qui
      manquait.** Tout le module 11 était en place et vérifié, mais aucune
      porte ne menait à une conversation NEUVE : on pouvait lire et répondre à
      un fil existant, jamais en ouvrir un. Une fonctionnalité sans point de
      départ n'existe pas pour l'utilisateur, si complète soit-elle par
      ailleurs. Le bouton ouvre — ou retrouve — la conversation puis emmène au
      fil ; il n'écrit aucun message, car rédiger se fait là où l'on voit à
      qui l'on parle.
- [x] Le bouton s'appuie sur l'**idempotence** de `POST /conversations` :
      recliquer ne crée pas un second fil, et la garantie vient de l'index
      unique sur la paire, pas d'une précaution prise dans le composant
- [x] **Proxy Vite `/socket.io` avec `ws: true`** — sans ce drapeau, Vite
      relaie la première requête HTTP de Socket.io mais refuse la montée en
      WebSocket : le socket a l'air de fonctionner par intermittence, et rien
      en console ne désigne le proxy

#### Deux défauts trouvés à l'exécution

- [x] **Supprimer un message ne le supprimait pas de la liste.** L'extrait
      « dernier message » est une **copie** du texte : effacer le message
      d'origine le laissait intact dans la conversation, visible des deux
      côtés et présent dans la réponse HTTP. C'est le prix de la
      dénormalisation — toute écriture qui touche un message doit toucher
      l'extrait. Corrigé par `rafraichirExtrait()`, plus un drapeau `supprime`
      sur l'extrait.
- [x] **La règle « texte ou média » bloquait la suppression.** La suppression
      douce vide précisément ces deux champs, puis enregistre : la validation
      refusait, et l'API répondait « un message doit contenir du texte ou un
      média » **à une demande de suppression**. Le message accusait le
      contenu ; la cause était l'ordre des règles.

### 11.6 Vérifications

Suite serveur `npm run test:messagerie` — **62/62**.

- [x] Socket refusé sans jeton, avec un jeton falsifié, **avec un jeton
      expiré** (le cas qu'un contrôle naïf laisse passer, la signature étant
      valide)
- [x] **Un identifiant envoyé par le client est ignoré** : le serveur répond
      l'identité du porteur du jeton, et la salle est la sienne
- [x] S'écrire à soi-même refusé
- [x] **10 ouvertures simultanées donnent UNE conversation**, un seul document
- [x] Sas d'entrée : premier message accepté, second refusé, réponse de la
      cible libre, acceptation puis reprise de l'échange
- [x] Le demandeur ne peut pas accepter sa propre demande
- [x] Conversation refusée : plus rien ne passe, des deux côtés
- [x] Un tiers ne peut ni écrire ni lire ; il ne voit pas la conversation
- [x] Compteurs exacts (3 d'un côté, 0 de l'autre), total global, remise à
      zéro, messages reçus marqués lus **mais pas ceux envoyés**
- [x] **Bob reçoit le message en direct** · **Carol ne reçoit rien**
- [x] L'expéditeur est notifié pour ses autres onglets, avec sa propre vue
- [x] Double coche en direct · saisie relayée à l'autre, pas à soi
- [x] **Saisie émise par un tiers non relayée** · ni dans un fil refusé
- [x] Suppression : réservée à l'expéditeur, message conservé, contenu absent
      de la réponse HTTP
- [x] `/messages/non-lus` non confondu avec un identifiant · 400 · 404 · 401

Parcours navigateur `npm run test:messagerie` côté client — **25/25**,
**avec deux navigateurs ouverts simultanément**.

- [x] **Alice écrit, le message paraît chez Bob sans aucun rechargement** —
      c'est la seule vérification qui distingue « diffusé » de « rechargé »
- [x] **Et une seule fois chez Alice** : l'ajout local et le socket ne doublent
      pas la bulle
- [x] Le fil de Carol n'apparaît pas chez Bob : le filtrage par conversation
      tient à l'écran
- [x] Double coche en direct · « Alice écrit… » chez Bob, jamais chez Alice
- [x] **La pastille apparaît chez Bob depuis une autre page, et retombe** à
      l'ouverture de la conversation
- [x] Demande de chat : bandeau chez la cible, conséquence du refus annoncée,
      champ de saisie retiré au demandeur, puis **rendu en direct** après
      acceptation
- [x] `/messages` sans débordement en 375 et 768 px, retour mobile présent
- [x] Console propre

> **Une vérification a d'abord échoué pour une raison qui n'était pas la
> bonne.** Le compte des occurrences portait sur la page entière : le même
> texte y figure légitimement deux fois — dans la bulle, et dans l'extrait de
> la liste à gauche. Le banc d'essai signalait donc un doublon qui n'existait
> pas. Corrigé en ciblant le fil (`data-testid="fil-messages"`).

### 11.7 Parcours utilisateur de bout en bout — modules 10 et 11

Contrôle demandé explicitement : *chercher une personne et voir un résultat*,
puis *ouvrir une conversation, la retrouver dans sa liste, y entrer, écrire et
envoyer*. Suite dédiée `npm run test:parcours-10-11` — **35/35**.

Les deux autres suites vérifient les RÈGLES ; celle-ci suit une INTENTION du
début à la fin. C'est cette différence qui a révélé le trou : `test:recherche`
et `test:messagerie` passaient à 100 %, et il était pourtant impossible
d'ouvrir une conversation depuis l'interface. Une suite qui teste des règles
ne voit pas l'absence d'un point d'entrée.

- [x] La recherche s'ouvre depuis la navigation
- [x] **Les suggestions apparaissent pendant la frappe**, la personne y figure
- [x] **La recherche validée affiche un résultat**, nom complet lisible
- [x] L'onglet « Personnes » la liste, sans message « aucun résultat »
- [x] **Cliquer sur le résultat ouvre son profil**
- [x] **Le profil propose « Envoyer un message »**
- [x] Le clic mène à la messagerie, sur la bonne conversation
- [x] **La conversation existe réellement en base** (un seul document)
- [x] **Elle apparaît dans ma liste de conversations**, avec le nom
- [x] **Elle s'ouvre au clic**, champ de saisie et bouton présents
- [x] **Le message envoyé apparaît dans le fil**, le champ est vidé
- [x] **Et il est enregistré en base** — un message affiché n'est pas un
      message envoyé : une interface optimiste peut montrer une bulle qu'aucun
      serveur n'a reçue
- [x] Le destinataire voit la conversation, l'extrait et **un message non lu**
- [x] Entrée envoie aussi ; deux messages en base
- [x] Responsive 375 et 768 px, console propre

#### Le sas d'entrée, tel qu'il se voit à l'écran

Le premier scénario écrit pour ce parcours a échoué sur un comportement qui
était **juste** : le champ de saisie disparaissait après le premier message.
La cible ne suivait pas l'expéditeur, la conversation était donc « en
attente », et la règle du 11.2 s'appliquait — un seul message tant qu'elle
n'a pas accepté.

- [x] Le scénario principal ouvre une conversation avec quelqu'un **qui me
      suit** : c'est l'échange courant, et le champ y reste disponible
- [x] Un second scénario couvre l'autre chemin : premier message accepté,
      **puis champ retiré**
- [x] **Et l'interface explique pourquoi** — sans cette phrase, un champ qui
      s'évanouit ressemble exactement à un bogue

### 11.8 Contrôle de non-régression

Les douze suites rejouées après le module :

| Commande | Résultat |
|---|---|
| `npm run test:api` (serveur) | 73/73 |
| `npm run test:stripe` (serveur) | 50/50 |
| `npm run test:evenements` (serveur) | 76/76 |
| `npm run test:recherche` (serveur) | 54/54 |
| `npm run test:messagerie` (serveur) | 62/62 |
| `npm run test:ui` (client) | 45/45 |
| `npm run test:premium` (client) | 18/18 |
| `npm run test:paiement` (client) | 46/46 |
| `npm run test:carte` (client) | 50/50 |
| `npm run test:evenements` (client) | 38/38 |
| `npm run test:recherche` (client) | 36/36 |
| `npm run test:messagerie` (client) | 25/25 |
| `npm run test:parcours-10-11` (client) | 35/35 |

**608/608.** `npm run lint` et `npm run build` passent.

---

## Module 12 — Notifications  `TERMINÉ`

> Ce que les modules précédents rendent possible ici : le **socket
> authentifié** du module 11 pour la diffusion immédiate, et les huit
> événements à notifier, déjà tous écrits — suivi (6), like et commentaire
> (5), abonnement premium (7), inscription à un événement (9), demande de
> chat et message (11), vérification de diplôme (4).

### 12.0 La décision structurante — un point de génération unique

Huit endroits du code peuvent créer une notification. La tentation est
d'écrire `Notification.create(...)` dans chacun : c'est direct, et chaque
contrôleur sait ce qu'il vient de faire.

C'est aussi le moyen d'obtenir **huit règles légèrement différentes**. Le
premier oubliera de vérifier qu'on ne se notifie pas soi-même, le deuxième
créera un doublon à chaque re-like, le troisième laissera une notification
orpheline quand la publication est supprimée. Aucun de ces défauts n'est
visible en lisant un seul contrôleur — ils n'apparaissent qu'en les comparant.

- [x] **`notification.service.js` est le SEUL endroit qui écrit** une
      notification ; les contrôleurs déclarent l'intention, pas la mécanique
- [x] **On ne se notifie jamais soi-même** — règle appliquée une fois, pas
      huit. Aimer sa propre publication ne produit rien.
- [x] **Anti-doublon sur les actions réversibles** : `creerOuRegrouper()` avec
      `findOneAndUpdate` + `upsert`, en UNE opération. Chercher puis créer
      laisserait entre les deux la fenêtre où deux clics rapides font deux
      documents — même raisonnement qu'aux modules 9 et 11.
- [x] Fenêtre de regroupement d'une heure : en deçà c'est une hésitation,
      au-delà c'est une attention nouvelle
- [x] **La création ne lève JAMAIS.** Une notification accompagne une action,
      elle n'est pas l'action : si son écriture échoue, le like doit rester et
      le message doit partir. L'échec est tracé, pas propagé — sans quoi
      l'utilisateur verrait « erreur » alors que tout s'est bien passé.
- [x] **La cible est polymorphe** (`refPath`) : un champ par type donnerait un
      document criblé de `null`
- [x] Une notification dont la cible a disparu ne casse pas l'écran

### 12.1 Modèle
- [x] `models/Notification.js` — destinataire, émetteur, type, cible
      polymorphe, `lu`
- [x] `TYPES_NOTIFICATION` et `TYPES_CIBLE` **exportés en constantes** :
      recopiée dans le service, les validateurs et les tests, la liste
      finirait par diverger
- [x] **`emetteur` facultatif** — « votre diplôme a été vérifié » vient de
      l'administration, pas d'une personne dont on afficherait l'avatar.
      Rendre le champ obligatoire forcerait à inventer un émetteur.
- [x] Index `{ destinataire, lu, createdAt: -1 }` — égalité, filtre, tri
- [x] **TTL de 30 jours sur `luLe`**, un champ posé UNIQUEMENT à la lecture.
      Faire expirer sur `updatedAt` effacerait des notifications jamais lues ;
      MongoDB ignorant les documents dont le champ indexé est absent, ce TTL
      ne touche que ce qui a été vu.
- [x] `versionPublique()` — l'émetteur réduit à ce qui l'affiche, jamais son
      email ; la cible réduite à son identifiant, le front construisant le
      lien lui-même

### 12.2 Service
- [x] `creer()` — point unique, ignore l'auto-notification
- [x] `creerOuRegrouper()` — pour les actions réversibles ; `$unset` de `luLe`
      au regroupement, sinon une notification relue puis ravivée resterait
      exposée à la purge
- [x] `liste()` · `compterNonLues()` · `marquerLu()` · `toutMarquerLu()` ·
      `supprimer()`
- [x] **Le filtre porte aussi sur le destinataire**, jamais sur le seul
      identifiant : connaître un identifiant ne doit pas suffire à écrire
      chez quelqu'un d'autre
- [x] Diffusion socket immédiate, **réutilisant `diffuserA()` du module 11** —
      un second mécanisme de diffusion donnerait deux couches à maintenir et
      deux façons de se tromper de destinataire

### 12.3 Branchements
- [x] `follow` et `demande_follow` (module 6) — deux types distincts, parce
      que « X vous suit » ne demande rien tandis que « X demande à vous
      suivre » appelle une décision
- [x] Accepter une demande prévient **le demandeur**, pas celui qui accepte
- [x] `like` (module 5) — **la pose seulement** : « X n'aime plus votre
      publication » n'a aucun usage et serait blessant pour rien
- [x] `commentaire` (module 5) — `creer` et non `creerOuRegrouper` : deux
      commentaires sont deux contributions, les regrouper effacerait le second
- [x] `demande_chat` et `message` (module 11) — le type dépend de l'état du
      fil ; les confondre noierait les demandes parmi les messages courants
- [x] `inscription_event` (module 9) — notifie **l'organisateur**, pas
      l'inscrit qui vient d'agir
- [x] `nouvel_abonne_premium` (module 7) — créé **dans le webhook**, pas au
      clic : la moitié des sessions Checkout sont abandonnées, et notifier au
      clic annoncerait des abonnés qui n'ont jamais payé
- [x] `diplome_verifie` (module 4) — sans émetteur, et émis aussi en cas de
      refus : un coach non informé attendrait une réponse déjà rendue

### 12.4 Endpoints
- [x] `GET /api/notifications` — paginé, filtre `nonLues`
- [x] `GET /api/notifications/non-lues` — pastille
- [x] `PATCH /api/notifications/:id/lu` · `POST /api/notifications/tout-lu`
- [x] `DELETE /api/notifications/:id`
- [x] **Aucune route de création**, et c'est délibéré : une notification naît
      d'une action réelle, jamais d'une requête qui la demanderait
- [x] **404 et non 403** sur une notification qui n'est pas la nôtre : le 403
      confirmerait son existence chez quelqu'un d'autre
- [x] Segments fixes avant `/:id`, comme aux modules 6, 7, 9, 10 et 11
- [x] `validators/notification.validator.js`

### 12.5 Front
- [x] `api/notification.api.js` — aucune fonction de création
- [x] `context/NotificationContext.jsx` + `hooks/useNotifications.js`
- [x] **Deux sources pour le compteur** : le socket pour l'immédiat, HTTP au
      montage pour ce qui est arrivé avant la connexion
- [x] L'arrivée d'une notification **incrémente localement** au lieu de relire
      le serveur : une relecture par like d'une publication populaire ferait
      exactement le trafic que le temps réel devait éviter
- [x] `components/notification/NotificationItem.jsx` — traduction du type en
      phrase française, en un seul endroit
- [x] Le lien mène **à l'endroit exact** ; sans destination, la ligne reste
      une ligne — un lien mort est pire qu'un texte simple
- [x] Pictogramme **doublé du texte**, jamais seul porteur de sens
- [x] `pages/Notifications.jsx` — onglets « toutes » / « non lues »,
      suppression, « tout marquer comme lu »
- [x] **Arriver sur la page ne vaut PAS lecture.** Contrairement à la
      messagerie — où ouvrir une conversation, c'est la lire — une liste de
      vingt notifications ne se lit pas d'un regard. Tout marquer à l'arrivée
      ferait disparaître le repère de ce qui restait à voir.
- [x] Mises à jour optimistes, corrigées par une relecture en cas d'échec
- [x] Pastille et entrée « Notifications » dans la navigation

#### Deux défauts trouvés à l'exécution

- [x] **Le contexte s'abonnait au socket avant que le socket existe.** React
      exécute les effets des ENFANTS avant ceux du parent : `NotificationProvider`,
      placé sous `SocketProvider`, appelait `ecouter()` alors que la référence
      valait encore `null`. L'abonnement partait dans le vide et la pastille ne
      bougeait jamais en direct.
      Le symptôme est particulièrement trompeur : tout fonctionnait dans les
      composants montés PLUS TARD — une conversation ouverte après navigation
      trouve un socket bien vivant. Seuls les abonnements posés au premier
      rendu échouaient, c'est-à-dire ceux des compteurs globaux.
      Corrigé en passant le socket par un **état** : `ecouter` change alors
      d'identité quand le socket apparaît, et l'effet des consommateurs se
      rejoue.
- [x] **La navigation débordait à 768 px.** La sixième entrée a fait passer
      les liens horizontaux au-delà de la largeur : la page se mettait à
      défiler latéralement, ce qui ne se voit sur aucun écran large. Le
      basculement passe de `md` (768 px) à `lg` (1024 px) — la barre du bas,
      déjà prévue pour le mobile, sert désormais aussi la tablette.

### 12.6 Vérifications

Suite serveur `npm run test:notifications` — **47/47**.

- [x] **On ne se notifie pas soi-même** : ni en aimant, ni en commentant sa
      propre publication ; la liste reste vide
- [x] Un like notifie l'auteur, avec émetteur, cible et état non lu
- [x] **Liker, dé-liker, re-liker deux fois ne produit QU'UNE notification** —
      un seul document en base
- [x] Retirer un like ne notifie rien
- [x] **Deux commentaires font deux notifications**
- [x] Un nouvel abonné notifie ; un compte privé reçoit une **demande**, pas
      un abonné ; accepter prévient le demandeur
- [x] Premier message d'un fil en attente → `demande_chat` ; une fois ouvert →
      `message`
- [x] Une inscription notifie l'organisateur, cible sur l'événement
- [x] **La décision sur un diplôme notifie le coach, sans émetteur**
- [x] Compteur exact, filtre « non lues », `luLe` renseigné à la lecture
- [x] « Tout marquer comme lu » ramène à zéro ; relancer annonce zéro
- [x] Un tiers ne voit, ne marque ni ne supprime les notifications d'autrui
      (404, jamais 403) ; aucun email dans les réponses
- [x] **La liste s'affiche encore quand la cible a été supprimée**
- [x] `/non-lues` et `/tout-lu` non confondus avec un identifiant · 400 · 404

Parcours navigateur `npm run test:notifications` côté client — **32/32**,
avec deux navigateurs simultanés.

- [x] **La pastille monte en direct depuis une autre page**, et s'incrémente
- [x] **Le type est traduit en phrase française** — « a aimé votre
      publication », et non « like »
- [x] Nom de l'émetteur, ancienneté, distinction visuelle des non lues
- [x] Marquer une notification lue fait redescendre la pastille
- [x] L'onglet « non lues » ne montre que ce qui reste
- [x] **Arriver sur la page n'a rien marqué lu tout seul**
- [x] « Tout marquer comme lu » vide la pastille, et le bouton disparaît
- [x] **La demande de conversation est annoncée comme telle**, et son lien
      mène directement à la bonne conversation
- [x] Supprimer retire la ligne, et elle ne revient pas au rechargement
- [x] Un tiers ne voit rien des notifications d'autrui
- [x] `/notifications` sans débordement en 375 et 768 px · console propre

### 12.7 Contrôle de non-régression

Les dix-neuf suites rejouées :

| Commande | Résultat |
|---|---|
| `npm run test:api` (serveur) | 73/73 |
| `npm run test:stripe` (serveur) | 50/50 |
| `npm run test:evenements` (serveur) | 76/76 |
| `npm run test:recherche` (serveur) | 54/54 |
| `npm run test:messagerie` (serveur) | 62/62 |
| `npm run test:notifications` (serveur) | 47/47 |
| `npm run test:perf` (serveur) | 18/18 |
| `npm run test:ui` (client) | 45/45 |
| `npm run test:relations` (client) | 21/21 |
| `npm run test:premium` (client) | 18/18 |
| `npm run test:paiement` (client) | 46/46 |
| `npm run test:carte` (client) | 50/50 |
| `npm run test:evenements` (client) | 38/38 |
| `npm run test:recherche` (client) | 36/36 |
| `npm run test:messagerie` (client) | 25/25 |
| `npm run test:parcours-10-11` (client) | 35/35 |
| `npm run test:notifications` (client) | 32/32 |
| `npm run test:perf` (client) | 15/15 |

**770/770** sur **dix-neuf** suites, performance comprise. `npm run lint` et `npm run build` passent.

> Le changement de point de rupture de la navigation touche **tous** les
> écrans : les neuf suites navigateur ont été rejouées pour cette seule
> raison. Une correction de mise en page qui ne concerne qu'une page ne se
> vérifie pas sur cette page.

---

## Module 13 — Finitions  `TERMINÉ` *(une vérification en attente d une machine vierge)*

> Les douze modules précédents ont produit une application qui fonctionne
> **sur cette machine**. Le module 13 traite de tout ce qui manque pour
> qu'elle fonctionne ailleurs, et pour qu'un tiers puisse la reprendre.

### 13.0 Le problème central — un projet qui ne tourne que chez son auteur

Rien de ce qui suit n'ajoute une fonctionnalité. Tout y répond à la même
question : **qu'est-ce qui casse quand quelqu'un d'autre ouvre ce dépôt ?**

- [x] **Aucun README.** Le projet demande Node 24, Docker, un replica set
      MongoDB, des clés Cloudinary, des clés Stripe et le CLI Stripe. Rien de
      tout cela ne se devine en lisant le code.
- [x] **Aucune façon de lancer « les tests ».** Il y en a quinze, réparties
      sur deux paquets, avec des prérequis différents — et deux d'entre elles
      échouent en cascade si un relais n'est pas actif.
- [x] **Des prérequis qui échouent sans le dire.** `stripe listen` absent →
      treize vérifications rouges qui accusent le code. Un compte admin
      manquant → deux autres. Le diagnostic doit précéder l'échec.

### 13.1 README
- [x] [`README.md`](../README.md) — ce que fait l'application, module par module
- [x] Prérequis exacts, avec versions (Node 24, Docker, MongoDB 8, Stripe CLI)
- [x] **Le replica set expliqué** : MongoDB refuse les transactions sur une
      instance autonome, et le projet en utilise partout. C'est le piège
      d'installation le plus fréquent — tout marche jusqu'à la première
      écriture transactionnelle, qui échoue sur un message parlant de
      « replica set » sans dire quoi faire.
- [x] Installation depuis un dépôt vierge, commande par commande
- [x] Variables d'environnement : à quoi sert chacune, **et ce qui se dégrade
      quand elle manque** — sans Cloudinary le stockage bascule en local,
      sans Stripe tout fonctionne sauf les abonnements
- [x] Pourquoi il n'existe aucune route de création d'administrateur
- [x] Les quatre pièges d'environnement rencontrés, réunis en un endroit
- [x] Structure des dossiers et quatre décisions techniques structurantes

### 13.2 Une commande pour tout tester
- [x] `npm test` à la racine — [`scripts/test-tout.mjs`](../scripts/test-tout.mjs)
- [x] **Vérification des prérequis AVANT de lancer quoi que ce soit** :
      `.env` présent, API vivante, MongoDB connecté, Vite joignable, **proxy
      Vite fonctionnel**, compte admin présent, rappel du relais Stripe
- [x] Chaque manque donne une **commande à copier**, pas une description :
      « lancez le serveur » oblige à chercher comment, `cd server && npm run
      dev` se colle dans un terminal
- [x] Les suites s'exécutent **une par une**, avec une pause entre elles
- [x] **Un seul réessai, et seulement sur une panne de TRANSPORT.** Une
      vérification qui échoue est un résultat : la rejouer masquerait ce que
      la suite mesure. Une panne réseau n'est pas un résultat — la suite n'a
      rien pu mesurer. Constaté en conditions réelles : une coupure de
      quelques secondes a fait tomber huit suites d'affilée sur
      `fetch failed / ECONNRESET`, sans qu'une ligne de code ait bougé.
- [x] Récapitulatif final, extrait des échecs, commande pour rejouer la suite
      fautive seule, code de sortie exploitable en CI
- [x] Les API d'abord, plus rapides : une régression de fond se signale en
      quelques secondes plutôt qu'après huit minutes de Playwright

### 13.3 Audit responsive
- [x] Tous les écrans en 375, 768 et 1440 px — couvert par les neuf suites
      navigateur, qui vérifient l'absence de débordement écran par écran
- [x] **La navigation à six entrées tient à chaque palier** : le basculement
      est passé de `md` à `lg` au module 12, la sixième entrée ne tenant plus
      à 768 px

### 13.4 Audit d'accessibilité et de console
- [x] Chaque `<img>` porte un `alt` ; chaque bouton-pictogramme, un libellé
      réservé aux lecteurs d'écran
- [x] **Distinction faite entre image de contenu et image décorative.** Le
      média d'une publication EST le contenu : `alt=""` le retirait
      entièrement de la lecture d'écran. L'affiche d'un événement, elle, garde
      un `alt` vide — son titre est annoncé juste après, dans le même lien.
- [x] Aucune information portée par la seule couleur : les pastilles doublent
      leur nombre d'un libellé, les états d'événement s'écrivent en toutes
      lettres
- [x] Console propre sur tous les écrans, vérifiée par chaque suite

#### La correction qui a cassé l'application — et que rien n'a vu venir

- [x] L'amélioration du texte alternatif de `PostCard` a été écrite dans le
      sous-composant `Carrousel({ medias })`, où **`post` n'existe pas**.
      Chaque publication levait une `ReferenceError` au rendu, et l'article
      n'apparaissait jamais.
- [x] **`npm run lint` ET `npm run build` sont passés dessus sans rien
      signaler.** ESLint ne relève pas une variable inconnue dans une
      configuration React moderne, et esbuild la traite comme un global
      potentiel. Le défaut n'existait qu'au premier rendu réel.
- [x] Cinq suites navigateur l'ont attrapé — c'est exactement ce à quoi elles
      servent. Le message disait `waiting for locator('article')` : il
      désignait la cause, et la première hypothèse (« la machine est
      chargée ») était fausse. La seconde campagne, lancée sans rien d'autre,
      a rendu **les mêmes échecs aux mêmes endroits** : c'est ce qui a
      tranché entre l'aléa et la régression.
- [x] Corrigé en passant `titre` en propriété

### 13.5 Déploiement
- [x] `server/.env.example` complété — **`MONGOOSE_DEBUG` et `RATE_LIMIT_DEV`
      manquaient**, découverts en comparant les `process.env` du code aux
      clés documentées
- [x] `client/.env.example` à jour ; seules les variables `VITE_` sortent au
      navigateur, et tout ce qui s'y trouve est public
- [x] Ce qui change en production, déjà en place : `secure` et
      `sameSite: 'none'` sur les cookies hors développement, origines CORS
      lues dans `CLIENT_URL`, limiteurs de débit neutralisés en local
- [x] **Build client vérifié, poids des fragments contrôlé** : principal
      360 ko (103 ko gzip), Leaflet confiné au fragment cartographique —
      `grep -c leaflet dist/assets/index-*.js` rend bien `0`. Socket.io est
      dans le principal, et c'est voulu : il se connecte sur toutes les pages
      pour les pastilles de messages et de notifications.
- [x] **Procédure de déploiement écrite** — tableau de ce que `NODE_ENV`
      bascule (cookies, limiteurs, CORS, stockage), sonde de santé à donner à
      l'hébergeur, renvoi de `index.html` sur les routes inconnues (sans quoi
      un rafraîchissement sur `/evenements/abc` rend un 404), et déclaration
      des webhooks Stripe — `capability.updated` compris, dont l'absence a
      déjà bloqué un coach en « en attente »

### 13.6 Revue de sécurité
- [x] **Aucun `.env` n'a jamais été commité** — vérifié sur tout l'historique
      git, pas seulement sur l'état courant
- [x] Aucune clé Stripe, secret de webhook ou URI Mongo dans les fichiers
      suivis
- [x] `helmet`, `express-mongo-sanitize`, limiteur global et limiteurs
      spécifiques en place
- [x] **Les quatre niveaux de visibilité revérifiés** : ni
      `versionPublique()` ni `versionCarte()` ne laissent passer email, mot
      de passe, données Stripe ou version de session. Cinq suites vérifient
      explicitement l'absence d'adresse email dans les réponses.
- [x] **Les verrous premium revérifiés** : les cinq contrôleurs qui servent du
      contenu (publications, commentaires, stories, événements, messages)
      passent tous par `versionPour()` et `aAccesPremium()`, jamais par une
      règle réécrite localement

### 13.7 Vérification finale
- [x] **Les dix-neuf suites au vert en une seule commande : 770/770**

| Commande | Résultat |
|---|---|
| `npm run test:api` (serveur) | 73/73 |
| `npm run test:stripe` (serveur) | 50/50 |
| `npm run test:evenements` (serveur) | 76/76 |
| `npm run test:recherche` (serveur) | 54/54 |
| `npm run test:messagerie` (serveur) | 62/62 |
| `npm run test:notifications` (serveur) | 47/47 |
| `npm run test:ui` (client) | 45/45 |
| `npm run test:premium` (client) | 18/18 |
| `npm run test:paiement` (client) | 46/46 |
| `npm run test:carte` (client) | 50/50 |
| `npm run test:evenements` (client) | 38/38 |
| `npm run test:recherche` (client) | 36/36 |
| `npm run test:messagerie` (client) | 25/25 |
| `npm run test:parcours-10-11` (client) | 35/35 |
| `npm run test:notifications` (client) | 32/32 |

- [x] `npm run lint` et `npm run build` sans erreur
- [~] **Le README reste à éprouver sur une machine vierge.** Les commandes
      citées ont été vérifiées une à une contre les scripts réellement
      déclarés, et les variables documentées contre les `process.env` du
      code. Mais l'installation complète — dépôt cloné, `node_modules`
      absents, base vide — n'a pas été rejouée : elle demande une machine où
      rien n'est déjà en place. C'est la seule vérification du projet qui
      repose sur une relecture plutôt que sur une exécution.

> **Trois campagnes ont été nécessaires, et les deux premières ont appris
> quelque chose.** La première est tombée sur une coupure réseau — d'où le
> réessai sur panne de transport. La deuxième a révélé la régression de
> `PostCard`, que le lint et la compilation avaient laissée passer. Une suite
> qui échoue mérite qu'on lise son message avant de blâmer la machine :
> ici, il désignait la cause dès le premier essai.
