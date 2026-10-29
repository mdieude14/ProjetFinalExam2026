# ===========================================================================
#  FERMER LE DEVELOPPEMENT AU RESEAU LOCAL - ET POUVOIR REVENIR EN ARRIERE
# ===========================================================================
#
#   Clic droit sur PowerShell -> Executer en tant qu administrateur, puis :
#   powershell -ExecutionPolicy Bypass -File scripts\pare-feu-fermer-le-dev.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\pare-feu-fermer-le-dev.ps1 -Retirer
#
# ---------------------------------------------------------------------------
# POURQUOI CE SCRIPT EXISTE, ET CE QU IL CORRIGE
# ---------------------------------------------------------------------------
#
# `epreuve-pare-feu.ps1` DEMONTRE un mecanisme, il ne le corrige pas. Il
# reclasse le Wi-Fi en Public pendant 90 secondes pour prouver que c est bien
# la regle "Private" qui donne l acces. Mesure faite le 29 octobre 2026, l etat
# NORMAL de ce poste est le suivant :
#
#   regle entrante "Node.js JavaScript Runtime"
#     programme : C:\Program Files\nodejs\node.exe
#     ports     : TOUS
#     profil    : Private
#   reseau Wi-Fi SFN_xxxx : categorie Private
#   back-end  : tourne sur ce binaire exactement
#
# DONC L API DE DEVELOPPEMENT EST JOIGNABLE DEPUIS TOUT LE RESEAU LOCAL.
# Mesure depuis un espace reseau distinct (un conteneur Docker, qui traverse
# reellement le filtre de l hote) :
#
#   http://192.168.1.21:5000/api/health   REPONSE 200    <-- l API
#   http://192.168.1.21:5173/             ECONNREFUSED   <-- Vite, sain
#   http://192.168.1.21:5678/healthz      REPONSE 200    <-- n8n, editeur compris
#
# Vite est sain SANS pare-feu, parce qu il n ecoute que sur ::1. L API et n8n,
# eux, ecoutent sur toutes les interfaces : leur seule protection etait la
# regle du pare-feu, et cette regle les AUTORISE.
#
# ---------------------------------------------------------------------------
# POURQUOI UNE REGLE DE BLOCAGE CIBLEE, ET NON UNE LIAISON SUR 127.0.0.1
# ---------------------------------------------------------------------------
#
# La correction la plus evidente serait de lier l API a localhost. ELLE
# CASSERAIT TOUTE LA CHAINE DE SUPPORT : les flux n8n appellent l API par
# `host.docker.internal:5000`, qui resout vers 192.168.65.254 - une passerelle
# interne a Docker, et non 127.0.0.1. Mesure du 29 octobre 2026.
#
#   depuis le conteneur : host.docker.internal -> 192.168.65.254   REPONSE 200
#   adresse Wi-Fi du poste                     -> 192.168.1.21
#
# Les deux chemins sont DISTINCTS, donc separables. On bloque le sous-reseau du
# Wi-Fi et on laisse celui de Docker intact. Aucune ligne de code a changer,
# aucun risque pour l agent de support, et le retour en arriere est une
# commande.
#
# ---------------------------------------------------------------------------
# CE QUE CETTE REGLE NE FAIT PAS
# ---------------------------------------------------------------------------
#
# Elle ne remplace pas la discipline du tunnel. Le tunnel expose n8n a
# INTERNET ; cette regle ferme le RESEAU LOCAL. Ce sont deux surfaces
# differentes, et fermer l une ne ferme pas l autre.
#
# Elle ne protege pas non plus d un appareil deja sur le Wi-Fi qui changerait
# de sous-reseau. Elle vise 192.168.1.0/24 parce que c est le reseau constate ;
# si la box change de plan d adressage, il faudra la refaire.
#
# TOUT EST EN ASCII, DELIBEREMENT. Windows PowerShell 5.1 lit un fichier sans
# BOM avec la page de codes ANSI : un tiret cadratin UTF-8 y devient trois
# caracteres dont 0x94, un guillemet courbe que l analyseur prend pour un
# delimiteur de chaine. Constate le 21 octobre 2026.
# ===========================================================================

param([switch]$Retirer)

$NOM = "CoachConnect - bloquer le dev depuis le reseau local"
$SOUS_RESEAU = "192.168.1.0/24"
$PORTS = @(5000, 5173, 5678)

function Noter($t) { Write-Output $t }

# --- L elevation d abord : sans elle, rien de ce qui suit ne marche --------
$identite = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $identite.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Noter "ECHEC : cette fenetre n est pas en administrateur. Rien n a ete change."
  Noter ""
  Noter "  Clic droit sur PowerShell -> Executer en tant qu administrateur, puis"
  Noter "  relancer la meme commande."
  exit 1
}

# --- Retrait ---------------------------------------------------------------
if ($Retirer) {
  $existante = Get-NetFirewallRule -DisplayName $NOM -ErrorAction SilentlyContinue
  if (-not $existante) {
    Noter "Aucune regle a retirer : elle n existe pas."
    exit 0
  }
  Remove-NetFirewallRule -DisplayName $NOM -Confirm:$false
  Noter "Regle retiree. Le developpement redevient joignable depuis le reseau local."
  exit 0
}

# --- Pose ------------------------------------------------------------------
$existante = Get-NetFirewallRule -DisplayName $NOM -ErrorAction SilentlyContinue
if ($existante) {
  Noter "La regle existe deja. Rien a faire."
  Noter "  Pour la retirer : powershell -ExecutionPolicy Bypass -File scripts\pare-feu-fermer-le-dev.ps1 -Retirer"
  exit 0
}

try {
  New-NetFirewallRule -DisplayName $NOM `
    -Direction Inbound -Action Block -Protocol TCP `
    -LocalPort $PORTS -RemoteAddress $SOUS_RESEAU `
    -Profile Any -Enabled True -ErrorAction Stop | Out-Null
} catch {
  Noter ("ECHEC de la creation : " + $_.Exception.Message)
  exit 1
}

Noter "Regle posee."
Noter ("  ports   : " + ($PORTS -join ", "))
Noter ("  source  : " + $SOUS_RESEAU + "  (le Wi-Fi ; Docker en 192.168.65.0/24 n est pas touche)")
Noter ""
Noter "A VERIFIER MAINTENANT, et dans cet ordre :"
Noter ""
Noter "  1  Depuis le telephone, sur le meme Wi-Fi :"
Noter "       http://192.168.1.21:5000/api/health    ATTENDU : echec de connexion"
Noter "       http://192.168.1.21:5678/healthz       ATTENDU : echec de connexion"
Noter ""
Noter "  2  Le widget de support doit continuer a fonctionner. Si la reponse de"
Noter "     l agent n arrive plus, c est que le chemin de Docker a ete touche :"
Noter "     retirer la regle immediatement, et le dire."
Noter ""
Noter "       cd server; node scripts/bout-en-bout-agent.mjs      ATTENDU : 25/25"
Noter ""
Noter "  Pour revenir en arriere :"
Noter "    powershell -ExecutionPolicy Bypass -File scripts\pare-feu-fermer-le-dev.ps1 -Retirer"
