# 29 octobre 2026 — L'agent Telegram répondait à l'exploitant comme à un client

> Rapport rendu tel quel. Le journal technique correspondant est en `docs/SUIVI.md`,
> section 15.67.

## Le défaut signalé

Réponse à une alerte d'escalade, avec la consigne complète :

> « OK, je te formule ma réponse alors : j'ai bien pris connaissance de votre demande.
> Pouvez-vous nous fournir la date de résiliation de votre abonnement ainsi que la date de
> prélèvement du dernier abonnement ? … »

Ce que l'agent a répondu — **à l'exploitant**, comme à un client :

> « Merci pour ce message, mais je crois qu'il y a une confusion : je suis l'assistant de
> CoachConnect et c'est à vous que je réponds… aucun abonnement premium ne figure sur votre
> compte. »

## Tâches réalisées et testées

### 1. La cause, et elle est structurelle

```js
if (reference) { … → rédige un brouillon pour l'utilisateur }

/* ---- Question libre à la base de connaissances ---- */
… → l'agent répond À L'EXPLOITANT, comme à un client
```

Sans référence lisible, le message **tombait dans le robot d'accueil**. Le flux n'a, à cet
instant, aucun moyen de savoir que l'expéditeur est l'exploitant : le compte rattaché n'est lu
qu'un nœud plus loin.

Chaque étape avait fait ce qui était écrit. Le résultat est pourtant absurde, et surtout
**trompeur** : le texte rendu a toutes les apparences d'une réponse réfléchie, et rien n'y dit
que la consigne n'a jamais été comprise comme telle.

> **Un repli qui RÉPOND quand même est pire qu'un repli qui refuse.** Devant une entrée
> ambiguë, on rend la question — pas une réponse confiante et hors sujet.

### 2. Le banc d'essai gardait la faute, en vert

```js
ok('répondre à un message sans référence reste une question ordinaire',
  citeSansRef.reponseDossier === false && citeSansRef.valide === true);
```

Cette assertion **décrivait** le comportement observé au lieu de dire celui qu'on veut, et elle
le figeait. *Un test écrit en regardant le produit certifie le produit tel qu'il est, défaut
compris.* Elle a été retournée, avec sa raison écrite à côté.

### 3. La correction : deux signes, lus sans dépenser un jeton

| Cas | Signe | Ce que le bot répond désormais |
|---|---|---|
| a | « Répondre » utilisé, mais sur un message sans `Réf.` | « Je ne trouve aucune référence dans le message auquel vous répondez… utilisez Répondre sur mon alerte, celle qui porte 🏷️ Réf. » |
| b | la référence **recopiée** dans son propre message | « Je ne la lis pas, et c'est volontaire : une faute de frappe sur huit caractères instruirait le dossier de quelqu'un d'autre » |

Le cas (b) était déjà refusé, **mais en silence** : un refus qui n'explique pas passe pour une
panne. Et un utilisateur ordinaire n'est pas pénalisé — le durcissement ne vise que les messages
qui **citent** quelque chose ou qui portent une référence tapée.

### 4. L'origine du brouillon, qui manquait au back-office

Le brouillon Telegram **y apparaissait déjà, mais sans rien dire** : `enregistrerBrouillon` met
`brouillonParAgent: false` — un humain est bien intervenu — donc l'avertissement « proposé par
l'agent » ne s'affichait pas. Un texte dicté au téléphone était **indistinguable** d'un texte
tapé devant le dossier.

`brouillonOrigine` ajouté : `agent` | `telegram` | `back-office`.

**Ce n'est pas la même question que `brouillonParAgent`** : celui-ci dit si un humain a relu,
l'origine dit d'où vient le geste. Une amorce Telegram est dictée de mémoire, souvent depuis un
téléphone, **sans la demande sous les yeux**.

**L'origine est une propriété de la ROUTE, jamais une donnée du corps.** Éprouvé par
falsification : on pousse `brouillonOrigine: 'back-office'` dans le corps de la route Telegram,
et le dossier rend quand même `telegram`.

Marqueur ambre dans l'écran de modération : « Rédigé par l'agent depuis une amorce envoyée sur
Telegram. La demande n'était pas sous les yeux au moment de la dicter : à relire avant envoi. »

### 5. L'adresse d'expédition était déjà la bonne

`MAIL_FROM=Support CoachConnect <support.coachconnect.app@gmail.com>` — rien à changer.

### 6. Le piège de l'import, qui rend le bot muet sans erreur

**`n8n import:workflow` remet le flux à INACTIF.** Mesuré : après l'import du correctif,
`ccAgentTelegr01` était inactif. Aucun message, aucune erreur — le bot aurait simplement cessé
de répondre, et l'on aurait cherché la panne dans le code qu'on venait d'écrire.

```
n8n import:workflow --input=/workflows/agent-telegram.json
n8n update:workflow --id=ccAgentTelegr01 --active=true
docker compose -f … -f …override… -f …tunnel… up -d --force-recreate n8n
```

### 7. Les épreuves

| Suite | Avant | Après |
|---|---|---|
| Telegram et courriel | 267 | **274/274** |
| brouillon et validation | 49 | **52/52** |
| back-office (navigateur) | 137 | **140/140** |
| API support | — | **133/133** |
| escalade forcée | — | **35/35** |
| support par courriel | — | **56/56** |
| relève des escalades | — | **78/78** |
| chaîne réelle | — | **25/25** |

**793 vérifications, treize nouvelles.** Lint du client : 0 erreur.

Le cas réel est éprouvé **mot pour mot**, dans les deux situations : cité sur un message sans
référence, il ne part plus au robot d'accueil ; cité sur la bonne alerte, il rédige le brouillon.

L'épreuve d'écran porte sur une **présence** : on écrit l'origine en base, on recharge, et on
exige que le marqueur apparaisse. Vérifier son absence passerait au vert sur un écran vide.

## Tâche en cours

Aucune.

## Tâches à venir

### Ce que je n'ai volontairement pas fait

**La campagne complète n'a pas été rejouée.** 0,71 Go de mémoire libre, compression à 1 729 Mo —
pire que lorsqu'elle est morte quelques heures plus tôt. La relancer aurait reproduit l'échec et
produit vingt minutes de données invalides. **793 n'est pas 2035**, et il faut le dire.

*Corollaire de la règle « ne jamais relever un seuil pour obtenir du vert » : ne jamais faire
tourner un instrument dans des conditions où il ne mesure plus rien.*

**Le tunnel est refermé.** `tunnel/healthz` → 530, `WEBHOOK_URL` revenu sur localhost. Le laisser
ouvert sans surveillance était le risque signalé deux fois.

### Ce qui attend

- **Rouvrir et éprouver la chaîne Telegram corrigée** : `node docker/n8n/ouvrir-tunnel.mjs`, puis
  répondre au dossier `d9d8790e`. Vérifier les trois comportements : la consigne citée sur
  l'alerte rédige un brouillon ; le brouillon apparaît aussi dans `/admin/moderation` avec le
  marqueur Telegram ; `ENVOYER` expédie depuis `support.coachconnect.app@gmail.com`.
- **Poser la règle du pare-feu** (élévation requise) et vérifier **les deux sens**.
- **Libérer la mémoire**, puis rejouer les 37 suites.
- **Points reportés** — Ankama 12 Go, application Google en Public au déploiement.
