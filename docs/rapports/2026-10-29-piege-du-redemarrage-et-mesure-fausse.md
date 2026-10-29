# 29 octobre 2026 (soir) — Le piège du redémarrage s'est réalisé, et une mesure de sécurité était fausse

> Rapport rendu tel quel. Le journal technique correspondant est en `docs/SUIVI.md`,
> section 15.69.

## Tâches réalisées et testées

### 1. Le projet relancé, et le piège du redémarrage pris en flagrant délit

Il était consigné depuis onze jours, en avertissement. Au redémarrage du poste, il s'est
produit **exactement** comme écrit :

```
docker/n8n/.env     -> WEBHOOK_URL=https://<adresse du tunnel de la veille>/
coachconnect-tunnel -> Exited (255)      le conteneur n'est PAS revenu
ccAgentTelegr01     -> ACTIF             il declare donc une adresse MORTE
```

n8n a démarré, lu l'adresse morte, et l'a déclarée à Telegram pour un workflow actif. **Le bot
était injoignable en silence** — aucune erreur dans le journal de n8n, aucune dans Telegram,
rien à l'écran.

Nettoyé par la procédure prévue (`--fermer`) : n8n **200**, adresse locale, zéro conteneur de
tunnel, certificat préservé.

> **Ce que cette occurrence ajoute à l'avertissement** : il ne suffit pas de « ne pas ouvrir le
> tunnel juste avant un redémarrage ». Il faut **nettoyer après tout redémarrage**, parce que
> l'état fautif ne se signale pas. La seule façon de le voir est de le chercher.

Séquence de relance, **certificat d'abord** : Docker Desktop, attente du moteur, les deux
conteneurs, certificat Avast vérifié, Mongo primaire, back-end, front-end, relais Stripe (clé de
test confirmée avant lancement).

### 2. Le plafond mémoire pour WSL, posé au bon moment

Posé **pendant que Docker était arrêté**, donc sans interrompre quoi que ce soit : WSL n'était
pas démarré, le fichier a pris effet au lancement suivant. *C'est la seule fenêtre où ce
changement est gratuit.*

```ini
[wsl2]
memory=2GB
```

| Mesure | Avant | Après |
|---|---|---|
| `vmmemWSL` | **760 Mo** | **267 Mo** |
| plafond vu par les conteneurs | ~3,9 Go (50 % de la RAM) | **1,926 GiB** |
| les deux conteneurs ensemble | — | 437 + 133 = **570 Mo** |

**Environ 490 Mo rendus**, et plus du triple de marge conservé. Le 2 Go n'est pas un chiffre
rond : il vient de la mesure des deux conteneurs réunis. Pour revenir en arrière : supprimer le
fichier puis `wsl --shutdown`.

### 3. Une mesure de sécurité qui ne prouvait pas ce qu'elle affirmait

C'est la correction la plus importante, et elle porte sur **mon propre travail de la veille**.

Le journal affirmait avoir mesuré l'exposition de l'API « depuis un espace réseau distinct — un
conteneur Docker, **qui traverse réellement le filtre de l'hôte** ». En revérifiant :

```
Get-NetFirewallHyperVVMSetting :
  Enabled              : True
  DefaultInboundAction : Block
  LoopbackEnabled      : True        <-- la reponse
```

Le pare-feu Hyper-V traite le trafic d'un conteneur vers l'hôte comme du **loopback**. Il ne
traverse donc **pas** le filtre de profil. Les trois lignes de mesure ne disaient rien de plus
que les sockets d'écoute.

> **La leçon : une mesure vaut ce que vaut le chemin qu'elle emprunte.** Croire qu'un conteneur
> est « un autre appareil » a produit une conclusion de sécurité **fausse, et rassurante dans le
> mauvais sens** — elle donnait l'impression d'avoir déjà tout compris, et elle a été publiée
> comme telle dans le journal et dans un rapport archivé.

Les deux documents sont **rectifiés sur place**, avec un encadré qui dit ce que la mesure ne
prouvait pas. *Un rapport archivé ne se réécrit pas en silence : la rectification est visible à
côté de l'affirmation d'origine.*

#### Ce qui reste établi, et ce qui ne l'est pas

| | État |
|---|---|
| 5000 et 5678 écoutent sur `::` — **toutes** les interfaces | **établi** (sockets) |
| 5173 écoute sur `::1` — localhost seul, **sain par construction** | **établi** |
| une règle entrante autorise `node.exe`, **tous ports**, profil **Private** | **établi** |
| le back-end tourne sur ce binaire exactement | **établi** (PID vérifié) |
| **un appareil tiers y arrive-t-il vraiment ?** | **NON ÉTABLI** |

### 4. Le réseau a changé, et mon script codait un plan d'adressage en dur

```
reseau  : PEDA                   categorie : Public
Wi-Fi   : 10.172.10.18 / 24
```

La première version de `pare-feu-fermer-le-dev.ps1` ciblait `192.168.1.0/24` — le réseau
domestique. Elle aurait été **sans effet ici**. *Un plan d'adressage codé en dur protège un seul
lieu, et ne le dit pas.*

**Réécrit** : blocage entrant sur 5000, 5173, 5678, **tous profils, sans restriction
d'adresse**. Le loopback n'est pas filtré par le pare-feu Windows, et le trafic WSL est exempté
— donc le travail local, les suites et les flux n8n passent toujours. **Cette seconde raison est
une déduction, pas une mesure**, et le script le dit : la vérification finale exige les deux
sens.

Les guillemets français avaient glissé dedans — 8 caractères non-ASCII, attrapés par le contrôle
d'encodage du fichier lui-même. *La règle inscrite dans l'en-tête a servi à attraper sa propre
violation.*

### 5. Une animation prouvée par sa déclaration, et non par un échantillon

Première campagne : **2047/2048**, une chute.

```
✗ Navigateur — bascule du compositeur   18/19
    ECHEC le dépliement est animé, pas instantané
    -> 408 px à mi-course, 408 px à l'arrivée
```

Relancée seule : **19/19**. La vérification échantillonnait la hauteur 80 ms après le clic et
exigeait une valeur intermédiaire. Sur une machine saturée, **l'animation de 300 ms était déjà
terminée**.

Même famille que la mesure « pendant le chargement » de `relations.mjs` : un état transitoire lu
à délai fixe. **La différence est qu'ici on peut s'en passer** — le dépliement est animé parce
qu'une transition CSS le déclare (`grid transition-all duration-300`), et cela se lit sans
course :

```
OK  **le dépliement est animé, pas instantané** — une transition CSS le déclare
    -> all sur 0.3s
```

> **La règle qui s'en dégage** : quand un état transitoire **est le sujet**, on le mesure à
> délai fixe et on le déclare (`mesure-instantanee`). Quand il n'est qu'un **moyen** de prouver
> autre chose, on cherche la preuve qui ne court pas.

### 6. La campagne après correction : 2048/2048

```
Total : 2048/2048 vérifications
Tout est au vert.
37 suites — mémoire libre au lancement : 0,68 Go
```

**Et la preuve est dans les conditions** : la campagne précédente était partie à 0,43 Go et
l'assertion d'échantillon est tombée ; celle-ci est partie à 0,68 Go — toujours bien sous le
seuil — et l'assertion déterministe a tenu. *Une correction qui ne passe qu'en conditions
favorables ne prouve rien.*

Aucune régression de performance : **18/18** et **15/15**.

### 7. Une date fausse, corrigée partout

Plusieurs traces portaient « 30 octobre 2026 » alors que l'horloge du poste et l'environnement
s'accordent sur le **29**. Corrigé dans le journal, les deux rapports archivés concernés, le
script du pare-feu, un commentaire de test et l'en-tête du `.wslconfig` ; **le fichier de rapport
a été renommé** et l'index mis à jour. Balayage final : zéro occurrence restante.

> *Dans un journal, une date fausse ne se contente pas d'être inexacte : elle rend la trace
> introuvable le jour où on la cherche.*

## Tâche en cours

Aucune.

## Tâches à venir

### Ce qui demande le compte Telegram du porteur du projet

Le tunnel est **fermé** (nettoyage du piège du redémarrage). Pour éprouver la chaîne corrigée :

```bash
node docker/n8n/ouvrir-tunnel.mjs
cd server && node scripts/preparer-epreuve-telegram.mjs   # un dossier auquel répondre
```

Trois comportements, puis deux refus :

1. amorce citée sur l'alerte → **un brouillon rédigé par le modèle**, adapté à la demande
   initiale ;
2. le même brouillon sur `/admin/moderation`, avec le **marqueur ambre** Telegram ;
3. `ENVOYER` → courriel depuis `support.coachconnect.app@gmail.com`.

Puis : répondre à un message **sans** `Réf.`, et **recopier** la référence à la main. Les deux
doivent rendre une explication, pas une réponse de robot d'accueil.

⚠️ **Refermer après usage** : `node docker/n8n/ouvrir-tunnel.mjs --fermer`

### Ce qui demande une élévation

```
powershell -ExecutionPolicy Bypass -File scripts\pare-feu-fermer-le-dev.ps1
```

Puis **les deux sens** : le téléphone doit échouer **et** `node scripts/bout-en-bout-agent.mjs`
rendre 25/25. **C'est la seule mesure qui tranchera** la question laissée ouverte au point 3.

### Points reportés

Ankama 12 Go, et l'application Google en Public au déploiement.
