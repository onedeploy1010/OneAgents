-- Replit panel 专属 15 天培训模板(给 Mikkie 等做 Replit 面板的新人)。
-- 每天任务量对齐 panel phase,跳过企业邮箱/WebStorm/Claude Code(用 Replit Agent 替代)。
-- 同时加 employee_invites.template_slug 以便邀请流程指定模板。

begin;

alter table employee_invites
  add column if not exists template_slug text;

insert into onboarding_templates (name, description, duration_days, score_rubric, version)
values (
  'replit_panel_15day',
  'Replit Agent 构建 OneAgents 面板的 15 天并行培训。每天任务与 panel 构建 10 个 phase 对齐。',
  15,
  '[
    {"dimension":"Prompt 能力","weight":0.20,"note":"能否用 Replit Agent 做出符合要求的代码"},
    {"dimension":"测试 & 验证","weight":0.20,"note":"每 phase 能否给出测试步骤和截图"},
    {"dimension":"执行能力","weight":0.20,"note":"是否准时交 phase"},
    {"dimension":"调试能力","weight":0.15,"note":"Agent 出错能否自己修或提出正确问题"},
    {"dimension":"文档与沟通","weight":0.15,"note":"提交说明是否清晰"},
    {"dimension":"责任感与稳定性","weight":0.10,"note":"卡住不拖,及时反馈"}
  ]'::jsonb,
  1
)
on conflict (name) do update set
  description = excluded.description,
  score_rubric = excluded.score_rubric,
  updated_at = now();

-- 15 天任务
with tpl as (select id from onboarding_templates where name = 'replit_panel_15day')
insert into onboarding_template_tasks (template_id, day_number, phase, title, today_goal, required_tasks, required_outputs, score_focus)
select tpl.id, d.* from tpl, (values
  (1::smallint, 'Kickoff', 'Day 1 — 加入 + Replit 注册 + Phase 0',
   '装好工作身份 + Replit bootstrap 项目',
   'Telegram /start 完成 intake;注册 Replit;建 Next.js repl 叫 oneagents-panel;粘贴 Agent 大 prompt;完成 Phase 0',
   'Replit preview URL;Phase 0 截图;告诉 Nina"Phase 0 done"',
   '是否理解项目大图;有没有先读 Mikkie 手册'),
  (2::smallint, 'Phase 1', 'Day 2 — Auth(登录 + 注册页)',
   'Supabase Auth 接入,能登录',
   '复 /login /signup;middleware 保护 /dashboard;用 Alps 给的测试邮箱走一遍邮件验证',
   'URL + 登录截图 + 签出/登录/签出的录屏',
   '密码/邮箱流是否清晰;遇到 RLS 错时能否描述清'),
  (3::smallint, 'Phase 2', 'Day 3 — App shell(响应式导航)',
   '侧栏+顶栏+dark mode+移动端 drawer',
   '装 shadcn 的 sheet/dropdown/avatar;实现 md:固定侧栏,sm:drawer;角色 badge',
   '桌面+手机两张截图',
   '细节是否到位;移动端是否真可用'),
  (4::smallint, 'Phase 3', 'Day 4 — Dashboard 首页(角色化)',
   '根据 users.role 展示不同卡片',
   'founder 全局 / member 自己项目 / trainee 自己培训;连真实 Supabase 数据',
   '4 种角色登录各一张截图',
   '是否理解每个角色关心什么'),
  (5::smallint, 'Phase 4a', 'Day 5 — Clients 列表 + 详情',
   'TanStack Table + 详情 tabs',
   '列表支持搜索/过滤/分页;详情有 overview/projects/contacts',
   '列表截图;CoreX 详情页截图',
   '表格和空状态是否有设计感'),
  (6::smallint, 'Phase 4b', 'Day 6 — Projects 列表 + 详情',
   '',
   '列表项目 tabs(任务/会议/成员/时间线);"新项目"按钮调 /entities/projects',
   '截图;建一个新项目测一下',
   '能否自信改动数据并立即测'),
  (7::smallint, 'Phase 5', 'Day 7 — Tasks + Meetings',
   '两个模块同时推',
   'Tasks 可按 track/status/assignee 过滤,parent 用缩进展示;Meetings 带 transcript 展开',
   '两页截图;点开你自己的 panel-v1 项目看 11 个任务能否正确显示',
   '数据结构理解深度'),
  (8::smallint, 'Phase 6', 'Day 8 — Onboarding + Mentor',
   '培训进度 + mentor 对话回放',
   '进度条 + 每日卡片;对话用气泡时间线展示,右侧 meta(model/latency)',
   '回放截图(选 Trainee Two)',
   'UX 是否让 superadmin 一眼看明白对话质量'),
  (9::smallint, 'Phase 7', 'Day 9 — Workflows + 审批队列',
   '时间线视图 + 审批按钮',
   'Workflow list;run detail 展开 step_runs;Approvals 页有 approve/reject 按钮调 Worker',
   '截图 + 真的审批一条',
   '能否让 founder 在 30 秒内批一堆'),
  (10::smallint, 'Phase 8', 'Day 10 — Knowledge + Finance + Assets',
   '次要模块集中完成',
   'Knowledge 浏览+上传;Finance Recharts 月度;Assets 续费日历',
   '三页截图',
   '复用组件的能力'),
  (11::smallint, 'Polish A', 'Day 11 — Empty / Loading / Error 全覆盖',
   '让空页面/加载/错误都有设计',
   '每个表都加 skeleton;空状态文案友好;错误边界',
   '截图对比 Phase 前后',
   '对细节的关注'),
  (12::smallint, 'Polish B', 'Day 12 — 移动端全量实测',
   '所有页面 iPhone + Android 尺寸都过一遍',
   'Chrome DevTools 模拟 + 真手机测至少 3 个页面',
   'Bug 清单 + 修复列表',
   '能否发现细节 bug'),
  (13::smallint, 'Phase 9a', 'Day 13 — 客户 portal /portal',
   '独立登录 + 限制只读',
   '/portal/login 用 Supabase Auth;根据 email 查 client_contacts;/portal/dashboard 只看自己 client 的 projects',
   '用 client 邮箱模拟登录截图',
   '权限边界把握'),
  (14::smallint, 'Phase 9b', 'Day 14 — Vercel 部署 + E2E',
   '上线到生产 URL',
   '用 Vercel + GitHub 集成;环境变量搬过去;全角色 E2E 测一遍',
   '生产 URL + 4 种角色成功登录的截图',
   '生产环境问题能否独立解决'),
  (15::smallint, 'Retro', 'Day 15 — 复盘 + 写 review',
   '总结学到什么',
   '写一份 reflection.md:学到的/难的/建议;Alps 做 final 面评;决定是否转正',
   'reflection.md + 面评记录',
   '总结深度和诚实度')
) as d(day_number, phase, title, today_goal, required_tasks, required_outputs, score_focus)
on conflict (template_id, day_number) do update set
  phase = excluded.phase,
  title = excluded.title,
  today_goal = excluded.today_goal,
  required_tasks = excluded.required_tasks,
  required_outputs = excluded.required_outputs,
  score_focus = excluded.score_focus,
  updated_at = now();

-- 给 Mikkie 的邀请指定此模板
update employee_invites
set template_slug = 'replit_panel_15day',
    notes = coalesce(notes, '') || ' [template=replit_panel_15day]'
where invited_by_user_id = (select id from users where email = 'onelongmarketing@gmail.com')
  and status = 'pending'
  and notes like 'Mikkie%';

commit;
