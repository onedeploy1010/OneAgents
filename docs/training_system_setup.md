# 培训系统搭建指南

面向:管理员 / 部署负责人。
目标:把 OneAgents 培训系统从零搭起来,接入知识库,开始第一次试运行。

## 一、系统组成(谁管什么)

```
┌──────────────────────────────────────────────────────┐
│  Supabase(所有数据的事实源)                         │
│  - users / clients / projects                        │
│  - onboarding_programs / onboarding_tasks            │
│  - onboarding_templates / onboarding_template_tasks  │
│  - mentors(教官人设)                                │
│  - mentor_conversations(对话 + 回放)                │
│  - user_profiles(员工自画像)                        │
│  - knowledge_documents / knowledge_chunks(向量库)   │
└──────────────────┬───────────────────────────────────┘
                   │ service_role
┌──────────────────┴───────────────────────────────────┐
│  OneAgents Worker(Cloudflare,https://oneagents-worker.one-deploy.workers.dev) │
│  - 个性化引导 / 对话 / 评分                          │
│  - 走 Vercel AI Gateway 调 Claude / OpenAI           │
│  - Cron:续费/到期 + Telegram 通知                  │
└──────────────────┬───────────────────────────────────┘
                   │ HTTP
         ┌─────────┴─────────┬─────────────────┐
         │                   │                 │
   Telegram bot       Retool / Supabase  新人自助(token)
   (消息/指令)        Studio(面板)       (curl / 前端)
```

## 二、搭建步骤(一次性,估计 1-2 小时)

### Step 1:前置账号

| 账号 | 用处 | 获取方式 |
| --- | --- | --- |
| Supabase 项目 | 主数据库 + pgvector | supabase.com 新建,记 PAT + DB 密码 |
| Cloudflare 账号 | Worker 运行环境 | dash.cloudflare.com,创 API token(Workers 全权) |
| Vercel AI Gateway | 统一 LLM 账单 | vercel.com → AI Gateway → Create Key(`vck_...`) |
| Telegram Bot Token(可选) | 团队内通知 | @BotFather → `/newbot` |
| Google Workspace(可选) | 企业邮箱 | workspace.google.com 开通 |
| GitHub Org(可选) | 企业代码托管 | github.com/organizations/new |

### Step 2:推迁移

```bash
cd /Users/macbookpro/WebstormProjects/OneAgents
supabase login
supabase link --project-ref <YOUR_SUPABASE_REF>
supabase db push --include-all
```

这会依次推入 7 份 migration,结果:
- 业务主库(users / projects / tasks / finance ...)
- 身份 + 授权层(identity_bindings / api_tokens / agent_permissions)
- 培训模板层(onboarding_templates + 15-day seed)
- 语义检索 RPC `match_knowledge_chunks`
- Mentor + 对话 + 画像 + 回放视图 `mentor_conversation_replay`

### Step 3:注入 Worker secrets

```bash
cd cloudflare/worker
npx wrangler login
# 必需
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put AI_GATEWAY_API_KEY

# 管理员 bootstrap key(生成后保存一份,丢了就重建一次)
ADMIN_KEY="$(openssl rand -hex 32)"
printf "%s" "$ADMIN_KEY" | npx wrangler secret put ADMIN_BOOTSTRAP_KEY

# 可选(有就配)
npx wrangler secret put TG_BOT_TOKEN
npx wrangler secret put TG_DEFAULT_CHAT_ID
npx wrangler secret put TG_WEBHOOK_SECRET
npx wrangler secret put GH_WEBHOOK_SECRET
```

### Step 4:部署

```bash
npm run deploy
curl https://<your-worker>.workers.dev/health
```

### Step 5:登记首位 founder 账户 + 发 token

迁移已经 seed 了 `onelongmarketing@gmail.com` 作为 founder;如果你想换自己的邮箱:

```sql
update public.users set email = 'you@yourdomain.com' where role = 'founder';
```

然后拿 ADMIN_KEY 发一个属于自己的 bearer token:

```bash
curl -X POST https://<worker>/admin/tokens/create \
  -H "x-admin-key: $ADMIN_KEY" \
  -H 'content-type: application/json' \
  -d '{"label":"<你名字> CLI","userId":"<你的 user uuid>","scopes":["admin"]}'
```

返回 `"token":"oa_..."` 是明文,**仅此一次**;之后只存哈希。

### Step 6:灌知识库

系统内置了 7 份 SOP 概要(Day 1-7 流程、部署平台、DB 基础),但**远远不够**。初期至少再补这些材料:

| 主题 | 来源建议 |
| --- | --- |
| 公司历史 / 定位 | 自己写一页 |
| 带过新人的典型错误案例 | 你带过人的笔记或事后复盘 |
| 客户项目清单 + 每个项目一段描述 | 从 `projects` 表关联 `knowledge_documents` |
| 代码规范(commit / 分支 / PR) | 从 existing repo 的 CONTRIBUTING.md 拷 |
| 常用工具的非显然操作(WebStorm 快捷键 / SSH 配置常见坑) | 你自己整理 |
| 故障复盘(过去踩过的坑) | 从 Slack / Telegram 捞 |
| Q&A(新人真实问过的问题 + 你当时的回答) | 持续积累,问一次记一次 |

灌法有两种:

**A. 手动 insert + 自动 embed**

```sql
insert into knowledge_documents (title, doc_type, summary, embedding_status)
values ('SOP:WebStorm 常用快捷键', 'sop',
        '命令搜索 ⌘⇧A;文件搜索 ⌘⇧O;全局搜索 ⌘⇧F;...', 'pending');
```

然后让 Worker 批处理 embedding:

```bash
curl -X POST https://<worker>/admin/knowledge/embed-pending \
  -H "x-admin-key: $ADMIN_KEY"
```

**B. 让 Agent 帮你写一份初稿**

```bash
curl -X POST https://<worker>/admin/knowledge/research \
  -H "x-admin-key: $ADMIN_KEY" \
  -H 'content-type: application/json' \
  -d '{"topic":"SSH 配置常见坑与排查","audience":"新人 Day 5"}'
```

Agent 会用 Claude/GPT 写一篇 <=500 字的结构化文档(背景/关键概念/操作要点/常见错误/核对清单),入库 + 自动 embed。你可以再手工改。

### Step 7:登记你的项目与客户(现有在做的)

```bash
# 为每个客户一条
curl -X POST https://<worker>/entities/clients \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Acme Ltd","contactName":"...","contactChannel":"email:..."}'

# 为每个项目一条
curl -X POST https://<worker>/entities/projects \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"clientId":"<client-uuid>","name":"...","projectCode":"acme-site-prod",...}'
```

## 三、"知识库应该有什么"checklist

在**招第一个新人之前**,至少备好:

- [ ] 至少 20 条 `knowledge_documents`,doc_type 包含 `sop` / `training` / `research` / `spec`
- [ ] 每条 summary 字段不少于 100 字(embedding 靠 summary)
- [ ] 关键话题都有:工具安装 / 账号申请 / 代码规范 / 服务器连接 / DB 使用 / 部署平台 / DNS / 汇报流程 / 典型错误
- [ ] 公司正在做的**项目**都登记进 `projects`,关联到 clients
- [ ] 至少 3 份业务客户文档(灌到 `knowledge_documents` 做 `doc_type='spec'`)
- [ ] 新人入职引导的 mentor 已选好(推荐 Day 1-3 用 Nina,Day 5-7 用 Oscar)

## 四、Mentor 人设如何调校

系统内置 4 个:

| slug | name | 风格 | 适合阶段 |
| --- | --- | --- | --- |
| `marcus_strict` | Marcus | 严格 / 基础控 / 扣分细致 | Day 1-7 |
| `nina_coach` | Nina | 温和 / 鼓励 / 拆小步骤 | Day 1-3, 8-11 |
| `ravi_product` | Ravi | 追问 why / 业务视角 | Day 11, 13, 15 |
| `oscar_ops` | Oscar | 稳 / 先看日志 / 回滚意识 | Day 5-7, 9-10, 14 |

改 `mentors` 表的 `system_prompt` 字段即可调整人设。模板变量:`{trainee_name} / {task_title} / {today_goal} / {required_outputs} / {score_focus} / {sops} / {memory}`。

加新 mentor:直接 insert 一行到 `mentors` 表(写 system_prompt 时继续用这些占位符)。

## 五、验证搭建成功的清单

```bash
# 1. /health 返回 app+env
curl https://<worker>/health

# 2. 列 4 个 mentor
curl https://<worker>/mentors

# 3. 发 research 一条,确认入库 + embed 成功
curl -X POST https://<worker>/admin/knowledge/research \
  -H "x-admin-key: $ADMIN_KEY" \
  -d '{"topic":"Git rebase 基础"}'

# 4. 启动一个测试培训程序
curl -X POST https://<worker>/onboarding/programs/start \
  -H "authorization: Bearer $TOKEN" \
  -d '{"traineeEmail":"trainee1@demo.local","startDate":"2026-04-19","mentorSlug":"nina_coach"}'

# 5. 测试 today 路由(需要 trainee token)
curl -H "authorization: Bearer $TRAINEE_TOKEN" https://<worker>/onboarding/me/today

# 6. superadmin 回放
curl -H "x-admin-key: $ADMIN_KEY" https://<worker>/admin/programs/<program-id>/transcript
```

都 ok 就可以开始招人了。

## 六、常见问题

- **为什么 embedding 失败?** 多数是 AI Gateway 余额问题,或 OpenAI 模型被限流。把 `AI_GATEWAY_API_KEY` 切到有余额的 key,重跑 `/admin/knowledge/embed-pending`。
- **能用自己 fine-tune 的模型吗?** 现在只走 `openai/text-embedding-3-small`(1536 维匹配 schema)。要换模型需要同步改 `knowledge_chunks.embedding vector(1536)` 维度和重建 index。
- **Mentor 会越用越懂我们公司吗?** 会,但不是靠 fine-tune。靠:(a) 不断往 `knowledge_documents` 灌真实案例,(b) `mentor_conversations` 历史成为记忆片段,(c) `user_profiles` 让 Nina 能根据这个新人的特点调引导。
- **想加第 5 个、第 6 个 mentor?** insert 到 `mentors` 表即可,不需要改代码。
