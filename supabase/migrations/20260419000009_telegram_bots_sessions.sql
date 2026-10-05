-- Telegram 多 bot 架构 + 多轮会话状态 + 客户联系人。
-- 两个 bot:employee(内部) / client(客户)。
-- 每个 chat_id 有一份 session state,支持多步引导(email -> 绑定 -> intake -> 启动培训)。

begin;

create type tg_bot_role as enum ('employee', 'client', 'admin');

create table if not exists telegram_bots (
  id uuid primary key default gen_random_uuid(),
  role tg_bot_role not null unique,
  display_name text not null,
  username text,
  token_secret_ref text not null,  -- 指向 Worker env 里哪个 secret 名
  default_chat_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists telegram_sessions (
  chat_id text primary key,
  bot_role tg_bot_role not null,
  state jsonb not null default '{}'::jsonb,
  last_interaction_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_telegram_sessions_bot on telegram_sessions(bot_role, last_interaction_at desc);

create table if not exists client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text,
  email text,
  telegram_chat_id text,
  role_at_client text,
  is_primary boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_client_contacts_client on client_contacts(client_id);
create index if not exists idx_client_contacts_telegram on client_contacts(telegram_chat_id);
create unique index if not exists uq_client_contacts_tg
  on client_contacts(telegram_chat_id)
  where telegram_chat_id is not null;

alter table telegram_bots enable row level security;
alter table telegram_sessions enable row level security;
alter table client_contacts enable row level security;

create trigger trg_telegram_bots_set_updated_at before update on telegram_bots
for each row execute function set_updated_at();
create trigger trg_telegram_sessions_set_updated_at before update on telegram_sessions
for each row execute function set_updated_at();
create trigger trg_client_contacts_set_updated_at before update on client_contacts
for each row execute function set_updated_at();

-- 种子:2 个 bot 角色的登记。具体 token 仍然放在 Worker secret。
insert into telegram_bots (role, display_name, username, token_secret_ref) values
  ('employee', 'One23 IT.DEP BOT', 'one23_tech_bot', 'TG_BOT_TOKEN'),
  ('client', 'One23 Client BOT', null, 'TG_BOT_TOKEN_CLIENT')
on conflict (role) do update set
  display_name = excluded.display_name,
  token_secret_ref = excluded.token_secret_ref,
  updated_at = now();

commit;
