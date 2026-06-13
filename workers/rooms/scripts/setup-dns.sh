#!/usr/bin/env bash
# One-time DNS setup for the production hostname:
#
#   CLOUDFLARE_API_TOKEN=<token> bash workers/rooms/scripts/setup-dns.sh
#
# Creates the proxied CNAME retro-recall.ruralrooted.com → retro-recall.pages.dev,
# then polls until the Pages custom domain (already attached to the project)
# finishes validating. The Worker routes for /api/* and /room/* are already
# deployed and start receiving traffic as soon as this record exists.
#
# NOTE: wrangler's OAuth token CANNOT write DNS records (its OAuth flow has no
# dns_records scope — verified against `wrangler login --scopes-list`). You
# need a scoped API token: dash.cloudflare.com → My Profile → API Tokens →
# Create Token → "Edit zone DNS" template, scoped to ruralrooted.com only.
# Alternatively, skip this script and add the record in the dashboard:
#   DNS → ruralrooted.com → Add record: CNAME  retro-recall → retro-recall.pages.dev  (proxied)
set -euo pipefail

ACCOUNT_ID="ab519005d2ca337fe5ff1957a98a117a"
ZONE_NAME="ruralrooted.com"
HOSTNAME="retro-recall"
TARGET="retro-recall.pages.dev"
PROJECT="retro-recall"

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "CLOUDFLARE_API_TOKEN is not set." >&2
  echo "Create a token with 'Edit zone DNS' for $ZONE_NAME (see header comment), then:" >&2
  echo "  CLOUDFLARE_API_TOKEN=<token> bash $0" >&2
  exit 1
fi

api() { curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" "$@"; }

ZONE_ID=$(api "https://api.cloudflare.com/client/v4/zones?name=$ZONE_NAME" \
  | python3 -c "import json,sys; r=json.load(sys.stdin)['result']; print(r[0]['id'] if r else '')")
if [ -z "$ZONE_ID" ]; then
  echo "Could not read zone $ZONE_NAME with this token — does it include Zone:Read + DNS:Edit for that zone?" >&2
  exit 1
fi

echo "Creating proxied CNAME $HOSTNAME.$ZONE_NAME → $TARGET …"
RESULT=$(api -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  --data "{\"type\":\"CNAME\",\"name\":\"$HOSTNAME\",\"content\":\"$TARGET\",\"proxied\":true,\"comment\":\"Retro Recall — Pages site + rooms Worker routes (see workers/rooms)\"}")
OK=$(printf '%s' "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print('yes' if d['success'] or any(e.get('code')==81057 for e in d['errors']) else d['errors'])")
if [ "$OK" != "yes" ]; then
  echo "DNS record creation failed: $OK" >&2
  exit 1
fi
echo "record in place (81057 = already existed, which is fine)"

echo "Waiting for the Pages custom domain to validate …"
for _ in $(seq 1 30); do
  STATUS=$(api "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/pages/projects/$PROJECT/domains" \
    | python3 -c "import json,sys; r=json.load(sys.stdin).get('result') or []; print(r[0]['status'] if r else 'unknown (token lacks pages:read — check the dashboard)')")
  echo "  status: $STATUS"
  [ "$STATUS" = "active" ] && break
  case "$STATUS" in unknown*) break;; esac
  sleep 10
done

echo "Done. Try: https://$HOSTNAME.$ZONE_NAME/play/bubble-buddies"
