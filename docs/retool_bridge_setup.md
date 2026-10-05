# Retool 桥接面板搭建指南

**目的**:在 Mikkie 的 Replit 面板上线前,用 Retool 给你一个 4 小时能用的内部桌面。
**定位**:**短期桥梁**,不是长期。Mikkie 面板上线后这个可以弃掉。

---

## 一、Retool 和 Replit 工作方式的区别

| 方面 | Retool | Replit(Mikkie 用) |
| --- | --- | --- |
| 构建方式 | 连数据 → 拖组件 → 配 Query → 配 Action | Agent 从自然语言写源码 |
| AI 作用 | 辅助(生成 Query / 单个组件) | 主力(写整个 app) |
| 整体 prompt | ❌ 不支持"一个 prompt 全搭完" | ✅ 一大段 prompt 建全部 |
| 每页你要做的 | 新建 App → 连数据 → 拖组件 → 对 AI 说"给我个 table 展示 X" | Agent 自动建文件 |

**所以 Retool 不是"一个 prompt" — 而是 5 个小 prompt + 5 个 SQL 查询。**

---

## 二、Step 1 — 注册 Retool + 连接 Supabase(一次性,10 分钟)

### 1. 注册
<https://retool.com> → Sign up(免费 tier 5 个用户)。

### 2. 新建 Resource(数据源)
1. 左下角 **Resources** → **Create new** → **Postgres**(不是 Supabase 那个,直接选 Postgres 走 connection string)
2. 填连接信息(从 Supabase Dashboard → Project Settings → Database → Connection string → Session pooler):
   ```
   Host: aws-x-<region>.pooler.supabase.com
   Port: 5432(或 6543 pooler)
   Database: postgres
   Username: postgres.<project-ref>
   Password: onelong53541314(你的 DB 密码)
   SSL: require
   ```
3. 测试连接 → Save,取名 `oneagents-supabase`

### 3. 新建 REST API Resource(选填,调 Worker 用)
1. Resources → Create → **REST API**
2. Base URL: `https://oneagents-worker.one-deploy.workers.dev`
3. Headers 里加:
   ```
   Authorization: Bearer oa_B8KkoKJaVECuivTGOtFvkDikqXMOQwBvUxcimjbseYE   (你的 founder token)
   ```
4. Save,取名 `oneagents-worker`

### 4. 新建 App
左栏 **Apps** → Create new app → 取名 `oneagents-ops-bridge`。

---

## 三、App 布局方案

推荐顶部 tab 切换 5 个页面:

```
┌──────────────────────────────────────────────┐
│ OneAgents Ops                                │
│ [概览] [审批队列] [客户需求] [培训回放] [活动日志] │
├──────────────────────────────────────────────┤
│  (页面内容)                                   │
└──────────────────────────────────────────────┘
```

实现:拖 `Tabbed Container`(组件菜单 → Layout → Tabs),5 个 tab 对应下面 5 页。

---

## 四、每页 AI Prompt + 查询(照抄即可)

### Page 1:概览仪表盘

**告诉 Retool AI(右上角 AI 按钮)**:
```
Create a dashboard overview with 5 stat cards in a grid:
1. Active projects count
2. Tasks pending review (needs_human_review=true)
3. Pending approvals (workflow_step_runs where status='awaiting_approval')
4. Client needs this week (tasks where source_channel='telegram_client:new_need' and created_at > now() - interval '7 days')
5. Agent runs last 24h count

Use Resource: oneagents-supabase (Postgres).
```

**SQL 查询(手动加的 5 条 Query,点 + New query,选 Resource = oneagents-supabase):**

```sql
-- stat_active_projects
select count(*)::int as n from projects where status in ('active','planning');

-- stat_pending_reviews
select count(*)::int as n from tasks where needs_human_review = true and status != 'done';

-- stat_pending_approvals
select count(*)::int as n from workflow_step_runs where status = 'awaiting_approval';

-- stat_client_needs_week
select count(*)::int as n from tasks
where source_channel = 'telegram_client:new_need'
  and created_at > now() - interval '7 days';

-- stat_agent_runs_24h
select count(*)::int as n from agent_runs where started_at > now() - interval '24 hours';
```

把每个 card 的 value 绑到对应 query 的 `data[0].n`。

---

### Page 2:审批队列(最常用)

**告诉 Retool AI**:
```
Build a Kanban-style view of pending approvals. Left column: workflow step runs awaiting approval. Show step_key, workflow name, created_at, and two buttons per row: Approve / Reject. On Approve click, call REST POST to /workflow-runs/{{run_id}}/steps/{{step_key}}/approve. On Reject, open a modal asking for reason, then POST to reject endpoint.

Use Resource: oneagents-worker for approve/reject, oneagents-supabase for the list.
```

**SQL(命名 `list_pending_approvals`):**
```sql
select
  sr.id as step_run_id,
  sr.run_id,
  sr.step_key,
  sr.created_at,
  w.name as workflow_name,
  p.name as project_name,
  c.name as client_name
from workflow_step_runs sr
join workflow_runs r on r.id = sr.run_id
join workflows w on w.id = r.workflow_id
left join projects p on p.id = r.project_id
left join clients c on c.id = r.client_id
where sr.status = 'awaiting_approval'
order by sr.created_at desc;
```

**Approve 按钮 action**:
- Type: Run script / REST query
- Resource: oneagents-worker
- Method: POST
- URL: `/workflow-runs/{{ currentRow.run_id }}/steps/{{ currentRow.step_key }}/approve`
- Body: `{}`
- 成功后:Toast "已批准" + 刷新 list

**Reject 按钮**:同上,URL 改 /reject,Body 带 `{reason: "..."}` 从 modal input 读。

---

### Page 3:客户需求看板

**告诉 Retool AI**:
```
Build a table listing all client needs from tasks table where source_channel='telegram_client:new_need'. Columns: title, client name, project code, priority, status, created_at. Row click opens a detail drawer with description, a Status dropdown (todo → doing → done), and a button "Reply to client via Telegram" that opens a modal with a message input, then POSTs to /clients/<id>/reply (we'll mock this if not implemented yet, just a console.log).

Sort by priority ASC then created_at DESC.
```

**SQL(`list_client_needs`):**
```sql
select
  t.id,
  t.title,
  t.description,
  t.priority,
  t.status,
  t.created_at,
  p.project_code,
  p.name as project_name,
  c.name as client_name,
  c.id as client_id
from tasks t
join projects p on p.id = t.project_id
join clients c on c.id = p.client_id
where t.source_channel = 'telegram_client:new_need'
order by t.priority asc nulls last, t.created_at desc;
```

**Status 更新**(inline dropdown):
```sql
-- update_task_status
update tasks set status = {{ newStatus }}, updated_at = now() where id = {{ selectedRow.id }};
```

---

### Page 4:培训对话回放

**告诉 Retool AI**:
```
Build a two-pane layout. Left: list of trainees who have active onboarding_programs, showing name, mentor, progress. Right: when a trainee is selected, show their mentor_conversations as chat bubbles with role-colored background (user=blue, mentor=green, observation=gray). Include model_used and latency_ms as small meta. Sort by created_at ASC.

Resource: oneagents-supabase.
```

**SQL 左:`list_active_trainees`:**
```sql
select
  op.id as program_id,
  u.display_name,
  u.email,
  op.mentor_slug,
  op.start_date,
  op.end_date,
  (select count(*) from onboarding_tasks ot where ot.program_id = op.id and ot.status = 'done')
    || '/' ||
    (select count(*) from onboarding_tasks ot2 where ot2.program_id = op.id) as progress
from onboarding_programs op
join users u on u.id = op.trainee_user_id
where op.status = 'active'
order by op.start_date desc;
```

**SQL 右:`get_conversations`(参数 program_id):**
```sql
select
  role,
  content,
  context_kind,
  model_used,
  latency_ms,
  created_at
from mentor_conversation_replay
where program_id = {{ selectedTrainee.program_id }}
order by created_at asc;
```

---

### Page 5:活动日志(agent_runs)

**告诉 Retool AI**:
```
Build a filterable table of agent_runs. Columns: agent_name, trigger_source, status, actor (join users), started_at. Filters at the top: agent_name dropdown, status dropdown, date range picker. Click row to expand and show input_payload and output_payload as formatted JSON.
```

**SQL(`list_agent_runs`):**
```sql
select
  ar.id,
  ar.agent_name,
  ar.trigger_source,
  ar.status,
  u.display_name as actor,
  ar.started_at,
  ar.input_payload,
  ar.output_payload,
  ar.error_message
from agent_runs ar
left join users u on u.id = ar.actor_user_id
where
  ({{ filterAgent.value === 'all' }} or ar.agent_name = {{ filterAgent.value }})
  and ({{ filterStatus.value === 'all' }} or ar.status = {{ filterStatus.value }})
  and ar.started_at >= {{ dateRange.value.start }}
  and ar.started_at <= {{ dateRange.value.end }}
order by ar.started_at desc
limit 200;
```

---

## 五、权限设置(Retool 角色)

Retool 自带角色。建议:

| Retool 角色 | 谁 | 能看什么 |
| --- | --- | --- |
| Admin | Alps | 全部 5 页 + 编辑 App |
| Editor | 核心员工 | 全部 5 页,不能改 App 结构 |
| End User | 普通员工 | 只 Page 1 + Page 3(他们自己客户需求)|

App 里用 `current_user.role` 做条件渲染:
```javascript
// Tabs 的 Hidden 条件
{{ current_user.role === 'end_user' && ['概览', '客户需求'].includes(tabName) === false }}
```

---

## 六、上线 checklist

```
☐ 注册 Retool
☐ 添加 Postgres Resource(连 Supabase)
☐ 添加 REST API Resource(连 Worker)
☐ 新建 App oneagents-ops-bridge
☐ Tab 1 概览 — 5 个 stat cards + 5 个 SQL
☐ Tab 2 审批队列 — list_pending_approvals + approve/reject buttons
☐ Tab 3 客户需求 — list_client_needs + status 更新
☐ Tab 4 培训回放 — 两栏布局 + mentor_conversation_replay
☐ Tab 5 活动日志 — 筛选 table + JSON expand
☐ 邀请 1-2 个同事测试
☐ 贴 domain 给自己用(或用 Retool 子域)
```

**预期时间**:4-6 小时(第一次用 Retool 可能要查文档多一点)。

---

## 七、对 Retool AI 的"起手式"

打开 App 编辑器 → 右上 ✨ AI 图标 → 聊天框里粘:

```
I'm building an internal operations panel for OneAgents. The panel connects to a Postgres database (Supabase) already added as Resource "oneagents-supabase" and a REST API Resource called "oneagents-worker" base URL https://oneagents-worker.one-deploy.workers.dev with bearer auth.

The panel has 5 tabs:
1. Overview (5 stat cards)
2. Approvals queue (tasks + workflow_step_runs awaiting_approval)
3. Client needs (tasks where source_channel='telegram_client:new_need')
4. Training replay (onboarding_programs + mentor_conversations)
5. Activity log (agent_runs with filters)

Start by creating the tab layout and the first page (Overview). I'll guide you through each page one at a time. Use shadcn-like clean design. Dark mode default.
```

AI 会建起骨架。然后每个 tab 里分别粘上面第四节的对应 prompt + SQL。

---

## 八、常见坑

| 坑 | 解决 |
| --- | --- |
| 连接 Supabase 失败 | 检查用户名格式 `postgres.<ref>`;SSL 必须 require;pooler 端口 6543 |
| RLS 让查询返回空 | Retool 用 service_role connection 就不受 RLS 限制;或 Postgres 的 DB 密码用户默认绕过 RLS |
| AI 生成的 Query 用了错列名 | 改一下就行,AI 不总知道你的 schema |
| 按钮 click 调 Worker 失败 | 检查 bearer token;看 Worker 日志 `wrangler tail` |

---

## 九、多人使用 + 角色化显示(必读)

**一个 Retool workspace + 一个 app,不同人登录看到不同内容**。不要做多个 app。

### 9.1 邀请员工进 Retool workspace

1. Retool 右下角头像 → **Settings** → **Users & groups**
2. 点 **Invite**
3. 填员工企业邮箱(建议 `xxx@one23x.com`)+ 选 Role:
   - **Admin** — 你自己
   - **Editor** — 给 1-2 个核心员工(能改 app)
   - **End User** — 其他所有员工(只能用,不能改)
4. 员工收邮件 → 设密码 → 登录
5. 共享你的 app 给整个 workspace(app 页面顶部 → **Share** → Everyone in workspace)

**关键**:员工的 Retool 登录邮箱必须和 Supabase `users.email` 一致,app 才能识别他是谁。

### 9.2 在 app 里加 `who_am_i` query(必做第一步)

**新 Query(SQL,Resource = oneagents-supabase):**

Query 名:`who_am_i`
SQL:
```sql
select id, email, display_name, role, status
from users
where lower(email) = lower({{ current_user.email }})
limit 1;
```

**设置为 app 加载时自动运行**(Query 设置 → Event handlers → On page load)。

之后全 app 处处可以写:
```javascript
{{ who_am_i.data[0]?.role }}      // 'founder' / 'member' / 'trainee'
{{ who_am_i.data[0]?.id }}        // user uuid
{{ who_am_i.data[0]?.display_name }}
```

### 9.3 角色化 Tab 显示

顶部 `Tabbed Container` 的每个 tab 有 **Hidden** 属性,写:

| Tab | Hidden 条件 | 谁能看 |
| --- | --- | --- |
| 我的(/me) | 永远显示 | 所有人 |
| 概览 | `{{ !['founder', 'member'].includes(who_am_i.data[0]?.role) }}` | founder + member |
| 客户 / Clients | `{{ who_am_i.data[0]?.role !== 'founder' && who_am_i.data[0]?.role !== 'member' }}` | founder + member |
| 项目 / Projects | 同上 | founder + member |
| 审批队列 | `{{ who_am_i.data[0]?.role !== 'founder' }}` | founder 独享 |
| 客户需求 | `{{ !['founder', 'member'].includes(who_am_i.data[0]?.role) }}` | founder + member |
| 培训回放 | `{{ who_am_i.data[0]?.role !== 'founder' }}` | founder 独享(管全部学员) |
| 我的培训(trainee 专属) | `{{ who_am_i.data[0]?.role !== 'trainee' }}` | trainee 独享 |
| 活动日志 | `{{ who_am_i.data[0]?.role !== 'founder' }}` | founder 独享 |
| Admin 菜单 | `{{ who_am_i.data[0]?.role !== 'founder' }}` | founder 独享 |

### 9.4 按钮 / 操作的角色锁

```javascript
// 按钮 Disabled
{{ who_am_i.data[0]?.role !== 'founder' }}

// 按钮 Hidden
{{ !['founder', 'member'].includes(who_am_i.data[0]?.role) }}

// 删除按钮(更严)
{{ who_am_i.data[0]?.role !== 'founder' }}
```

### 9.5 SQL 按 role 过滤数据

同一个 table 组件,不同角色看不同数据。Query 里加条件:

```sql
-- tasks_list query — founder 看全部,member 看自己负责的,trainee 看不到
select t.*, p.name as project_name
from tasks t
join projects p on p.id = t.project_id
where
  case {{ who_am_i.data[0]?.role }}
    when 'founder' then true
    when 'member' then (
      t.assignee_user_id = {{ who_am_i.data[0]?.id }}
      or t.reporter_user_id = {{ who_am_i.data[0]?.id }}
      or exists (
        select 1 from project_members pm
        where pm.project_id = t.project_id
          and pm.user_id = {{ who_am_i.data[0]?.id }}
      )
    )
    else false
  end
order by t.created_at desc;
```

### 9.6 "我的"视图(trainee 专属)

trainee 登录只看这一个 tab,里面:
- 当前培训程序进度(progress bar)
- Day X 今日任务 + 已提交状态
- /chat mentor(可嵌 iframe 或链到 Telegram bot)

**Query `me_training`:**
```sql
select
  op.id as program_id,
  op.start_date, op.end_date, op.mentor_slug,
  t.name as template_name,
  (select count(*) from onboarding_tasks ot
   where ot.program_id = op.id and ot.status = 'done') as done,
  (select count(*) from onboarding_tasks ot2
   where ot2.program_id = op.id) as total
from onboarding_programs op
join onboarding_templates t on t.id = op.template_id
where op.trainee_user_id = {{ who_am_i.data[0]?.id }}
  and op.status = 'active'
limit 1;
```

**Query `me_today_task`:**
```sql
select ot.*
from onboarding_tasks ot
join onboarding_programs op on op.id = ot.program_id
where op.trainee_user_id = {{ who_am_i.data[0]?.id }}
  and op.status = 'active'
  and ot.day_number = (
    -- 计算当前是第几天
    least(
      date_part('day', now() - op.start_date::timestamp)::int + 1,
      15
    )
  )
limit 1;
```

### 9.7 安全重点 — Retool UI 隐藏 ≠ 真安全

**重要**:Retool 的 Hidden 只是**前端不显示**,任何人通过浏览器 devtools 能看底层数据。真正的权限边界必须在 Supabase RLS + Worker API 层面:

- ✅ **Retool UI** 用 Hidden/Disabled 减少误操作
- ✅ **Supabase RLS** 阻止未授权读写(已启用,service_role 绕过,anon 默认拒绝)
- ✅ **Worker API** 用 `/me` / bearer token 验证身份
- ❌ **别靠 Retool UI 做安全**,只靠它做 UX

当前状态:Retool 走的是 Postgres pooler 用 DB 密码,**绕过 RLS**。所以 Retool 是"内部可信环境"。**千万别把 Retool 共享给外部客户**。

### 9.8 客户不要放进 Retool

客户(非员工)走另外两条路:
- **Telegram 客户 bot** `@one23_support_bot`(已上线 — /newneed /progress 等)
- **Mikkie 的 Replit 面板 `/portal`** 路由(Phase 9 做)— 独立登录、独立品牌

Retool 的 End User license $5/人/月对客户不划算,品牌也不对。

### 9.9 最小可用范围(我推荐的第 1 版)

只做 **2 个 tab + 1 个 who_am_i query**,就能让所有 3 种角色都有体验:

| Tab | 给谁 | 显示条件 |
| --- | --- | --- |
| **"我的"(/me)** | 所有人(founder/member/trainee) | 永远显示,内容按 role 切:founder 看团队概览,member 看自己项目,trainee 看今日任务 |
| **"审批"** | founder 独享 | `{{ who_am_i.data[0]?.role !== 'founder' }}` 隐藏 |

这两个 tab 覆盖 80% 日常。其他 tab(客户 / 项目 / 培训回放 / 活动日志)**等需要了再加**。

---

## 十、什么时候扔掉 Retool

Mikkie 的 Replit 面板 Phase 7(审批队列)上线后:
- Retool 的 Page 2(审批)可以关
- Phase 8 上线后:Page 3(客户需求)也可以关
- 其他 page 如果 Replit 面板没覆盖,留着辅助

最终 Retool **0 用或 1-2 个专项工具**(比如数据分析/报表,Replit 面板不一定要做)。
