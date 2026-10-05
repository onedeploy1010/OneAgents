#!/usr/bin/env bash
# 把 identity_bindings(provider=telegram) 里的 provider_user_id 回填到
# users.telegram_chat_id (仅限当前为 NULL 的 user)。
# Coach send_encouragement 旧代码只查 users.telegram_chat_id,所以不回填它就发不出。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEV_VARS="$SCRIPT_DIR/../../cloudflare/worker/.dev.vars"
set -a; source "$DEV_VARS"; set +a

REST="${SUPABASE_URL%/}/rest/v1"
H_API="apikey: $SUPABASE_SERVICE_ROLE_KEY"
H_AUTH="Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"

echo "拉所有 telegram identity bindings"
BINDINGS=$(curl -fsS -H "$H_API" -H "$H_AUTH" \
  "$REST/identity_bindings?provider=eq.telegram&select=user_id,provider_user_id")
COUNT=$(echo "$BINDINGS" | jq 'length')
echo "  共 $COUNT 条"

PATCHED=0
SKIPPED=0
echo ""
echo "$BINDINGS" | jq -c '.[]' | while IFS= read -r row; do
  USERID=$(echo "$row" | jq -r '.user_id')
  TID=$(echo "$row" | jq -r '.provider_user_id')
  USR=$(curl -fsS -H "$H_API" -H "$H_AUTH" \
    "$REST/users?id=eq.$USERID&select=email,telegram_chat_id" | jq -r '.[0]')
  CUR=$(echo "$USR" | jq -r '.telegram_chat_id // empty')
  EMAIL=$(echo "$USR" | jq -r '.email')
  if [ -z "$CUR" ]; then
    BODY=$(jq -nc --arg t "$TID" '{telegram_chat_id: $t}')
    curl -fsS -X PATCH -H "$H_API" -H "$H_AUTH" \
      -H "Content-Type: application/json" \
      -d "$BODY" "$REST/users?id=eq.$USERID" -o /dev/null
    echo "  backfilled $EMAIL <- $TID"
    PATCHED=$((PATCHED+1))
  else
    echo "  skip $EMAIL already set"
    SKIPPED=$((SKIPPED+1))
  fi
done

echo ""
echo "=== Mikkie now ==="
curl -fsS -H "$H_API" -H "$H_AUTH" \
  "$REST/users?email=eq.mikkizoon@gmail.com&select=email,display_name,telegram_chat_id" | jq
