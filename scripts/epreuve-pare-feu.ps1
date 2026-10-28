# ===========================================================================
#  EPROUVER LA REGLE "Private" DU PARE-FEU - EN UNE SEULE MANOEUVRE
# ===========================================================================
#
#   Clic droit sur PowerShell -> Executer en tant qu administrateur, puis :
#   powershell -ExecutionPolicy Bypass -File epreuve-pare-feu.ps1
#
# CE QU IL FAIT, DANS L ORDRE :
#   1  classe le Wi-Fi en Public
#   2  laisse 90 secondes pour tenter la connexion DEPUIS UN TELEPHONE
#   3  remet le classement initial TOUT SEUL, quoi qu il arrive
#
# POURQUOI LE RETOUR EST AUTOMATIQUE, ET NON UNE SECONDE COMMANDE.
# Laisser le reseau domestique classe Public couperait l acces au serveur de
# developpement depuis le telephone, et ce n est pas l etat voulu. Un oubli est
# trop facile : le retour est donc place dans un bloc finally, qui s execute
# meme sur interruption ou sur erreur.
#
# POURQUOI LE TEST DOIT VENIR D UN AUTRE APPAREIL.
# Windows ne fait pas traverser le filtre entrant au trafic local-vers-local de
# facon fiable : une tentative depuis cette machine ne prouverait rien, ni dans
# un sens ni dans l autre. Seul un appareil tiers sur le meme Wi-Fi traverse
# reellement la regle.
#
# TOUT EST EN ASCII, DELIBEREMENT. Windows PowerShell 5.1 lit un fichier sans
# BOM avec la page de codes ANSI : un tiret cadratin UTF-8 (E2 80 94) y devient
# trois caracteres dont 0x94, un guillemet courbe fermant que l analyseur prend
# pour un delimiteur de chaine. Le script precedent echouait ainsi sur une ligne
# qui paraissait correcte. Constate le 21 octobre 2026.
# ===========================================================================

$journal = Join-Path $PSScriptRoot "pare-feu-epreuve.txt"
$lignes = @()

function Noter($t) {
  $script:lignes += $t
  Write-Output $t
  $script:lignes | Set-Content -Path $journal -Encoding UTF8
}

$alias = $null
$initial = $null

try {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Noter "ECHEC : cette fenetre n est pas en administrateur. Rien n a ete change."
    Noter "  Clic droit sur PowerShell -> Executer en tant qu administrateur."
    exit 1
  }

  $profil = Get-NetConnectionProfile | Where-Object { $_.InterfaceAlias -like "*Wi-Fi*" } | Select-Object -First 1
  if (-not $profil) {
    Noter "ECHEC : aucun profil Wi-Fi trouve."
    exit 1
  }

  $alias = $profil.InterfaceAlias
  $initial = $profil.NetworkCategory
  $ip = Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.InterfaceAlias -eq $alias } |
        Select-Object -First 1 -ExpandProperty IPAddress

  Noter "=== ETAT DE DEPART ==="
  Noter ("  interface  : " + $alias)
  Noter ("  classement : " + $initial)
  Noter ("  adresse    : " + $ip)
  foreach ($r in (Get-NetFirewallRule -Direction Inbound -ErrorAction SilentlyContinue |
                  Where-Object { $_.DisplayName -like "*Node.js*" })) {
    Noter ("  regle      : Profile=" + $r.Profile + " Action=" + $r.Action + " Enabled=" + $r.Enabled)
  }
  Noter ""

  if ($initial -ne "Private") {
    Noter ("ATTENTION : le reseau n etait pas en Private mais en " + $initial + ".")
    Noter "Il sera remis dans cet etat initial a la fin, pas en Private."
    Noter ""
  }

  Noter "=== BASCULE EN PUBLIC ==="
  Set-NetConnectionProfile -InterfaceAlias $alias -NetworkCategory Public -ErrorAction Stop
  Start-Sleep -Seconds 3
  $apres = (Get-NetConnectionProfile -InterfaceAlias $alias).NetworkCategory
  Noter ("  classement : " + $apres)
  if ($apres -ne "Public") {
    Noter "  la bascule n a pas pris : l epreuve est sans valeur."
  }
  Noter ""
  Noter "=== MAINTENANT, SUR LE TELEPHONE, 90 SECONDES ==="
  Noter ("  Ouvre : http://" + $ip + ":5000/api/health")
  Noter "  ATTENDU : echec de connexion, ou attente qui expire."
  Noter "  SI LA PAGE REPOND : la regle ne protege pas. A creuser."
  Noter ""

  for ($s = 90; $s -gt 0; $s -= 15) {
    Write-Output ("  ... " + $s + " s restantes")
    Start-Sleep -Seconds 15
  }
}
catch {
  Noter ("ERREUR : " + $_.Exception.Message)
}
finally {
  # LE RETOUR EN ARRIERE, QUOI QU IL ARRIVE.
  if ($alias -and $initial) {
    try {
      Set-NetConnectionProfile -InterfaceAlias $alias -NetworkCategory $initial -ErrorAction Stop
      Start-Sleep -Seconds 2
      $final = (Get-NetConnectionProfile -InterfaceAlias $alias).NetworkCategory
      Noter ""
      Noter "=== RETOUR EN ARRIERE ==="
      Noter ("  classement retabli : " + $final)
      if ($final -ne $initial) {
        Noter "  ATTENTION : le retour n a pas pris. A corriger a la main :"
        Noter ("  Set-NetConnectionProfile -InterfaceAlias " + $alias + " -NetworkCategory " + $initial)
      }
    }
    catch {
      Noter ("ECHEC DU RETOUR : " + $_.Exception.Message)
      Noter ("  A corriger a la main : Set-NetConnectionProfile -InterfaceAlias " + $alias + " -NetworkCategory " + $initial)
    }
  }
  Noter ""
  Noter "TERMINE"
}
