#!/usr/bin/env bash
# Active les pochettes Spotify dans Onde : enregistre vos identifiants développeur
# Spotify sur le Raspberry Pi (jamais dans l'app ni sur GitHub) et met le relais à jour.
#
#   bash relay/configurer-spotify.sh
#
# Avant de le lancer (gratuit, 3 minutes) :
#   1. https://developer.spotify.com/dashboard → connectez-vous avec votre compte Spotify.
#   2. « Create app » : nom « Onde », Redirect URI « https://gautierbastien-cmyk.github.io/onde/ »,
#      API utilisée : « Web API ». Enregistrez.
#   3. Dans « Settings » de l'app : copiez le Client ID, puis « View client secret ».
set -euo pipefail

PI="bastien@192.168.1.18"
cd "$(dirname "$0")"

read -r -p "Client ID Spotify : " CID
read -r -s -p "Client secret Spotify (masqué) : " SECRET
echo
[ -n "$CID" ] && [ -n "$SECRET" ] || { echo "Identifiants manquants."; exit 1; }

echo "→ Mise à jour du relais et enregistrement des identifiants sur le Pi"
scp -q onde-relais.py "$PI:onde-relais/onde-relais.py"
printf 'SPOTIFY_CLIENT_ID=%s\nSPOTIFY_CLIENT_SECRET=%s\n' "$CID" "$SECRET" |
  ssh "$PI" 'umask 077; cat > ~/onde-relais/spotify.env'
ssh "$PI" 'systemctl --user restart onde-relais && sleep 1'

echo "→ Test"
RESULT=$(ssh "$PI" 'curl -s -m 15 "192.168.1.18:8495/cover?artist=Daft%20Punk&title=One%20More%20Time"')
if echo "$RESULT" | grep -q '"image"'; then
  echo "✅ Pochettes Spotify actives. Elles apparaîtront dans Onde pour les prochains morceaux."
else
  echo "⚠️  Spotify n'a pas répondu comme prévu : $RESULT"
fi
