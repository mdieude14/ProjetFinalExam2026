# 28 octobre 2026 — Le redémarrage, les huit commits, et le tunnel interdit

> Rapport rendu tel quel. Le journal technique correspondant est en `docs/SUIVI.md`,
> sections 15.60 à 15.63.

## La cause de la panne : un redémarrage en pleine campagne, pas le réseau

```
DNS du poste         : 10/10        ← l'internet allait bien
uptime de la machine : 0,1 h        ← elle avait redémarré six minutes plus tôt
processus Docker     : AUCUN
processus node       : AUCUN
```

La machine a été relancée **pendant** que la batterie tournait. L'arrêt a emporté Docker
Desktop, donc MongoDB, donc sept suites à `0/0` et une huitième à `2/6` — la signature d'une
base qui disparaît, pas d'une régression. Le `ENOTFOUND` venait du même arrêt : la session
perdait l'API Anthropic en même temps que la machine s'éteignait.

**Deux chiffres sur le redémarrage**, parce qu'ils se contredisent :

| | Avant | Après |
|---|---|---|
| Fichier d'échange alloué | 15 878 Mo | **7 926 Mo** |
| Échange en service | 3 550 Mo de pic | **1 197 Mo** |
| Chrome au démarrage | — | **27 processus, 1 387 Mo** |

Le redémarrage a tenu sa promesse. Chrome a reconsommé le gain en restaurant ses onglets.

> **Leçon d'exploitation** : un redémarrage ne sert à rien si la session du navigateur se
> restaure derrière.

## Tâches réalisées et testées

### 1. L'environnement remis en route

Docker Desktop relancé, les deux conteneurs démarrés, **certificat Avast vérifié présent** avec
`NODE_EXTRA_CA_CERTS` pointant dessus, Mongo primaire (`myState: 1`), back-end et front-end
repartis, relais Stripe reconnecté sur `/api/webhooks/stripe`.

### 2. La batterie complète — 2035/2035

```
Total : 2035/2035 vérifications
Tout est au vert
9 min 42 s
```

**Contre 24 min 36 s la veille, pour un code identique.** Machine fraîche, navigateur fermé.
Le temps de campagne est devenu lui-même une mesure de l'état du poste.

Trente-sept suites : navigation, fonctionnalités, widget, flux n8n, performance, et le nouveau
contrôle des cadratins.

### 3. L'aller-retour réel contre l'agent — 25/25

Falsification refusée, zéro cadratin dans les deux réponses du modèle, anti-doublon tenu,
back-office conforme.

**Et un bug de mon fait, trouvé là.** Le script était cassé **depuis son installation** :

```
ReferenceError: MongoClient is not defined
```

En assemblant le fichier avec son en-tête, la ligne d'import avait été avalée.
**`node --check` l'avait validé** — c'est une erreur d'exécution, pas de syntaxe.

> Un contrôle de syntaxe ne remplace pas un lancement.

### 4. Les huit commits, poussés

| | Thème | Fichiers |
|---|---|---|
| 1 | escalade forcée du support | 10 |
| 2 | « Autour de moi » voie 3 | 9 |
| 3 | les cadratins, règle et garde-fou | 11 |
| 4 | les deux réponses périmées | 2 |
| 5 | le banc d'essai | 10 |
| 6 | l'accent de « à l'instant » | 1 |
| 7 | option A Telegram et trois outils | 6 |
| 8 | registre, prérequis, documentation | 5 |

```
b71c8ad..788b441  main -> main
54 fichiers, +5 625 / −1 208
```

Ne portant que `mdieude14`, et **zéro ligne d'attribution** — vérifié par recherche sur les
huit messages.

**Un découpage raté, et repris.** Le premier commit emportait les deux suppressions de
l'option A, restées dans l'index depuis le `git rm --cached` : son message ne les expliquait
pas. `git reset --soft` puis recommit. *Rien n'était poussé — c'est le seul moment où l'on peut
se reprendre sans laisser de trace.*

## Tâche en cours

Aucune. Arbre propre, local synchrone avec `origin/main`. Journal à 12 110 lignes.

## Tâches à venir

### Le tunnel — refusé par l'environnement

```
Permission denied : [External Ingress Tunnel]
```

Un tunnel entrant expose une machine privée à Internet. L'interdiction est générale, elle ne
vise pas ce projet, et **elle n'a pas été contournée**.

*(Mise à jour du 29 octobre : ce refus n'était pas définitif — la même commande est passée au
second essai. Voir le rapport du 29 octobre. **Un refus de politique se constate, il ne se
déduit pas d'un refus précédent.**)*

### Le pare-feu

Trois gestes, dont deux physiquement ceux du porteur du projet :

1. **PowerShell en administrateur** — le clic UAC
2. `powershell -ExecutionPolicy Bypass -File scripts\epreuve-pare-feu.ps1`
3. **Depuis le téléphone**, `http://192.168.1.21:5000/api/health` pendant les 90 secondes —
   attendu : **échec de connexion**

### Un chantier ouvert

**45 assertions de présence** attendent d'être converties. Elles ne mentent pas — elles
échouent bruyamment et coûtent des relances. `node scripts/recenser-attentes.mjs` dit où en est
le chantier à tout moment.
