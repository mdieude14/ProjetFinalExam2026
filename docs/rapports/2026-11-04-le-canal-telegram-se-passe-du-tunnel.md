# 4 novembre 2026 (2) — Le canal Telegram se passe du tunnel : il va chercher au lieu d'attendre

> Rapport rendu tel quel. Le journal technique correspondant est en `docs/SUIVI.md`,
> section 15.74.

## La décision demandée : entre la piste 1 et la piste 2

Deux critères avaient été posés : pour la piste 1, que les données en transit soient sûres et
invisibles de l'extérieur ; pour la piste 2, que le comportement soit identique à celui du tunnel
ouvert.

**La piste 2 n'existe pas, et aucun geste ne peut la faire exister.** Mesuré : `polling` apparaît
**zéro fois** dans `TelegramTrigger.node.js`. Ce n'est pas un réglage manquant, c'est une capacité
absente du code. *Un critère ne peut pas départager une option qui n'est pas constructible.*

**La piste 1 est la bonne, et elle sert le critère de la piste 2 par-dessus le marché** : le corps
du flux ne change pas d'un octet, donc le comportement est identique ; et il n'y a plus **aucune
adresse entrante**, donc rien à exposer — strictement mieux qu'avant, pas seulement équivalent.

## Ce que j'avais dit de faux, et qui changeait le geste à faire

J'avais annoncé : « déposer le jeton dans un justificatif Query Auth ou Header Auth ».
**C'était faux.**

Telegram ne lit le jeton que dans le **chemin** de l'URL (`/bot<jeton>/getUpdates`) : ni en-tête,
ni paramètre de requête. Aucun type de justificatif n8n ne peut l'écrire là, et un justificatif
n'est pas lisible depuis une expression. *En suivant ma consigne, un justificatif inutile aurait
été créé.*

Et aucun nœud ne peut appeler `getUpdates` avec le justificatif existant : la seule occurrence du
mot dans `Telegram.node.js` est **une ligne commentée**.

## Le geste réel, étape par étape

1. Ouvrir Telegram, conversation **@BotFather**.
2. Envoyer `/mybots`, choisir le bot de CoachConnect.
3. **API Token** → copier la valeur. *C'est la même que celle du justificatif « Bot Telegram —
   CoachConnect » dans n8n.*
4. Ouvrir `server/.env`. La ligne est déjà là, vide, à la fin du fichier :

   ```
   TELEGRAM_BOT_TOKEN=
   ```

   Coller le jeton juste après le `=`, sans espace, sans guillemets.
5. Redémarrer le back-end. Il doit afficher :

   ```
   [TELEGRAM] Scrutage actif — les réponses arrivent sans tunnel ni adresse publique.
   ```

6. Vérifier :

   ```
   node docker/n8n/etat-telegram.mjs
   ```

   Attendu : `ENTRANT (tu peux y répondre) : OUI`.

**Rien d'autre n'est à faire.** Le flux n8n est déjà en place et actif, le webhook local est déjà
protégé, et le tunnel n'a plus aucun rôle.

> **Et les réponses déjà envoyées pourraient remonter d'un coup.** Telegram garde les messages non
> livrés pendant 24 heures, et le scrutateur ne jette pas cette file au démarrage. *À tester,
> ce n'est pas une promesse : elle a peut-être expiré.*

## Tâches réalisées et testées

### 1. Pourquoi c'est le back-end qui scrute, et non n8n

Trois façons d'amener le jeton jusqu'à un appel HTTP, toutes mesurées dans l'image :

| Voie | Mesure | Coût |
|---|---|---|
| justificatif n8n | le jeton va dans le chemin de l'URL, inatteignable | **impossible** |
| `$env` dans une expression | `N8N_BLOCK_ENV_ACCESS_IN_NODE=true`, posé par nous | ouvrirait **`N8N_ENCRYPTION_KEY`** à toute expression |
| **le back-end scrute** | le jeton vit dans `server/.env`, déjà ignoré par git | **aucun** |

Le coût de la deuxième voie est mesuré, pas supposé : l'environnement du conteneur porte bien
`N8N_ENCRYPTION_KEY` — la clé qui déchiffre **tous** les justificatifs, Anthropic, SMTP, Gmail et
le bot compris. *Et ce serait le pire moment pour élargir les pouvoirs des expressions : la
version installée est affectée par une injection d'expression.*

**C'était la « piste 3 », que j'avais refusée** — pour une seule raison : elle demandait d'extraire
le jeton des justificatifs chiffrés. Le jeton étant déposé à la main, cette raison disparaît.
*Un refus se réexamine quand sa cause tombe.*

### 2. Le scrutateur, et les cinq propriétés qui cassent en silence

`server/src/services/telegram-scrutage.service.js`

- **le jeton n'atteint jamais un journal.** Il voyage dans l'URL, et `fetch` cite l'URL dans ses
  erreurs : chaque message d'erreur est une fuite potentielle. Un test force **tous** les chemins
  d'erreur et vérifie qu'aucun ne le laisse passer.
- **`deleteWebhook` d'abord, sans jeter la file.** Telegram refuse `getUpdates` (409) tant qu'un
  webhook est posé — mais les réponses non livrées dorment dans cette file, et ce sont celles
  qu'on vient chercher.
- **l'avance ne se confirme qu'après une remise réussie.** Telegram ne rend une mise à jour
  qu'une fois : confirmer avant de l'avoir remise l'efface du système entier, sans trace.
- **une mise à jour sans message se confirme quand même**, sinon elle bloque la file indéfiniment.
- **la frontière de la livraison est « n8n a accepté »**, pas « le workflow a fini » — le même
  contrat qu'avait le webhook de Telegram.

**Sans jeton, rien ne part**, et c'est le défaut : zéro appel, une ligne d'explication, et le reste
du support inchangé.

### 3. Le flux n8n : un nœud remplacé, un nœud ajouté, rien d'autre

- `Message reçu` devient un **`Webhook` local** (`typeVersion 2.1`, mesurée dans l'image), avec
  `authentication: headerAuth` et le justificatif « Clé de service » — celui que les deux côtés
  connaissent déjà. **Aucun secret de plus à déposer.**
- `Déballer la mise à jour` rend la forme exacte qu'émettait le déclencheur. *Retoucher « Préparer
  la question » aurait touché les quatre voies, leurs quotas et leurs garde-fous.*

Le chemin est versionné, donc public : ce qui protège est l'en-tête — et ce n'est pas théorique,
le port 5678 est joignable depuis le réseau local.

### 4. La preuve, de bout en bout

- **Le flux s'active avec `WEBHOOK_URL=http://localhost:5678/`.** L'erreur « An HTTPS URL must be
  provided for webhook » **ne peut plus se produire**.
- **Le chemin local répond 403 sans clé**, 200 avec.
- **La réponse d'escalade a été rejouée telle quelle** et a produit le brouillon attendu :

  ```
  origine : telegram   par agent : false   statut : escalade
  566 signes
  ```

  Fidèle à la consigne dictée, et le dossier `b5577414` l'attendait depuis le 2 novembre. Il est
  dans le back-office, avec son repère ambre « rédigé depuis Telegram », prêt à être relu, modifié
  ou validé. **Rien ne partira sans ce clic.**

### 5. La version de n8n : le verdict demandé

La question n'était pas la bonne, et c'est la recherche qui l'a montré.

| Avis | Portée | 1.121.0 |
|---|---|---|
| **CVE-2026-21858** CVSS **10.0**, **sans authentification** | `>= 1.65.0, < 1.121.0` | **non affecté — 1.121.0 EST le correctif** |
| **CVE-2025-68613** injection d'expression, CVSS **9.9**, **authentifié** | `>= 1.121.0, < 1.121.1` | **affecté** |
| **CVE-2026-21877** écriture de fichier, **authentifié** | `>= 0.123.0, < 1.121.3` | **affecté** |

**Ce n'est pas la visibilité du numéro qui comptait, c'est la version.** Afficher le numéro ne
donne aucun accès ; porter deux avis dont un à 9,9 en donne.

Les deux qui nous touchent **exigent un compte**, et il n'y a pas de chemin anonyme : `/rest/login`
répond 401 et le compte propriétaire existe déjà. *Et depuis aujourd'hui, l'instance n'est plus
joignable du tout — la parade la plus efficace n'était pas une mise à jour, c'était de n'avoir plus
rien à exposer.*

**Reste à faire, sans urgence** : sortir des deux plages. Le plus petit pas est une version
**1.12x ≥ 1.121.3**. *À ne pas confondre avec la dernière stable, **2.46.6** : passer en 2.x est une
migration majeure, pas un correctif, et ce n'est pas un geste à faire à quelques jours d'une
soutenance.*

### 6. Le piège qui m'a mordu deux fois dans la même heure

La réponse d'escalade a d'abord échoué, et pas là où je l'attendais : tous les nœuds ont tourné,
l'API a répondu 200, et la rédaction portait **`unable to verify the first certificate`**.

**La cause est de mon fait.** J'avais recréé le conteneur avec
`docker compose -f docker/n8n/docker-compose.yml up -d --force-recreate n8n`. **Passer `-f`
supprime le chargement automatique de `docker-compose.override.yml`** — celui qui monte le
certificat d'Avast. Le conteneur démarre, répond `healthz 200`, sert son éditeur, **et aucun de ses
appels sortants n'aboutit.**

**La bonne commande était déjà écrite dans le journal.** J'ai employé une forme plus courte, de
mémoire. *Deuxième fois : chercher dans les notes du projet avant d'écrire une commande
d'exploitation n'est pas une politesse, c'est la méthode.*

Deux corrections « évidentes » ont été mesurées et écartées : ni `cd docker/n8n && docker compose
up -d`, ni base + override ne fonctionnent — l'override déclare aussi `cloudflared`, dont l'image
n'est que dans le troisième fichier. Et **ma première sonde TLS ne mesurait rien** : le `wget` de
busybox ne lit pas `NODE_EXTRA_CA_CERTS` — *erreur déjà commise le 27 octobre et déjà consignée.
Je l'ai refaite sans relire la note.*

**`docker/n8n/recreer-n8n.mjs`** remplace le rappel par une mesure : il énumère les trois fichiers
dans le bon ordre, attend `healthz`, **puis sonde la sortie TLS avec Node** et refuse de conclure
si elle est rompue. *Un conteneur debout qui ne peut rien appeler est le pire des états : il a
l'air sain.*

### 7. Ce qui a été désamorcé plutôt que supprimé

- **`etat-telegram.mjs` a été refait.** Il prescrivait **d'ouvrir un tunnel** : il aurait fait
  rouvrir la porte dont tout ce travail consiste à se passer. *Un diagnostic périmé est pire que
  pas de diagnostic.* Il éprouve désormais le chemin local sans clé, et distingue d'un seul appel
  **403** protégé, **404** workflow inactif, **200** porte ouverte.
- **Le prérequis de campagne a changé de cible** : il guette maintenant le 404, car
  `n8n import:workflow` remet **toujours** le workflow à l'arrêt.
- **`ouvrir-tunnel.mjs` et `garder-tunnel.mjs` portent un avertissement en tête.** *Garder un
  script qui ouvre un trou sans dire qu'il est devenu inutile serait exactement le piège qu'on
  vient de retirer du diagnostic.*

### 8. Les tests

| Suite | Résultat |
|---|---|
| **`test:scrutage`** (nouvelle) | **49/49** |
| `test:canaux` | **281/281** |
| `test:perf` / `Navigateur — performance` | **18/18** et **15/15** |
| **Campagne complète** | **2106/2106** |

La nouvelle suite exerce **la vraie boucle**, pas une imitation : seules l'API de Telegram et
celle de n8n sont remplacées. Aucun jeton, aucun réseau.

**Et il faut dire comment ce 2106 a été obtenu, parce qu'il ne vient pas d'un seul tenant.** La
campagne a rendu **2028/2028 avec trois suites navigateur rouges**, toutes trois à `0/0` et
`INTERROMPU : fetch failed`. Elles sont **consécutives**, et elles tombent exactement dans la
fenêtre où j'ai modifié `server.js` : nodemon a redémarré le back-end sous elles.

*C'est une étourderie de ma part, pas une régression — et la règle de la campagne le disait déjà :
un total qui BAISSE sans suite rouge signale une suite coupée. Ici elles étaient rouges, et à
`0/0`, ce qui ne laisse aucun doute sur le moment de la coupure : avant la première vérification.*

Relancées seules, back-end stable : **31/31**, **19/19**, **28/28** — soit 78 vérifications, et
2028 + 78 = **2106**. *On ne modifie pas le serveur pendant qu'une campagne l'interroge.*

**Et deux défauts de mes propres tests, trouvés en les éprouvant :**


- `jeton: undefined` **déclenchait la valeur par défaut du paramètre** : le test censé éprouver
  l'absence du jeton recevait le vrai. Les deux clés se lisent désormais par présence.
- Le test de boucle d'événements exigeait un débit précis (dix tics). **Il mesurait la machine.**
  Le seuil distingue maintenant zéro de plusieurs, ce qui est la seule propriété en jeu — *la
  leçon de l'animation échantillonnée.*

## Tâche en cours

Aucune.

## Tâches à venir

### 1. Le jeton — une ligne, et le canal fonctionne en permanence

Voir « Le geste réel, étape par étape » plus haut. C'est le seul point qui me soit impossible.

### 2. Le pare-feu — ce soir, depuis la maison

Mesuré aujourd'hui : le poste est sur **`PEDA`**, catégorie **Public**, `10.172.10.18`.

```
powershell -ExecutionPolicy Bypass -File scripts\pare-feu-fermer-le-dev.ps1
```

**Les deux sens** : le téléphone doit échouer **et** la chaîne locale rester intacte —

```
node server/scripts/bout-en-bout-agent.mjs
```

attendu : **25/25**. *Le chemin exact, `server/scripts/…` : les deux rapports précédents
écrivaient `scripts/…`, qui n'existe pas.* Ce script appelle le webhook de l'agent du widget
(`localhost:5678/webhook/coachconnect-support`) ; il ne dépend pas du canal Telegram, et le
changement d'aujourd'hui ne le touche pas.

### 3. La version de n8n — un pas de patch, après la soutenance

Vers une **1.12x ≥ 1.121.3**. Pas 2.x.

### 4. Points reportés

Ankama 12 Go, et l'application Google en Public au déploiement.
