# 28 octobre 2026 — Les assertions de présence, et le faux vert que l'outil cachait

> Rapport rendu tel quel. Le journal technique correspondant est en `docs/SUIVI.md`,
> section 15.64.

## Ce qu'est une assertion de présence, et pourquoi la distinction compte

Une suite de tests pose deux sortes de questions. Elles **n'ont pas le même danger**.

**Question de présence** — « est-ce que le bouton est là ? »

```js
await page.waitForTimeout(2000);                       // j'attends 2 secondes
ok('le bouton est là', (await bouton.count()) === 1);  // je regarde
```

Si la machine est chargée et que le bouton n'est pas encore affiché, je compte **0** et le test
devient **ROUGE**. Le produit va très bien ; c'est le chronomètre qui était trop court. C'est un
**faux rouge** : agaçant, il coûte une relance de dix minutes, mais **il ne mentira jamais**.

**Question d'absence** — « est-ce que ce bouton est bien introuvable ? »

```js
await page.waitForTimeout(2000);
ok('un sportif ne voit PAS le bouton admin', (await boutonAdmin.count()) === 0);
```

Même situation : page pas encore affichée, je compte **0**… et le test devient **VERT**. Sauf
que rien n'a été vérifié. **Une page vide contient zéro bouton admin, exactement comme une page
correcte.** Le test certifie qu'une porte est fermée alors qu'il a mesuré le vide.

> **La règle qui en découle** : une absence ne conclut rien sur un écran vide. Il faut d'abord
> prouver qu'il y a quelque chose, *puis* montrer que la chose interdite n'y est pas.

Les 45 étaient donc le tas inoffensif, et c'est pour cela qu'elles avaient été laissées. Les 9
dangereuses avaient été traitées en priorité.

## Tâches réalisées et testées

### 1. Un faux vert était encore vivant

`messagerie.mjs` vérifiait que Bob ne voit pas le fil de conversation de Carol :

```js
const filCarolChezBob = await pageBob.getByText('fil de Carol').count();
ok('le fil de Carol n’apparaît pas chez Bob', filCarolChezBob === 0);
```

Sur une page de Bob non rendue, « fil de Carol » n'y est pas — **vert, en ayant mesuré le
vide**. Cette assertion garde **le cloisonnement des conversations privées**. C'est la pire
place possible pour un faux vert.

**Pourquoi le balayage du matin l'avait manquée** : il cherchait la comparaison à zéro *dans la
ligne de lecture*. Ici la lecture est sur une ligne, le verdict sur la suivante, et la
comparaison porte sur un **nom de variable**.

> **La leçon la plus importante du jour.** `ABSENCE : 0` avait été annoncé le matin comme un
> acquis. C'était faux, et **rien ne pouvait le signaler** : l'outil ne sait pas qu'il ne sait
> pas. Un recenseur qui se trompe de classement est **pire que pas de recenseur**, parce qu'il
> délivre un certificat de bonne santé. La section 15.62 du journal a été corrigée plutôt que
> laissée en contradiction.

### 2. Trois des 45 n'étaient pas à corriger

| | Ce que c'était réellement | Décision |
|---|---|---|
| `messagerie` (pastille) | le délai est le **pas d'une boucle de scrutation** | déjà juste, l'outil le comptait à tort |
| `notifications` (suppression) | idem | déjà juste |
| `relations:328` | mesure **pendant** le chargement — seul instant où le défaut est visible | **conservée**, marquée volontaire |

Les trois de `publication-toggle` vérifient qu'une chose **n'a pas** changé : *on ne peut pas
attendre un non-événement.* Elles portent un marqueur `mesure-instantanee :` que l'outil
reconnaît.

### 3. Les 42 autres, ancrées — et un choix de méthode

**Les délais fixes ont été gardés, et une attente conditionnelle insérée devant chaque
lecture.** Les retirer aurait changé la chronologie d'assertions voisines qui comptent des
appels réseau ou mesurent des états transitoires.

**Conséquence assumée** : ce chantier achète de la **fiabilité, pas de la vitesse**. Le gain de
temps n'arrivera que le jour où une suite aurait échoué et aurait dû être relancée.

Trois exceptions où l'ancre remplace vraiment le délai : le retrait d'un abonné (le nombre
**diminue** — une boucle de scrutation remplace 2,5 s d'attente sèche), et les listes de 20 et
22 lignes, où l'on attend **la vingtième** et **la vingt-deuxième**. Attendre « une ligne » ne
dit rien du nombre : elle était déjà là avant le clic.

### 4. Une régression causée en corrigeant, et ce qu'elle a appris

**La campagne est sortie rouge : 2034/2035.** Une seule chute — « Bob voit *Alice écrit…*
pendant la frappe ». Reproductible deux fois : donc **une régression, pas de la fragilité**.

```js
const signalerSaisie = useCallback(() => {
  if (!minuteurSaisie.current) {
    emettre('saisie:debut', …);            // UNE SEULE FOIS, au début d'une série
  } else {
    clearTimeout(minuteurSaisie.current);  // sinon on repousse
  }
  minuteurSaisie.current = setTimeout(…, 2000);
}, …);
```

L'indicateur n'est émis **qu'au début d'une série de frappe**. Le délai de 2,5 s remplacé ne
servait pas le socket : **il laissait ce minuteur expirer**. Sans lui, Alice enchaînait, aucun
`saisie:debut` ne partait, et Bob ne voyait rien — *alors que le produit allait parfaitement
bien*.

**Ce délai n'est pas remplaçable** : la fermeture de la série est un minuteur côté client,
invisible du dehors. Il n'y a rien dans le DOM à attendre.

> **La leçon : un délai fixe qui porte une précondition doit la DIRE.** Sinon le passage
> suivant le prend pour de la négligence et le retire. Et cela valide la règle conservatrice
> ci-dessus — elle a été enfreinte une seule fois, et c'était précisément là où elle comptait.

### 5. La campagne, dans les pires conditions

```
Total : 2035/2035 vérifications
Tout est au vert.
mémoire libre : 0,90 Go sur 8,3
```

**Lancée volontairement à 0,90 Go** — le niveau qui faisait durer la campagne 24 minutes. Si
les corrections valent quelque chose, les suites doivent tenir là. Elles ont tenu : la seule
chute était la mienne, et elle était déterministe.

Relevé final : `à traiter : 0 — sans danger : 30`. **Et l'outil dit maintenant sa propre
limite** : « un zéro ici ne vaut rien sans une campagne verte, il lit le texte et non le
navigateur. »

Vérifié en plus : **0 erreur** de lint, garde-fou des cadratins **9/9**, les six nouveaux
sélecteurs existent bien dans l'application avant usage.

### 6. Quatre commits poussés

`788b441..b633ac8`, auteur `mdieude14`, zéro ligne d'attribution.

## Tâche en cours

Aucune.

## Tâches à venir

- **Le tunnel** — une seule commande, `node docker/n8n/ouvrir-tunnel.mjs`, puis `--fermer`
  après usage. ⚠️ L'adresse publique mène à n8n, **éditeur compris**.
- **Le pare-feu** — les trois gestes, dont le clic UAC et l'essai depuis le téléphone.
- **Chrome** — revenu à 20 processus / 1 503 Mo. L'arrêt a été **refusé** par la politique de
  l'agent (« Interfere With Workloads ») ; aucun contournement tenté.
- **Un point à décider** — l'adresse du compte git apparaît 7 fois dans `docs/SUIVI.md`, toutes
  antérieures. Elle est de toute façon publique : elle signe chaque commit. **Zéro identifiant
  Telegram**, vérifié.
- **Points reportés** — Ankama 12 Go, et le passage de l'application Google en Public au
  déploiement.
