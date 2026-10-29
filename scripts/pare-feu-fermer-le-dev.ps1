# ===========================================================================
#  FERMER LE DEVELOPPEMENT AU RESEAU - ET POUVOIR REVENIR EN ARRIERE
# ===========================================================================
#
#   Clic droit sur PowerShell -> Executer en tant qu administrateur, puis :
#   powershell -ExecutionPolicy Bypass -File scripts\pare-feu-fermer-le-dev.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\pare-feu-fermer-le-dev.ps1 -Retirer
#
# ---------------------------------------------------------------------------
# CE QUI EST ETABLI, ET CE QUI NE L EST PAS
# ---------------------------------------------------------------------------
#
# ETABLI, par les sockets d ecoute :
#
#   port 5000 (API)   ecoute sur ::    -> TOUTES les interfaces
#   port 5678 (n8n)   ecoute sur ::    -> TOUTES les interfaces
#   port 5173 (Vite)  ecoute sur ::1   -> localhost SEUL, sain par construction
#
# ETABLI, par les regles du pare-feu :
#
#   regle entrante "Node.js JavaScript Runtime"
#     programme : C:\Program Files\nodejs\node.exe
#     ports     : TOUS
#     profil    : Private
#
# Le back-end tourne sur ce binaire exactement. Sur un reseau classe Private,
# cette seule regle - posee un jour par l invite "Autoriser node.js" - suffit
# a ouvrir l API a tout le reseau, alors que les trois profils du pare-feu sont
# actifs avec DefaultInboundAction = Block.
#
# PAS ETABLI : qu un appareil tiers y arrive vraiment.
#
#   Une premiere version de ce script affirmait l avoir mesure depuis un
#   conteneur Docker, "qui traverse reellement le filtre de l hote". C ETAIT
#   FAUX. Le pare-feu Hyper-V, qui regit le trafic WSL, porte :
#
#     LoopbackEnabled : True
#
#   Le trafic d un conteneur vers l hote est donc traite comme du LOOPBACK et
#   ne traverse PAS le filtre de profil. La mesure ne disait rien de plus que
#   les sockets : que l hote ecoute sur cette adresse.
#
#   LECON : une mesure vaut ce que vaut le chemin qu elle emprunte. Croire
#   qu un conteneur est "un autre appareil" a produit une conclusion de
#   securite fausse, et rassurante dans le mauvais sens - car elle donnait
#   l impression d avoir deja tout compris.
#
# SEUL UN APPAREIL TIERS SUR LE MEME RESEAU TRANCHE. C est la verification
# demandee a la fin de ce script, et elle n est pas optionnelle.
#
# ---------------------------------------------------------------------------
# POURQUOI UNE REGLE DE BLOCAGE SANS SOUS-RESEAU
# ---------------------------------------------------------------------------
#
# Une premiere version ciblait 192.168.1.0/24, le reseau domestique. Elle
# serait INUTILE partout ailleurs : mesure le 29 octobre 2026, le poste etait
# sur 10.172.10.18/24, reseau "PEDA" classe Public. Un plan d adressage code
# en dur protege un seul lieu.
#
# Cette version bloque donc l entrant sur les trois ports, TOUS PROFILS, SANS
# restriction d adresse. Deux raisons pour que cela ne casse rien :
#
#   - le loopback (127.0.0.1) n est PAS filtre par le pare-feu Windows, donc
#     le travail en local et les suites de tests ne voient aucune difference ;
#   - le trafic WSL est exempte par LoopbackEnabled ci-dessus, donc les flux
#     n8n qui appellent l API par host.docker.internal:5000 passent toujours.
#
# LA SECONDE RAISON EST UNE DEDUCTION, PAS UNE MESURE. C est pourquoi la
# verification finale exige les DEUX sens : le telephone doit echouer, ET
# l agent de support doit continuer a repondre. Si l agent tombe, la deduction
# etait fausse : on retire la regle et on le dit.
#
# ---------------------------------------------------------------------------
# CE QUE CETTE REGLE NE FAIT PAS
# ---------------------------------------------------------------------------
#
# Elle ne remplace pas la discipline du tunnel. Le tunnel expose n8n a
# INTERNET ; cette regle ferme le RESEAU LOCAL. Deux surfaces differentes, et
# fermer l une ne ferme pas l autre.
#
# TOUT EST EN ASCII, DELIBEREMENT. Windows PowerShell 5.1 lit un fichier sans
# BOM avec la page de codes ANSI : un tiret cadratin UTF-8 y devient trois
# caracteres dont 0x94, un guillemet courbe que l analyseur prend pour un
# delimiteur de chaine. Constate le 21 octobre 2026.
# ===========================================================================

param([switch]$Retirer)

$NOM = "CoachConnect - bloquer le dev depuis le reseau"
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
  Noter "Regle retiree. Le developpement redevient joignable depuis le reseau."
  exit 0
}

# --- Etat avant, pour que la comparaison soit possible ---------------------
Noter "--- Etat avant la pose ---"
Get-NetConnectionProfile | ForEach-Object {
  Noter ("  reseau   : " + $_.Name + "  (" + $_.NetworkCategory + ")")
}
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.InterfaceAlias -eq 'Wi-Fi' -or $_.InterfaceAlias -eq 'Ethernet' } |
  ForEach-Object { Noter ("  adresse  : " + $_.IPAddress + "  sur " + $_.InterfaceAlias) }
Noter ""

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
    -LocalPort $PORTS `
    -Profile Any -Enabled True -ErrorAction Stop | Out-Null
} catch {
  Noter ("ECHEC de la creation : " + $_.Exception.Message)
  exit 1
}

Noter "Regle posee."
Noter ("  ports   : " + ($PORTS -join ", "))
Noter "  profils : tous"
Noter "  source  : toute adresse distante (le loopback n est pas filtre)"
Noter ""
Noter "A VERIFIER MAINTENANT, DANS LES DEUX SENS, et ce n est pas optionnel :"
Noter ""
Noter "  1  Depuis un telephone, sur le meme reseau que ce poste. Remplacer"
Noter "     l adresse par celle affichee plus haut :"
Noter "       http://<adresse>:5000/api/health    ATTENDU : echec de connexion"
Noter "       http://<adresse>:5678/healthz       ATTENDU : echec de connexion"
Noter ""
Noter "  2  L agent de support doit continuer a repondre. Si la reponse n arrive"
Noter "     plus, le trafic de Docker etait filtre lui aussi : retirer la regle"
Noter "     immediatement, et le dire."
Noter ""
Noter "       cd server; node scripts/bout-en-bout-agent.mjs      ATTENDU : 25/25"
Noter ""
Noter "  Pour revenir en arriere :"
Noter "    powershell -ExecutionPolicy Bypass -File scripts\pare-feu-fermer-le-dev.ps1 -Retirer"
