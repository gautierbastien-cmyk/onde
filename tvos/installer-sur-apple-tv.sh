#!/usr/bin/env bash
# Compile Onde pour Apple TV et l'installe sur « Salon ».
# À relancer tous les 7 jours : sans abonnement développeur Apple, la signature expire.
#
#   bash tvos/installer-sur-apple-tv.sh
set -euo pipefail
cd "$(dirname "$0")"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
DEVICE=00008110-000044460E3A401E   # Apple TV « Salon »

# Adresse secrète du relais (Shazam, pochettes Spotify), jamais versionnée
if [ ! -f OndeTV/Secrets.plist ]; then
  URL=$(ssh bastien@192.168.1.18 'printf "https://bastien-mediaflow.duckdns.org/onde/%s" "$(cat ~/onde-relais/.secret)"')
  plutil -create xml1 OndeTV/Secrets.plist && plutil -insert relayURL -string "$URL" OndeTV/Secrets.plist
fi

echo "→ Compilation"
xcodebuild -project OndeTV.xcodeproj -scheme OndeTV -configuration Release -destination "id=$DEVICE" \
  -derivedDataPath build -allowProvisioningUpdates -allowProvisioningDeviceRegistration build -quiet
echo "→ Installation sur l'Apple TV"
xcrun devicectl device install app --device "$DEVICE" build/Build/Products/Release-appletvos/OndeTV.app >/dev/null
xcrun devicectl device process launch --device "$DEVICE" com.gautierbastien.onde.tv >/dev/null
echo "✅ Onde est installée et lancée sur l'Apple TV (valable 7 jours)."
