#!/usr/bin/env bash
# 一次性补救:把 Mikkie 的 onboarding_programs + 15 天 tasks 直接通过 PostgREST 建出来。
# 完全幂等:已存在 active program 就复用;已存在的 task 按 template_task_id 跳过。
#
# 用 cloudflare/worker/.dev.vars 里的 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY。
# 脚本不打印 service role key。
#
# 跑:bash supabase/scripts/fix_mikkie_program.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEV_VARS="$SCRIPT_DIR/../../cloudflare/worker/.dev.vars"

if [ ! -f "$DEV_VARS" ]; then
  echo "❌ 找不到 $DEV_VARS" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "$DEV_VARS"; set +a

: "${SUPABASE_URL:?SUPABASE_URL not set in .dev.vars}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY not set in .dev.vars}"

REST="${SUPABASE_URL%/}/rest/v1"
AUTH_H1="apikey: $SUPABASE_SERVICE_ROLE_KEY"
AUTH_H2="Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"

EMAIL="mikkizoon@gmail.com"
TEMPLATE_SLUG="replit_panel_15day"
MENTOR_SLUG="nina_coach"
START_DATE="$(date -u +%Y-%m-%d)"

call() {
  # call <method> <path> [json-body]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -fsS -X "$method" -H "$AUTH_H1" -H "$AUTH_H2" \
      -H "Content-Type: application/json" \
      -H "Prefer: return=representation" \
      -d "$body" "$REST$path"
  else
    curl -fsS -X "$method" -H "$AUTH_H1" -H "$AUTH_H2" \
      -H "Accept: application/json" "$REST$path"
  fi
}

echo "→ 找 user (email=$EMAIL)"
USER_ID=$(call GET "/users?email=eq.$EMAIL&select=id" | jq -r '.[0].id // empty')
[ -n "$USER_ID" ] || { echo "❌ 用户不存在"; exit 1; }
echo "  user_id = $USER_ID"

echo "→ 找模板 ($TEMPLATE_SLUG)"
TPL=$(call GET "/onboarding_templates?name=eq.$TEMPLATE_SLUG&select=id,duration_days")
TPL_ID=$(echo "$TPL" | jq -r '.[0].id // empty')
DURATION=$(echo "$TPL" | jq -r '.[0].duration_days // empty')
[ -n "$TPL_ID" ] || { echo "❌ 模板不存在 — 先跑 migration 20260419000015_replit_template.sql"; exit 1; }
echo "  template_id = $TPL_ID  (duration=$DURATION 天)"

echo "→ 检查已有 active program"
PROGRAM_ID=$(call GET "/onboarding_programs?trainee_user_id=eq.$USER_ID&status=eq.active&select=id,start_date&order=start_date.desc&limit=1" \
  | jq -r '.[0].id // empty')

if [ -z "$PROGRAM_ID" ]; then
  END_DATE=$(date -u -j -f %Y-%m-%d -v+$((DURATION-1))d "$START_DATE" +%Y-%m-%d)
  echo "→ 建 program ($START_DATE → $END_DATE)"
  PROG_BODY=$(jq -nc \
    --arg uid "$USER_ID" --arg tid "$TPL_ID" --arg ms "$MENTOR_SLUG" \
    --arg sd "$START_DATE" --arg ed "$END_DATE" --arg slug "$TEMPLATE_SLUG" '{
      trainee_user_id: $uid, template_id: $tid, mentor_slug: $ms,
      start_date: $sd, end_date: $ed, status: "active",
      summary: ("manual fix · invite intake 时 program 静默失败 · 模板 " + $slug)
    }')
  PROGRAM_ID=$(call POST "/onboarding_programs" "$PROG_BODY" | jq -r '.[0].id')
  PROG_START="$START_DATE"
  echo "  ✅ program_id = $PROGRAM_ID"
else
  PROG_START=$(call GET "/onboarding_programs?id=eq.$PROGRAM_ID&select=start_date" | jq -r '.[0].start_date')
  echo "  已有 program $PROGRAM_ID (start_date=$PROG_START),不重建"
fi

echo "→ 拉模板任务"
TPL_TASKS=$(call GET "/onboarding_template_tasks?template_id=eq.$TPL_ID&select=id,day_number,phase,title,today_goal,required_tasks,required_outputs,score_focus&order=day_number")
TPL_COUNT=$(echo "$TPL_TASKS" | jq 'length')
echo "  共 $TPL_COUNT 条模板任务"

echo "→ 拉已有任务的 template_task_id 列表"
EXISTING_IDS=$(call GET "/onboarding_tasks?program_id=eq.$PROGRAM_ID&select=template_task_id" \
  | jq -c '[.[].template_task_id]')
EXISTING_COUNT=$(echo "$EXISTING_IDS" | jq 'length')
echo "  已有 $EXISTING_COUNT 条任务"

echo "→ 构造 due_at 查表 (按 program start_date)"
DUE_MAP="{}"
for d in $(seq 1 "$DURATION"); do
  DUE=$(date -u -j -f %Y-%m-%d -v+$((d-1))d "$PROG_START" +"%Y-%m-%dT23:59:00Z")
  DUE_MAP=$(echo "$DUE_MAP" | jq --argjson day "$d" --arg due "$DUE" '. + {($day | tostring): $due}')
done

NEW_ROWS=$(echo "$TPL_TASKS" | jq -c \
  --argjson exclude "$EXISTING_IDS" \
  --argjson dueMap "$DUE_MAP" \
  --arg pid "$PROGRAM_ID" '
  map(select(.id as $tid | ($exclude | index($tid)) | not)) |
  map({
    program_id: $pid,
    template_task_id: .id,
    day_number: .day_number,
    title: .title,
    description: .today_goal,
    phase: .phase,
    today_goal: .today_goal,
    required_tasks: .required_tasks,
    required_outputs: .required_outputs,
    score_focus: .score_focus,
    status: "todo",
    due_at: $dueMap[(.day_number | tostring)]
  })')

NEW_COUNT=$(echo "$NEW_ROWS" | jq 'length')
echo "  → 准备插入 $NEW_COUNT 条新任务"

if [ "$NEW_COUNT" -gt 0 ]; then
  INSERTED=$(call POST "/onboarding_tasks" "$NEW_ROWS" | jq 'length')
  echo "  ✅ 新插 $INSERTED 条"
else
  echo "  ⏭ 没有需要新插的任务"
fi

echo "→ 写一行 agent_runs 留审计"
AUDIT_BODY=$(jq -nc \
  --arg email "$EMAIL" --arg slug "$TEMPLATE_SLUG" \
  --arg uid "$USER_ID" --arg pid "$PROGRAM_ID" --arg tid "$TPL_ID" \
  --argjson new "$NEW_COUNT" --argjson old "$EXISTING_COUNT" '{
    agent_name: "onboarding_agent",
    trigger_source: "manual:fix_invite_program",
    status: "success",
    input_payload: { email: $email, template_slug: $slug },
    output_payload: {
      user_id: $uid, program_id: $pid, template_id: $tid,
      tasks_inserted: $new, tasks_pre_existing: $old
    }
  }')
call POST "/agent_runs" "$AUDIT_BODY" > /dev/null

TOTAL=$(call GET "/onboarding_tasks?program_id=eq.$PROGRAM_ID&select=id" | jq 'length')
echo ""
echo "✅ 完成"
echo "   program_id        = $PROGRAM_ID"
echo "   tasks(总数)       = $TOTAL"
echo "   本次新插          = $NEW_COUNT"
echo "   原本已存在        = $EXISTING_COUNT"
