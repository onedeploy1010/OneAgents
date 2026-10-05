-- 员工邀请表。admin 先登记 Telegram username,新人 /start 时自动认出并完成录入。

begin;

create table if not exists employee_invites (
  id uuid primary key default gen_random_uuid(),
  telegram_username text,
  telegram_user_id text,
  mentor_slug text references mentors(slug) on delete set null,
  invited_by_user_id uuid references users(id) on delete set null,
  notes text,
  status text not null default 'pending' check (status in ('pending','consumed','revoked','expired')),
  expires_at timestamptz,
  consumed_at timestamptz,
  consumed_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_employee_invites_tg_username on employee_invites(telegram_username) where status = 'pending';
create index if not exists idx_employee_invites_tg_user_id on employee_invites(telegram_user_id) where status = 'pending';

alter table employee_invites enable row level security;

create trigger trg_employee_invites_set_updated_at before update on employee_invites
for each row execute function set_updated_at();

commit;
