-- 工作流引擎。
-- 把"谁做什么、做完通知谁、是否审批、通过后触发什么"结构化进数据库。
-- 节点可以是:agent / ai_platform / tool / webhook / human。
-- 每个节点可声明:项目 + 客户 + 记忆命名空间 + 连接器。

begin;

create type workflow_executor_kind as enum (
  'agent',        -- 内部 OneAgents DO(MeetingAgent/FinanceAgent 等)
  'ai_platform',  -- 外部 AI 平台(OpenAI / Claude / Gemini via AI Gateway)
  'tool',         -- Worker 内部工具(embed / sendTelegram / call /entities/*)
  'webhook',      -- 调外部 HTTP 端点
  'human'         -- 真人操作,需要回写 complete
);

create type workflow_step_status as enum (
  'pending',
  'running',
  'awaiting_approval',
  'approved',
  'rejected',
  'completed',
  'failed',
  'skipped'
);

create type workflow_run_status as enum (
  'active',
  'paused',
  'completed',
  'failed',
  'cancelled'
);

create table if not exists workflows (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  version smallint not null default 1,
  trigger_kind text not null default 'manual',
  trigger_config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workflow_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  step_index smallint not null,
  step_key text not null,
  name text not null,
  description text,
  executor_kind workflow_executor_kind not null,
  executor_ref text,
  executor_config jsonb not null default '{}'::jsonb,
  project_scope text not null default 'inherit',
  client_scope text not null default 'inherit',
  connector_slugs text[] not null default '{}'::text[],
  memory_namespace text,
  requires_approval boolean not null default false,
  approver_roles text[] not null default '{}'::text[],
  depends_on text[] not null default '{}'::text[],
  on_success_step_key text,
  on_failure_step_key text,
  notification_targets jsonb not null default '{}'::jsonb,
  timeout_seconds int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workflow_id, step_key)
);

create index if not exists idx_workflow_steps_workflow on workflow_steps(workflow_id, step_index);

create table if not exists workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  triggered_by_user_id uuid references users(id) on delete set null,
  triggered_by_source text,
  input_payload jsonb not null default '{}'::jsonb,
  status workflow_run_status not null default 'active',
  current_step_key text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_workflow_runs_workflow on workflow_runs(workflow_id, started_at desc);
create index if not exists idx_workflow_runs_status on workflow_runs(status, started_at desc);
create index if not exists idx_workflow_runs_project on workflow_runs(project_id);

create table if not exists workflow_step_runs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references workflow_runs(id) on delete cascade,
  step_id uuid not null references workflow_steps(id) on delete cascade,
  step_key text not null,
  status workflow_step_status not null default 'pending',
  assigned_user_id uuid references users(id) on delete set null,
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  artifacts jsonb not null default '{}'::jsonb,
  approval_required boolean not null default false,
  approved_by_user_id uuid references users(id) on delete set null,
  approved_at timestamptz,
  rejected_reason text,
  notes text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, step_key)
);

create index if not exists idx_workflow_step_runs_run on workflow_step_runs(run_id);
create index if not exists idx_workflow_step_runs_status on workflow_step_runs(status, created_at desc);
create index if not exists idx_workflow_step_runs_assignee on workflow_step_runs(assigned_user_id, status);

alter table workflows enable row level security;
alter table workflow_steps enable row level security;
alter table workflow_runs enable row level security;
alter table workflow_step_runs enable row level security;

create trigger trg_workflows_set_updated_at before update on workflows
for each row execute function set_updated_at();
create trigger trg_workflow_steps_set_updated_at before update on workflow_steps
for each row execute function set_updated_at();
create trigger trg_workflow_runs_set_updated_at before update on workflow_runs
for each row execute function set_updated_at();
create trigger trg_workflow_step_runs_set_updated_at before update on workflow_step_runs
for each row execute function set_updated_at();

-- 回放视图:把 run × step_runs × workflow 元数据 join 起来
create or replace view workflow_run_timeline as
select
  r.id as run_id,
  w.slug as workflow_slug,
  w.name as workflow_name,
  r.status as run_status,
  r.project_id,
  r.client_id,
  r.started_at as run_started_at,
  r.finished_at as run_finished_at,
  sr.id as step_run_id,
  sr.step_key,
  s.name as step_name,
  s.executor_kind,
  s.executor_ref,
  sr.status as step_status,
  sr.assigned_user_id,
  sr.approval_required,
  sr.approved_by_user_id,
  sr.approved_at,
  sr.input_payload,
  sr.output_payload,
  sr.error_message,
  sr.started_at as step_started_at,
  sr.completed_at as step_completed_at,
  sr.created_at as step_created_at
from workflow_runs r
join workflows w on w.id = r.workflow_id
left join workflow_step_runs sr on sr.run_id = r.id
left join workflow_steps s on s.id = sr.step_id
order by r.started_at desc, sr.created_at asc;

-- 种子:两个常用工作流样例
insert into workflows (slug, name, description, trigger_kind) values
  ('new-client-intake', '新客户接入', '从初次对接到项目立项 + 第一次例会', 'manual'),
  ('employee-first-day', '新员工 Day 0', '入职当天自动展开 GW/GH 邀请、培训程序和首日欢迎', 'manual')
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  updated_at = now();

-- new-client-intake 的步骤
with wf as (select id from workflows where slug = 'new-client-intake')
insert into workflow_steps (
  workflow_id, step_index, step_key, name, description,
  executor_kind, executor_ref, executor_config,
  requires_approval, approver_roles, depends_on, on_success_step_key,
  notification_targets
)
select wf.id, v.* from wf, (values
  (1::smallint, 'intake_call', '初次沟通',
   '和客户开初次对接会,记录需求', 'human'::workflow_executor_kind, 'role:founder',
   '{"hint":"会后把 rawTranscript 传到 /workflows/meeting"}'::jsonb,
   false, ARRAY[]::text[], ARRAY[]::text[], 'summarize_intake',
   '{"telegram":true,"roles":["founder"]}'::jsonb),
  (2::smallint, 'summarize_intake', 'Agent 整理纪要',
   'meeting_agent 对 rawTranscript 抽取结论与行动项', 'agent'::workflow_executor_kind, 'meeting_agent',
   '{"tool":"workflow/meeting","output_key":"meetingId"}'::jsonb,
   false, ARRAY[]::text[], ARRAY['intake_call']::text[], 'scope_review',
   '{"telegram":true}'::jsonb),
  (3::smallint, 'scope_review', '人工确认范围与报价',
   'Founder 审批 scope / 报价 / 风险', 'human'::workflow_executor_kind, 'role:founder',
   '{}'::jsonb,
   true, ARRAY['founder']::text[], ARRAY['summarize_intake']::text[], 'create_project',
   '{"telegram":true,"roles":["founder"]}'::jsonb),
  (4::smallint, 'create_project', '建立项目记录',
   '调 /entities/projects 登记', 'tool'::workflow_executor_kind, 'entities/projects',
   '{"from_input":["clientId","name","projectCode","projectType","deliveryModel"]}'::jsonb,
   false, ARRAY[]::text[], ARRAY['scope_review']::text[], 'initial_tasks',
   '{"telegram":true}'::jsonb),
  (5::smallint, 'initial_tasks', '生成首批任务',
   'project_ops_agent 生成 5 条启动任务候选', 'agent'::workflow_executor_kind, 'project_ops_agent',
   '{"placeholder":true}'::jsonb,
   true, ARRAY['founder']::text[], ARRAY['create_project']::text[], 'handoff',
   '{"telegram":true}'::jsonb),
  (6::smallint, 'handoff', '交接并通知团队',
   '发 Telegram 给执行团队', 'tool'::workflow_executor_kind, 'telegram/send',
   '{"template":"新项目 {project_name} 已立项,请查看任务清单。"}'::jsonb,
   false, ARRAY[]::text[], ARRAY['initial_tasks']::text[], null,
   '{"telegram":true}'::jsonb)
) as v(step_index, step_key, name, description, executor_kind, executor_ref, executor_config,
       requires_approval, approver_roles, depends_on, on_success_step_key, notification_targets)
on conflict (workflow_id, step_key) do update set
  name = excluded.name,
  description = excluded.description,
  executor_kind = excluded.executor_kind,
  executor_ref = excluded.executor_ref,
  executor_config = excluded.executor_config,
  requires_approval = excluded.requires_approval,
  approver_roles = excluded.approver_roles,
  depends_on = excluded.depends_on,
  on_success_step_key = excluded.on_success_step_key,
  notification_targets = excluded.notification_targets,
  updated_at = now();

-- employee-first-day 的步骤
with wf as (select id from workflows where slug = 'employee-first-day')
insert into workflow_steps (
  workflow_id, step_index, step_key, name, description,
  executor_kind, executor_ref, executor_config,
  requires_approval, approver_roles, depends_on, on_success_step_key,
  notification_targets
)
select wf.id, v.* from wf, (values
  (1::smallint, 'confirm_gw_seat', '确认 GW 席位已分配',
   'Founder 在 GW admin 开好 seat 后 tick', 'human'::workflow_executor_kind, 'role:founder',
   '{"gw_action":"create_user"}'::jsonb,
   false, ARRAY[]::text[], ARRAY[]::text[], 'confirm_gh_invite',
   '{"telegram":true,"roles":["founder"]}'::jsonb),
  (2::smallint, 'confirm_gh_invite', '发出 GitHub Org 邀请',
   'Founder 邀请新人 GH 账号进 org', 'human'::workflow_executor_kind, 'role:founder',
   '{"gh_action":"invite_member"}'::jsonb,
   false, ARRAY[]::text[], ARRAY['confirm_gw_seat']::text[], 'start_onboarding',
   '{"telegram":true,"roles":["founder"]}'::jsonb),
  (3::smallint, 'start_onboarding', '启动 15 天培训程序',
   '调 /onboarding/programs/start', 'tool'::workflow_executor_kind, 'onboarding/start',
   '{"from_input":["traineeEmail","mentorEmail","startDate","mentorSlug"]}'::jsonb,
   false, ARRAY[]::text[], ARRAY['confirm_gh_invite']::text[], 'generate_brief',
   '{"telegram":true}'::jsonb),
  (4::smallint, 'generate_brief', '生成 Day 1 引导',
   'mentor 生成当日引导并记到对话', 'tool'::workflow_executor_kind, 'onboarding/today',
   '{}'::jsonb,
   false, ARRAY[]::text[], ARRAY['start_onboarding']::text[], 'welcome_notify',
   '{"telegram":true}'::jsonb),
  (5::smallint, 'welcome_notify', '欢迎通知',
   '向 mentor / trainee 同时发消息', 'tool'::workflow_executor_kind, 'telegram/send',
   '{"template":"@{trainee_name} 欢迎加入,你的教官是 {mentor_name},请运行 /chat 随时问。"}'::jsonb,
   false, ARRAY[]::text[], ARRAY['generate_brief']::text[], null,
   '{"telegram":true}'::jsonb)
) as v(step_index, step_key, name, description, executor_kind, executor_ref, executor_config,
       requires_approval, approver_roles, depends_on, on_success_step_key, notification_targets)
on conflict (workflow_id, step_key) do update set
  name = excluded.name,
  description = excluded.description,
  executor_kind = excluded.executor_kind,
  executor_ref = excluded.executor_ref,
  executor_config = excluded.executor_config,
  requires_approval = excluded.requires_approval,
  approver_roles = excluded.approver_roles,
  depends_on = excluded.depends_on,
  on_success_step_key = excluded.on_success_step_key,
  notification_targets = excluded.notification_targets,
  updated_at = now();

commit;
