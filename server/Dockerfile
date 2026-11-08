# ===========================================================================
#  L'API DE COACHCONNECT, EN CONTENEUR
# ===========================================================================
#
# POURQUOI UN CONTENEUR, ET PAS VERCEL.
#
# L'API tient un serveur Socket.IO : `initialiserSockets(serveurHttp)` réutilise
# le serveur HTTP d'Express pour la messagerie et les notifications en direct.
# Cela exige un PROCESSUS QUI VIT — pas une fonction qui démarre à chaque
# requête et s'éteint après.
#
#   Vercel sait faire du WebSocket depuis juin 2026, en bêta publique, mais la
#   connexion se ferme quand la fonction atteint sa durée maximale. Une
#   messagerie en direct présentée à un jury ne se joue pas là-dessus.
#
# D'où ce conteneur, qui tourne sur le MÊME VPS que n8n : un seul hébergement
# à payer, deux services derrière le même relais Caddy.
#
# ---------------------------------------------------------------------------
#  CONSTRUCTION EN DEUX TEMPS, ET CE QUE ÇA ÉVITE
# ---------------------------------------------------------------------------
#
# Le premier temps installe les dépendances ; le second ne garde que ce qui
# tourne. L'image finale ne contient donc ni cache npm, ni outils de
# construction — moins de poids, et surtout moins de surface.
# ===========================================================================

# ---------------------------------------------------------------------------
#  1 — LES DÉPENDANCES
# ---------------------------------------------------------------------------
#
# VERSION EXACTE, JAMAIS `lts` NI `alpine` SEUL.
# Une image reconstruite six mois plus tard doit revenir identique, sans quoi
# une panne devient inexplicable. 24.22.2 est alignée sur le Node du poste de
# développement (24.19) : même majeur, donc mêmes comportements.
FROM node:24.22.2-alpine AS dependances

WORKDIR /app

# On copie d'abord les manifestes SEULS. Docker met alors en cache la couche
# d'installation : changer une ligne de `src/` ne réinstalle pas tout.
COPY package.json package-lock.json ./

# `npm ci` et non `npm install` : il exige un lock synchronisé et refuse de
# résoudre autrement. C'est ce qui garantit que l'image contient exactement
# les versions éprouvées — y compris la montée d'axios du 8 novembre.
#
# `--omit=dev` écarte nodemon et les suites de tests : ils n'ont rien à faire
# dans une image de production.
#
# ---------------------------------------------------------------------------
#  LE SECRET `cacert` : FACULTATIF, ET POUR UNE SEULE MACHINE
# ---------------------------------------------------------------------------
#
# Sur le poste de développement, l'antivirus intercepte le HTTPS et npm
# échoue dans le conteneur :
#
#     npm error code UNABLE_TO_VERIFY_LEAF_SIGNATURE
#     request to https://registry.npmjs.org/... failed
#
# On peut lui passer le certificat racine de l'antivirus — qui est une clé
# PUBLIQUE, pas un secret — par un montage BuildKit :
#
#     docker build --secret id=cacert,src=../docker/n8n/certificats/avast-root.crt \
#                  -t coachconnect-api .
#
# SANS CE SECRET, LE `if` EST FAUX ET RIEN NE CHANGE : sur le VPS, où aucun
# antivirus n'intercepte, la construction est celle de n'importe quelle image
# Node. Le Dockerfile reste donc portable, et le contournement ne vit que sur
# la machine qui en a besoin.
#
#   C'EST L'INVERSE DE CE QUI AVAIT ÉTÉ FAIT POUR n8n, où le certificat est
#   monté par un fichier de surcharge qu'il ne faut SURTOUT PAS copier sur le
#   VPS — il y désignerait un certificat inexistant et ferait échouer tous les
#   appels sortants, en silence. Ici, l'absence du secret est le cas normal.
RUN --mount=type=secret,id=cacert,target=/tmp/ca-locale.crt \
    sh -eu -c 'if [ -s /tmp/ca-locale.crt ]; then npm config set cafile /tmp/ca-locale.crt; fi; npm ci --omit=dev; npm cache clean --force'

# ---------------------------------------------------------------------------
#  2 — L'IMAGE QUI TOURNE
# ---------------------------------------------------------------------------
FROM node:24.22.2-alpine AS production

# ---------------------------------------------------------------------------
#  AUCUN `apk add`, ET C'EST DÉLIBÉRÉ
# ---------------------------------------------------------------------------
#
# Premier jet : `apk add --no-cache dumb-init`, pour que Node reçoive bien
# SIGTERM en tant que processus 1. La construction a échoué ici :
#
#     WARNING: fetching https://dl-cdn.alpinelinux.org/... :
#              TLS: server certificate not trusted
#
# C'est l'antivirus du poste qui intercepte le HTTPS — la panne qui a coûté
# deux jours sur n8n. Le Dockerfile n'était pas en cause.
#
# MAIS L'ÉCHEC A MENÉ À UNE MEILLEURE IMAGE, et pour deux raisons :
#
#   1. `dumb-init` était INUTILE. Le problème du processus 1 ne concerne que
#      les signaux SANS gestionnaire. Or `src/server.js:176-177` enregistre
#      déjà `SIGTERM` et `SIGINT` vers un arrêt propre — le commentaire dit
#      même « hebergeur », il a été écrit pour ce cas. Et pour la moisson des
#      processus orphelins, `init: true` dans la composition fournit l'init de
#      Docker, sans rien installer.
#
#   2. Sans paquet à télécharger, LA CONSTRUCTION MARCHE SUR CE POSTE — donc
#      l'image peut être ÉPROUVÉE ici, au lieu d'être livrée sur la foi d'un
#      « ça devrait passer sur le VPS ».
#
#   UNE IMAGE QU'ON NE PEUT PAS CONSTRUIRE CHEZ SOI EST UNE IMAGE QU'ON LIVRE
#   SANS L'AVOIR VUE TOURNER.

ENV NODE_ENV=production
WORKDIR /app

COPY --from=dependances /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src
COPY scripts ./scripts

# ---------------------------------------------------------------------------
#  3 — ON NE TOURNE PAS EN ROOT
# ---------------------------------------------------------------------------
#
# L'image `node` fournit déjà un utilisateur `node` non privilégié. S'en
# servir coûte une ligne, et limite ce qu'une faille d'exécution pourrait
# atteindre.
#
# ⚠️ `chown` AVANT de changer d'utilisateur : après, le processus n'aurait
# plus le droit de le faire.
RUN chown -R node:node /app
USER node

EXPOSE 5000

# ---------------------------------------------------------------------------
#  4 — LA SONDE DE SANTÉ
# ---------------------------------------------------------------------------
#
# Elle interroge la route que l'application expose déjà. Son intérêt n'est pas
# cosmétique : Docker peut relancer un conteneur dont le processus vit encore
# mais qui ne répond plus — le cas d'une boucle d'événements bloquée, que le
# simple « le processus existe » ne voit pas.
#
# `start-period` laisse le temps à la connexion Mongo de s'établir : sans lui,
# le conteneur serait déclaré malade pendant son démarrage normal.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Pas d'ENTRYPOINT : `init: true` dans la composition confie à Docker la
# place du processus 1, et le serveur gère ses propres signaux.
CMD ["node", "src/server.js"]
