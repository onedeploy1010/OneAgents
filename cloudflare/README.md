# Cloudflare 执行层说明

**作者：Manus AI**  
**版本：v0.1**  
**状态：首版骨架说明**

## 一、定位

本目录承载 **OneAgents 的执行与编排层**。它的职责不是保存全部主业务数据，而是作为外部事件入口、任务调度层和专用 Agent 运行环境。根据 Cloudflare 官方文档，Agents 适合运行在持久化、可调度、可实时连接的环境中，并与 Durable Objects 绑定；因此这里的第一版骨架采用 **Worker 入口 + Agent 类** 的方式组织。[1]

## 二、当前结构

| 路径 | 作用 |
| --- | --- |
| `worker/package.json` | 依赖与运行脚本 |
| `worker/wrangler.jsonc` | Cloudflare 部署配置与 Agent 绑定 |
| `worker/.dev.vars.example` | 本地开发配置样例 |
| `worker/src/index.ts` | HTTP 入口、Webhook 路由、流程占位 |
| `worker/src/agents/` | 会议、项目运营、财务、新人培训四类 Agent 骨架 |

## 三、为什么这样分层

首版不直接把全部复杂工作流塞进单个巨型 Worker，而是先建立三层。第一层是 **HTTP / Webhook 入口层**，负责接收 GitHub、Telegram 和业务工作流请求。第二层是 **专用 Agent 层**，负责保存某类业务的最小持久状态。第三层是 **Supabase 写入层**，负责把结果写回主运营库。这样的结构既符合你当前“先跑 MVP”的节奏，也与 Cloudflare Agents 的运行模型一致。[1] [2]

## 四、首版可用路由

| 路由 | 作用 | 当前状态 |
| --- | --- | --- |
| `GET /health` | 健康检查 | 已预留 |
| `POST /webhooks/github` | 接收 GitHub 事件 | 已预留占位 |
| `POST /webhooks/telegram` | 接收 Telegram 命令 | 已预留占位 |
| `POST /workflows/meeting` | 会议转任务入口 | 已实现候选入库骨架 |
| `POST /workflows/finance` | 财务入账入口 | 已实现候选入库骨架 |

## 五、开发建议

如果你接下来继续做实现，建议先把这三个点补齐。第一，补 webhook 验签与错误处理。第二，补真实的 Telegram 指令解析与通知模板。第三，把 `meeting_agent` 与 `finance_agent` 从“写入候选记录”升级到“生成候选摘要 + 待复核任务”。等这三步完成后，再考虑 GitHub 同步、知识检索、邮件账单解析与 WhatsApp 客户通知。

## 六、启动方式

Cloudflare 官方快速开始说明，Agents 项目通常以 `wrangler` 运行，并在配置中声明 Durable Object 绑定与迁移信息；Agent 类则以 TypeScript class 形式实现，方法可通过 `@callable()` 暴露。[1]

```bash
cd cloudflare/worker
npm install
npm run dev
```

> 本目录当前是**后端执行层骨架**，不是完整前端应用。你后续如果要做管理面板，可以再新增独立前端目录，或使用另一个仓库承载。

## References

[1]: https://developers.cloudflare.com/agents/getting-started/quick-start/ "Cloudflare Agents Quick start"
[2]: https://developers.cloudflare.com/agents/ "Cloudflare Agents"
