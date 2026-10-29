# 29 octobre 2026 — 2048/2048, et une prudence de la veille qui était de trop

> Rapport rendu tel quel. Le journal technique correspondant est en `docs/SUIVI.md`,
> section 15.68.

## Tâches réalisées et testées

### 1. La reprise, après un arrêt de Docker Desktop

Le travail de la veille s'était interrompu **entre l'indexation et le commit** : douze fichiers
prêts, rien de poussé. Rien n'était perdu — l'index de git avait tout gardé.

Séquence de relance, dans l'ordre, et **le certificat d'abord** : Docker Desktop, attente du
moteur, les deux conteneurs, vérification du certificat Avast *avant toute autre chose*, Mongo
primaire (`myState: 1`), back-end, front-end, puis le relais Stripe.

Le relais **refuse de démarrer sur une clé `sk_live_`**, vérifié dans la commande même : un
relais branché sur une clé de production débiterait une vraie carte.

**Trois commits poussés** (`e722eee..8493350`), auteur `mdieude14`, zéro ligne d'attribution :
le repli de l'agent Telegram, l'origine du brouillon, et le journal.

### 2. La campagne complète : 2048/2048

```
Total : 2048/2048 vérifications
Tout est au vert.
37 suites — mémoire libre au lancement : 0,80 Go
```

**2048 = 2035 + les treize vérifications ajoutées la veille.** Le compte tombe juste, ce qui
vaut une confirmation en soi : aucune suite n'a été coupée en route.

| Suite modifiée | Avant | Après |
|---|---|---|
| Workflows — Telegram et courriel | 267 | **274/274** |
| API — réponse à une demande | 49 | **52/52** |
| Navigateur — back-office du support | 137 | **140/140** |

**Aucune régression de performance** : `API — performance` **18/18**, `Navigateur —
performance` **15/15**. Les seuils n'ont pas été touchés.

### 3. Une prudence de la veille qui était de trop

Hier, à 0,71 Go, j'ai **refusé** de lancer la campagne. Aujourd'hui, partie à 0,59 Go mesurés
quelques minutes plus tôt, elle est passée — la mémoire était remontée à 0,80 Go au moment du
lancement, les services s'étant stabilisés.

> **La leçon, et elle corrige la mienne : mesurer vaut mieux que prédire.** Le seuil de 2 Go est
> un *avertissement*, pas un verdict. Refuser sur un relevé pris avant que les services se
> posent, c'est confondre une photo avec une tendance. La règle « ne jamais relever un seuil
> pour obtenir du vert » reste entière ; elle ne dit pas « ne jamais mesurer ».

Ce qui a changé côté machine : **Chrome a été fermé** et ne figure plus parmi les sept premiers
consommateurs. Restent `svchost` (918 Mo sur 97 processus) et la machine WSL de Docker (760 Mo),
incompressibles sans toucher à la configuration du poste.

### 4. La chaîne Telegram, prête à l'épreuve réelle

Le correctif est bien dans n8n **après redémarrage**, vérifié dans le flux stocké en base et non
seulement dans le fichier source.

Tunnel rouvert : `healthz` **200**, `/rest/credentials` et `/rest/workflows` **401**, certificat
préservé, **six flux sur six actifs**.

**Dossier frais préparé** : référence **`43440b45`**, « Double prélèvement premium », en
`escalade`, alerte Telegram **partie**. Les deux dossiers d'épreuve précédents étaient clos,
donc plus répondables — la relève ne renvoie jamais une alerte déjà partie.

## Tâche en cours

Aucune.

## Tâches à venir

### Ce qui demande le compte Telegram du porteur du projet

Trois comportements à éprouver, dans cet ordre, sur le dossier `43440b45` :

1. répondre à l'alerte avec une amorce → **un brouillon rédigé par le modèle**, adapté à la
   demande initiale, et non une réponse adressée à l'exploitant ;
2. le même brouillon visible sur `/admin/moderation`, avec le **marqueur ambre** « rédigé depuis
   une amorce envoyée sur Telegram » ;
3. `ENVOYER` → le courriel part depuis `support.coachconnect.app@gmail.com`.

Et **deux cas de refus**, neufs, à éprouver aussi : répondre à un message sans `Réf.`, et
recopier la référence à la main. Les deux doivent rendre une explication, pas une réponse de
robot d'accueil.

⚠️ **Refermer après usage** : `node docker/n8n/ouvrir-tunnel.mjs --fermer`

### Ce qui demande une élévation

**Poser la règle du pare-feu** : `powershell -ExecutionPolicy Bypass -File
scripts\pare-feu-fermer-le-dev.ps1`, puis vérifier **les deux sens** — le téléphone doit échouer
ET `node scripts/bout-en-bout-agent.mjs` rendre 25/25.

### Ce qui demande une décision

- **Un plafond mémoire pour WSL** dans `%USERPROFILE%\.wslconfig` (`memory=2GB`) rendrait 0,3 à
  0,5 Go de façon permanente. Demande `wsl --shutdown`, donc l'arrêt de Docker, et **modifie la
  configuration du poste hors du projet** : c'est une décision, pas une initiative.
- **Points reportés** — Ankama 12 Go, application Google en Public au déploiement.
