-- OneAgents
-- 初版主运营库迁移脚本
-- 目标：为公司运营系统建立可执行的 Supabase / PostgreSQL 基础结构

begin;

create extension if not exists pgcrypto;
create extension if not exists vector;

create type user_role as enum ('founder', 'member', 'trainee', 'agent');
create type user_status as enum ('active', 'inactive', 'trial');
create type client_status as enum ('lead', 'active', 'paused', 'closed');
create type project_type as enum ('web', 'automation', 'ops', 'ai', 'maintenance');
create type project_status as enum ('planning', 'active', 'blocked', 'maintenance', 'done');
create type risk_level as enum ('low', 'medium', 'high');
create type delivery_model as enum ('fixed', 'retainer', 'hourly');
create type priority_level as enum ('1', '2', '3', '4', '5');
create type task_status as enum ('todo', 'doing', 'review', 'blocked', 'done');
create type task_source_type as enum ('manual', 'meeting', 'github', 'agent', 'onboarding', 'system');
create type action_item_status as enum ('pending_review', 'approved', 'converted_to_task', 'rejected', 'done');
create type ledger_entry_type as enum ('income', 'expense', 'transfer');
create type finance_allocation_scope as enum ('company', 'project', 'shared');
create type finance_entry_status as enum ('expected', 'received', 'confirmed', 'refunded', 'bad_debt_risk');
create type asset_type as enum ('domain', 'server', 'site', 'repo', 'email', 'bot', 'api_key', 'database', 'monitoring', 'storage', 'other');
create type owner_scope as enum ('company', 'client');
create type asset_status as enum ('active', 'warning', 'expired', 'archived');
create type billing_cycle as enum ('monthly', 'yearly', 'quarterly', 'usage_based', 'one_time');
create type subscription_status as enum ('active', 'paused', 'cancelled');
create type deployment_platform as enum ('cloudflare', 'vercel', 'netlify', 'server', 'other');
create type deployment_status as enum ('pending', 'success', 'failed', 'cancelled');
create type environment_name as enum ('prod', 'staging', 'dev');
create type onboarding_status as enum ('planned', 'active', 'completed', 'extended', 'failed');
create type onboarding_task_status as enum ('todo', 'doing', 'submitted', 'reviewed', 'done', 'failed');
create type performance_period_type as enum ('weekly', 'biweekly', 'monthly', 'trial');
create type document_type as enum ('meeting_note', 'sop', 'spec', 'report', 'email', 'proposal', 'research', 'training');
create type embedding_status as enum ('pending', 'done', 'failed');
create type agent_run_status as enum ('queued', 'running', 'success', 'failed', 'cancelled');
create type notification_channel as enum ('telegram', 'email', 'whatsapp', 'dashboard');
create type notification_status as enum ('pending', 'sent', 'failed', 'cancelled', 'acknowledged');

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null,
  role user_role not null default 'member',
  status user_status not null default 'trial',
  telegram_chat_id text,
  github_username text,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  contact_channel text,
  billing_currency text,
  status client_status not null default 'lead',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete restrict,
  name text not null,
  project_code text not null unique,
  type project_type not null,
  status project_status not null default 'planning',
  priority smallint not null default 3 check (priority between 1 and 5),
  owner_user_id uuid references users(id) on delete set null,
  delivery_model delivery_model not null default 'fixed',
  quoted_u numeric(12,2),
  start_date date,
  target_date date,
  risk_level risk_level not null default 'medium',
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role_in_project text,
  is_primary boolean not null default false,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create table if not exists meetings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  title text not null,
  meeting_source text,
  source_uri text,
  raw_transcript text,
  summary text,
  decisions text,
  open_questions text,
  happened_at timestamptz not null default now(),
  created_by uuid references users(id) on delete set null,
  created_by_agent boolean not null default false,
  agent_name text,
  source_channel text,
  confidence_score numeric(4,3),
  needs_human_review boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1))
);

create table if not exists meeting_action_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  title text not null,
  description text,
  assignee_user_id uuid references users(id) on delete set null,
  priority smallint not null default 3 check (priority between 1 and 5),
  due_at timestamptz,
  status action_item_status not null default 'pending_review',
  task_id uuid,
  created_by_agent boolean not null default true,
  agent_name text,
  source_channel text,
  confidence_score numeric(4,3),
  needs_human_review boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1))
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  description text,
  status task_status not null default 'todo',
  priority smallint not null default 3 check (priority between 1 and 5),
  assignee_user_id uuid references users(id) on delete set null,
  reporter_user_id uuid references users(id) on delete set null,
  source_type task_source_type not null default 'manual',
  source_ref_id uuid,
  estimated_hours numeric(8,2),
  due_at timestamptz,
  completed_at timestamptz,
  created_by_agent boolean not null default false,
  agent_name text,
  source_channel text,
  confidence_score numeric(4,3),
  needs_human_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (estimated_hours is null or estimated_hours >= 0),
  check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1))
);

create table if not exists fx_rates (
  id uuid primary key default gen_random_uuid(),
  base_currency text not null,
  quote_currency text not null default 'U',
  rate numeric(18,6) not null check (rate > 0),
  source text not null,
  effective_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (base_currency, quote_currency, effective_at)
);

create table if not exists finance_ledger (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  entry_type ledger_entry_type not null,
  entry_status finance_entry_status not null default 'confirmed',
  allocation_scope finance_allocation_scope not null default 'company',
  category text not null,
  original_currency text not null,
  original_amount numeric(18,6) not null,
  rate_to_u numeric(18,6) not null check (rate_to_u > 0),
  amount_u numeric(18,6) generated always as (original_amount * rate_to_u) stored,
  counterparty text,
  occurred_at timestamptz not null,
  evidence_url text,
  entered_by uuid references users(id) on delete set null,
  notes text,
  created_by_agent boolean not null default false,
  agent_name text,
  source_channel text,
  confidence_score numeric(4,3),
  needs_human_review boolean not null default false,
  created_at timestamptz not null default now(),
  check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1))
);

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  asset_type asset_type not null,
  name text not null,
  provider text,
  identifier text,
  owner_scope owner_scope not null default 'company',
  status asset_status not null default 'active',
  renewal_date date,
  monthly_cost_u numeric(12,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references assets(id) on delete set null,
  service_name text not null,
  plan_name text not null,
  billing_cycle billing_cycle not null,
  currency text not null,
  amount numeric(12,2) not null check (amount >= 0),
  amount_u numeric(12,2),
  next_billing_date date,
  auto_renew boolean not null default true,
  status subscription_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists deployments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  platform deployment_platform not null,
  environment environment_name not null,
  deployment_status deployment_status not null default 'pending',
  commit_sha text,
  branch_name text,
  deploy_url text,
  triggered_by uuid references users(id) on delete set null,
  external_ref text,
  deployed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists project_databases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  platform text not null default 'supabase',
  environment environment_name not null,
  instance_name text not null,
  primary_region text,
  backup_policy text not null,
  mirror_to_main_db boolean not null default false,
  restore_contact text,
  status asset_status not null default 'active',
  last_backup_at timestamptz,
  last_backup_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, environment, instance_name)
);

create table if not exists onboarding_programs (
  id uuid primary key default gen_random_uuid(),
  trainee_user_id uuid not null references users(id) on delete cascade,
  mentor_user_id uuid references users(id) on delete set null,
  status onboarding_status not null default 'planned',
  start_date date not null,
  end_date date,
  summary text,
  final_score numeric(5,2),
  final_decision text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists onboarding_tasks (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references onboarding_programs(id) on delete cascade,
  day_number smallint not null check (day_number between 1 and 30),
  title text not null,
  description text,
  status onboarding_task_status not null default 'todo',
  proof_uri text,
  score numeric(5,2),
  reviewer_user_id uuid references users(id) on delete set null,
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists performance_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  period_type performance_period_type not null,
  period_start date not null,
  period_end date not null,
  score numeric(5,2),
  summary text,
  reviewer_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, period_type, period_start, period_end)
);

create table if not exists knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  title text not null,
  doc_type document_type not null,
  source_uri text,
  storage_path text,
  summary text,
  vector_namespace text,
  embedding_status embedding_status not null default 'pending',
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references knowledge_documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  embedding vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  trigger_source text not null,
  status agent_run_status not null default 'queued',
  project_id uuid references projects(id) on delete set null,
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  channel notification_channel not null,
  status notification_status not null default 'pending',
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  scheduled_for timestamptz,
  sent_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table meeting_action_items
  add constraint meeting_action_items_task_id_fkey
  foreign key (task_id) references tasks(id) on delete set null;

create index if not exists idx_projects_client_id on projects(client_id);
create index if not exists idx_projects_owner_user_id on projects(owner_user_id);
create index if not exists idx_projects_status on projects(status);
create index if not exists idx_tasks_project_status on tasks(project_id, status);
create index if not exists idx_tasks_assignee_status on tasks(assignee_user_id, status);
create index if not exists idx_meetings_project_happened_at on meetings(project_id, happened_at desc);
create index if not exists idx_meeting_action_items_meeting_id on meeting_action_items(meeting_id);
create index if not exists idx_finance_ledger_occurred_at on finance_ledger(occurred_at desc);
create index if not exists idx_finance_ledger_project_id on finance_ledger(project_id);
create index if not exists idx_assets_renewal_date on assets(renewal_date);
create index if not exists idx_subscriptions_next_billing_date on subscriptions(next_billing_date);
create index if not exists idx_project_databases_project_id on project_databases(project_id);
create index if not exists idx_knowledge_documents_project_id on knowledge_documents(project_id);
create index if not exists idx_knowledge_chunks_document_id on knowledge_chunks(document_id);
create index if not exists idx_agent_runs_status_created_at on agent_runs(status, created_at desc);
create index if not exists idx_notifications_status_scheduled_for on notifications(status, scheduled_for);

create trigger trg_users_set_updated_at before update on users
for each row execute function set_updated_at();

create trigger trg_clients_set_updated_at before update on clients
for each row execute function set_updated_at();

create trigger trg_projects_set_updated_at before update on projects
for each row execute function set_updated_at();

create trigger trg_project_members_set_updated_at before update on project_members
for each row execute function set_updated_at();

create trigger trg_meetings_set_updated_at before update on meetings
for each row execute function set_updated_at();

create trigger trg_meeting_action_items_set_updated_at before update on meeting_action_items
for each row execute function set_updated_at();

create trigger trg_tasks_set_updated_at before update on tasks
for each row execute function set_updated_at();

create trigger trg_assets_set_updated_at before update on assets
for each row execute function set_updated_at();

create trigger trg_subscriptions_set_updated_at before update on subscriptions
for each row execute function set_updated_at();

create trigger trg_deployments_set_updated_at before update on deployments
for each row execute function set_updated_at();

create trigger trg_project_databases_set_updated_at before update on project_databases
for each row execute function set_updated_at();

create trigger trg_onboarding_programs_set_updated_at before update on onboarding_programs
for each row execute function set_updated_at();

create trigger trg_onboarding_tasks_set_updated_at before update on onboarding_tasks
for each row execute function set_updated_at();

create trigger trg_performance_reviews_set_updated_at before update on performance_reviews
for each row execute function set_updated_at();

create trigger trg_knowledge_documents_set_updated_at before update on knowledge_documents
for each row execute function set_updated_at();

create trigger trg_notifications_set_updated_at before update on notifications
for each row execute function set_updated_at();

create or replace view v_project_finance_summary as
select
  p.id as project_id,
  p.project_code,
  p.name as project_name,
  coalesce(sum(case when fl.entry_type = 'income' and fl.entry_status in ('received', 'confirmed') then fl.amount_u else 0 end), 0) as income_u,
  coalesce(sum(case when fl.entry_type = 'expense' and fl.entry_status in ('received', 'confirmed') then fl.amount_u else 0 end), 0) as expense_u,
  coalesce(sum(case when fl.entry_type = 'income' and fl.entry_status in ('received', 'confirmed') then fl.amount_u else 0 end), 0)
    - coalesce(sum(case when fl.entry_type = 'expense' and fl.entry_status in ('received', 'confirmed') then fl.amount_u else 0 end), 0) as gross_margin_u
from projects p
left join finance_ledger fl on fl.project_id = p.id
group by p.id, p.project_code, p.name;

create or replace view v_subscription_due_soon as
select
  s.id,
  s.service_name,
  s.plan_name,
  s.status,
  s.next_billing_date,
  s.amount,
  s.amount_u,
  a.name as asset_name,
  a.provider,
  p.project_code,
  p.name as project_name
from subscriptions s
left join assets a on a.id = s.asset_id
left join projects p on p.id = a.project_id
where s.status = 'active'
  and s.next_billing_date is not null
  and s.next_billing_date <= current_date + interval '14 days';

commit;
