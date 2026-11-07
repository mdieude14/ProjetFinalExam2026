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

## 1. MongoDB Atlas

### Pourquoi Atlas et pas un Mongo sur le VPS

**Les 20 transactions exigent un jeu de répliques.** Un `mongod` seul, installé en deux
minutes sur le VPS, les refuse toutes avec
`Transaction numbers are only allowed on a replica set member or mongos` — et sept modules
tombent : commentaires, publications, stories, événements, abonnements, messagerie,
modération. **Atlas est un jeu de répliques même sur son offre gratuite M0.** Monter un jeu
de répliques à la main sur un VPS, c'est trois nœuds à surveiller pour le même résultat.

### Les gestes

1. **Créer un cluster M0** (gratuit), région la plus proche — `eu-west` pour la France.
2. **Créer un utilisateur de base** avec un mot de passe long et aléatoire.
   *Ni le nom ni le mot de passe ne doivent apparaître ailleurs que dans la variable
   d'environnement de l'hébergeur de l'API.*
3. **Autoriser le réseau.** Deux voies :

   | Voie | Quand | Réserve |
   |---|---|---|
   | Les IP de sortie de l'hébergeur | elles sont fixes et documentées | la plus étroite, à préférer |
   | `0.0.0.0/0` | l'hébergeur n'annonce pas d'IP fixe | **l'accès ne tient alors QUE sur le mot de passe** |

   > Si `0.0.0.0/0` est retenu, le mot de passe de base devient la seule barrière : il doit
   > être long, unique, et ne jamais servir ailleurs.

4. **Récupérer la chaîne de connexion** au format `mongodb+srv://…`. Le schéma `+srv` active
   le TLS tout seul : **aucune option de certificat à écrire** dans `db.js`.
5. **La poser dans `MONGO_URI`** sur l'hébergeur de l'API. *Pas dans un fichier du dépôt.*

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
   rafraîchir la page rend un 404, alors que la navigation interne fonctionne. Les règles de
   réécriture de Vercel ne s'appliquent qu'après le système de fichiers : les fichiers de
   `assets/` sont donc servis normalement, ils ne sont pas masqués par la règle fourre-tout.
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
