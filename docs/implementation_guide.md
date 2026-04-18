# 实施说明

**作者：Manus AI**  
**版本：v0.1**  
**状态：初版实施指南**

## 一、目的

本文件用于把当前仓库从“业务设计文档集合”推进到“可实施的 MVP 仓库”。它关注的不是长期全部蓝图，而是接下来两到四周内你和智能开发最应该按什么顺序动手、每一步要产出什么、各平台应承担什么边界。

## 二、总体落地原则

OneAgents 的第一版不追求功能齐全，而追求**事实清楚、链路闭环、权限可控**。因此，第一版只做三个关键支柱：**Supabase 主运营库、Cloudflare 执行层、Telegram 内部通知入口**。GitHub 作为代码事实源接入，Google Workspace 作为邮件与日历来源接入，客户项目数据库继续保留在各自 Supabase 项目内。[1] [2] [3]

| 原则 | 说明 | 对实施的影响 |
| --- | --- | --- |
| 单一事实源 | 项目与财务事实进入公司运营库，代码事实留在 GitHub | 不要把任务状态散落到多平台 |
| 先候选再确认 | Agent 先生成候选结果，再由人确认 | 初期减少误写和越权 |
| 平台分层 | Cloudflare 处理执行，Supabase 处理核心关系数据 | 避免边缘层承载全部主数据 |
| 默认最小权限 | Bot、Webhook、数据库和 API 均只授予必要能力 | 降低误操作风险 |

## 三、推荐仓库结构

建议把仓库逐步整理成下面这个结构。这样无论是你自己继续做，还是后续交给新人或智能开发，都能快速知道每个目录的职责。

```text
OneAgents/
├── README.md
├── docs/
│   ├── product_scope.md
│   ├── database_schema.md
│   ├── agent_catalog.md
│   ├── workflow_specs.md
│   ├── integration_matrix.md
│   ├── environment_variables.md
│   ├── onboarding_track.md
│   ├── finance_rules.md
│   └── implementation_guide.md
├── db/
│   ├── migrations/
│   ├── seeds/
│   └── README.md
└── cloudflare/
    ├── worker/
    │   ├── src/
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── wrangler.toml
    │   └── .dev.vars.example
    └── README.md
```

## 四、第一阶段必须完成的内容

第一阶段的目标是让仓库具备“可以开始开发”的最低条件，而不是立刻连上所有外部平台。因此你现在最需要完成的是四项基础资产：第一，**Supabase SQL 初版**；第二，**Cloudflare Worker / Agent 骨架**；第三，**环境变量样例与运行说明**；第四，**README 与实施文档**。

| 资产 | 作用 | 负责人建议 |
| --- | --- | --- |
| SQL 初版 | 建立运营主库 | 智能开发主导，你审核 |
| Worker 骨架 | 承接 webhook、调度和通知 | 智能开发主导 |
| 配置样例 | 避免环境变量混乱 | 你与开发共同维护 |
| README / 实施文档 | 给新人、协作者与 Agent 统一入口 | 当前仓库维护者 |

## 五、首批数据库范围

第一版数据库不要一次性做满全部业务表，而应先形成最短闭环。建议优先落地 `users`、`clients`、`projects`、`tasks`、`meetings`、`meeting_action_items`、`finance_ledger`、`fx_rates`、`assets`、`subscriptions`、`project_databases`、`agent_runs` 与 `notifications`。其中，`knowledge_documents`、`performance_reviews` 和更完整的培训评分能力，可以在第二轮继续补齐。

这个顺序的逻辑是：项目、任务、会议、财务和通知是最先产生实际管理价值的模块，而复杂知识索引与绩效计算应建立在主库稳定之后。

## 六、首批 Cloudflare 执行层范围

Cloudflare 第一版不要急着把全部 Agent 做成复杂状态机。更实际的做法是先实现一个统一的入口层：包括健康检查、统一 webhook 路由、定时任务入口、Telegram 通知发送函数，以及一个简单的任务队列或占位处理器。Cloudflare Agents 适合长期存在、可调度、有状态的业务代理；但 MVP 阶段完全可以先以 Worker 结构承接，再逐步把高价值 Agent 升级到更稳定的状态模型上。[1]

| 路由 | 作用 | 首版行为 |
| --- | --- | --- |
| `GET /health` | 部署与存活检测 | 返回版本和时间 |
| `POST /webhooks/github` | 接收 GitHub 事件 | 先校验签名并记录日志 |
| `POST /webhooks/telegram` | 接收内部命令 | 解析命令并回写通知 |
| `POST /workflows/meeting` | 会议转任务入口 | 先写入候选事件与占位结果 |
| `POST /workflows/finance` | 财务入账入口 | 做基础校验和入库占位 |

## 七、建议的开发顺序

最容易失败的做法，是同时连数据库、消息平台、代码平台和客户项目库。更可控的顺序是分四步推进。先让数据库迁移成功，再让 Cloudflare 部署成功，然后打通 Telegram，最后接 GitHub。这样一旦出错，你能快速定位到底是数据层、执行层，还是外部集成层的问题。

| 顺序 | 动作 | 完成标准 |
| --- | --- | --- |
| 1 | 执行 Supabase SQL | 核心表创建成功 |
| 2 | 部署 Cloudflare Worker | `/health` 正常返回 |
| 3 | 接 Telegram Bot | 能收到测试通知 |
| 4 | 接 GitHub Webhook | 能记录一次 push 或 PR 事件 |
| 5 | 打通首个业务流 | 会议转任务候选可落库 |

## 八、环境变量与密钥管理

环境变量命名应以 `APP_`、`SUPABASE_`、`CF_`、`GH_`、`TG_`、`MAIL_`、`AI_` 等前缀统一管理。高敏感配置例如 `SUPABASE_SERVICE_ROLE_KEY`、`CF_API_TOKEN`、`GH_APP_PRIVATE_KEY`、`TG_BOT_TOKEN`，必须仅在服务端环境中使用，不应出现在任何前端或公开脚本中。[4] [5]

> “默认最小权限”在这个仓库里不是建议，而是实施前提。尤其是 GitHub 写权限、生产环境变更权限、客户消息发送权限，首版都应保留人工确认。

## 九、给智能开发的直接任务单

如果下一步由智能开发接手，可以直接按下面这张表执行。这样能减少解释成本，也能避免他先做了不重要的东西。

| 优先级 | 任务 | 交付物 |
| --- | --- | --- |
| P0 | 补齐 SQL 初版 | `db/migrations/001_init.sql` |
| P0 | 搭建 Worker 骨架 | `cloudflare/worker/src/index.ts` 等 |
| P0 | 输出配置样例 | `.dev.vars.example`、`db/README.md` |
| P1 | 接入 Telegram 测试通知 | 可执行的测试入口 |
| P1 | 接入 GitHub webhook 验签 | 占位处理器与日志 |
| P2 | 实现会议转任务候选流 | 示例请求与入库逻辑 |

## 十、下一轮建议

当首版 SQL 和执行层跑通之后，下一轮最值得补的不是更多平台，而是**可验证的首个完整工作流**。我建议优先实现 `meeting_agent` 或 `project_ops_agent`，因为这两条链路最接近你当前的真实痛点。等它们稳定后，再补财务自动分类、知识向量检索和 WhatsApp 客户通知。

## References

[1]: https://developers.cloudflare.com/agents/ "Cloudflare Agents"
[2]: https://supabase.com/docs/guides/database/extensions/pgvector "Supabase pgvector"
[3]: https://developers.cloudflare.com/workers/platform/pricing/ "Cloudflare Workers Pricing"
[4]: https://supabase.com/docs/guides/api/api-keys "Supabase API Keys"
[5]: https://developers.cloudflare.com/fundamentals/api/reference/permissions/ "Cloudflare API Token permissions"
