# Les rapports d'avancement

Un rapport par séance de travail, dans l'ordre. Chacun décrit **ce qui a été fait et
éprouvé**, **ce qui était en cours**, et **ce qui restait à faire** — y compris ce que je ne
pouvais pas faire moi-même, et pourquoi.

## Pourquoi ce dossier existe, et ce qu'il n'est pas

`docs/SUIVI.md` est le **journal technique** : il garde les causes, les mesures, les décisions
et les leçons, classées par incident. On y va pour comprendre *pourquoi* une chose est comme
elle est.

Ce dossier-ci garde les **rapports tels qu'ils ont été rendus**, dans leur forme d'origine. On
y va pour retrouver *ce qui avait été dit à un moment donné* : l'état du projet ce jour-là, les
chiffres annoncés, les tâches ouvertes, et les questions posées.

Les deux ne se remplacent pas. Le journal est réorganisé quand une cause est mieux comprise ;
un rapport, lui, ne se réécrit pas — il date, et c'est son intérêt.

## Une limite à connaître

**L'archive commence au 28 octobre 2026.** Les rapports antérieurs ont été rendus en
conversation et n'ont pas été conservés mot pour mot. Leur substance — les causes, les mesures
et les décisions — se trouve dans `docs/SUIVI.md`, qui couvre tout le projet depuis le début.
Je ne reconstitue pas de mémoire ce que je n'ai pas : un rapport inventé après coup serait pire
qu'un rapport manquant.

## L'index

| Date | Rapport | Ce qu'il couvre |
|---|---|---|
| 2026-10-28 | [Le redémarrage et les huit commits](2026-10-28-redemarrage-et-huit-commits.md) | la cause du `ENOTFOUND`, l'environnement remis en route, 2035/2035, les huit commits poussés, le tunnel refusé |
| 2026-10-28 | [Les assertions de présence](2026-10-28-assertions-de-presence.md) | le faux vert vivant sur le cloisonnement, les trois angles morts du recenseur, la régression que j'ai causée |
| 2026-10-29 | [Le tunnel ouvert, éprouvé, refermé](2026-10-29-tunnel-ouvert-eprouve-referme.md) | les mesures à l'ouverture et à la fermeture, les deux points Telegram vérifiés à la source, les deux dettes d'exploitation |
| 2026-10-29 | [Les flux de messagerie activés](2026-10-29-flux-de-messagerie-actives.md) | l'activation autorisée, la campagne, le tunnel rouvert pour l'épreuve réelle |

## Comment lire un chiffre de campagne

`2035/2035` désigne des **vérifications**, pas des suites : 37 suites, et chacune en porte de
quelques-unes à plus de cent. Un total qui **baisse** sans qu'aucune suite ne soit rouge ne
signale pas une régression mais **une suite coupée en route** — c'est la règle inscrite dans
`scripts/test-tout.mjs`, et elle a servi deux fois.
