# OneAgents API 参考 + 能力缺口分析

**Worker base URL**: `https://oneagents-worker.one-deploy.workers.dev`
**版本**: v2026.04.20 (`b6246853-...`)
**说明**: 本文档手工维护,API 改动要同步修这里。后续上 Hono + OpenAPI 自动化时会废弃。

---

## 一、认证

| 类型 | 请求头 | 给谁 |
| --- | --- | --- |
| 匿名 | — | `/health` / `GET /workflows` / `GET /mentors` / webhooks |
| **Bearer** | `Authorization: Bearer oa_...` | 内部用户 + 外部 app 对接 |
| **Admin key** | `X-Admin-Key: <ADMIN_BOOTSTRAP_KEY>` | 仅 founder 级管理操作 |
| **Webhook 签名** | `X-Hub-Signature-256` / `X-Telegram-Bot-Api-Secret-Token` | GitHub / Telegram |

**错误响应**(通用):
```json
{ "ok": false, "error": "machine_readable_code" }
```
加 HTTP 状态 400 / 401 / 403 / 404 / 500。

**成功响应**:
```json
{ "ok": true, "...": "..." }
```

---

## 二、端点全集(按职能分组)

### 2.1 系统 / 身份

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| GET | `/health` | — | 健康检查,返回 app/env/now |
| GET | `/me` | Bearer | 当前 token 对应 user + bindings + scopes |

**`GET /me` 样例响应**:
```json
{
  "ok": true,
  "authenticated": true,
  "source": "bearer",
  "scopes": ["workflows:write"],
  "user": {
    "id": "fd8ec68b-...",
    "email": "you@company.com",
    "display_name": "Alps Zhang",
    "role": "founder",
    "status": "active"
  },
  "bindings": [
    { "provider": "telegram", "provider_user_id": "7120732225", "display_name": "..." }
  ]
}
```

### 2.2 实体录入

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| POST | `/entities/clients` | Bearer | 新建客户 |
| POST | `/entities/projects` | Bearer | 新建项目 |
| POST | `/entities/project-members` | Bearer | 挂成员到项目 |

**`POST /entities/clients`**:
```json
{
  "name": "Acme Japan K.K.",
  "contactName": "Takeshi",
  "contactChannel": "email:takeshi@acme.jp",
  "billingCurrency": "USDT",
  "status": "active",
  "notes": "retainer,月 5000U"
}
```
返回:`{ ok, client: { id, name, status } }`

**`POST /entities/projects`**:
```json
{
  "clientId": "<uuid>",
  "name": "Acme 跨境主站 v1",
  "projectCode": "acme-site-v1",
  "projectType": "web",
  "status": "planning",
  "ownerUserEmail": "you@company.com",
  "deliveryModel": "fixed",
  "riskLevel": "medium",
  "startDate": "2026-04-25",
  "targetEndDate": "2026-07-01",
  "description": "商城 + 后台"
}
```
返回:`{ ok, project: { id, name, project_code, status } }`

**`POST /entities/project-members`**:
```json
{ "projectId": "<uuid>", "userEmail": "dev@company.com", "role": "developer" }
```

### 2.3 工作流引擎

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| GET | `/workflows` | — | 列全部 workflow 定义 |
| POST | `/workflows/:slug/trigger` | Bearer | 触发一个 run |
| GET | `/workflow-runs/:id` | — | 时间线视图 |
| POST | `/workflow-runs/:id/steps/:key/complete` | Bearer | 完成 human/agent 步 |
| POST | `/workflow-runs/:id/steps/:key/approve` | Bearer | 审批通过 |
| POST | `/workflow-runs/:id/steps/:key/reject` | Bearer | 拒绝 |

**`POST /workflows/:slug/trigger` 样例**:
```json
{
  "projectId": "<uuid>",
  "clientId": "<uuid>",
  "input": { "traineeEmail": "x@y.com", "startDate": "2026-04-25" },
  "source": "manual"
}
```
返回:`{ ok, runId, workflow: "employee-first-day" }`

### 2.4 独立 workflow 路由(old-style,legacy)

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/workflows/meeting` | 旧路径:会议候选入库 |
| POST | `/workflows/finance` | 旧路径:财务候选入库 |
| POST | `/workflows/knowledge` | 文档 + auto embed |
| POST | `/workflows/infra` | 资产候选入库 |

**保留作兼容**。新接入建议走 `/workflows/:slug/trigger`。

### 2.5 培训

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| POST | `/onboarding/programs/start` | Bearer | 启动一个培训程序 |
| GET | `/onboarding/me/today` | Bearer | 当日任务 + mentor 引导 |
| POST | `/onboarding/me/chat` | Bearer | 和 mentor 对话(带记忆) |
| POST | `/onboarding/me/intake` | Bearer | 新人自画像抽取 |
| POST | `/onboarding/tasks/:id/submit` | Bearer | 提交作业 |
| POST | `/onboarding/tasks/:id/grade` | Bearer | 评分(支持 AI 预评 usePrescore:true) |
| GET | `/onboarding/programs/:id/summary` | — | 程序汇总(阶段 / 进度 / 平均分) |
| GET | `/mentors` | — | 列出 mentor + client_agent 全部 |

### 2.6 管理员(X-Admin-Key)

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/admin/tokens/create` | 发 Bearer token(明文一次性) |
| POST | `/admin/bindings/bind` | 绑外部身份到内部 user |
| POST | `/admin/connectors/register` | 登记连接器 |
| GET | `/admin/programs/:id/transcript` | 对话回放 |
| GET | `/admin/conversations` | 按 mentor/trainee/日期 过滤对话 |
| GET | `/admin/mentors/stats` | mentor 使用统计 |
| POST | `/admin/knowledge/research` | LLM 写一份主题培训文档 |
| POST | `/admin/knowledge/embed-pending` | 批处理待 embed 文档 |

### 2.7 Cron

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/cron/run` | 手动触发一次续费+到期扫描+通知 |

自动:`0 9 * * *` UTC 定时触发。

### 2.8 Webhooks

| 方法 | 路径 | 验签 |
| --- | --- | --- |
| POST | `/webhooks/github` | `X-Hub-Signature-256`(如配 GH_WEBHOOK_SECRET) |
| POST | `/webhooks/telegram/employee` | `X-Telegram-Bot-Api-Secret-Token`(如配 TG_WEBHOOK_SECRET) |
| POST | `/webhooks/telegram/client` | 同上 |
| POST | `/webhooks/telegram` | 兼容旧,等价 `/employee` |

### 2.9 Agent DO

| 绑定 | 说明 |
| --- | --- |
| MeetingAgent / ProjectOpsAgent / FinanceAgent / OnboardingAgent / OrchestratorAgent / KnowledgeAgent / InfraAgent | 7 个 Cloudflare Durable Object agent,目前通过 `agents` 框架路由访问(`/agents/...`)但**尚无公开 HTTP 接口调用** — 被 webhook / cron 间接驱动 |

---

## 三、能力缺口分析(你问的"完整支持"部分)

### 3.1 客户侧缺什么 🔴 优先级高

| 缺 | 影响 | 建议 |
| --- | --- | --- |
| `GET /entities/clients`(列) / `GET /entities/clients/:id`(详情) | Retool 和 Mikkie 面板都得绕 Supabase 直连 | ✅ 补 |
| `PATCH /entities/clients/:id` | 改名、改状态都要改 SQL | ✅ 补 |
| `POST /entities/client-contacts` + `PATCH` + `DELETE` | 唯一靠 SQL 或 bot 流程能建 | ✅ 补 |
| `POST /portal/bind`(客户用邮箱/邀请码) | 现在只能通过 Telegram `/start` | ⚠️ 有 Web portal 时补 |
| `POST /portal/message` + `GET /portal/projects` | Mikkie 面板 Phase 9 需要 | ⚠️ 等面板做 |
| `POST /clients/:id/reply`(员工从内部回客户群) | 沟通闭环 | ✅ 小功能 |

### 3.2 员工 / 用户侧缺什么 🟡

| 缺 | 影响 | 建议 |
| --- | --- | --- |
| `GET /entities/users` / `:id` | 管理员查人 | ✅ 补 |
| `PATCH /entities/users/:id`(改 role / status) | 试用转正 / 停用 | ✅ 补 |
| `PATCH /me/profile` | 员工自己改 display_name / 提交画像 | ⚠️ 低优 |
| `GET /me/tasks` / `GET /me/projects` | 我负责的 / 参与的 | ✅ 补(Retool / 面板都要) |
| `POST /admin/seat/allocate` | 一键新员工入职(CF/Supabase 邀请) | ⚠️ 有 GW 再补 |
| `POST /admin/seat/revoke` | 离职一键吊销 | ⚠️ 低频 |

### 3.3 智能体(Agent)侧缺什么 🟡

| 缺 | 影响 | 建议 |
| --- | --- | --- |
| `GET /agents` 列出 7 个 agent 状态 | 面板监控 | ✅ 补 |
| `GET /agents/:name/state` 快照 | Debug + 监控 | ✅ 补(通过 DO getSnapshot) |
| `POST /agents/:name/invoke` 外部调用 | 让外部系统主动触发特定 agent | ⚠️ 中等 |
| `GET /agent-runs` 分页 | 活动日志页 | ✅ 补 |
| `agents.log` WebSocket/SSE | 实时日志流 | ⚠️ 低优,面板做 |

### 3.4 应用 / 连接器侧缺什么 🔴 重要

| 缺 | 影响 | 建议 |
| --- | --- | --- |
| `GET /connectors` | 面板看注册了哪些 | ✅ 补 |
| `POST /connectors/:id/test` | 健康检查 | ✅ 补 |
| `POST /webhooks/github-app` | 真 GitHub App(而非手动 repo webhook) | ⚠️ 等 GH org 设好再补 |
| `POST /webhooks/stripe` | 未来接收付款通知 | ⚠️ 有客户付款场景时 |
| `POST /email/incoming` | **接 CF Email Routing 账单邮件** | ✅ 你提到的,必补 |
| `POST /integrations/google-drive/token` | OAuth 连客户 Drive | ⚠️ 有需求时 |
| CORS 支持 | Retool / Mikkie 面板要 preflight | ✅ 必补(没加过) |
| 文件上传 `/media/upload` | 群里图/文档自动归档 | ✅ 补 |

### 3.5 元能力缺什么 🔴

| 缺 | 影响 |
| --- | --- |
| 统一错误码枚举(文档化) | 现在 error 字符串不稳定 |
| 速率限制 headers(X-RateLimit-Remaining) | Retool / 面板无法做 backoff |
| 分页标准(`?limit=20&cursor=...`) | 列表端点都直接返回全集 |
| ETag / If-None-Match | 面板缓存优化 |
| Response 标准化(data/meta 分离) | 以后 SDK 好生成 |
| CORS | **必补** — Retool / Mikkie 面板浏览器端必需 |
| OpenAPI 3 spec | SDK 自动生成 |

---

## 四、我建议的补 API 顺序(按 ROI)

**立即补(Mikkie Phase 4-7 开始就要用)**
1. **CORS headers** — 5 分钟改 Worker(所有响应加 `Access-Control-Allow-Origin`)
2. `GET /entities/users` + `/clients` + `/projects` + `/tasks` + 分页参数 — 面板列表页需要
3. `GET /me/tasks` / `/me/projects` — 个人首页
4. `POST /entities/client-contacts` — 客户接入必需
5. `GET /connectors` / `GET /agents` — 面板监控

**其次补(媒体 + 邮件自动化)**
6. CF Email Worker(独立部署)→ POST 到 main Worker `/email/incoming`
7. `POST /media/upload` + Supabase Storage
8. `PATCH /entities/clients/:id` / `/projects/:id` / `/tasks/:id`

**面板第二版时补**
9. `POST /clients/:id/reply` — 员工回客户
10. `POST /agents/:name/invoke`
11. `GET /portal/projects` + 客户 portal 全套

**长期**
12. Hono 重构 + 自动 OpenAPI
13. SDK 生成(TypeScript + Python)
14. GraphQL(如果有复杂查询需求)

---

## 五、Retool 对接 Cheat Sheet

### 直连 Supabase(绕过 Worker)
**只读**用 Supabase Postgres pooler 即可,5 页面里 Overview / Approvals 查询 / Client Needs / Training Replay / Activity Log **全部能走 SQL**。不用 Worker API。

### 必须走 Worker 的动作
只有**写动作**(改状态 / 调 Agent / 自动化)才要走 Worker:

| Retool 按钮 | Worker 端点 |
| --- | --- |
| 审批通过 | `POST /workflow-runs/{id}/steps/{key}/approve` |
| 审批拒绝 | `POST /workflow-runs/{id}/steps/{key}/reject` |
| 手动完成 human 步 | `POST /workflow-runs/{id}/steps/{key}/complete` |
| 新建客户 | `POST /entities/clients` |
| 新建项目 | `POST /entities/projects` |
| 手动跑 cron | `POST /cron/run` (admin) |
| 研究新 SOP | `POST /admin/knowledge/research` (admin) |

Retool REST Resource 填:
- Base URL: `https://oneagents-worker.one-deploy.workers.dev`
- Headers: `Authorization: Bearer <你的 oa_token>`
- Headers: `X-Admin-Key: <admin_key>`(仅 admin 路由需)

---

## 六、示例:完整的客户录入端到端(curl)

```bash
WORKER=https://oneagents-worker.one-deploy.workers.dev
TOKEN=oa_你的founder_token

# 1. 建客户
CLIENT=$(curl -s -X POST $WORKER/entities/clients \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Acme","contactName":"Jane","billingCurrency":"USDT","status":"active"}' \
  | jq -r .client.id)

# 2. 建项目
PROJECT=$(curl -s -X POST $WORKER/entities/projects \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"clientId\":\"$CLIENT\",\"name\":\"Acme Site v1\",\"projectCode\":\"acme-site-v1\",\"projectType\":\"web\"}" \
  | jq -r .project.id)

# 3. 触发 new-client-intake workflow
curl -s -X POST $WORKER/workflows/new-client-intake/trigger \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"clientId\":\"$CLIENT\",\"input\":{\"clientId\":\"$CLIENT\",\"name\":\"Acme Site v1\",\"projectCode\":\"acme-site-v1\"}}"
```

---

## 七、Rate limits / 可靠性

| 类型 | 限制 |
| --- | --- |
| Cloudflare Workers 免费 tier | 100k req/天,50ms CPU/req |
| AI Gateway(走 embedding / chat) | 按用量付费,无硬限 |
| Supabase PG | free tier:连接数 60,每月 500MB egress |
| Telegram Bot | 30 msg/s,1 msg/s per group |

没有专门 rate-limit headers;建议 Retool / 面板端失败重试带指数退避。

---

## 八、调试 / 监控

- Worker 日志:`wrangler tail`(SSE 实时)
- Supabase 慢查询:Dashboard → Database → Performance
- Agent_runs 表:所有 agent 行为持久化审计
- `mentor_conversation_replay` 视图:对话完整回放

---

## 九、我下一步可以补什么

如果你说"开工",我可以 4 小时内补齐:
1. CORS(5 分钟)
2. `GET /entities/users / clients / projects / tasks` + 分页(1 小时)
3. `GET /me/tasks / projects`(30 分钟)
4. `POST /entities/client-contacts` + PATCH(30 分钟)
5. `GET /connectors` / `GET /agents` + state snapshots(1 小时)
6. `PATCH /entities/:type/:id`(30 分钟)

**Mikkie 的面板 Phase 4-8 需要其中 90% 的 GET 端点**,不如我现在补好,她做起来更快。

选要不要我继续。
