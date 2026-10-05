-- 群绑定支持到 organization 级(集团)。
-- 现有 client_id/project_id 继续有效,organization_id 可独立存在。

begin;

alter table telegram_groups
  add column if not exists organization_id uuid references organizations(id) on delete set null;

create index if not exists idx_telegram_groups_organization on telegram_groups(organization_id);

commit;
