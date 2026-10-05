-- 多租户元数据:tenants / tenant_modules / tenant_agents
-- 权威源 = OneAgents Supabase。每 tenant 的运营数据住各自的 Neon Postgres。
-- Decisions 记录在 docs/multi_tenant.md(下一轮补)。

begin;

create type tenant_status as enum ('provisioning', 'active', 'suspended', 'archived');

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,                          -- e.g. 'corex', 'acme'
  name text not null,                                 -- 公司显示名
  status tenant_status not null default 'provisioning',
  -- Neon Postgres 定位信息
  neon_project_id text,                               -- neon project id
  neon_branch_id text,                                -- 默认 main branch
  db_host text,
  db_name text,
  db_user text,
  -- db 密码存 Cloudflare Worker secret,这里只记 secret name
  connection_secret_name text,                        -- e.g. 'TENANT_DB_PASS_corex'
  branding jsonb not null default '{}'::jsonb,        -- { logo_url, primary_color, app_name }
  owner_user_id uuid references users(id) on delete set null,  -- 创建 / 负责此 tenant 的 founder
  owner_email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tenants_status on tenants(status);
create index if not exists idx_tenants_slug on tenants(slug);

-- 页面级模块开关(y 级)
-- module_slug 约定:顶层 'hr', 'projects', 'finance'; 子页 'hr.salary', 'projects.tasks' 等
create table if not exists tenant_modules (
  tenant_id uuid not null references tenants(id) on delete cascade,
  module_slug text not null,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,          -- 模块级自定义配置(比如 HR 里是否展示薪资列)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, module_slug)
);

create index if not exists idx_tenant_modules_enabled on tenant_modules(tenant_id) where enabled = true;

-- 每 tenant 的 agent 启用 + 配置
-- agent_slug 约定:与 cloudflare/worker/src/agents/ 下的目录名对齐
--   'meeting' | 'finance' | 'infra' | 'knowledge' | 'onboarding' | 'orchestrator' | 'project-ops' | 'training-coach'
create table if not exists tenant_agents (
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_slug text not null,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,          -- 频率、模型、aggressiveness 等
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, agent_slug)
);

create index if not exists idx_tenant_agents_enabled on tenant_agents(tenant_id) where enabled = true;

-- 更新时间触发器
create trigger trg_tenants_set_updated_at before update on tenants
  for each row execute function set_updated_at();
create trigger trg_tenant_modules_set_updated_at before update on tenant_modules
  for each row execute function set_updated_at();
create trigger trg_tenant_agents_set_updated_at before update on tenant_agents
  for each row execute function set_updated_at();

-- RLS(Worker 走 service_role 绕过;留着以防未来直连)
alter table tenants enable row level security;
alter table tenant_modules enable row level security;
alter table tenant_agents enable row level security;

-- superadmin scope 约定
-- api_tokens.scopes 是 text[],我们约定两种特殊 scope:
--   'superadmin'       — 能操作 /superadmin/* 全部路由
--   'tenant:<slug>'    — 绑定某 tenant,能以该 tenant 身份调 agents / company-admin API
-- 不需要 schema 改动。下一轮在 Worker 里加 requireSuperadmin / requireTenantScope。

commit;
