#!/usr/bin/env bash
#
# Installe ce qu'il faut sur un VPS Hostinger Ubuntu 24.04 NU pour faire
# tourner la composition CoachConnect : Caddy, n8n et l'API.
#
#   bash installer-vps.sh --verifier   ne change RIEN, diagnostique seulement
#   bash installer-vps.sh              installe Docker puis clone le depot
#
# Il NE demarre PAS la composition : cela demande les secrets et un DNS qui
# resout deja, faute de quoi Caddy boucle en erreur et peut atteindre la
# limite de Let's Encrypt.

set -euo pipefail

DEPOT="https://github.com/mdieude14/ProjetFinalExam2026.git"
CIBLE="/opt/coachconnect"
VERIFIER_SEULEMENT=0
[ "${1:-}" = "--verifier" ] && VERIFIER_SEULEMENT=1

bleu()  { printf '\033[1;34m%s\033[0m\n' "$*"; }
vert()  { printf '  \033[32mOK\033[0m    %s\n' "$*"; }
jaune() { printf '  \033[33mNOTE\033[0m  %s\n' "$*"; }
rouge() { printf '  \033[31mSTOP\033[0m  %s\n' "$*"; }

ANOMALIES=0

bleu ""
bleu "=== 1. LE SYSTEME EST-IL CELUI QU'ON ATTEND ? ==="

if [ -r /etc/os-release ]; then
  . /etc/os-release
  printf '  systeme : %s\n' "${PRETTY_NAME:-inconnu}"
  case "${VERSION_ID:-}" in
    24.04) vert "Ubuntu 24.04, c'est la cible" ;;
    22.04) jaune "Ubuntu 22.04 : la composition marche aussi, rien a changer" ;;
    *)     jaune "version ${VERSION_ID:-inconnue} : non testee, mais Docker suffit" ;;
  esac
else
  rouge "/etc/os-release illisible"; ANOMALIES=$((ANOMALIES+1))
fi
printf '  machine : %s, %s processeur(s), %s de memoire\n' \
  "$(uname -m)" "$(nproc 2>/dev/null || echo '?')" \
  "$(free -h 2>/dev/null | awk '/^Mem:/{print $2}' || echo '?')"

bleu ""
bleu "=== 2. LE MODELE « with n8n » EST-IL PRESENT ? (le point qui compte) ==="

# Un modele pre-installe se trahit de trois facons. On teste les trois.
TRACES=0

if command -v docker >/dev/null 2>&1; then
  CONTENEURS=$(docker ps -a --format '{{.Names}} {{.Image}}' 2>/dev/null || true)
  if [ -n "$CONTENEURS" ]; then
    jaune "des conteneurs existent deja :"
    printf '%s\n' "$CONTENEURS" | sed 's/^/          /'
    if printf '%s' "$CONTENEURS" | grep -qiE 'n8n|traefik|nginx-proxy|caddy'; then
      rouge "n8n ou un relais inverse est DEJA installe : c'est le modele a eviter"
      TRACES=$((TRACES+1))
    fi
  else
    vert "aucun conteneur : serveur vierge"
  fi
else
  vert "Docker pas installe : serveur vierge, donc pas le modele n8n"
fi

# Les ports 80 et 443 doivent etre LIBRES, c'est le vrai critere.
#
# ET ON NE PEUT PAS CONCLURE « LIBRE » SANS AVOIR MESURE. Un outil absent
# rend une liste vide, donc tous les ports paraissent libres : un faux vert.
# D'ou l'ancrage de l'absence sur une presence : l'outil doit exister ET voir
# au moins un port a l'ecoute, sans quoi la mesure est declaree muette.
OUTIL=""
ECOUTES=""
if command -v ss >/dev/null 2>&1; then
  OUTIL="ss"
  ECOUTES=$(ss -lntnH 2>/dev/null | awk '{print $4}' || true)
elif command -v netstat >/dev/null 2>&1; then
  OUTIL="netstat"
  ECOUTES=$(netstat -lntn 2>/dev/null | awk '/^tcp/ {print $4}' || true)
fi

NB_ECOUTES=$(printf '%s' "$ECOUTES" | grep -c . || true)

if [ -z "$OUTIL" ]; then
  rouge "ni ss ni netstat : IMPOSSIBLE de verifier les ports 80 et 443"
  jaune "      « apt-get install -y iproute2 », puis relancer"
  TRACES=$((TRACES+1))
elif [ "${NB_ECOUTES:-0}" -eq 0 ]; then
  rouge "$OUTIL ne voit AUCUN port a l'ecoute, pas meme SSH : mesure non credible"
  jaune "      un serveur joignable en SSH ecoute forcement quelque part"
  TRACES=$((TRACES+1))
else
  vert "$OUTIL voit $NB_ECOUTES port(s) a l'ecoute : la mesure est credible"
  for PORT in 80 443; do
    if printf '%s\n' "$ECOUTES" | grep -qE "[:.]${PORT}\$"; then
      QUI=""
      if [ "$OUTIL" = "ss" ]; then
        QUI=$(ss -lntnpH 2>/dev/null | awk -v p="[:.]${PORT}\$" '$4 ~ p {print $NF}' | head -1 || true)
      fi
      rouge "le port $PORT est DEJA OCCUPE ${QUI:+par $QUI} : Caddy ne demarrera pas"
      TRACES=$((TRACES+1))
    else
      vert "port $PORT libre, et mesure pour de bon"
    fi
  done
fi

for UNITE in nginx apache2 caddy traefik; do
  if systemctl is-active --quiet "$UNITE" 2>/dev/null; then
    rouge "le service $UNITE tourne et prendra les ports : « systemctl disable --now $UNITE »"
    TRACES=$((TRACES+1))
  fi
done

if [ "$TRACES" -eq 0 ]; then
  bleu ""
  vert "VERDICT : Ubuntu NU, rien a reinstaller, on peut continuer"
else
  bleu ""
  rouge "VERDICT : $TRACES trace(s) d'une installation prealable, a traiter avant Caddy"
  ANOMALIES=$((ANOMALIES+ TRACES))
fi

bleu ""
bleu "=== 3. LE RESEAU SORTANT ==="
for HOTE in github.com download.docker.com; do
  if curl -fsS --max-time 10 -o /dev/null "https://$HOTE" 2>/dev/null; then
    vert "$HOTE joignable"
  else
    rouge "$HOTE INJOIGNABLE : ni le clone ni Docker ne marcheront"
    ANOMALIES=$((ANOMALIES+1))
  fi
done

if [ "$VERIFIER_SEULEMENT" -eq 1 ]; then
  bleu ""
  bleu "=== MODE VERIFICATION : rien n'a ete modifie ==="
  printf '  anomalies : %s\n' "$ANOMALIES"
  exit 0
fi

if [ "$ANOMALIES" -gt 0 ]; then
  bleu ""
  rouge "$ANOMALIES anomalie(s) : installation interrompue, rien n'a ete modifie."
  rouge "Corrige d'abord, ou relance avec --verifier pour revoir le detail."
  exit 1
fi

bleu ""
bleu "=== 4. DOCKER ==="

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  vert "Docker et le greffon compose sont deja la : $(docker --version)"
else
  bleu "  installation depuis le depot officiel Docker..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg >/dev/null

  install -m 0755 -d /etc/apt/keyrings
  if [ ! -s /etc/apt/keyrings/docker.asc ]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
      -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
  fi

  CODENOM=$(. /etc/os-release && echo "${VERSION_CODENAME}")
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${CODENOM} stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin >/dev/null

  systemctl enable --now docker >/dev/null 2>&1 || true
  vert "installe : $(docker --version)"
fi
vert "compose : $(docker compose version --short 2>/dev/null || echo '?')"

bleu ""
bleu "=== 5. LE DEPOT ==="

# Le depot est PUBLIC : le clone ne demande aucun jeton.
if [ -d "$CIBLE/.git" ]; then
  vert "deja clone dans $CIBLE"
  git -C "$CIBLE" remote set-url origin "$DEPOT"
  git -C "$CIBLE" fetch --quiet origin main
  git -C "$CIBLE" reset --hard --quiet origin/main
  vert "mis a jour sur $(git -C "$CIBLE" rev-parse --short HEAD)"
else
  apt-get install -y -qq git >/dev/null 2>&1 || true
  git clone --quiet --depth 1 "$DEPOT" "$CIBLE"
  vert "clone dans $CIBLE sur $(git -C "$CIBLE" rev-parse --short HEAD)"
fi

cd "$CIBLE/docker/n8n/hostinger"
for F in docker-compose.yml Caddyfile .env.example api.env.example; do
  [ -f "$F" ] && vert "present : $F" || { rouge "MANQUE : $F"; exit 1; }
done

bleu ""
bleu "=== 6. CE QUI RESTE, ET QUI NE PEUT PAS ETRE AUTOMATISE ICI ==="
cat <<'SUITE'
  Il manque deux choses, et aucune ne peut etre devinee par ce script :

    a) LES SECRETS. Copier les deux modeles puis les remplir :
         cd /opt/coachconnect/docker/n8n/hostinger
         cp .env.example .env  &&  cp api.env.example api.env
         chmod 600 .env api.env

    b) LE DNS. Les deux sous-domaines doivent DEJA resoudre vers ce serveur,
       sinon Caddy boucle et Let's Encrypt bloque le domaine des heures :
         dig +short api.<domaine>
         dig +short n8n.<domaine>

  Ensuite, et seulement ensuite :
         docker compose up -d
         docker compose ps
SUITE
bleu ""
vert "Installation terminee. Rien n'a ete demarre, c'est voulu."
