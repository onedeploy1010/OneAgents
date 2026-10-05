-- Telegram 群支持:把群绑定到 client/project,群里做会议记录 + 触发 agent。

begin;

create type meeting_buffer_status as enum ('active', 'ended', 'discarded');

create table if not exists telegram_groups (
  chat_id text primary key,
  bot_role tg_bot_role not null,
  title text,
  client_id uuid references clients(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  bound_by_user_id uuid references users(id) on delete set null,
  bound_at timestamptz,
  is_active boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_telegram_groups_project on telegram_groups(project_id);
create index if not exists idx_telegram_groups_client on telegram_groups(client_id);
create index if not exists idx_telegram_groups_bot_role on telegram_groups(bot_role);

create table if not exists telegram_meeting_buffers (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null references telegram_groups(chat_id) on delete cascade,
  title text,
  started_by_user_id uuid references users(id) on delete set null,
  started_by_tg_user_id text,
  status meeting_buffer_status not null default 'active',
  transcript text not null default '',
  message_count int not null default 0,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  meeting_id uuid references meetings(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tg_meeting_buffers_chat_active
  on telegram_meeting_buffers(chat_id)
  where status = 'active';

alter table telegram_groups enable row level security;
alter table telegram_meeting_buffers enable row level security;

create trigger trg_telegram_groups_set_updated_at before update on telegram_groups
for each row execute function set_updated_at();
create trigger trg_tg_meeting_buffers_set_updated_at before update on telegram_meeting_buffers
for each row execute function set_updated_at();

commit;
