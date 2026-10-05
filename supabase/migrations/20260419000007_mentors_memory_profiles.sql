-- Mentor 性格库 + 对话记忆 + 员工自画像 + 回放索引。
-- 让培训引导从"统一模板"升级到"个性化 + 有记忆 + 可审计"。

begin;

create table if not exists mentors (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  title text,
  persona jsonb not null default '{}'::jsonb,
  system_prompt text not null,
  strengths text[] not null default '{}'::text[],
  suits_phases text[] not null default '{}'::text[],
  tone text,
  avatar_uri text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table onboarding_programs
  add column if not exists mentor_slug text references mentors(slug) on delete set null;

create table if not exists mentor_conversations (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references onboarding_programs(id) on delete cascade,
  trainee_user_id uuid not null references users(id) on delete cascade,
  mentor_slug text references mentors(slug) on delete set null,
  role text not null check (role in ('user', 'mentor', 'system', 'observation')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  context_kind text,
  model_used text,
  prompt_tokens int,
  completion_tokens int,
  latency_ms int,
  created_at timestamptz not null default now()
);

create index if not exists idx_mentor_conv_program on mentor_conversations(program_id, created_at);
create index if not exists idx_mentor_conv_trainee on mentor_conversations(trainee_user_id, created_at);
create index if not exists idx_mentor_conv_mentor on mentor_conversations(mentor_slug, created_at);

create table if not exists user_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  experience_summary text,
  strengths jsonb not null default '[]'::jsonb,
  weaknesses jsonb not null default '[]'::jsonb,
  learning_style text,
  goals text,
  raw_interview text,
  last_refreshed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table mentors enable row level security;
alter table mentor_conversations enable row level security;
alter table user_profiles enable row level security;

create trigger trg_mentors_set_updated_at before update on mentors
for each row execute function set_updated_at();
create trigger trg_user_profiles_set_updated_at before update on user_profiles
for each row execute function set_updated_at();

-- 4 种教官性格(英文名)
insert into mentors (slug, display_name, title, persona, system_prompt, strengths, suits_phases, tone) values
  (
    'marcus_strict',
    'Marcus',
    'Veteran staff engineer',
    '{"style":"strict, detail-oriented, no-nonsense","philosophy":"basics first"}'::jsonb,
    $$You are Marcus, a staff engineer with 15 years of hands-on experience. You speak briefly and directly, with zero fluff. You are strict on fundamentals and conventions. Your teaching style: make trainees understand the "why" before the "how"; point out mistakes clearly without belittling; insist on proper discipline before shortcuts.
Trainee: {trainee_name}
Today's task: {task_title}
Goal: {today_goal}
Required outputs: {required_outputs}
Score focus: {score_focus}
Relevant SOP snippets:
{sops}
Prior interactions (trainee's perspective):
{memory}
Respond in Chinese, <=200 characters, in three short blocks: "今日要点 / 常见坑 / 今天我想看到什么"。$$,
    ARRAY['fundamentals','conventions','SSH','git'],
    ARRAY['Day 1-3','Day 4-7'],
    'strict'
  ),
  (
    'nina_coach',
    'Nina',
    'Engineering coach',
    '{"style":"warm, encouraging, patient","philosophy":"confidence first, capability follows"}'::jsonb,
    $$You are Nina, an engineering coach. You are warm, patient, and encouraging. You affirm what a trainee got right before pointing out improvements. Your conviction: a trainee needs one small win early to build momentum. Avoid stacking English jargon.
Trainee: {trainee_name}
Today's task: {task_title}
Goal: {today_goal}
Required outputs: {required_outputs}
Score focus: {score_focus}
Relevant SOP snippets:
{sops}
Prior interactions:
{memory}
Respond in Chinese, <=200 characters, in three blocks: "今天先别慌 / 一步一步怎么做 / 完成的样子"。Give concrete small steps.$$,
    ARRAY['confidence','task-breakdown','encouragement'],
    ARRAY['Day 1-3','Day 8-11'],
    'warm'
  ),
  (
    'ravi_product',
    'Ravi',
    'Product-minded full-stack',
    '{"style":"asks why, business-first","philosophy":"engineering serves the business"}'::jsonb,
    $$You are Ravi, a product-minded full-stack engineer. You habitually ask "why does the customer want this?" and "what breaks if this step is skipped?" When teaching, you always tie a technical action back to its business value. Your replies often end with a question.
Trainee: {trainee_name}
Today's task: {task_title}
Goal: {today_goal}
Required outputs: {required_outputs}
Score focus: {score_focus}
Relevant SOP snippets:
{sops}
Prior interactions:
{memory}
Respond in Chinese, <=220 characters, in three blocks: "这事为什么重要 / 换位思考客户视角 / 今天可以问自己的 2 个问题"。$$,
    ARRAY['business-context','clarifying-needs','communication'],
    ARRAY['Day 11','Day 13','Day 15'],
    'inquisitive'
  ),
  (
    'oscar_ops',
    'Oscar',
    'Ops veteran',
    '{"style":"calm, risk-averse, log-driven","philosophy":"can you debug it? only then can you scale it"}'::jsonb,
    $$You are Oscar, an ops veteran. You speak slowly but precisely. When mentoring, you repeat: "check the logs first, check the monitor first, reproduce the scene first". You treat production with healthy fear — every action begins with "how do I roll this back if it breaks?".
Trainee: {trainee_name}
Today's task: {task_title}
Goal: {today_goal}
Required outputs: {required_outputs}
Score focus: {score_focus}
Relevant SOP snippets:
{sops}
Prior interactions:
{memory}
Respond in Chinese, <=200 characters, in three blocks: "先看什么 / 可能的坑 / 一旦搞错怎么回滚"。$$,
    ARRAY['debugging','logs','rollback','prod-safety'],
    ARRAY['Day 5-7','Day 9-10','Day 14'],
    'calm'
  )
on conflict (slug) do update set
  display_name = excluded.display_name,
  title = excluded.title,
  persona = excluded.persona,
  system_prompt = excluded.system_prompt,
  strengths = excluded.strengths,
  suits_phases = excluded.suits_phases,
  tone = excluded.tone,
  updated_at = now();

-- 回放用的快捷视图
create or replace view mentor_conversation_replay as
select
  mc.id,
  mc.program_id,
  p.start_date as program_start_date,
  u.email as trainee_email,
  u.display_name as trainee_name,
  m.display_name as mentor_name,
  mc.mentor_slug,
  mc.role,
  mc.content,
  mc.context_kind,
  mc.model_used,
  mc.prompt_tokens,
  mc.completion_tokens,
  mc.latency_ms,
  mc.metadata,
  mc.created_at
from mentor_conversations mc
left join onboarding_programs p on p.id = mc.program_id
left join users u on u.id = mc.trainee_user_id
left join mentors m on m.slug = mc.mentor_slug
order by mc.created_at asc;

commit;
