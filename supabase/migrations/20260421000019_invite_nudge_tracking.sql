-- Pre-accept nudge 追踪:给 employee_invites 加催促相关字段。
-- 用于 training-coach 的 nudge-pending-invites skill,避免 cron 重复 DM。

begin;

alter table employee_invites
  add column if not exists last_nudged_at timestamptz,
  add column if not exists nudge_count smallint not null default 0,
  add column if not exists case_review_sent_at timestamptz;

create index if not exists idx_employee_invites_pending_age
  on employee_invites(created_at)
  where status = 'pending';

commit;
