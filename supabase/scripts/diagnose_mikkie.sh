#!/usr/bin/env bash
# 诊断 Mikkie 的真实状态:user / identity / programs / tasks / 最近的 mentor 对话 / agent_runs。
# 不改任何数据,只读。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEV_VARS="$SCRIPT_DIR/../../cloudflare/worker/.dev.vars"
set -a; source "$DEV_VARS"; set +a

REST="${SUPABASE_URL%/}/rest/v1"
G() { curl -fsS -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" "$REST$1"; }

EMAIL="mikkizoon@gmail.com"

echo "=== USER ==="
G "/users?email=eq.$EMAIL&select=id,display_name,email,role,status,telegram_chat_id,created_at,updated_at" | jq

USER_ID=$(G "/users?email=eq.$EMAIL&select=id" | jq -r '.[0].id')

echo ""
echo "=== IDENTITY BINDINGS ==="
G "/identity_bindings?user_id=eq.$USER_ID&select=provider,provider_user_id,display_name,verified_at" | jq

echo ""
echo "=== ALL ONBOARDING PROGRAMS (any status) ==="
G "/onboarding_programs?trainee_user_id=eq.$USER_ID&select=id,template_id,mentor_slug,status,start_date,end_date,is_paused,summary,final_score,final_decision,created_at,updated_at&order=created_at.desc" | jq

echo ""
echo "=== TASKS for active program (status counts) ==="
PID=$(G "/onboarding_programs?trainee_user_id=eq.$USER_ID&status=eq.active&select=id&order=start_date.desc&limit=1" | jq -r '.[0].id')
echo "active program_id = $PID"
TASKS=$(G "/onboarding_tasks?program_id=eq.$PID&select=day_number,phase,title,status,score,submitted_at,graded_at&order=day_number")
echo "$TASKS" | jq 'group_by(.status) | map({status: .[0].status, count: length})'
echo "-- touched (非 todo) --"
echo "$TASKS" | jq '[.[] | select(.status != "todo")] | { touched_count: length, touched: . }'

echo ""
echo "=== EMPLOYEE INVITES for this email/user ==="
G "/employee_invites?or=(consumed_user_id.eq.$USER_ID,telegram_username.eq.mikkie)&select=id,telegram_username,telegram_user_id,mentor_slug,template_slug,status,created_at,consumed_at,nudge_count,case_review_sent_at,notes&order=created_at.desc" | jq

echo ""
echo "=== RECENT AGENT RUNS related to Mikkie ==="
G "/agent_runs?or=(input_payload->>email.eq.$EMAIL,output_payload->>user_id.eq.$USER_ID)&select=agent_name,trigger_source,status,error_message,input_payload,output_payload,created_at&order=created_at.desc&limit=15" | jq

echo ""
echo "=== MENTOR CONVERSATIONS for active program ==="
G "/mentor_conversations?program_id=eq.$PID&select=role,content,context_kind,model_used,latency_ms,created_at&order=created_at.desc&limit=10" | jq

echo ""
echo "=== USER PROFILE ==="
G "/user_profiles?user_id=eq.$USER_ID&select=experience_summary,strengths,weaknesses,learning_style,goals,last_refreshed_at" | jq
