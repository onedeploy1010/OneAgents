# OneAgents

**作者：Manus AI**  
**版本：v0.2**  
**状态：实施启动稿**

## 一、项目定位

**OneAgents** 是一个面向远程技术交付团队的运营操作系统仓库。它的目标不是替代 GitHub、Supabase、Cloudflare、Telegram 或企业邮箱，而是把这些平台之间分散的事实连接起来，形成一个可查询、可提醒、可审计、可逐步自动化的工作中枢。

当前仓库主要服务于以下四类核心目标。第一，是把**项目、任务、会议、资产、订阅、财务与新人培训**统一纳入结构化主库。第二，是让 **Cloudflare 承担执行入口与编排层**，负责接收事件、定时触发和路由专用 Agent。第三，是让 **Supabase/Postgres 继续作为主运营事实源**，承载核心关系数据与长期审计记录。第四，是把 Telegram 作为内部控制台，把 GitHub 作为代码事实源，把客户项目数据库维持在各自独立的 Supabase 项目中。[1] [2] [3] [4]

## 二、当前架构原则

系统采用“**外部事件输入 → Cloudflare 执行层 → Supabase 主运营库存档 → Telegram / 面板输出**”的主路径。这样设计的原因很简单：执行层需要接近 webhook、定时器和消息入口，而主事实层需要稳定的关系模型、可追溯性和后续分析能力。Cloudflare Agents 适合承载有状态、可调度的业务 Agent；Supabase 的 PostgreSQL 与 `pgvector` 更适合作为结构化数据和知识检索的底座。[1] [4]

| 层级 | 主要职责 | 当前建议 |
| --- | --- | --- |
| 事实源层 | 代码、客户业务数据、邮件、聊天、会议文档 | GitHub、客户 Supabase、Google Workspace、Telegram |
| 执行层 | Webhook、定时任务、Agent 路由、通知编排 | Cloudflare Workers / Agents |
| 主数据层 | 项目、任务、财务、资产、培训、审计 | Supabase 公司运营库 |
| 检索层 | 知识索引、摘要、向量检索 | Supabase `pgvector`，后续可补 Cloudflare Vectorize |
| 输出层 | 内部通知、审批、日报、管理面板 | Telegram、内部面板、导出文档 |

## 三、仓库内容

本仓库当前已经包含 MVP 阶段的 8 份核心业务说明文档，并从本次开始逐步补齐真正可运行的实现资产。你可以把它理解为：**业务规则先定清楚，再逐步补可执行代码**。

| 目录或文件 | 作用 |
| --- | --- |
| `docs/` | 业务范围、数据库、Agent、工作流、集成矩阵、财务规则等说明 |
| `db/` | Supabase SQL、迁移脚本、种子数据与策略样例 |
| `cloudflare/` | Cloudflare 执行层与 Agent 骨架 |
| `README.md` | 项目入口说明与实施顺序 |

## 四、推荐实施顺序

这个仓库不适合一上来就同时开发全部模块。更有效的方法，是先把最短闭环跑起来，再逐步扩展。建议按以下顺序推进。

| 阶段 | 目标 | 产出 |
| --- | --- | --- |
| Phase 1 | 建立主运营库 | Supabase SQL 初版、核心表、基础审计字段 |
| Phase 2 | 建立执行入口 | Cloudflare Worker / Agent 骨架、Webhook 路由 |
| Phase 3 | 跑通首批 Agent | 会议转任务、项目进度整理、财务归一、入职引导 |
| Phase 4 | 接入外部平台 | GitHub、Telegram、Google Workspace、客户 Supabase |
| Phase 5 | 做知识与报表增强 | 检索索引、日报周报、报价辅助 |

## 五、首批上线范围

MVP 阶段建议先只做四条最短链路。第一条是**会议转任务**，让沟通结果不再停留在文本里。第二条是**项目进度整理**，让你不用自己追上下文。第三条是**财务入账与 U 折算**，让多币种经营视图统一。第四条是**新人 15 天考核引导**，让新人可以在 AI 辅助下更快进入工作状态。

这四条链路都应遵守同一条规则：**先生成候选结果，再人工确认，再正式写入主库**。对客户正式消息、财务异常、生产配置和正式报价，默认仍保留人工审批。

## 六、本地开发与环境准备

本仓库中的真实密钥**绝不能**提交到版本库。建议使用 `.env.local`、Cloudflare 环境变量管理、Supabase 项目密钥系统等方式托管配置，并严格区分公开变量与仅服务端变量。尤其是 `SUPABASE_SERVICE_ROLE_KEY`、`CF_API_TOKEN`、`TG_BOT_TOKEN`、`GH_APP_PRIVATE_KEY` 等高权限密钥，必须只放在受控执行环境中。[5]

| 类别 | 关键变量示例 | 是否可暴露到前端 |
| --- | --- | --- |
| 数据库 | `DB_URL`、`SUPABASE_SERVICE_ROLE_KEY` | 否 |
| Cloudflare | `CF_ACCOUNT_ID`、`CF_API_TOKEN` | 否 |
| GitHub | `GH_APP_ID`、`GH_WEBHOOK_SECRET` | 否 |
| Telegram | `TG_BOT_TOKEN`、`TG_DEFAULT_CHAT_ID` | 否 |
| 应用公开配置 | `APP_NAME`、`APP_TIMEZONE` | 是，但需按需暴露 |

## 七、你现在最该做的事

如果你准备继续把这个仓库推进成 MVP，我建议按下面顺序执行。首先，把 **Supabase SQL 初版** 应用到公司运营库。其次，部署 **Cloudflare 执行层骨架**，先验证一个健康检查接口和一个统一 webhook 入口。然后，再逐步接入 GitHub 与 Telegram，使事件真正开始流动。等这几步跑通后，再考虑报价建议、知识向量索引与 WhatsApp 客户通知。

## 八、后续计划

下一轮实现建议继续补以下内容：第一，数据库迁移与 RLS 策略初版；第二，Cloudflare 队列、Cron 与 Durable Object 状态管理；第三，GitHub、Telegram、Supabase 的事件适配器；第四，`meeting_agent` 与 `project_ops_agent` 的第一个可跑通用例。

## References

[1]: https://developers.cloudflare.com/agents/ "Cloudflare Agents"
[2]: https://developers.cloudflare.com/d1/ "Cloudflare D1"
[3]: https://developers.cloudflare.com/vectorize/ "Cloudflare Vectorize"
[4]: https://supabase.com/docs/guides/database/extensions/pgvector "Supabase pgvector"
[5]: https://supabase.com/docs/guides/api/api-keys "Supabase API Keys"
