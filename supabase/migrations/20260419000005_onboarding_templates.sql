-- 15 天培训模板 + 扩展 onboarding_tasks 以支持提交与 AI 预评分。

begin;

create table if not exists onboarding_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  duration_days smallint not null default 15,
  score_rubric jsonb not null default '[]'::jsonb,
  version smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists onboarding_template_tasks (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references onboarding_templates(id) on delete cascade,
  day_number smallint not null check (day_number between 1 and 30),
  phase text not null,
  title text not null,
  today_goal text,
  required_tasks text,
  required_outputs text,
  score_focus text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, day_number)
);

alter table onboarding_programs
  add column if not exists template_id uuid references onboarding_templates(id) on delete set null;

alter table onboarding_tasks
  add column if not exists template_task_id uuid references onboarding_template_tasks(id) on delete set null,
  add column if not exists phase text,
  add column if not exists today_goal text,
  add column if not exists required_tasks text,
  add column if not exists required_outputs text,
  add column if not exists score_focus text,
  add column if not exists submission_notes text,
  add column if not exists submission_uris text[] not null default '{}'::text[],
  add column if not exists submitted_at timestamptz,
  add column if not exists graded_at timestamptz,
  add column if not exists grader_notes text,
  add column if not exists ai_prescore jsonb;

alter table onboarding_templates enable row level security;
alter table onboarding_template_tasks enable row level security;

create index if not exists idx_onboarding_tasks_program_day on onboarding_tasks(program_id, day_number);

create trigger trg_onboarding_templates_set_updated_at before update on onboarding_templates
for each row execute function set_updated_at();
create trigger trg_onboarding_template_tasks_set_updated_at before update on onboarding_template_tasks
for each row execute function set_updated_at();

-- 默认 15 天模板
insert into onboarding_templates (name, description, duration_days, score_rubric, version) values
  (
    'default_15_day',
    '内置 15 天培训路线。来源:docs/onboarding_track.md v0.1。',
    15,
    '[
      {"dimension":"环境配置能力","weight":0.20,"note":"工具、账号、SSH、IDE 配置独立性"},
      {"dimension":"协作能力","weight":0.20,"note":"GitHub、任务流、汇报流程使用"},
      {"dimension":"执行能力","weight":0.25,"note":"能否完成简单任务"},
      {"dimension":"排查能力","weight":0.15,"note":"日志、定位、假设能力"},
      {"dimension":"文档与沟通","weight":0.10,"note":"纪要与汇报清晰度"},
      {"dimension":"责任感与稳定性","weight":0.10,"note":"按时反馈、遇阻不卡死"}
    ]'::jsonb,
    1
  )
on conflict (name) do update set
  description = excluded.description,
  score_rubric = excluded.score_rubric,
  updated_at = now();

-- Day 1-15 模板任务
with tpl as (select id from onboarding_templates where name = 'default_15_day')
insert into onboarding_template_tasks (template_id, day_number, phase, title, today_goal, required_tasks, required_outputs, score_focus)
select tpl.id, d.* from tpl, (values
  (1::smallint, '阶段一:环境准备 (Day 1-3)', '组织进入与工具安装', '获得工作身份与基础工具', '登录企业邮箱、加入 Telegram 群、安装 WebStorm、安装 Claude Code、安装 Git', '工具安装截图、登录成功截图、设备与系统信息', '是否能独立完成安装与登录'),
  (2::smallint, '阶段一:环境准备 (Day 1-3)', '代码与协作环境', '获取 GitHub 访问与本地仓库能力', '登录 GitHub、加入组织、配置 SSH Key、克隆示例仓库、成功拉取代码', 'SSH 配置记录、仓库 clone 成功截图', '是否理解仓库、分支与提交基本概念'),
  (3::smallint, '阶段一:环境准备 (Day 1-3)', '基础开发环境连通', '能在本地打开项目并运行基础命令', '用 WebStorm 打开仓库、安装依赖、启动项目、读取 README、记录卡点', '本地运行截图、问题清单', '是否能整理问题而不是只说"跑不起来"'),
  (4::smallint, '阶段二:协作认知 (Day 4-7)', '部署平台认知', '认识 Cloudflare / Vercel / Netlify 的角色', '登录部署平台、识别已有项目、查看环境变量位置、理解部署日志入口', '各平台截图与说明', '是否知道哪个平台负责什么'),
  (5::smallint, '阶段二:协作认知 (Day 4-7)', 'SSH 与服务器基础', '能连接到主开发服务器', '配置 SSH、登录服务器、查看目录、理解基础 Linux 命令', 'SSH 登录截图、常用命令笔记', '是否能安全连接并描述所做操作'),
  (6::smallint, '阶段二:协作认知 (Day 4-7)', '数据库连接基础', '能连接 Supabase 并查看基础数据结构', '登录 Supabase、识别项目、查看表结构、理解环境区分', '表结构截图、术语说明', '是否理解生产库、测试库和权限差异'),
  (7::smallint, '阶段二:协作认知 (Day 4-7)', 'DNS 与域名基础', '理解域名解析与站点绑定', '查看 Cloudflare DNS、识别 A 记录 / CNAME、理解域名与站点关系', 'DNS 记录截图、解释说明', '是否能区分域名、DNS、服务器和站点'),
  (8::smallint, '阶段三:执行练习 (Day 8-11)', '简单代码修改', '完成一次小范围代码变更', '新建分支、修改代码、提交 commit、发起 PR 或补丁', 'commit 链接、变更说明', '是否会说明改了什么、为什么这样改'),
  (9::smallint, '阶段三:执行练习 (Day 8-11)', '日志与错误定位', '能读日志和定位错误入口', '查看构建日志、运行日志、找出一个报错来源、给出解释', '报错截图、分析记录', '是否有结构化排查思路'),
  (10::smallint, '阶段三:执行练习 (Day 8-11)', '订阅与资源记录', '学会记录资产与订阅', '录入一个域名、一个服务器、一个订阅服务到资产台账', '录入记录、字段说明', '是否能正确识别归属与到期时间'),
  (11::smallint, '阶段三:执行练习 (Day 8-11)', '会议纪要转行动项', '能整理会议要点并抽取任务', '阅读一份纪要、提炼结论、列出行动项与负责人建议', '纪要整理文档', '是否能区分结论、问题与待确认项'),
  (12::smallint, '阶段四:独立交付 (Day 12-15)', '小任务独立执行', '独立完成一个小任务', '接单、执行、记录、回报', '任务结果、提交链接、说明', '是否能独立推进而不是等待逐条指挥'),
  (13::smallint, '阶段四:独立交付 (Day 12-15)', '交付表达训练', '输出一份结构清晰的任务汇报', '写任务背景、处理过程、结果、遗留问题', '汇报文档', '是否表达清楚、简洁、可信'),
  (14::smallint, '阶段四:独立交付 (Day 12-15)', '模拟综合任务', '完成一次小型端到端任务', '拉代码、改配置、连接平台、提交结果、写总结', '完整任务记录', '是否形成完整工作闭环'),
  (15::smallint, '阶段四:独立交付 (Day 12-15)', '最终评估', '完成试用期总结与最终评估', '自评、知识点回顾、负责人面评', '试用总结、评分表', '是否具备独立承担基础任务的能力')
) as d(day_number, phase, title, today_goal, required_tasks, required_outputs, score_focus)
on conflict (template_id, day_number) do update set
  phase = excluded.phase,
  title = excluded.title,
  today_goal = excluded.today_goal,
  required_tasks = excluded.required_tasks,
  required_outputs = excluded.required_outputs,
  score_focus = excluded.score_focus,
  updated_at = now();

-- 7 份 SOP 种子(以文档片段形式入库。具体内容随后由你或 agent 扩写;这里保证检索层有基础材料)
insert into knowledge_documents (title, doc_type, source_uri, summary, embedding_status)
values
  ('SOP:工具安装', 'sop', 'docs/onboarding_track.md#day-1', 'Day 1 所需工具:企业邮箱 (Google Workspace)、Telegram、WebStorm、Claude Code、Git。每项需要安装成功截图与登录截图。', 'pending'),
  ('SOP:账号申请', 'sop', 'docs/onboarding_track.md#day-2', '新人账号体系:GitHub(加入 org + SSH key)、Supabase(加入项目组)、Cloudflare(dash 访问)、企业邮箱(自己域名)。所有账号绑定个人邮箱后再邀请到企业。', 'pending'),
  ('SOP:项目命名规则', 'sop', 'docs/product_scope.md', '项目代码格式:<client-slug>-<short-desc>-<env>。例:acme-dashboard-prod。slug 小写连字符,禁止空格。创建时写入 projects.project_code。', 'pending'),
  ('SOP:Git 提交流程', 'sop', 'docs/onboarding_track.md#day-8', '分支:feat/*, fix/*, chore/*。commit message 动词开头(英文)。PR 必须描述变更动机 + 测试方法。禁止直接 push 到 main。', 'pending'),
  ('SOP:服务器连接', 'sop', 'docs/onboarding_track.md#day-5', '主开发服务器通过 SSH key 登录,IP 与用户名见 assets 表 asset_type=server。第一次登录后把 public key 贴进服务器 ~/.ssh/authorized_keys。禁止在服务器上直接改生产数据。', 'pending'),
  ('SOP:数据库基础', 'sop', 'docs/onboarding_track.md#day-6', '公司运营库在 Supabase 项目 oneagents。生产 key 只给 service_role 持有者。新人默认给 anon/publishable,只能做只读查询。生产/测试环境区分:APP_ENV=prod / dev。', 'pending'),
  ('SOP:部署平台说明', 'sop', 'docs/onboarding_track.md#day-4', 'Cloudflare:Workers(后端 agent)、DNS、R2 存储。Vercel:前端 Next.js 站点。Netlify:历史客户项目。每个平台的账号都需要 2FA。', 'pending')
on conflict do nothing;

commit;
