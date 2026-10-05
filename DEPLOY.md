# OneAgents 部署 Runbook

把 Supabase 当主运营库,Cloudflare Worker 当执行层。按顺序跑这 3 步即可上线 MVP。

---

## 准备清单

| 资源 | 要做的事 |
| --- | --- |
| Supabase 项目 | 在 https://supabase.com/dashboard 新建项目,记下 Project Ref、URL、`service_role` key |
| Cloudflare 账号 | 已登录 `wrangler login` |
| Telegram Bot(可选) | 从 @BotFather 创建,拿 Bot Token 与默认 Chat ID |
| GitHub Webhook Secret(可选) | 自行生成一个随机字符串,后面在 GitHub App/Repo 里配同一份 |

---

## 一、Supabase:部署主运营库

### 方式 A(推荐):Dashboard SQL Editor

1. 打开 Supabase Dashboard → SQL Editor → New query。
2. 先跑 `db/migrations/001_init.sql`(建表、枚举、索引、触发器)。
3. 再跑 `db/seeds/001_reference_seed.sql`(`fx_rates` 默认 1:1)。
4. 在 Table Editor 确认 `projects`、`meetings`、`finance_ledger`、`agent_runs` 等表存在。

### 方式 B:Supabase CLI

CLI 要求迁移文件带 14 位时间戳前缀。当前是 `001_init.sql`,本地先改名再 push:

```bash
cd /Users/macbookpro/WebstormProjects/OneAgents
supabase login
supabase link --project-ref <YOUR_PROJECT_REF>

# 重命名以满足 CLI 时间戳格式
mv db/migrations/001_init.sql supabase/migrations/20260419000001_init.sql
mv db/seeds/001_reference_seed.sql supabase/seeds/20260419000002_reference_seed.sql

supabase db push
```

> 如果不想改仓库结构,就用方式 A。

### 验证

在 SQL Editor 跑:

```sql
select table_name from information_schema.tables
where table_schema = 'public' order by 1;
```

应至少看到 `projects`、`meetings`、`tasks`、`finance_ledger`、`agent_runs`、`fx_rates` 等表。

---

## 二、Cloudflare Worker:配置与部署

### 1. 本地依赖

```bash
cd /Users/macbookpro/WebstormProjects/OneAgents/cloudflare/worker
npm install
```

### 2. 登录并预检

```bash
npx wrangler login
npx wrangler deploy --dry-run   # 应看到 4 个 Durable Object 绑定
```

### 3. 注入密钥(生产环境)

把 Supabase 与 Telegram 密钥作为 Secret 注入 Worker。**不要**把它们写进 `wrangler.jsonc`。

```bash
# 必需
npx wrangler secret put SUPABASE_URL            # 粘贴 https://<ref>.supabase.co
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY

# 可选(用到哪项补哪项)
npx wrangler secret put TG_BOT_TOKEN
npx wrangler secret put TG_DEFAULT_CHAT_ID
npx wrangler secret put TG_WEBHOOK_SECRET
npx wrangler secret put GH_WEBHOOK_SECRET
```

### 4. 本地开发密钥

复制样例并填值(仅本地用,不提交):

```bash
cp .dev.vars.example .dev.vars
# 用编辑器填入真实值
npm run dev
```

### 5. 部署到生产

```bash
npm run deploy
```

部署完会得到类似 `https://oneagents-worker.<subdomain>.workers.dev` 的 URL。

### 6. 冒烟测试

```bash
WORKER_URL="https://oneagents-worker.<subdomain>.workers.dev"

# 健康检查
curl "$WORKER_URL/health"

# 会议候选写入(需要 Supabase 已经建表)
curl -X POST "$WORKER_URL/workflows/meeting" \
  -H 'content-type: application/json' \
  -d '{
    "title": "冒烟测试会议",
    "rawTranscript": "demo 文本",
    "sourceChannel": "smoke_test"
  }'

# 财务候选写入
curl -X POST "$WORKER_URL/workflows/finance" \
  -H 'content-type: application/json' \
  -d '{
    "entryType": "income",
    "category": "project_payment",
    "originalCurrency": "USDT",
    "originalAmount": 100,
    "rateToU": 1,
    "occurredAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
  }'
```

然后回 Supabase Table Editor 看 `meetings`、`finance_ledger`、`agent_runs` 是否有新记录。

---

## 三、外部事件接入(可选,跑通再接)

| 平台 | 目标路由 | 要做的事 |
| --- | --- | --- |
| GitHub | `POST /webhooks/github` | 在 Repo/Org Webhook 里填 URL,secret 用 `GH_WEBHOOK_SECRET`,触发 push/PR 验证 |
| Telegram | `POST /webhooks/telegram` | `curl` `https://api.telegram.org/bot<TOKEN>/setWebhook` 指向 Worker URL |

首版路由只落 `agent_runs` 审计记录,真实解析等后续迭代补上。

---

## 常见问题

- **`wrangler deploy` 报 DO 迁移冲突**:首次部署已注册 `v1` sqlite classes。若后续新增 Agent,要在 `wrangler.jsonc` 的 `migrations` 里加新 tag(`v2`)并用 `new_sqlite_classes`,不要改旧 tag。
- **Supabase 插入报 RLS 拒绝**:Worker 用 `service_role` key,默认绕过 RLS。如果换成 `anon`,需要在迁移里加 policy。
- **`meeting_candidate saved` 但 Telegram 没收到**:是否配了 `TG_BOT_TOKEN` + `TG_DEFAULT_CHAT_ID`?没配会静默跳过,查 `wrangler tail` 确认。
