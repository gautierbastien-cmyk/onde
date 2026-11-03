#!/usr/bin/env bash
# Installe le relais Onde sur le Raspberry Pi et l'expose en HTTPS derrière Caddy,
# sous une adresse secrète. À lancer depuis le Mac, dans le dossier du projet :
#
#   bash relay/installer-sur-pi.sh
#
# Ce que fait le script :
#   1. copie relay/onde-relais.py dans ~/onde-relais/ sur le Pi ;
#   2. crée un service systemd utilisateur (démarrage automatique, redémarrage en cas d'arrêt),
#      à l'écoute uniquement sur le réseau local (192.168.1.18:8495) ;
#   3. ajoute à ~/frenchio/Caddyfile une route /onde/<secret>/ (sauvegarde préalable),
#      puis recharge Caddy ;
#   4. vérifie l'accès public et affiche l'adresse à coller dans Onde → Réglages → Relais.
set -euo pipefail

PI="bastien@192.168.1.18"
LAN_IP="192.168.1.18"
PORT=8495
DOMAIN="bastien-mediaflow.duckdns.org"
ORIGIN="https://gautierbastien-cmyk.github.io"
cd "$(dirname "$0")"

echo "→ Copie du relais sur le Pi"
ssh "$PI" 'mkdir -p ~/onde-relais ~/.config/systemd/user'
scp -q onde-relais.py "$PI:onde-relais/onde-relais.py"

echo "→ Service systemd"
ssh "$PI" "cat > ~/.config/systemd/user/onde-relais.service" <<EOF
[Unit]
Description=Relais Onde (Shazam, titres, flux HTTP)
After=network-online.target

[Service]
ExecStart=/usr/bin/python3 %h/onde-relais/onde-relais.py $PORT $ORIGIN $LAN_IP
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
ssh "$PI" "loginctl enable-linger \$USER >/dev/null 2>&1 || sudo loginctl enable-linger \$USER; systemctl --user daemon-reload && systemctl --user enable --now onde-relais && sleep 1 && curl -sf $LAN_IP:$PORT/health >/dev/null && echo '  relais actif sur le réseau local'"

echo "→ Route Caddy"
SECRET=$(ssh "$PI" 'f=~/onde-relais/.secret; [ -s $f ] || head -c 18 /dev/urandom | od -An -tx1 | tr -d " \n" > $f; cat $f')
ssh "$PI" "grep -q '/onde/' ~/frenchio/Caddyfile" && echo "  route déjà présente" || {
  ssh "$PI" "cp ~/frenchio/Caddyfile ~/frenchio/Caddyfile.avant-onde.\$(date +%Y%m%d-%H%M%S)"
  ssh "$PI" "python3 - ~/frenchio/Caddyfile '$SECRET' '$LAN_IP:$PORT'" <<'PY'
import sys
path, secret, upstream = sys.argv[1:4]
s = open(path).read()
marker = "\t# AIOStreams (serveur Jellyfin pour Odin), tout le reste du domaine"
block = (f"\t# Relais Onde (Shazam, titres des radios, flux HTTP) — adresse secrète\n"
         f"\thandle_path /onde/{secret}/* {{\n\t\treverse_proxy {upstream} {{\n\t\t\tflush_interval -1\n\t\t}}\n\t}}\n")
assert marker in s, "repère introuvable dans le Caddyfile"
open(path, "w").write(s.replace(marker, block + marker, 1))
PY
  ssh "$PI" 'docker exec caddy-reverse-proxy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || docker restart caddy-reverse-proxy >/dev/null'
}

URL="https://$DOMAIN/onde/$SECRET"
sleep 2
if curl -sf "$URL/health" >/dev/null; then
  echo
  echo "✅ Relais en ligne. Dans Onde → Réglages → Relais personnel, collez :"
  echo
  echo "   $URL"
  echo
else
  echo "⚠️  Le relais ne répond pas encore à $URL/health — vérifiez Caddy (docker logs caddy-reverse-proxy)."
fi
