-- 身份与授权层。
-- 目标:
--   1. `identity_bindings`:把外部账号(Telegram / GitHub / Google / Email)绑到内部 users。
--   2. `api_tokens`:Worker 验证调用方;存 hash,不存明文。
--   3. `agent_permissions`:按 Agent × 资源 声明能力级别(read/suggest/write/execute)。
--   4. `connectors`:登记外部平台连接(不存密钥,只存 secret 名与状态)。
--   5. 扩展 `agent_runs` 记录真实触发者。
-- service_role 继续绕过 RLS;新表同样启用 RLS。

begin;

create type identity_provider as enum (
  'telegram',
  'github',
  'google',
  'email',
  'supabase_auth'
);

create type agent_permission_level as enum ('read', 'suggest', 'write', 'execute');

create type connector_status as enum ('active', 'paused', 'expired', 'revoked');

create table if not exists identity_bindings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider identity_provider not null,
  provider_user_id text not null,
  display_name text,
  metadata jsonb not null default '{}'::jsonb,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_user_id)
);

create index if not exists idx_identity_bindings_user_id on identity_bindings(user_id);
create index if not exists idx_identity_bindings_provider on identity_bindings(provider);

create table if not exists api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  agent_name text,
  label text not null,
  token_hash text not null unique,
  token_prefix text not null,
  scopes text[] not null default '{}'::text[],
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_api_tokens_user_id on api_tokens(user_id);
create index if not exists idx_api_tokens_agent_name on api_tokens(agent_name);

create table if not exists agent_permissions (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  resource text not null,
  level agent_permission_level not null default 'read',
  allowed boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_name, resource)
);

create index if not exists idx_agent_permissions_agent on agent_permissions(agent_name);

create table if not exists connectors (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references users(id) on delete set null,
  provider identity_provider not null,
  name text not null,
  status connector_status not null default 'active',
  config jsonb not null default '{}'::jsonb,
  secret_ref text,
  last_health_check_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, name)
);

create index if not exists idx_connectors_owner on connectors(owner_user_id);
create index if not exists idx_connectors_provider on connectors(provider);

alter table agent_runs
  add column if not exists actor_user_id uuid references users(id) on delete set null,
  add column if not exists actor_identity_id uuid references identity_bindings(id) on delete set null,
  add column if not exists actor_source text;

create index if not exists idx_agent_runs_actor_user on agent_runs(actor_user_id);

alter table identity_bindings enable row level security;
alter table api_tokens enable row level security;
alter table agent_permissions enable row level security;
alter table connectors enable row level security;

create trigger trg_identity_bindings_set_updated_at before update on identity_bindings
for each row execute function set_updated_at();
create trigger trg_agent_permissions_set_updated_at before update on agent_permissions
for each row execute function set_updated_at();
create trigger trg_connectors_set_updated_at before update on connectors
for each row execute function set_updated_at();

-- 默认 agent × 资源权限(按 docs/agent_catalog.md 第五节的层级)。
-- 通过 upsert 幂等注入。
insert into agent_permissions (agent_name, resource, level, notes) values
  ('orchestrator_agent',  'agent_runs',          'write',   '仅记录路由审计'),
  ('orchestrator_agent',  'notifications',       'write',   '发编排层通知'),
  ('orchestrator_agent',  'meetings',            'read',    '仅观察'),
  ('orchestrator_agent',  'finance_ledger',      'read',    '不直接改金额'),
  ('project_ops_agent',   'projects',            'read',    null),
  ('project_ops_agent',   'tasks',               'suggest', '生成候选任务,待复核'),
  ('project_ops_agent',   'meeting_action_items','suggest', null),
  ('project_ops_agent',   'agent_runs',          'write',   null),
  ('meeting_agent',       'meetings',            'write',   '候选会议可直接入库,标 needs_human_review'),
  ('meeting_agent',       'meeting_action_items','suggest', null),
  ('meeting_agent',       'agent_runs',          'write',   null),
  ('finance_agent',       'finance_ledger',      'suggest', '大额需人工复核'),
  ('finance_agent',       'notifications',       'write',   '续费/异常提醒'),
  ('finance_agent',       'fx_rates',            'read',    null),
  ('finance_agent',       'agent_runs',          'write',   null),
  ('knowledge_agent',     'knowledge_documents', 'write',   '写入候选文档与 embedding 状态'),
  ('knowledge_agent',     'knowledge_chunks',    'write',   null),
  ('knowledge_agent',     'agent_runs',          'write',   null),
  ('onboarding_agent',    'onboarding_programs', 'read',    null),
  ('onboarding_agent',    'onboarding_tasks',    'suggest', null),
  ('onboarding_agent',    'performance_reviews', 'suggest', '最终评分人工决定'),
  ('onboarding_agent',    'agent_runs',          'write',   null),
  ('infra_agent',         'assets',              'read',    null),
  ('infra_agent',         'subscriptions',       'read',    null),
  ('infra_agent',         'deployments',         'read',    null),
  ('infra_agent',         'notifications',       'write',   '到期/异常提醒'),
  ('infra_agent',         'agent_runs',          'write',   null)
on conflict (agent_name, resource) do update set
  level = excluded.level,
  notes = excluded.notes,
  updated_at = now();

-- 引导账户:第一位 founder 自动建出来并绑定已知 Telegram。
insert into users (email, display_name, role, status, telegram_chat_id)
values ('onelongmarketing@gmail.com', 'Alps Zhang', 'founder', 'active', '7120732225')
on conflict (email) do update set
  role = excluded.role,
  status = excluded.status,
  telegram_chat_id = coalesce(excluded.telegram_chat_id, users.telegram_chat_id),
  updated_at = now();

insert into identity_bindings (user_id, provider, provider_user_id, display_name, verified_at)
select u.id, 'telegram', '7120732225', 'Alps Zhang (telegram)', now()
from users u where u.email = 'onelongmarketing@gmail.com'
on conflict (provider, provider_user_id) do nothing;

insert into identity_bindings (user_id, provider, provider_user_id, display_name, verified_at)
select u.id, 'email', 'onelongmarketing@gmail.com', 'onelongmarketing@gmail.com', now()
from users u where u.email = 'onelongmarketing@gmail.com'
on conflict (provider, provider_user_id) do nothing;

commit;
