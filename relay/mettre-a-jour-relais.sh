#!/usr/bin/env bash
# Met à jour le relais Onde sur le Raspberry Pi (nouvelle version de onde-relais.py) et le redémarre.
#
#   bash relay/mettre-a-jour-relais.sh
set -euo pipefail
cd "$(dirname "$0")"
PI="bastien@192.168.1.18"
scp -q onde-relais.py "$PI:onde-relais/onde-relais.py"
ssh "$PI" 'systemctl --user restart onde-relais && sleep 1 && curl -sf 192.168.1.18:8495/history?since=9999999999999 >/dev/null' \
  && echo "✅ Relais mis à jour (historique partagé actif)." || echo "⚠️  Le relais ne répond pas après la mise à jour."
