# 4 novembre 2026 — « Que le tunnel s'ouvre quand je réponds » : la moitié est impossible

> Rapport rendu tel quel. Le journal technique correspondant est en `docs/SUIVI.md`,
> section 15.73.

## La demande, et pourquoi sa première moitié ne peut pas exister

> « Je veux que quand je réponds à un message d'escalade, le tunnel Telegram s'active
> automatiquement pour que le workflow s'exécute de bout en bout, puis ferme le tunnel une fois
> l'exécution terminée. »

**Pour savoir que quelqu'un a répondu sur Telegram, il faut que Telegram ait pu livrer le
message. Or Telegram ne peut livrer que si l'adresse est déjà joignable.**

> Ce n'est pas un manque d'effort, c'est l'œuf et la poule : **aucune automatisation ne peut
> réagir à un événement qu'elle ne peut pas recevoir.**

## Tâches réalisées et testées

### 1. Trois contournements cherchés, et mesurés

| Piste | Mesure | Verdict |
|---|---|---|
| que **n8n scrute** Telegram (`getUpdates`), ce qui ne demande aucun tunnel | `TelegramApi.credentials.js` n'a **aucun bloc `authenticate`**, seulement un `test` | un `httpRequest` empruntant ce justificatif **partirait sans jeton** |
| que **le déclencheur scrute** de lui-même | `TelegramTrigger.node.js` : aucun `polling`, `webhooks: 1` | **webhook, et rien d'autre** |
| que **notre back-end scrute** | le jeton n'est dans **aucun** `.env` du projet | il faudrait l'extraire des justificatifs chiffrés — **refusé** |

**La première piste était la bonne**, et elle supprimerait le tunnel **entièrement** : un appel
sortant passe derrière n'importe quelle box. Elle bute sur un seul point, vérifiable dans
l'image : n8n n'expose le jeton Telegram qu'au nœud `telegram`, jamais à un `httpRequest`
générique.

**Elle redevient possible avec un geste du porteur du projet, et d'un seul** : déposer le jeton
dans un justificatif que `httpRequest` sait lire (« Query Auth » ou « Header Auth »), depuis
l'éditeur n8n. **Son secret, son geste.** Bénéfice : plus de tunnel du tout, donc plus aucune
exposition, et le canal entrant fonctionne en permanence. *C'est la vraie réponse au besoin, et
elle attend une décision.*

### 2. `garder-tunnel.mjs` — la seconde moitié, elle, est faite

```bash
node docker/n8n/garder-tunnel.mjs            # 20 min par défaut
node docker/n8n/garder-tunnel.mjs --minutes=45
```

Il ouvre le tunnel une fois, puis **le referme de lui-même** dès que l'activité s'arrête. *On ne
pense donc au tunnel qu'une seule fois, au début.*

**Cinq décisions qui comptent :**

- **il ne duplique pas la logique d'ouverture** : il appelle `ouvrir-tunnel.mjs`, où l'ordre des
  trois étapes est écrit. *Dupliquer, c'est s'exposer à ce que les deux divergent.*
- **il compte les exécutions avant d'ouvrir.** Sans ce point de départ, une exécution de la
  veille passerait pour de l'activité et le tunnel resterait ouvert sans que personne ne réponde.
- **il lit la base, pas le journal.** n8n ne trace pas une exécution réussie, et
  `docker logs --since` s'est déjà révélé trompeur après une recréation de conteneur.
- **les horodatages de n8n sont lus comme de l'UTC**, parce qu'ils en sont. Une erreur d'une
  heure fermerait le tunnel en pleine conversation **ou** le laisserait ouvert une heure de trop.
- **il referme sur interruption.** Un Ctrl-C qui laisserait le tunnel ouvert serait le pire des
  deux mondes : on croit avoir arrêté, l'adresse reste joignable.

**Ce qu'il ne fait pas, et il le dit** : il réduit la fenêtre d'exposition, il ne la supprime
pas. Seule la piste du scrutage la supprimerait.

**Cycle complet éprouvé, et les heures le prouvent :**

```
12:40:27  21 exécutions au départ
12:40:27  ouverture du tunnel…
12:41:08  en veille (ouverture : 41 s)
12:43:12  2 min sans activité  ->  fermeture
          exit 0
```

État final confirmé par le diagnostic : `adresse : localhost`, `tunnel : fermé`,
`SORTANT : OUI`, `ENTRANT : NON`, zéro conteneur de tunnel.

**Et un défaut de ma méthode d'épreuve, pas du script** : j'avais redirigé sa sortie dans `sed`
pour masquer l'adresse — **un tube tamponne**, et je n'ai donc rien vu avant la fin. *Le script
ne l'imprime déjà pas : le `sed` était superflu.*

### 3. Vider la mémoire de WSL — trois réponses, et la troisième est posée

| | Moyen | Effet | Coût |
|---|---|---|---|
| 1 | `wsl --shutdown` | rend **tout** | arrête Docker, donc Mongo et n8n |
| 2 | `echo 3 > /proc/sys/vm/drop_caches` | vide le cache de pages | il faut y penser au bon moment |
| 3 | **`autoMemoryReclaim=gradual`** | WSL rend de lui-même | **aucun, et c'est posé** |

**Pourquoi `gradual` et non `dropcache`** : `dropcache` libère plus vite mais vide le cache
disque de la machine virtuelle — les relectures repassent par le disque, et **une campagne y
perdrait plus de temps qu'elle n'en gagne.**

Et cela ne remplace pas le plafond : le plafond empêche WSL de **prendre** plus de 2 Go, la
récupération lui fait **rendre** ce dont il ne se sert plus. *Deux moments différents.*

### 4. La campagne : 2050/2050, au niveau de mémoire le plus bas jamais tenu

```
Total : 2050/2050 vérifications
Tout est au vert.   —   0 suite rouge
37 suites — mémoire libre : 0,57 Go
```

Aucune régression de performance : **18/18** et **15/15**.

**0,57 Go est le niveau le plus bas où une campagne ait abouti** — contre 0,43 Go où elle était
morte, et 0,68 à 0,90 Go pour les réussites précédentes. *Le plafond WSL et la récupération
automatique y sont probablement pour quelque chose, mais je ne l'affirme pas : une campagne verte
à 0,57 Go est une mesure, pas une preuve de causalité.*

## Deux endroits où je corrige plutôt que de rassurer

**La version de n8n.** Établi : `/rest/settings` expose `versionCli: 1.121.0` sans
authentification, et cela ne donne aucun accès. **Mais je ne peux pas vérifier d'ici si cette
version porte une faiblesse publiée**, et je ne conclurai pas « ce n'est pas problématique » sur
une mesure que je n'ai pas faite. La parade reste la même : ne pas laisser le tunnel ouvert.

**Le réseau.** Le message disait « on est toujours sur le réseau de l'école ». **Mesuré :
`SFR_5A78_5GHZ`, catégorie Private.** *Un état de réseau se mesure, il ne se suppose pas, même
par celui qui est devant la machine.* **L'épreuve du pare-feu redevient donc possible.**

## Tâche en cours

Aucune.

## Tâches à venir

### 1. Le pare-feu — possible dès maintenant

```
powershell -ExecutionPolicy Bypass -File scripts\pare-feu-fermer-le-dev.ps1
```

**Les deux sens** : le téléphone doit échouer **et** `node scripts/bout-en-bout-agent.mjs` rendre
25/25. C'est la seule mesure qui tranchera la question que la mienne ne pouvait pas trancher — le
pare-feu Hyper-V traitant le trafic conteneur comme du loopback.

### 2. La décision sur le scrutage Telegram

Un justificatif à créer de sa main, et le tunnel disparaît définitivement.

### 3. Points reportés

Ankama 12 Go, et l'application Google en Public au déploiement.
