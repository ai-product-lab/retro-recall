#!/usr/bin/env bash
# One-time DNS setup for the production hostname (run by a human — writing to
# the shared ruralrooted.com zone is deliberately not done by automation):
#
#   bash workers/rooms/scripts/setup-dns.sh
#
# Creates the proxied CNAME retro-recall.ruralrooted.com → retro-recall.pages.dev
# using your wrangler OAuth token, then polls until the Pages custom domain
# (already attached to the project) finishes validating. The Worker routes
# for /api/* and /room/* are already deployed and start receiving traffic as
# soon as this record exists.
set -euo pipefail

ACCOUNT_ID="ab519005d2ca337fe5ff1957a98a117a"
ZONE_NAME="ruralrooted.com"
HOSTNAME="retro-recall"
TARGET="retro-recall.pages.dev"
PROJECT="retro-recall"

TOKEN=$(python3 - <<'PY'
import glob, os, re
paths = glob.glob(os.path.expanduser('~/Library/Preferences/.wrangler/config/default.toml')) \
      + glob.glob(os.path.expanduser('~/.wrangler/config/default.toml'))
src = open(paths[0]).read()
print(re.search(r'oauth_token\s*=\s*"([^"]+)"', src).group(1))
PY
)

api() { curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" "$@"; }

ZONE_ID=$(api "https://api.cloudflare.com/client/v4/zones?name=$ZONE_NAME" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['result'][0]['id'])")

echo "Creating proxied CNAME $HOSTNAME.$ZONE_NAME → $TARGET …"
api -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  --data "{\"type\":\"CNAME\",\"name\":\"$HOSTNAME\",\"content\":\"$TARGET\",\"proxied\":true,\"comment\":\"Retro Recall — Pages site + rooms Worker routes (see workers/rooms)\"}" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('record created' if d['success'] else d['errors'])"

echo "Waiting for the Pages custom domain to validate …"
for _ in $(seq 1 30); do
  STATUS=$(api "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/pages/projects/$PROJECT/domains" \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['result'][0]['status'])")
  echo "  status: $STATUS"
  [ "$STATUS" = "active" ] && break
  sleep 10
done

echo "Done. Try: https://$HOSTNAME.$ZONE_NAME/play/bubble-buddies"
