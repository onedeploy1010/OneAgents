# Agent Folder 架构

每个 agent 一个独立 folder,包含它的 DO class、skills、personas(若有)、connectors 声明。

```
agents/
├─ index.ts                 总 barrel,统一导出 7 个 agent
│
├─ meeting/
│   ├─ do.ts                 MeetingAgent DO(状态 + enqueueMeeting / getSnapshot)
│   ├─ skills/
│   │   └─ extract-highlights.ts   LLM 抽 summary/decisions/action_items
│   └─ connectors.ts         supabase + AI Gateway + TG client bot
│
├─ project-ops/
│   ├─ do.ts
│   ├─ skills/
│   │   └─ generate-tasks.ts   LLM 为新项目拆 5-8 条初始任务
│   └─ connectors.ts
│
├─ finance/
│   ├─ do.ts
│   ├─ skills/
│   │   ├─ parse-invoice.ts    从邮件正文抽账单字段
│   │   └─ fx-convert.ts       按 fx_rates 把任意币种折算到 U
│   └─ connectors.ts           含 cloudflare_email_routing(one23x.com 账单入口)
│
├─ onboarding/
│   ├─ do.ts
│   ├─ personas/              4 个 mentor 的 system_prompt 源码备份
│   │   ├─ nina.ts             温和/起步
│   │   ├─ marcus.ts           严格/基础
│   │   ├─ ravi.ts             业务/产品
│   │   ├─ oscar.ts            运维/日志
│   │   └─ index.ts            ONBOARDING_MENTORS / mentorBySlug
│   ├─ skills/
│   │   ├─ render-prompt.ts    模板变量 {x} 渲染
│   │   └─ get-memory.ts       取最近对话历史
│   └─ connectors.ts
│
├─ knowledge/
│   ├─ do.ts
│   ├─ skills/
│   │   ├─ embed.ts            单条 / 批量 embedding
│   │   ├─ search.ts           语义 top-K(带 fallback)
│   │   └─ research.ts         LLM 写指定主题文档 + 立即 embed
│   └─ connectors.ts           pgvector + AI Gateway
│
├─ infra/
│   ├─ do.ts
│   ├─ skills/
│   │   └─ scan-renewals.ts    扫 assets/subscriptions 续费
│   └─ connectors.ts
│
└─ orchestrator/
    ├─ do.ts
    ├─ personas/              4 个 client_agent persona 源码
    │   ├─ avery.ts            正式(企业客户)
    │   ├─ sam.ts              友好(小公司)
    │   ├─ kai.ts              技术(CTO 客户)
    │   ├─ mira.ts             外交(延期/加价场景)
    │   └─ index.ts            CLIENT_AGENTS / clientAgentBySlug
    ├─ skills/
    │   ├─ kickoff-plan.ts     新项目 kickoff 议题 + 初始任务生成
    │   └─ route-event.ts      事件到 agent 的路由决策
    └─ connectors.ts
```

## 真实 source of truth

- **DO 状态** 在 Cloudflare DO 存储里(每个 agent 的 `initialState`)
- **Persona system_prompt** 在 Supabase `mentors` 表里(可随时改,不需发版),personas/ 里的文件是**备份 + seed 源**
- **Skills** 在代码里(TypeScript 函数,要改需发版)
- **Connectors 列表** 只是"声明",方便面板可视化;实际连接配置走 env secret 和 `connectors` 表

## 扩展新 agent 的 checklist

```
☐ 在 agents/<name>/ 建 do.ts + index.ts
☐ agents/index.ts 加导出
☐ src/index.ts 加 import(barrel 的 re-export 自动带出)
☐ cloudflare/worker/wrangler.jsonc durable_objects.bindings + migrations.new_sqlite_classes 加 class 名
☐ 需要 LLM 能力的话,在 skills/ 放 helper
☐ 多性格就加 personas/,入 DB 再给 mentors.kind 区分
☐ connectors.ts 声明外部依赖
```
