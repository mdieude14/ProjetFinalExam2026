# 30 octobre 2026 — « Il ne se passe rien » : trois causes, dont une vraie

> Rapport rendu tel quel. Le journal technique correspondant est en `docs/SUIVI.md`,
> section 15.70.

## Le symptôme

Réponse à une alerte d'escalade, avec la consigne complète et la référence `bc7b0f49` bien
présente dans le message cité. **Rien ne s'est produit** — pas de brouillon, et pas même un
message d'erreur.

Trois causes se superposaient. Seule la troisième est un défaut.

## Tâches réalisées et testées

### 1. Cause 1 — l'agent n'écoutait pas, et c'était moi

```
ccAgentTelegr01  : INACTIF
WEBHOOK_URL      : http://localhost:5678/
conteneur tunnel : 0
```

J'avais fermé le tunnel quelques heures plus tôt, en nettoyant le piège du redémarrage.
**Telegram n'avait nulle part où livrer** : il a mis le message en file, et aucun code n'a
tourné. D'où « rien du tout », pas même une erreur — le repli corrigé la veille ne pouvait pas
parler puisqu'il n'a jamais été atteint.

Et « mon message a bien été lu » vient de l'indicateur de Telegram, qui atteste la livraison au
*chat*, pas l'exécution d'un workflow. *Un accusé de lecture ne dit rien de ce qui s'est passé
derrière.*

### 2. Cause 2 — ce dossier n'existait déjà plus

```
dossier bc7b0f49 : INTROUVABLE
compte alicesup… : SUPPRIME
adresse          : …@supportfront.local   <- domaine de TEST
```

L'escalade venait d'une **suite de tests**. Même tunnel ouvert, la réponse aurait reçu « Je ne
trouve aucun dossier portant la référence bc7b0f49 » — correct, mais incompréhensible pour qui
croit répondre à une vraie demande.

### 3. Cause 3 — la relève alertait pour les dossiers des suites

C'est le défaut, et il explique la confusion entière.

```
aNotifier() -> Ticket.find({ statut: 'escalade', notifieExploitant: false })
```

**Aucun filtre, ni dans l'API, ni dans le flux.** Le motif était :

> une suite crée un dossier escaladé → la relève envoie l'alerte sur Telegram → **la suite
> supprime le dossier** → l'exploitant détient une alerte qui ne pointe vers rien.

**Mesuré avant de corriger** : sur 14 dossiers en escalade, **3 portaient une adresse de test**
(`agentreel.local` ×2, `diagtls.local` ×1) et avaient bien reçu leur alerte.

#### Le critère : le domaine réservé, pas un nom de compte

`.local`, `.test`, `.invalid`, `.example` sont réservés par les **RFC 2606 et 6761** : aucune
adresse réelle ne peut s'y trouver, et aucun courriel n'y est livrable.

> Le filtre ne repose donc sur aucune convention de nommage qu'une suite pourrait oublier de
> suivre. Il repose sur une **impossibilité**. *Un critère fondé sur une habitude se contourne
> par distraction ; un critère fondé sur une RFC ne se contourne pas.*

Les **deux** emplacements de l'adresse sont examinés : le compte peuplé pour le widget,
`courrielAuteur` pour le canal courriel — où `auteur` est vide par construction. Ne regarder que
le compte aurait laissé passer **tous** les dossiers du courriel.

Le filtre est **dans la requête**, pas après : filtrer le résultat laisserait les dossiers
écartés occuper la fenêtre, et vingt dossiers de test jamais supprimés bloqueraient toute alerte
réelle, pour toujours et sans rien dire.

#### Le conflit avec les suites, et comment il est tranché

Un filtre inconditionnel aurait fait tomber deux suites : `test:support` vit sur
`@supporttest.local`, `test:courriel` sur `@courrieltest.local`, et toutes deux vérifient que la
file **ramène** leur dossier.

**Et la tentation était dangereuse** : leur donner un domaine livrable aurait fait risquer
l'envoi de vrais courriels à de vraies adresses depuis une campagne.

`?reserves=1`, **opt-in, et le défaut est le comportement sûr**. La relève ne le passe pas ; les
suites le passent. Les **deux sens** sont éprouvés — sans le drapeau le dossier réservé est
écarté, avec le drapeau il est rendu — et l'absence est **ancrée sur une présence**, sinon une
route cassée rendrait une liste vide et la vérification passerait au vert en ayant mesuré le
néant.

#### L'outil d'épreuve devait changer d'adresse

`preparer-epreuve-telegram.mjs` utilisait `@exemple.local`, désormais filtré — or ce script veut
l'inverse du filtre : il **fabrique** le dossier auquel répondre.

L'adresse se lit maintenant à l'exécution : `EPREUVE_COURRIEL`, sinon `git config user.email`,
sinon **refus explicite**. *Le dépôt est public : une adresse écrite dans un fichier y resterait
pour toujours, historique compris.* Avec sous-adressage, pour que le courriel arrive dans la même
boîte en se distinguant d'un message réel.

### 4. Une reconnaissance : le piège de l'import était déjà écrit

J'ai annoncé la veille « le piège de l'import » comme une découverte. Il était consigné depuis le
début dans l'en-tête de `server/tests/releve-telegram.mjs`, lignes 30 à 33.

> **La leçon : chercher dans les notes du projet avant d'annoncer une trouvaille.** Le temps
> perdu est mineur ; ce qui coûte, c'est de laisser croire que le projet ne savait pas, alors que
> quelqu'un l'avait déjà écrit à l'endroit exact où il fallait le lire.

### 5. Les épreuves

| Suite | Avant | Après |
|---|---|---|
| `test:support` — API | 133 | **134/134** |
| `test:courriel` — support par courriel | 56 | **57/57** |

## Tâche en cours

Aucune.

## Tâches à venir

### L'épreuve Telegram, maintenant sans le piège

```bash
node docker/n8n/ouvrir-tunnel.mjs
cd server && node scripts/preparer-epreuve-telegram.mjs
```

Le dossier créé porte désormais une **adresse réelle**, donc son alerte passe le filtre — et
aucune alerte de suite de tests ne viendra plus la noyer.

Trois comportements, puis deux refus :

1. amorce citée sur l'alerte → **un brouillon rédigé par le modèle** ;
2. le même brouillon sur `/admin/moderation`, avec le **marqueur ambre** Telegram ;
3. `ENVOYER` → courriel depuis `support.coachconnect.app@gmail.com`.

Puis : répondre à un message **sans** `Réf.`, et **recopier** la référence à la main.

⚠️ `node docker/n8n/ouvrir-tunnel.mjs --fermer` après usage.

### Le pare-feu

Demande une élévation que ma session n'a pas (`Accès refusé` mesuré). Le script est prêt et
network-indépendant depuis sa réécriture.

### Points reportés

Ankama 12 Go, et l'application Google en Public au déploiement.

---

## Addendum — la règle du registre a servi une troisième fois

La campagne de validation est sortie à **2021/2021**, avec `story par la caméra` marquée rouge
en affichant **`2/2`**. Aucune assertion n'avait échoué.

C'est la règle inscrite dans `scripts/test-tout.mjs` qui a parlé : *un total qui **baisse** sans
suite rouge signale une suite coupée en route, pas une régression.* Le compte attendu était
2050 ; **2050 − 2021 = 29**, et **31 − 2 = 29**.

```
2/2 vérifications réussies
INTERROMPU : page.waitForSelector: Timeout 15000ms exceeded.
  - waiting for locator('[data-test="ajouter-story"]') to be visible
```

Relancée seule : **31/31**. Faux rouge sous charge — à la trentième suite sur trente-sept, 15 s
ne suffisaient plus à rendre la page d'accueil pendant que la machine paginait.

Les deux plafonds portés de **15 s à 30 s**, avec la raison gravée à côté.

> **Et c'est gratuit, contrairement à ce qu'on croirait.** Relever une attente
> **conditionnelle** ne coûte rien : elle sort dès que la condition cède, donc zéro seconde de
> plus sur une machine au repos. Relever un **délai fixe**, lui, se paie à chaque passage. C'est
> pourquoi un plafond généreux ici n'est pas un truquage de l'instrument — alors que relever un
> seuil de performance en serait un.

**Troisième occurrence du même diagnostic en deux jours** : l'animation du compositeur, le
`fetch failed` de la bascule, et cette interruption. **Les trois venaient de la mémoire**, aucune
d'un défaut du produit.

> *Le banc d'essai nomme « panne réseau » ou « timeout » ce qui est une machine saturée ; il faut
> le traduire chaque fois.*

---

## Addendum 2 — la validation, et le tunnel rouvert

```
Total : 2050/2050 vérifications
Tout est au vert.   —   0 suite rouge
37 suites — mémoire libre au lancement : 0,87 Go
```

Le compte tombe juste : 2048 + les deux assertions ajoutées = 2050. `API — support automatisé`
**134/134**, `API — support par courriel` **57/57**, `story par la caméra` **31/31**, performance
**18/18** et **15/15**.

**Le tunnel rouvert**, et le filtre éprouvé par l'usage :

| Mesure | Résultat |
|---|---|
| `tunnel/healthz` | **200** |
| `/rest/credentials` et `/rest/workflows` | **401** |
| flux actifs **en base** | **6 sur 6** |
| dossier d'épreuve | **`384e7a25`**, adresse réelle |
| alerte Telegram | **partie en 20 s** |

> **L'alerte partie EST la preuve du filtre.** Le dossier porte une adresse réelle, donc
> `aNotifier()` l'a rendu ; s'il avait été écarté, aucune alerte ne serait jamais sortie. *Un
> filtre se prouve par ce qu'il laisse passer autant que par ce qu'il écarte.*

Et une leçon déjà apprise, reconfirmée : `docker logs --since 4m` rendait **zéro** ligne
d'activation alors que la base donnait les six flux actifs. Le conteneur venait d'être recréé, la
fenêtre de temps ne correspondait pas. *Lire le journal une fois ne dit pas l'état, seulement
l'instant — c'est la base qui fait foi.*
