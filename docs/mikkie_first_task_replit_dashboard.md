# Mikkie 第一任务 — 用 Replit Agent 搭 OneAgents 管理面板

**面向:Mikkie(新人,trainee)**
**陪跑:Alps(founder)**
**项目代码:`oneagents-panel-v1`**
**主任务 id(已在 DB):`ba3fbf7a-d506-42f8-9235-dc043e8816fb`**

---

## 一、你的前 30 分钟

### Step 1(5 分钟):注册 Replit
打开 <https://replit.com> → Sign up(推荐用 GitHub 账号登录)。
Free tier 够起步,写多了要升级 Replit Core ($20/月) 才能用 Always On 和 Replit Agent 高级功能。

### Step 2(5 分钟):建一个 Next.js repl
进 Replit → **Create** → 选 **Template: Next.js**(TypeScript)→ 起名 `oneagents-panel`。

等模板自动安装完(约 30 秒),点绿色 **Run** 按钮,窗口右边出现预览 URL,形如 `https://oneagents-panel-<你的用户名>.replit.dev`。**这个 URL 先存好,后面每个 phase 交给 Alps review**。

### Step 3(3 分钟):打开 Replit Agent
Replit 编辑器右上有一个 **AI Agent** 按钮(机器人图标),点开。

### Step 4(2 分钟):复制粘贴下面的"大 prompt"给 Agent

就是把**第三节**整段复制,粘贴到 Agent 对话框,发送。Agent 会自动开工。

### Step 5(15 分钟):和 Agent 配合 Phase 0

Agent 完成后你应该能看到:
- 项目装了 `@supabase/supabase-js`、`tailwindcss`、`shadcn/ui` 的几个基础组件
- 有一个 `/` 首页能跑
- `.env` 有 `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `NEXT_PUBLIC_WORKER_URL` 占位

**你这时候做**:把下面 3 个值填进 `.env`:
```
NEXT_PUBLIC_SUPABASE_URL=https://vqqtuitmfmdjtgutmpoh.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_8hAZNFBgAKU3E0AyzFbJSg_LbDav2Dy
NEXT_PUBLIC_WORKER_URL=https://oneagents-worker.one-deploy.workers.dev
```

**Phase 0 完成标志**:项目能跑 + 这 3 个 env 就位 + 预览 URL 可访问。

去 @one23_tech_bot 在 `/chat` 告诉 mentor Nina:
```
/chat 我完成了 Phase 0,Replit URL: <粘贴>。准备开始 Phase 1。
```

等 Alps review 通过后再做 Phase 1。

---

## 二、10 个 Phase 总览

| Phase | 内容 | Mikkie 交付 | Alps 验收 |
| --- | --- | --- | --- |
| 0 | Replit bootstrap | 可访问的预览 URL + env 就位 | 能打开看到默认页 |
| 1 | 登录 / 注册(Supabase Auth) | `/login` `/signup` 能跑通 | Alps 邮箱 signup 收到验证邮件并成功 |
| 2 | App shell + 响应式导航 | sidebar + topbar + dark mode + 移动端 drawer | 手机 + 桌面同时测 |
| 3 | Dashboard 首页(角色化) | 根据 `users.role` 展示不同卡片 | 4 种角色各登录验证 |
| 4 | Clients / Projects 页 | 列表(搜索/过滤/分页)+ 详情(tabs) | 点击 CoreX 能看到 3 个项目 |
| 5 | Tasks / Meetings 页 | data-table + 详情展开 | 测 Mikkie 自己的 panel 11 个任务能看到 |
| 6 | Onboarding / Mentor 回放 | 程序进度条 + 对话气泡时间线 | 能看到 Trainee Two 的完整对话回放 |
| 7 | Workflows + 审批 | 时间线 + approve/reject 按钮 | 测触发 `employee-first-day` 并走完 |
| 8 | Knowledge / Finance / Assets | 文档浏览+上传 / Recharts 图表 / 续费日历 | 每个页都有真数据 |
| 9 | Polish + Vercel 部署 + 客户 portal | `/portal` 独立登录,全站 loading/error 齐 | 生产 URL |

每 Phase 的预期 1-2 天。整个项目 10-14 天。

---

## 三、给 Replit Agent 的"大 prompt"(整段复制粘贴)

> **Mikkie 操作**:下面 ``` 之间的整段内容**全部复制**,粘贴到 Replit Agent 对话框发送。Agent 读完会开始干活。

```
You are building an internal management panel for OneAgents,
a small tech consultancy. The panel is a Next.js 15 App Router
application, styled with Tailwind CSS and shadcn/ui,
authenticated via Supabase Auth, deployed to Vercel at the end.

It reads data directly from a Supabase Postgres database
and calls a Cloudflare Worker for mutating operations.

Please build this in 10 phases. Do not try to finish everything
in one go. After each phase, stop and list what you did, what you
changed, and how to verify. The user will test, give feedback,
then ask you to continue.

## Tech stack (use exactly these)
- Next.js 15 App Router, TypeScript strict, React 19
- Tailwind CSS v4 + shadcn/ui components (install via `pnpm dlx shadcn@latest init`, then `add` per need)
- @supabase/supabase-js + @supabase/ssr for auth
- TanStack Table v8 for data tables
- Recharts for charts
- lucide-react for icons
- next-themes for dark mode
- sonner for toasts
- zod for form validation
- react-hook-form for forms

## Environment variables (user will fill these; create .env.local template)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_WORKER_URL=https://oneagents-worker.one-deploy.workers.dev

## Data model (read-only unless noted)
All in Supabase `public` schema.
Core tables you will query:
- users (id, email, display_name, role, status, telegram_chat_id)
  roles: 'founder','member','trainee','agent' (currently)
  status: 'active','inactive','trial'
- organizations (id, name, slug, description, admin_email)
- clients (id, name, organization_id, status, billing_currency, contact_name, notes)
- client_contacts (id, client_id, name, email, role_at_client, is_primary, telegram_chat_id)
- projects (id, client_id, name, project_code, type, status,
            priority, owner_user_id, delivery_model, risk_level,
            version, maintenance_mode, summary, start_date, target_date)
- project_members (project_id, user_id, role_in_project, is_primary)
- tasks (id, project_id, parent_task_id, title, description, status,
         priority, track, version_target, assignee_user_id, reporter_user_id,
         due_at, completed_at, created_by_agent, needs_human_review)
- meetings (id, project_id, title, raw_transcript, summary, decisions,
            open_questions, happened_at, needs_human_review)
- meeting_action_items
- finance_ledger (id, project_id, client_id, entry_type, category,
                  original_currency, original_amount, rate_to_u,
                  amount_u, occurred_at, notes, needs_human_review)
- subscriptions (id, service_name, plan_name, billing_cycle,
                 currency, amount, amount_u, next_billing_date,
                 auto_renew, status)
- assets (id, project_id, asset_type, name, provider,
          renewal_date, monthly_cost_u, status)
- onboarding_programs (id, trainee_user_id, mentor_user_id,
                       template_id, mentor_slug, start_date, end_date,
                       status, final_score)
- onboarding_tasks (id, program_id, day_number, title, description,
                    status, phase, today_goal, required_tasks,
                    required_outputs, score_focus,
                    submission_notes, submission_uris, submitted_at,
                    score, grader_notes, graded_at, ai_prescore)
- mentors (slug, display_name, title, persona, system_prompt,
           strengths, suits_phases, tone, is_active)
- mentor_conversations (id, program_id, trainee_user_id, mentor_slug,
                        role, content, context_kind, model_used,
                        latency_ms, created_at)
  -- use view `mentor_conversation_replay` for easy joins
- knowledge_documents (id, title, doc_type, summary, embedding_status,
                       project_id)
- knowledge_chunks (embedding vector(1536))
- agent_runs (id, agent_name, trigger_source, status,
              actor_user_id, input_payload, output_payload, started_at)
- workflows, workflow_steps, workflow_runs, workflow_step_runs
  -- use view `workflow_run_timeline`
- notifications (id, channel, status, title, body, scheduled_for, sent_at)
- telegram_groups (chat_id, bot_role, title, client_id, project_id,
                   organization_id)
- employee_invites (id, telegram_username, mentor_slug, status)

Row Level Security is ON for all business tables.
The Supabase anon key (NEXT_PUBLIC_SUPABASE_ANON_KEY) is safe in the browser.
For reads via anon, you will need to rely on RLS policies that allow
authenticated users to read their scope. If some tables don't return
rows with anon, fall back to calling the Worker's admin endpoints
with a bearer token (to be added later).

## Mutating operations (POST to Worker, not Supabase directly)
Base URL: process.env.NEXT_PUBLIC_WORKER_URL

- POST /entities/clients              body: {name, contactName?, contactChannel?, billingCurrency?, status?, notes?}
- POST /entities/projects             body: {clientId, name, projectCode, projectType?, status?, ownerUserEmail?, deliveryModel?, riskLevel?, startDate?, targetEndDate?, description?}
- POST /entities/project-members      body: {projectId, userEmail, role}
- POST /onboarding/programs/start
- GET  /onboarding/me/today           (requires Bearer token)
- POST /onboarding/tasks/:id/submit
- POST /onboarding/tasks/:id/grade
- GET  /onboarding/programs/:id/summary
- POST /workflows/:slug/trigger
- GET  /workflow-runs/:id
- POST /workflow-runs/:id/steps/:key/complete
- POST /workflow-runs/:id/steps/:key/approve
- POST /workflow-runs/:id/steps/:key/reject
- GET  /me                            (returns current user info)

Worker auth: Authorization: Bearer <oa_...>
Admin-only routes need X-Admin-Key header.

## Roles and what each can see (implement via UI gates reading users.role)
- **founder**: everything, plus /admin section with workflow approvals,
  simulation menu, knowledge research trigger
- **member**: own assigned projects, their tasks/meetings, finance only
  for projects they own, no admin section
- **trainee**: their own onboarding program only + /chat mentor page
- **contractor** (future): read-only assigned projects

Client-side role "client" uses the /portal route, separate layout,
reads only projects under their client_id.

## Pages to build (high level)
- / (marketing redirect → /login if not signed in, else /dashboard)
- /login, /signup, /auth/callback, /logout
- /dashboard (role-detected home)
- /dashboard/clients, /dashboard/clients/[id]
- /dashboard/projects, /dashboard/projects/[id]
- /dashboard/tasks, /dashboard/tasks/[id]
- /dashboard/meetings, /dashboard/meetings/[id]
- /dashboard/onboarding (list programs), /dashboard/onboarding/[id]
- /dashboard/mentors, /dashboard/mentors/[slug] (view conversations)
- /dashboard/workflows, /dashboard/workflows/[id]
- /dashboard/approvals (awaiting_approval queue)
- /dashboard/knowledge (documents list + upload)
- /dashboard/finance (ledger + charts)
- /dashboard/assets (assets + subscriptions + renewal calendar)
- /dashboard/agent-runs (activity feed)
- /dashboard/connectors (admin only)
- /dashboard/settings
- /portal (client login)
- /portal/dashboard (client read-only)

## Design direction
- Clean, modern, inspired by Linear / Vercel dashboard / Stripe
- Default dark mode
- Tight typography (Inter or Geist), small padding, crisp borders
- Card-based layouts on dashboard home
- Data tables with column filters and sticky headers
- Mobile: collapsible drawer on the left, top bar with role badge
- Empty states that explain what to do next
- Toasts for every mutation result
- Loading skeletons (not spinners) for tables

## Phase plan — execute one at a time, stop after each and ASK FOR REVIEW

### Phase 0 — Bootstrap (DO FIRST)
Tasks:
- Set up Tailwind v4 + shadcn/ui (init, add: button, card, input, label,
  toast/sonner, avatar, dropdown-menu, sheet, tabs, badge, separator)
- Install supabase-js + ssr
- Install tanstack/react-table, recharts, lucide-react, next-themes,
  react-hook-form, zod, date-fns
- Create `/lib/supabase/client.ts` (browser) and `/lib/supabase/server.ts`
  (server with cookies)
- Create `/lib/worker.ts` — small fetch wrapper with bearer
- Create `.env.local` with the vars listed above (blank for user)
- Keep a stub home page that says "OneAgents Panel — setup complete".
- Verify it runs, then STOP. Tell the user:
  "Phase 0 done. Start the dev server, confirm the page renders,
   and fill .env.local. When you are ready for Phase 1, say 'continue'."

### Phase 1 — Auth
Tasks:
- /login page: email + password form, zod validation, Supabase signIn
- /signup: disabled by default (invite only); implement it anyway behind
  a feature flag
- /auth/callback: handle Supabase auth callback (email link flow)
- /logout route handler
- middleware.ts: redirect unauthenticated → /login when under /dashboard
- Simple user store helper that loads users.role after auth
- STOP and ask for review.

### Phase 2 — App shell + responsive nav
Tasks:
- Layout with sidebar (fixed on md+, sheet drawer on sm)
- Top bar with workspace name, search placeholder, theme toggle, user avatar menu
- Role badge visible in user menu
- Nav items gated by role
- STOP.

### Phase 3 — Dashboard home (role-detected)
Tasks:
- When role=founder: card grid with counts (clients, active projects,
  tasks todo, pending approvals, recent agent_runs, recent meetings)
- When role=member: my projects, my tasks for this week
- When role=trainee: today's onboarding task (use worker /onboarding/me/today),
  mentor brief card, relevant SOPs, submit link
- Each card has an action button linking to the corresponding list
- STOP.

### Phase 4 — Clients + Projects
Tasks:
- /dashboard/clients: TanStack Table (name, status, organization, # projects,
  billing currency), row click → /clients/[id]
- /dashboard/clients/[id]: tabs for Overview / Projects / Contacts / Finance
- /dashboard/projects: TanStack Table (code, name, client, status, version,
  maintenance_mode badge)
- /dashboard/projects/[id]: tabs for Overview / Tasks / Meetings / Members / Timeline
- "New client" button on clients page opens a dialog → POST /entities/clients
- "New project" button same pattern
- STOP.

### Phase 5 — Tasks + Meetings
Tasks:
- /dashboard/tasks: TanStack Table with filters (track, status, assignee)
  parent_task_id visualized as indentation
- /dashboard/tasks/[id]: title, description, submission, score, comments
- /dashboard/meetings: grouped by project, summary preview
- /dashboard/meetings/[id]: transcript in a scrollable panel,
  extract action items (read-only)
- STOP.

### Phase 6 — Onboarding + Mentor
Tasks:
- /dashboard/onboarding: programs table (trainee, mentor, progress %, avg score)
- /dashboard/onboarding/[id]: 15-day grid, each day clickable,
  shows task + submission + score + ai_prescore
- /dashboard/mentors: mentor cards with persona highlights
- /dashboard/mentors/[slug]: persona details + recent conversations
  use view `mentor_conversation_replay` for join
- conversations replayed as chat bubbles with role colors and
  model_used / latency_ms as small meta labels
- STOP.

### Phase 7 — Workflows + Approvals
Tasks:
- /dashboard/workflows: list of workflows with last run status
- /dashboard/workflows/[id]: show steps as a timeline,
  list recent runs, each run expandable to step_runs timeline
- /dashboard/approvals: rows from workflow_step_runs where status='awaiting_approval'
  each row has Approve / Reject buttons calling the Worker endpoints
- Toast on success/fail
- STOP.

### Phase 8 — Knowledge + Finance + Assets
Tasks:
- /dashboard/knowledge: list of knowledge_documents, filter by doc_type
  click → detail page with summary; button to trigger re-embed
  upload input that sends text to Worker /admin/knowledge/research
  (admin only)
- /dashboard/finance: ledger table + monthly total chart (Recharts Line)
  filter by currency / entry_type
- /dashboard/assets: assets table + subscriptions table with renewal calendar
  (FullCalendar would be overkill — use a month grid component showing
  dots on days with renewals)
- STOP.

### Phase 9 — Polish + Vercel + client portal
Tasks:
- Empty states everywhere (friendly illustrations from undraw or simple icons)
- Loading skeletons on every table
- Error boundaries
- Mobile: re-check every page on sm breakpoint
- Add /portal layout:
  - Separate theme (lighter, client-friendly)
  - /portal/login with the same supabase auth
  - After login, check if user email matches client_contacts.email
  - /portal/dashboard shows the client's projects, their tasks (read-only),
    their meetings (summary only, not full transcript)
  - /portal/message form that POSTs to Worker to forward as telegram message
- Deploy to Vercel (via GitHub integration)
- STOP with the production URL.

At the end of each phase, show:
1. Files changed (list)
2. Commands to test the feature locally
3. One screenshot description of the expected UI
4. A single paragraph to paste to the user's mentor bot for review

DO NOT SKIP phases or try to deliver multiple at once.
DO NOT use shortcut libraries I did not list.
DO NOT generate fake seed data — rely on the real Supabase data.
DO NOT output markdown explanations longer than 20 lines — keep replies short.

Start with Phase 0 now.
```

---

## 四、和培训 bot 配合的流程

### 每 Phase 完成的提交模板

你在 @one23_tech_bot 私聊里发:

```
/chat Phase X 完成
- 预览 URL: <https://...>
- 主要改动: <一句话>
- 测试过的事: <列 3 条>
- 碰到的坑: <如果有>
- 附截图(回复贴图片)
```

Mentor Nina 会:
1. 给你一段回应(鼓励 + 小建议)
2. Alps 的 Telegram 会收到通知,去 Alps 自己的"陪跑 Day X"任务卡打分 + 批准你进下一个 phase

### 碰到技术卡点

```
/chat 我在 Phase 3 卡住了,supabase rls 查 users 返回空数组,
但我是登录的 founder。不知道怎么查。
```

Mentor 会基于知识库里的 SOP + 你历史对话给出建议。还不行就 @Alps 直接问。

### 看今日任务

```
/today
```
会显示你在 **15 天培训模板** 下的当日任务(和 panel 构建并行)。

> **重要**:你有**两条平行线**
> - panel 构建的 11 个任务(1 主 + 10 phase)— 在 `tasks` 表,你是 assignee
> - 15 天培训(默认模板)— 在 `onboarding_tasks` 表,配 Nina
>
> panel 构建**本身就是**你的实战训练,但我们仍然保留培训 rubric 走 5 维评分(环境/协作/执行/排查/文档/责任感)。你每完成一 phase,Alps 会打分写进 onboarding_tasks.score。

---

## 五、工具清单

除了 Replit,你会用到:

| 工具 | 干嘛 |
| --- | --- |
| Telegram(含 @one23_tech_bot) | 每天的主要对话入口 |
| Supabase Dashboard(只读)| 看数据库真实数据来对照你代码是否对了 Alps 会给你 read-only access |
| Vercel(Phase 9 注册)| 部署目标 |
| 本地浏览器 | 测手机尺寸(Chrome DevTools → Toggle device toolbar) |
| GitHub(可选)| Replit 能自动 sync 到 GitHub,正式上线前 Alps 会教你 |

---

## 六、第一天具体 checklist

```
☐ 找 Alps 拿 Telegram bot 邀请(我们需要你的 @username)
☐ 打开 @one23_tech_bot,发 /start,按提示回复姓名 / 邮箱 / 技术背景
☐ 收到 Day 1 任务,Mentor Nina 的第一段引导
☐ 注册 Replit(用 GitHub 登录最省事)
☐ 建 Next.js repl 叫 oneagents-panel
☐ 点 Run 看到默认页面
☐ 打开 Agent,粘贴上面第三节的"大 prompt"
☐ Agent 完成 Phase 0,告诉你"done",STOP
☐ 把 .env.local 的 3 个变量填上(Alps 给)
☐ /chat 告诉 Nina "Phase 0 done, URL: xxx",等 Alps 批准
☐ 开始 Phase 1
```

---

## 七、记住两个最重要的事

1. **别让 Agent 一次做完所有 phase**。prompt 里明确要求它每个 phase 停下来等你确认。如果 Agent 跑太快,打断它,说"pause, let me verify phase X first"。

2. **每个 phase 都截图 + 写测试记录**。Alps 的 review 根据截图和你写的测试记录打分,不是看代码多花哨。

---

## 八、联系人

- **陪跑 mentor**:Alps(founder)— Telegram: @AlpsZhang
- **AI 教官**:Nina(温和型)— /chat 直接问
- **技术问题优先级**:先自己查 15 分钟 → 问 Nina → 再不行 @Alps

---

祝你顺利,开工吧 ✨
