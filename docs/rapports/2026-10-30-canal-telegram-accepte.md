# 30 octobre 2026 (soir) — Le canal Telegram accepté, et un piège qui devient une mesure

> Rapport rendu tel quel. Le journal technique correspondant est en `docs/SUIVI.md`,
> section 15.71.

## Tâches réalisées et testées

### 1. Le canal Telegram est accepté par le porteur du projet

Éprouvé par lui, de bout en bout, sur une demande réelle :

> « j'ai bien la notification de message d'escalade qui vient de la demande d'un utilisateur,
> ensuite quand je formule le message de réponse en indiquant la référence du dossier, j'ai bien
> le brouillon qui est rédigé et envoyé au niveau du support modération et ainsi dans la
> conversation Telegram, et quand je valide le brouillon et que je fais envoyer, le mail s'envoie
> bien à l'adresse de l'utilisateur concerné — et cela si je valide le brouillon sur Telegram ou
> sur la page modération »

**Les cinq maillons du comportement demandé sont confirmés en usage réel** : l'alerte, la
référence lue dans le message cité, le brouillon rédigé par le modèle, sa présence **aux deux
endroits**, et l'expédition depuis l'une ou l'autre des deux validations.

Et le filtre posé la veille est confirmé en usage : « je reçois seulement les notifs qui viennent
d'une demande utilisateur et pas des tests ».

> *C'est la première fonctionnalité du module 15 validée par l'usage, et non par les suites
> seules.*

### 2. Ma contre-vérification — 940 vérifications

| Suite | Résultat |
|---|---|
| `test:canaux` — Telegram et courriel | **274/274** |
| `test:releve` — relève des escalades | **78/78** |
| `test:telegram` — rattachement (API) | **57/57** |
| `test:reponse` — brouillon et validation | **52/52** |
| `test:support` — API | **134/134** |
| `test:courriel` — support par courriel | **57/57** |
| `test:messagerie-agent` — assistant | **104/104** |
| `bout-en-bout-agent` — chaîne réelle | **25/25** |
| `client test:support` — back-office | **140/140** |
| `client test:telegram` — navigateur | **19/19** |

### 3. Le piège du redémarrage devient une mesure

**Deuxième occurrence en deux jours.** Au redémarrage comme à celui de la veille : adresse de
tunnel morte dans la configuration, conteneur de tunnel absent, **`ccAgentTelegr01` ACTIF**. n8n
l'avait déclarée à Telegram au démarrage, et le bot était injoignable en silence.

> **La leçon : un piège qui mord deux fois malgré sa consigne écrite doit devenir une MESURE,
> pas un rappel.** Une consigne demande qu'on s'en souvienne ; un contrôle le fait à notre place.
> L'avertissement existait depuis le 19 octobre et n'a rien empêché.

Le contrôle compare deux faits : `WEBHOOK_URL` est-elle publique, et un conteneur de tunnel
tourne-t-il ? **L'incohérence des deux est l'état fautif.** C'est un **rappel, pas un blocage** —
cet état n'empêche aucune suite de passer, il rend seulement le canal Telegram muet. Et il se
taît quand Docker est éteint : *un prérequis qui crie deux fois la même panne apprend à être
ignoré.*

#### `--prerequis` : l'état du poste sans lancer 37 suites

Ajouté pour deux raisons, dont la seconde compte plus : savoir en deux secondes si une campagne a
une chance d'aboutir, et surtout **éprouver les contrôles eux-mêmes**.

> **Un prérequis qui ne sonne jamais ne vaut rien**, et on ne peut pas le vérifier s'il faut
> vingt minutes de campagne pour l'entendre.

Le nouveau contrôle est éprouvé **dans les deux sens**, de façon reproductible :

```
état sain                          -> aucun avertissement
docker stop coachconnect-tunnel    (n8n garde l'adresse : l'après-redémarrage, exactement)
état fautif                        -> « ADRESSE DE TUNNEL MORTE dans n8n, et aucun tunnel debout »
après --fermer                     -> 0 avertissement
```

Et le rappel du relais Stripe est **inconditionnel** — ce n'est pas un défaut : le relais n'expose
aucun port, donc rien ne permet de le détecter. Vérifié séparément, il tournait. *Un rappel qu'on
ne peut pas mesurer vaut mieux qu'une détection qui mentirait.*

### 4. La séquence de relance, et le certificat en premier

Docker Desktop, attente du moteur, les deux conteneurs, **certificat Avast vérifié avant toute
autre chose**, Mongo primaire, nettoyage du piège, back-end, front-end, relais Stripe (**clé de
test confirmée avant lancement**).

**Le plafond WSL a survécu au redémarrage** : `memory=2GB` toujours en place.

### 5. Une hypothèse posée, puis corrigée

`API — Stripe Connect` est tombée à la deuxième suite sur `INTERROMPU : fetch failed`. J'ai
supposé une sortie HTTPS bloquée par le réseau de l'école. **Mesuré : faux** — `api.stripe.com`,
`api.anthropic.com` et `api.telegram.org` répondent tous. Et le `fetch` de cette suite pointe vers
`http://localhost:5000/api`, donc vers notre propre API, pas vers Stripe.

Le back-end n'était pas tombé : **200**, zéro redémarrage nodemon, aucune erreur, et il servait
d'autres requêtes au même moment.

> *Une hypothèse vaut d'être posée, mais elle ne vaut rien sans la mesure qui la tranche. Celle-ci
> a été démentie en une commande.*

## Tâche en cours

La campagne complète de validation.

## Tâches à venir

### Le pare-feu attend d'être chez soi

Le poste est sur **`PEDA`, catégorie Public**. La règle `node.exe` est limitée au profil
**Private** : elle ne s'applique donc pas ici, et une épreuve au téléphone depuis ce réseau **ne
mesurerait rien d'utile**.

> Le rapport de la veille affirmait « tu es chez toi » — c'était vrai le soir du 29, ce ne l'est
> plus. *Un état de réseau est une mesure de l'instant, pas une propriété du poste.*

La pose demande en outre une élévation que la session n'a pas (`administrateur : False`, mesuré).

### Points reportés

Ankama 12 Go, et l'application Google en Public au déploiement.

---

## Addendum — une assertion sur-spécifiée sur un état décidé par Stripe

La campagne de validation est sortie à **2049/2050**, une seule assertion rouge :

```
✗ API — Stripe Connect   49/50
    ECHEC statut « en_attente » tant que le formulaire n’est pas rempli  ->  restreint
```

Relancée seule : **50/50**. Et l'échec n'était **pas** un délai dépassé — le test attendait
`en_attente` et a reçu `restreint`. Un **état**, pas une horloge.

La cause est dans le calcul du statut :

```js
const statut = peutRecevoir
  ? 'actif'
  : compte.requirements?.entries?.length
    ? 'restreint'      // Stripe a DÉJÀ listé ses exigences
    : 'en_attente';    // Stripe n'a encore rien listé
```

`restreint` et `en_attente` **décrivent le même fait** — le formulaire n'est pas rempli — et ne
diffèrent que par le fait que Stripe ait eu le temps d'évaluer le compte. **C'est une course chez
Stripe**, hors de notre portée, et sous charge elle basculait.

L'assertion affirme désormais ce qu'elle protège : le compte **ne peut pas encore encaisser**. Les
deux valeurs passent ; **seul `actif` serait un défaut réel** à ce stade.

> **La règle : ne jamais figer dans une assertion un état décidé par un service tiers quand
> plusieurs valeurs y répondent correctement.** On affirme ce que le test protège, pas la forme
> qu'il prend ce jour-là.

Et une hypothèse de plus, démentie : le premier échec de cette suite était `INTERROMPU : fetch
failed`, que j'ai attribué à une sortie HTTPS bloquée par le réseau de l'école. **Mesuré faux** —
les trois services tiers répondent, et le `fetch` en cause pointe vers `localhost:5000`.

> *Deux hypothèses posées sur cette suite, deux fois démenties par la mesure ; c'est la mesure
> qui a fini par nommer la vraie cause.*

### La confirmation : 2050/2050

```
Total : 2050/2050 vérifications
Tout est au vert.   —   0 suite rouge
37 suites — mémoire libre au lancement : 0,90 Go
```

`API — Stripe Connect` **50/50** après la correction, `API — support automatisé` **134/134**, et
aucune régression de performance (**18/18** et **15/15**).
