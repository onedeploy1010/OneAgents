-- TrainingCoach 所需:课程内容字段 + review 表 + program 状态扩展。

begin;

-- 课程内容(实际学习素材,和 required_tasks 分开)
alter table onboarding_tasks
  add column if not exists course_content text,
  add column if not exists difficulty smallint default 3,
  add column if not exists extended_from_task_id uuid references onboarding_tasks(id) on delete set null,
  add column if not exists is_remedial boolean not null default false;

-- program 侧:coach 的运行状态
alter table onboarding_programs
  add column if not exists coach_state jsonb not null default '{}'::jsonb,
  add column if not exists last_coach_review_at timestamptz,
  add column if not exists is_paused boolean not null default false,
  add column if not exists pause_reason text;

-- Coach 每次 review 的记录 + 建议 + 执行结果
create type coach_review_trigger as enum ('cron_daily', 'cron_weekly', 'manual', 'submission_lag', 'low_score', 'silence_24h');
create type coach_recommendation_kind as enum (
  'switch_mentor',
  'extend_due',
  'add_remedial_task',
  'pause_program',
  'resume_program',
  'send_encouragement',
  'flag_for_review',
  'promote_to_member',
  'extend_program'
);

create table if not exists training_coach_reviews (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references onboarding_programs(id) on delete cascade,
  trigger coach_review_trigger not null,
  findings jsonb not null default '{}'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  raw_llm_response text,
  applied_at timestamptz,
  applied_by_user_id uuid references users(id) on delete set null,
  rejected_at timestamptz,
  rejected_reason text,
  auto_applied boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_coach_reviews_program on training_coach_reviews(program_id, created_at desc);
create index if not exists idx_coach_reviews_pending
  on training_coach_reviews(created_at desc)
  where applied_at is null and rejected_at is null;

alter table training_coach_reviews enable row level security;

create trigger trg_training_coach_reviews_set_updated_at before update on training_coach_reviews
for each row execute function set_updated_at();

-- 每一条具体 adjustment 的执行记录(便于回放和撤销)
create table if not exists training_coach_actions (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references training_coach_reviews(id) on delete cascade,
  kind coach_recommendation_kind not null,
  params jsonb not null default '{}'::jsonb,
  result jsonb,
  executed_at timestamptz not null default now(),
  rolled_back_at timestamptz
);

create index if not exists idx_coach_actions_review on training_coach_actions(review_id);

alter table training_coach_actions enable row level security;

commit;
