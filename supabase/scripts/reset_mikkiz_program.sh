#!/usr/bin/env bash
# 把 Mikkiz 的培训重置回初始状态(为了重跑测试):
#   * onboarding_programs.start_date = 今天,end_date = 今天+14,summary 更新
#   * onboarding_tasks 全部归零(status=todo,清空 submission/grade/score/reviewer)
#   * onboarding_tasks.due_at 按新 start_date 重算
#   * mentor_conversations 删光(干净的对话历史)
#   * training_coach_actions + training_coach_reviews 删光(coach 状态重置)
#   * telegram_sessions 状态置 idle
#
# 完全幂等:可以反复跑。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEV_VARS="$SCRIPT_DIR/../../cloudflare/worker/.dev.vars"
set -a; source "$DEV_VARS"; set +a

REST="${SUPABASE_URL%/}/rest/v1"
H_API="apikey: $SUPABASE_SERVICE_ROLE_KEY"
H_AUTH="Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
H_JSON="Content-Type: application/json"
G() { curl -fsS -H "$H_API" -H "$H_AUTH" "$REST$1"; }
PATCH() { curl -fsS -X PATCH -H "$H_API" -H "$H_AUTH" -H "$H_JSON" -d "$1" "$REST$2" -o /dev/null; }
DEL() { curl -fsS -X DELETE -H "$H_API" -H "$H_AUTH" "$REST$1" -o /dev/null; }
POST() { curl -fsS -X POST -H "$H_API" -H "$H_AUTH" -H "$H_JSON" -H "Prefer: return=representation" -d "$1" "$REST$2"; }

EMAIL="mikkizoon@one23x.org"
TG_CHAT_ID="7198974667"

echo "→ 找 Mikkiz user + program"
USERID=$(G "/users?email=eq.$EMAIL&select=id" | jq -r '.[0].id // empty')
[ -n "$USERID" ] || { echo "❌ 用户不存在"; exit 1; }
PROG=$(G "/onboarding_programs?trainee_user_id=eq.$USERID&status=eq.active&select=id,template_id,start_date&order=created_at.desc&limit=1" | jq '.[0]')
PROGRAM_ID=$(echo "$PROG" | jq -r '.id // empty')
TPL_ID=$(echo "$PROG" | jq -r '.template_id // empty')
[ -n "$PROGRAM_ID" ] || { echo "❌ 没有 active program"; exit 1; }
echo "  user_id    = $USERID"
echo "  program_id = $PROGRAM_ID"

NEW_START=$(date -u +%Y-%m-%d)
NEW_END=$(date -u -j -f %Y-%m-%d -v+14d "$NEW_START" +%Y-%m-%d)

echo ""
echo "→ 重置 program (start=$NEW_START, end=$NEW_END)"
PATCH "$(jq -nc --arg s "$NEW_START" --arg e "$NEW_END" '{
  start_date: $s, end_date: $e, status: "active", is_paused: false,
  pause_reason: null, final_score: null, final_decision: null,
  summary: ("manual reset " + $s + " · 干净流程测试")
}')" "/onboarding_programs?id=eq.$PROGRAM_ID"

echo "→ 删 mentor_conversations(对话历史)"
PRECONV=$(G "/mentor_conversations?program_id=eq.$PROGRAM_ID&select=id" | jq 'length')
DEL "/mentor_conversations?program_id=eq.$PROGRAM_ID"
POSTCONV=$(G "/mentor_conversations?program_id=eq.$PROGRAM_ID&select=id" | jq 'length')
echo "  $PRECONV → $POSTCONV"

echo "→ 删 training_coach_actions(由 reviews cascade,但显式删一次稳)"
RIDS=$(G "/training_coach_reviews?program_id=eq.$PROGRAM_ID&select=id" | jq -r '[.[].id] | join(",")')
if [ -n "$RIDS" ]; then
  DEL "/training_coach_actions?review_id=in.($RIDS)" || true
fi

echo "→ 删 training_coach_reviews"
PREREV=$(G "/training_coach_reviews?program_id=eq.$PROGRAM_ID&select=id" | jq 'length')
DEL "/training_coach_reviews?program_id=eq.$PROGRAM_ID"
POSTREV=$(G "/training_coach_reviews?program_id=eq.$PROGRAM_ID&select=id" | jq 'length')
echo "  $PREREV → $POSTREV"

echo "→ 重置所有 onboarding_tasks 回 todo + 清提交/评分"
# 先重置非 due_at 字段(批量 PATCH 一次)
PATCH '{
  "status": "todo",
  "submission_notes": null,
  "submission_uris": [],
  "submitted_at": null,
  "score": null,
  "graded_at": null,
  "grader_notes": null,
  "ai_prescore": null,
  "reviewer_user_id": null
}' "/onboarding_tasks?program_id=eq.$PROGRAM_ID"

echo "→ 按新 start_date 重算每条 task 的 due_at"
TASKS=$(G "/onboarding_tasks?program_id=eq.$PROGRAM_ID&select=id,day_number&order=day_number")
echo "$TASKS" | jq -c '.[]' | while IFS= read -r row; do
  TID=$(echo "$row" | jq -r '.id')
  DAY=$(echo "$row" | jq -r '.day_number')
  DUE=$(date -u -j -f %Y-%m-%d -v+$((DAY-1))d "$NEW_START" +"%Y-%m-%dT23:59:00Z")
  PATCH "$(jq -nc --arg d "$DUE" '{due_at: $d}')" "/onboarding_tasks?id=eq.$TID"
done
echo "  done"

echo "→ 重置 Mikkiz 的 telegram_sessions 到 idle"
PATCH '{"state": {"stage":"idle"}}' "/telegram_sessions?chat_id=eq.$TG_CHAT_ID" || \
  POST "$(jq -nc --arg cid "$TG_CHAT_ID" '{chat_id: $cid, bot_role: "employee", state: {stage:"idle"}}')" \
    "/telegram_sessions" > /dev/null || true

echo "→ 写 audit"
POST "$(jq -nc --arg uid "$USERID" --arg pid "$PROGRAM_ID" --arg ns "$NEW_START" '{
  agent_name: "onboarding_agent",
  trigger_source: "manual:reset_program",
  status: "success",
  input_payload: { reason: "重跑培训 + 测试提交-门控 + mentor 陪跑" },
  output_payload: { user_id: $uid, program_id: $pid, new_start_date: $ns }
}')" "/agent_runs" > /dev/null

echo ""
echo "✅ 完成"
echo ""
echo "=== verify ==="
G "/onboarding_programs?id=eq.$PROGRAM_ID&select=start_date,end_date,status,summary,is_paused" | jq
echo "task status counts:"
G "/onboarding_tasks?program_id=eq.$PROGRAM_ID&select=status" | jq 'group_by(.status) | map({status: .[0].status, count: length})'
