# Retool 面板 — 增量改动清单

搭建指南见 `retool_bridge_setup.md`。本文件记录**已上线后的小改动**,按时间倒序。

> **Schema 事实**
> - `onboarding_status` 枚举: `planned / active / completed / extended / failed`(**没有 `paused`**)。
> - `onboarding_task_status` 枚举: `todo / doing / submitted / reviewed / done / failed`。
> - Postgres 资源名:`oneagent-supabase`(单数)。REST 资源名:`oneagents-worker`。
> - Supabase project ref:`vqqtuitmfmdjtgutmpoh`。

---

## 2026-04-20 — Training tab 第一轮打磨

### 1. 状态筛选(放进 `trainingFiltersCard`)

**新组件 Select,命名 `trainingStatusFilter`**

在 `trainingFiltersCard` 里、`trainingSearchInput` 的右边拖一个 Select:

- Item mode: **Mapped**
- Values:  `["all", "planned", "active", "completed", "extended", "failed"]`
- Labels:  `["全部", "计划中", "进行中", "已完成", "延长", "失败"]`
- Default value: `active`
- Label: `状态`
- Event handler: `Change → Trigger query → trainingPrograms`

**同时修改 `trainingClearButton` 的 Click script**,加一行重置筛选:

```javascript
trainingSearchInput.setValue('');
trainingStatusFilter.setValue('all');
trainingPrograms.trigger();
```

**改 Query `trainingPrograms`**(资源 `oneagent-supabase`),替换整段 SQL:

```sql
-- Training programs list. Founder 看全部;trainee 看自己。支持搜索 + 状态筛选。
select
  p.id,
  p.trainee_user_id,
  u.display_name as trainee_name,
  p.template_id,
  t.name as template_name,
  p.mentor_slug,
  p.status,
  p.start_date,
  p.end_date,
  coalesce(agg.done, 0)::int as done,
  coalesce(agg.total, 0)::int as total,
  p.created_at,
  p.updated_at
from onboarding_programs p
left join users u on u.id = p.trainee_user_id
left join onboarding_templates t on t.id = p.template_id
left join (
  select
    program_id,
    count(*)::int as total,
    sum(case when status::text in ('done','reviewed') then 1 else 0 end)::int as done
  from onboarding_tasks
  group by program_id
) agg on agg.program_id = p.id
where
  (
    {{ myRole.value === 'founder' }}
    or p.trainee_user_id = {{ whoAmI.data.id?.[0] }}
  )
  and (
    {{ trainingStatusFilter.value === 'all' }}
    or p.status::text = {{ trainingStatusFilter.value }}
  )
  and (
    {{ !trainingSearchInput.value }}
    or u.display_name ilike '%' || {{ trainingSearchInput.value }} || '%'
    or t.name ilike '%' || {{ trainingSearchInput.value }} || '%'
    or p.mentor_slug ilike '%' || {{ trainingSearchInput.value }} || '%'
  )
order by p.created_at desc
limit 200;
```

> 改动点:新增 `trainingStatusFilter` 条件;`agg.done` 的口径修正为 `done/reviewed`(和 `onboarding_task_status` 对齐,去掉了原 SQL 里不存在的 `completed/graded`)。

**推荐同时在 `trainingTable` 加一列显示 status**(可选但强烈推荐):

加一列,column key = `status`,Format = **Tag**,Mapped options:

```
planned   → 计划中 → Gray
active    → 进行中 → Blue
completed → 已完成 → Green
extended  → 延长  → Orange
failed    → 失败  → Red
```

### 2. Drawer 快捷按钮

在 `trainingDrawer` body 里,`trainingDrawerMeta` 下方、`trainingTasksTitle` 上方插一行,放两颗 Button(Container + 横向布局,或者直接两个 Button 排列)。

**Button A — 复制 program_id**
- id: `trainingDrawerCopyIdButton`
- Text: `复制 program_id`
- Icon before: `bold/interface-text-formatting-copy`
- Style: `outline`
- Click → **Run script**:
  ```javascript
  const pid = trainingTable.selectedSourceRow?.id;
  if (!pid) {
    utils.showNotification({ title: '未选择培训项目', notificationType: 'warning' });
  } else {
    await navigator.clipboard.writeText(pid);
    utils.showNotification({
      title: '已复制',
      description: pid,
      notificationType: 'success',
    });
  }
  ```

**Button B — 打开 Supabase 记录**
- id: `trainingDrawerOpenSupabaseButton`
- Text: `打开 Supabase`
- Icon before: `bold/interface-link-square`
- Style: `outline`
- Click → **Open URL**,URL(表达式模式):
  ```
  {{ `https://supabase.com/dashboard/project/vqqtuitmfmdjtgutmpoh/editor?schema=public&filter=onboarding_programs.id%3Aeq%3A${trainingTable.selectedSourceRow?.id ?? ''}` }}
  ```
- **Open in new tab:** ✅
- Disabled: `{{ !trainingTable.selectedSourceRow?.id }}`

> Supabase Editor 的 URL 在不同版本略有差异;如果上面路径打开后不自动过滤,退化方案改成 `https://supabase.com/dashboard/project/vqqtuitmfmdjtgutmpoh/editor`,手动粘贴 id 搜索。

### 3. `trainingTasksTable` 的 status 列上 Tag 颜色

在 `trainingTasksTable` 里找到 status 列(column id = `c15f5`):

- Format: **string** → 改为 **Tag**
- Automatic colors: 关
- Mapped options:

| Value | Label | Color |
| --- | --- | --- |
| `todo` | 待办 | Gray |
| `doing` | 进行中 | Blue |
| `submitted` | 已提交 | Orange |
| `reviewed` | 已评 | Violet |
| `done` | 已完成 | Green |
| `failed` | 失败 | Red |

---

## 2026-04-21 — 待接受邀请(Pending Invites)监控 tab

**背景**:Worker 新增了 `nudgePendingInvites` 自动催促(12/48/72h 三档,见 `cloudflare/worker/src/agents/training-coach/skills/nudge-pending-invites.ts`)。Retool 侧需要一个可视化让 founder 随时看到谁停在 intake。

### 1. 新 tab `invites`(founder 独享)

把 tabSelector 的 values 数组扩展到 `['overview','approvals','clients','projects','myStuff','training','invites']`,labels 同步加 "邀请"。

新容器 `invitesTabContainer`,Hidden 条件:
```
{{ tabSelector.value !== 'invites' || myRole.value !== 'founder' }}
```

### 2. Query `pendingInvitesList`(资源 oneagent-supabase)

```sql
select
  ei.id,
  ei.telegram_username,
  ei.telegram_user_id,
  ei.mentor_slug,
  ei.template_slug,
  ei.notes,
  ei.status,
  ei.created_at,
  ei.last_nudged_at,
  ei.nudge_count,
  ei.case_review_sent_at,
  extract(epoch from (now() - ei.created_at))/3600 as age_hours,
  case
    when extract(epoch from (now() - ei.created_at))/3600 >= 72 then 'case_review'
    when extract(epoch from (now() - ei.created_at))/3600 >= 48 then 'tier2'
    when extract(epoch from (now() - ei.created_at))/3600 >= 12 then 'tier1'
    else 'fresh'
  end as tier,
  (select state->>'stage' from telegram_sessions ts
     where ts.bot_role='employee' and ts.state->>'invite_id' = ei.id::text
     limit 1) as current_stage
from employee_invites ei
where ei.status in ('pending', 'expired')
  and (
    {{ !invitesHidePending.value }}
    or ei.status != 'pending'
  )
order by
  case ei.status when 'pending' then 0 when 'expired' then 1 else 2 end,
  ei.created_at asc;
```

### 3. 表格 `invitesTable`

data: `{{ pendingInvitesList.data }}`

列:
- `telegram_username`(@handle)
- `template_slug`
- `age_hours` format=decimal,小数 1 位
- `tier` format=Tag,Mapped options:
  - `fresh` → 新鲜 → Gray
  - `tier1` → 催 → Blue
  - `tier2` → 加急 → Orange
  - `case_review` → 需复核 → Red
- `current_stage` format=string(显示 `invite_awaiting_display_name` 等)
- `nudge_count`
- `status`

### 4. 手动触发 nudge 按钮(founder 专属)

在 tab 顶部放 Button:
- Text: `手动跑一轮 nudge`
- Click → REST query `nudgePendingInvitesNow`:
  - Resource: `oneagents-worker`
  - Method: POST
  - URL: `/training-coach/nudge-invites`
  - 成功后 toast + `pendingInvitesList.trigger()`

### 5. Row action "标记放弃"(可选,简化版)

点选中行后,按钮 "置为 expired":
```sql
-- query: revokePendingInvite
update employee_invites
set status = 'expired',
    notes = coalesce(notes, '') || ' [manually expired]'
where id = {{ invitesTable.selectedSourceRow.id }};
```

---

## 待做(下一轮)

- **评分/批注**:写回 `onboarding_tasks.score` / `reviewer_user_id` / `graded_at`。Drawer 里加一个"评分"按钮弹 Modal。需要确认 `grader_notes` 字段是否已加(见 migration `20260420000018_training_coach.sql`)。
- **`training_coach_reviews` / `training_coach_actions` 查看与应用**:trainingDrawer 里加第三个 section,列出 AI 教练的建议 + "一键应用"按钮(调 Worker `/training-coach/.../apply`,如果 Worker 端有)。
- **Clients / Projects 的状态筛选**:和 Training 同规格复刻(`clientsFiltersCard` + `projectsFiltersCard` 都加状态 Select)。
- **My Stuff**:未做打磨。

---

## 既有组件速查(便于后续改动)

**Tab 结构**(`tabSelector.value`):`overview / approvals / clients / projects / myStuff / training`

**Training tab 内组件树**:
- `trainingTabContainer`
  - `trainingTitle` ("#### 培训")
  - `trainingFiltersCard`
    - `trainingSearchInput`
    - `trainingClearButton`
    - ⬅ 本次新增 `trainingStatusFilter`
  - `trainingContentCard`
    - `trainingSectionTitle` ("#### 培训项目...")
    - `trainingLoadingSpinner`
    - `trainingTable` → data: `trainingPrograms.data`
- `trainingDrawer`(modal frame)
  - body:
    - `trainingDrawerMeta` (文本概要)
    - ⬅ 本次新增 Copy / Supabase 按钮行
    - `trainingTasksTitle`
    - `trainingTasksTable` → data: `getTrainingTasks.data`
  - header: `trainingDrawerTitle`
  - footer: `trainingDrawerCloseButton`

**Queries**:
- `trainingPrograms` (SQL, oneagent-supabase) — 培训程序列表
- `getTrainingTasks` (SQL, oneagent-supabase) — 按 `trainingTable.selectedSourceRow?.id` 查任务
- `whoAmI` / `myRole` — 当前用户(onboarding 上每个 page load 跑)

---

## 给 Retool AI Agent 的 prompt(本轮改动)

整段复制,粘贴到 App 编辑器右上 ✨ AI 对话框:

```
I need you to make three improvements to the Training tab of this Retool app (App: oneagents-ops-bridge). Do them in order. Do not touch other tabs.

Context you can rely on:
- Postgres resource name: `oneagent-supabase` (singular "agent")
- Existing widgets on Training tab: trainingFiltersCard (contains trainingSearchInput + trainingClearButton), trainingTable, trainingDrawer (contains trainingDrawerMeta, trainingTasksTitle, trainingTasksTable, trainingDrawerCloseButton in footer)
- Existing queries: trainingPrograms, getTrainingTasks
- Supabase enum `onboarding_status` values: planned, active, completed, extended, failed (NO "paused")
- Supabase enum `onboarding_task_status` values: todo, doing, submitted, reviewed, done, failed
- Global state `myRole.value` is 'founder' | 'member' | 'trainee'
- `whoAmI.data.id` is the current user uuid (array of length 1)

=== CHANGE 1: Add status filter to Training tab ===

Inside trainingFiltersCard, to the right of trainingSearchInput, add a Select widget:
- id: trainingStatusFilter
- Label: 状态
- Item mode: Mapped
- Values: ["all", "planned", "active", "completed", "extended", "failed"]
- Labels: ["全部", "计划中", "进行中", "已完成", "延长", "失败"]
- Default value: "active"
- On change event: Trigger query trainingPrograms

Replace the entire SQL of query `trainingPrograms` with:

-- Training programs list. Founder 看全部;trainee 看自己。支持搜索 + 状态筛选。
select
  p.id,
  p.trainee_user_id,
  u.display_name as trainee_name,
  p.template_id,
  t.name as template_name,
  p.mentor_slug,
  p.status,
  p.start_date,
  p.end_date,
  coalesce(agg.done, 0)::int as done,
  coalesce(agg.total, 0)::int as total,
  p.created_at,
  p.updated_at
from onboarding_programs p
left join users u on u.id = p.trainee_user_id
left join onboarding_templates t on t.id = p.template_id
left join (
  select
    program_id,
    count(*)::int as total,
    sum(case when status::text in ('done','reviewed') then 1 else 0 end)::int as done
  from onboarding_tasks
  group by program_id
) agg on agg.program_id = p.id
where
  (
    {{ myRole.value === 'founder' }}
    or p.trainee_user_id = {{ whoAmI.data.id?.[0] }}
  )
  and (
    {{ trainingStatusFilter.value === 'all' }}
    or p.status::text = {{ trainingStatusFilter.value }}
  )
  and (
    {{ !trainingSearchInput.value }}
    or u.display_name ilike '%' || {{ trainingSearchInput.value }} || '%'
    or t.name ilike '%' || {{ trainingSearchInput.value }} || '%'
    or p.mentor_slug ilike '%' || {{ trainingSearchInput.value }} || '%'
  )
order by p.created_at desc
limit 200;

Update trainingClearButton click script to ALSO reset the filter. New script:

trainingSearchInput.setValue('');
trainingStatusFilter.setValue('all');
trainingPrograms.trigger();

Also add a "status" column to trainingTable with Format = Tag, Automatic colors OFF, Mapped options:
  planned → 计划中 → Gray
  active → 进行中 → Blue
  completed → 已完成 → Green
  extended → 延长 → Orange
  failed → 失败 → Red
Place it between 教官 (mentor_slug) and 开始 (start_date).

=== CHANGE 2: Add two quick-action buttons to trainingDrawer ===

In trainingDrawer body, insert a new row BETWEEN trainingDrawerMeta and trainingTasksTitle containing two buttons side by side.

Button A:
- id: trainingDrawerCopyIdButton
- Text: 复制 program_id
- Icon before: bold/interface-text-formatting-copy
- Style variant: outline
- Disabled: {{ !trainingTable.selectedSourceRow?.id }}
- Click → Run script:
    const pid = trainingTable.selectedSourceRow?.id;
    if (!pid) {
      utils.showNotification({ title: '未选择培训项目', notificationType: 'warning' });
    } else {
      await navigator.clipboard.writeText(pid);
      utils.showNotification({ title: '已复制', description: pid, notificationType: 'success' });
    }

Button B:
- id: trainingDrawerOpenSupabaseButton
- Text: 打开 Supabase
- Icon before: bold/interface-link-square
- Style variant: outline
- Disabled: {{ !trainingTable.selectedSourceRow?.id }}
- Click → Open URL (open in new tab):
    {{ `https://supabase.com/dashboard/project/vqqtuitmfmdjtgutmpoh/editor?schema=public&filter=onboarding_programs.id%3Aeq%3A${trainingTable.selectedSourceRow?.id ?? ''}` }}

=== CHANGE 3: Upgrade status column in trainingTasksTable ===

On trainingTasksTable, the "状态" column (column key = "status", column id c15f5) currently has Format = string. Change it to:
- Format: Tag
- Automatic colors: OFF
- Mapped options:
    todo → 待办 → Gray
    doing → 进行中 → Blue
    submitted → 已提交 → Orange
    reviewed → 已评 → Violet
    done → 已完成 → Green
    failed → 失败 → Red

=== Done ===

After all three changes, confirm by showing me: (1) the new trainingStatusFilter widget, (2) the updated trainingPrograms SQL, (3) the two new drawer buttons, (4) the tag mapping on trainingTasksTable status column.
```
