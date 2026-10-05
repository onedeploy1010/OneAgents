-- 层级升级:organization(集团)→ client(公司)→ project(项目)→ task(主线/子/分支)。
-- 项目加版本 + 维护模式 + "从哪个项目分裂出来"的追溯。

begin;

create type task_track as enum ('main', 'sub', 'branch', 'maintenance', 'hotfix');

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text unique,
  description text,
  admin_email text,
  brand_color text,
  website text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table clients
  add column if not exists organization_id uuid references organizations(id) on delete set null;

create index if not exists idx_clients_organization on clients(organization_id);

alter table projects
  add column if not exists version text,
  add column if not exists maintenance_mode boolean not null default false,
  add column if not exists spawned_from_project_id uuid references projects(id) on delete set null;

alter table tasks
  add column if not exists parent_task_id uuid references tasks(id) on delete cascade,
  add column if not exists track task_track not null default 'main',
  add column if not exists version_target text;

create index if not exists idx_tasks_parent on tasks(parent_task_id);
create index if not exists idx_tasks_project_track on tasks(project_id, track);
create index if not exists idx_tasks_version_target on tasks(project_id, version_target);

alter table organizations enable row level security;

create trigger trg_organizations_set_updated_at before update on organizations
for each row execute function set_updated_at();

commit;
