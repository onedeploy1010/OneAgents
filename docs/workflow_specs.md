# 工作流规格说明

**版本:v0.2**
**状态:引擎已上线(migration 008)**

## 一、核心原则

OneAgents 的工作流目标**不是炫目的全自动**,而是:**低出错、可回溯、可人工接管、可逐步自动化**。因此所有工作流采用统一的节点语义:

```
触发 → 节点1 → 节点2 → ... → 节点N → 结束
         │        │
         │        └─ 每个节点有 executor(agent/ai_platform/tool/webhook/human)
         │        └─ 每个节点可声明:项目 / 客户 / 记忆命名空间 / 连接器
         │        └─ 每个节点可要求审批
         │
         └─ 完成即通知 superadmin + 相关账号 + Telegram,自动推进下一个节点
```

## 二、数据模型(migration 008)

| 表 | 作用 |
| --- | --- |
| `workflows` | 工作流定义:slug、name、触发方式(manual/event/cron) |
| `workflow_steps` | 节点定义:executor_kind、executor_ref、config、依赖、审批要求、通知目标 |
| `workflow_runs` | 一次具体执行:project_id、client_id、input_payload、status |
| `workflow_step_runs` | 每个节点在一次执行中的状态:pending/running/awaiting_approval/completed/failed/rejected/skipped |
| `workflow_run_timeline`(视图) | superadmin 回放用的 join 视图 |

### 节点类型(`executor_kind`)

| kind | 含义 | 完成方式 |
| --- | --- | --- |
| `human` | 真人操作(founder/member/trainee) | **等待** `/workflow-runs/:id/steps/:key/complete` 被调用 |
| `agent` | 内部 OneAgents Agent(meeting_agent/project_ops_agent/...) | 调用后等 agent 产出结果,再 POST `/complete` |
| `ai_platform` | 直接通过 AI Gateway 调 OpenAI/Claude/Gemini | 自动执行,产出 content 字段 |
| `tool` | Worker 内部工具 | 自动执行,见下表 |
| `webhook` | 调外部 HTTP | 自动执行,HTTP 状态码决定成败 |

### 已实现的内置工具(`executor_kind=tool`)

| `executor_ref` | 作用 | 配置字段 |
| --- | --- | --- |
| `telegram/send` | 发 Telegram 到 `TG_DEFAULT_CHAT_ID` | `template`(可用 `{field}` 占位符引用 run.input 或上游 output) |
| `entities/projects` | 新建项目 | `from_input`:要从 run.input 取哪些字段 |
| `onboarding/start` | 启动 15 天培训程序 | `from_input`:traineeEmail/mentorEmail/startDate/mentorSlug |
| `onboarding/today` | 占位,提示 trainee 自己取 | (无) |

### 审批

- `workflow_steps.requires_approval = true` 的节点在**执行后**进入 `awaiting_approval`
- Superadmin 通过 `POST /workflow-runs/:id/steps/:key/approve` 或 Telegram `/approve <step-run-id>` 推进
- 拒绝走 `/reject`,整个 run 标 failed

### 通知

节点 `notification_targets`(jsonb)支持:
- `{"telegram": true}` — 发到 `TG_DEFAULT_CHAT_ID`
- `{"roles":["founder"]}` — 后续可做按角色分发(现在先 log)

## 三、路由清单

| 方法 | 路径 | 说明 | 鉴权 |
| --- | --- | --- | --- |
| GET | `/workflows` | 列出所有工作流 | 无 |
| POST | `/workflows/:slug/trigger` | 触发一次执行 | Bearer |
| GET | `/workflow-runs/:id` | 返回 timeline 视图 | 无 |
| POST | `/workflow-runs/:id/steps/:key/complete` | 节点外部完成回写 | Bearer |
| POST | `/workflow-runs/:id/steps/:key/approve` | 人工批准 | Bearer |
| POST | `/workflow-runs/:id/steps/:key/reject` | 人工拒绝 | Bearer |

Telegram 命令:
- `/approve <step-run-id>`
- `/reject <step-run-id> <reason>`

## 四、内置工作流样例

### WF: `employee-first-day`(新员工 Day 0)

```
confirm_gw_seat (human/founder)
  → confirm_gh_invite (human/founder)
    → start_onboarding (tool: onboarding/start, from_input=traineeEmail/mentorEmail/startDate/mentorSlug)
      → generate_brief (tool: onboarding/today)
        → welcome_notify (tool: telegram/send, template="@{trainee_name} 欢迎...")
```

trigger 时传 `input` 字段:
```json
{
  "traineeEmail": "ming@company.com",
  "mentorEmail": "you@company.com",
  "startDate": "2026-04-22",
  "mentorSlug": "nina_coach"
}
```

### WF: `new-client-intake`(新客户接入)

```
intake_call (human)
  → summarize_intake (agent: meeting_agent)
    → scope_review (human, requires_approval=true)
      → create_project (tool: entities/projects)
        → initial_tasks (agent: project_ops_agent, requires_approval=true)
          → handoff (tool: telegram/send)
```

## 五、记忆与连接器(设计位)

当前节点已声明字段,但**运行时未强制装载**,下一版会实现:

- `memory_namespace` — 指定该节点可访问的 `knowledge_documents.vector_namespace`;agent/ai_platform 类节点调 LLM 前自动 RAG 检索并拼进 system prompt
- `connector_slugs` — 指定该节点需要哪些 `connectors`(GitHub / Google / 客户自己的 Supabase);Worker 按 `connectors.secret_ref` 去 env 拿对应 secret
- `project_scope` / `client_scope` — 若为 `same` 或 `specific`,限制只能访问该 project/client 的数据(未来接入 RLS policy)

## 六、旧 WF 编号对照(v0.1 → v0.2)

v0.1 的 8 个 WF 现在是**工作流样例**,不是硬编码的 handler。通过 `workflows` + `workflow_steps` 表来定义,随时可以新增 / 改步骤而不用改代码:

| 旧编号 | 旧名称 | 实现形式 |
| --- | --- | --- |
| WF-01 | 会议转任务 | 当前独立 `/workflows/meeting` 路由 + 可封装为 workflow steps |
| WF-02 | GitHub 变更同步 | `/webhooks/github` 审计;可封装 workflow 做更精细动作 |
| WF-03 | 财务流水入账 | 独立 `/workflows/finance` 路由 |
| WF-04 | 资产订阅风险提醒 | 已在 cron 里跑 + `/cron/run` |
| WF-05 | 新人培训 | 扩展成专门的 `/onboarding/*` 路由 + `employee-first-day` workflow |
| WF-06 | 日报周报汇总 | 未实现,可作为新 workflow 节点(executor_kind=ai_platform) |
| WF-07 | 客户报价建议 | 未实现,可作为新 workflow 节点 |
| WF-08 | 知识入库 | `/workflows/knowledge` + `/admin/knowledge/research` + auto embed |

## 七、怎么加新工作流

直接 SQL 插入,不用改 Worker 代码:

```sql
insert into workflows (slug, name, trigger_kind) values ('weekly-report', '周报汇总', 'cron');

with wf as (select id from workflows where slug='weekly-report')
insert into workflow_steps (workflow_id, step_index, step_key, name, executor_kind, executor_ref, executor_config, depends_on, on_success_step_key, notification_targets)
select wf.id, 1, 'collect_runs', '拉取本周 agent_runs',
  'ai_platform', null,
  '{"system_prompt":"你是周报助手...", "user_prompt":"总结以下数据: {input}"}'::jsonb,
  ARRAY[]::text[], 'send_report',
  '{"telegram":true}'::jsonb
from wf;

with wf as (select id from workflows where slug='weekly-report')
insert into workflow_steps (workflow_id, step_index, step_key, name, executor_kind, executor_ref, executor_config, depends_on, notification_targets)
select wf.id, 2, 'send_report', '发周报',
  'tool', 'telegram/send',
  '{"template":"本周:{content}"}'::jsonb,
  ARRAY['collect_runs']::text[],
  '{"telegram":true}'::jsonb
from wf;
```

然后 `POST /workflows/weekly-report/trigger` 即可。

## 八、冒烟测试结果(v0.2 上线)

- `employee-first-day` 触发成功
- 2 个 human 步手动 /complete 后,级联 3 个 tool 步自动执行完成
- `workflow_runs.status` 从 `active` → `completed`
- `workflow_run_timeline` 视图能完整回放

## 九、下一步扩展(优先级)

1. **memory_namespace 实装** — agent/ai_platform 节点自动 RAG
2. **connector_slugs 实装** — 节点按需读取外部系统凭据
3. **cron trigger** — `trigger_kind='cron'` + `trigger_config.schedule` 由 Worker 定时触发
4. **event trigger** — GitHub push / 会议入库等事件自动触发关联 workflow
5. **parallel branches** — 目前只线性;需要时加 `on_success_step_key` 数组
6. **Retool 审批面板** — 查 `workflow_step_runs where status='awaiting_approval'`
