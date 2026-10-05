# 培训系统使用手册

面向:superadmin(你) / mentor(带人者) / trainee(新人) / 运维。
所有路径都以 Worker URL 为前缀,默认:`https://oneagents-worker.one-deploy.workers.dev`。

## 一、三种身份 & 三种认证

| 身份 | 认证 | 能做什么 |
| --- | --- | --- |
| Superadmin | `x-admin-key: <ADMIN_BOOTSTRAP_KEY>` | 发 token / 绑账号 / 登记 connector / 回放全部对话 / 触发 research / 跑 cron |
| Mentor(带人者) | `authorization: Bearer <oa_...>` 属于 founder/member | 开培训程序 / 评分 / 看汇总 |
| Trainee(新人) | `authorization: Bearer <oa_...>` 属于 trainee | `/me/today` / `/me/chat` / `/me/intake` / `tasks/:id/submit` |

拿 token 的方法统一走 `POST /admin/tokens/create`,需要 admin key。

## 二、Superadmin 日常操作

### 2.1 加新员工 + 发 token

```bash
# 1. 建 user
psql ... -c "insert into users(email, display_name, role, status) values ('ming@company.com', 'Xiao Ming', 'trainee', 'trial') returning id;"

# 或走 SQL Editor。拿到 user uuid.

# 2. 发 token(明文只出现一次)
curl -X POST $WORKER/admin/tokens/create \
  -H "x-admin-key: $ADMIN_KEY" -H 'content-type: application/json' \
  -d '{"label":"Xiao Ming CLI","userId":"<user-uuid>","scopes":["onboarding:self"]}'

# 3. 绑 Telegram 账号(让他能 /chat)
curl -X POST $WORKER/admin/bindings/bind \
  -H "x-admin-key: $ADMIN_KEY" -H 'content-type: application/json' \
  -d '{"email":"ming@company.com","provider":"telegram","providerUserId":"<他的 chat_id>","displayName":"Xiao Ming"}'

# 4. 绑 GitHub 账号(可选,webhook 归因用)
curl -X POST $WORKER/admin/bindings/bind \
  -H "x-admin-key: $ADMIN_KEY" \
  -d '{"email":"ming@company.com","provider":"github","providerUserId":"<github numeric user id>","displayName":"xiao-ming"}'
```

### 2.2 启动培训程序

```bash
curl -X POST $WORKER/onboarding/programs/start \
  -H "authorization: Bearer $MENTOR_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "traineeEmail":"ming@company.com",
    "mentorEmail":"you@company.com",
    "startDate":"2026-04-22",
    "mentorSlug":"nina_coach"
  }'
```

返回 `programId`。15 条 `onboarding_tasks` 自动展开,每天 due_at 为 23:59。

可选 `mentorSlug`:
- `marcus_strict`:扎基础,Day 1-7
- `nina_coach`:建信心,Day 1-3/8-11
- `ravi_product`:学业务思维,Day 11/13/15
- `oscar_ops`:学排查,Day 5-7/9-10/14

**建议做法**:初期用 Nina 降低新人压力;Day 4-5 切到 Oscar 学基础运维;Day 8+ 切回 Nina 做独立任务;Day 11-15 用 Ravi 做业务视角收尾。切换:`update onboarding_programs set mentor_slug='oscar_ops' where id='<program-id>';`

### 2.3 回放 / 审查 Agent 表现

```bash
# 看某位新人整个培训的对话
curl -H "x-admin-key: $ADMIN_KEY" \
  "$WORKER/admin/programs/<program-id>/transcript"

# 按 mentor/trainee 过滤
curl -H "x-admin-key: $ADMIN_KEY" \
  "$WORKER/admin/conversations?mentor=nina_coach&since=2026-04-01T00:00:00Z&limit=100"

# Mentor 的使用统计(消息数、平均延迟、最近活跃时间)
curl -H "x-admin-key: $ADMIN_KEY" "$WORKER/admin/mentors/stats"
```

`mentor_conversation_replay` 视图同步在 Supabase Studio → SQL Editor 能看,适合批量筛。

### 2.4 灌知识库 / 让 agent 帮你整理

```bash
# 让 agent 围绕主题写一份教材,自动入库 + embed
curl -X POST $WORKER/admin/knowledge/research \
  -H "x-admin-key: $ADMIN_KEY" \
  -H 'content-type: application/json' \
  -d '{"topic":"GitHub PR 拆分与提交信息规范","audience":"新人 Day 8"}'

# 手动插 + 批量 embed
# (先在 SQL Editor insert 多条 embedding_status='pending')
curl -X POST $WORKER/admin/knowledge/embed-pending \
  -H "x-admin-key: $ADMIN_KEY"
```

建议节奏:**每周至少加 5 条真实案例 / 过去的错题 / 客户特定说明**。越灌越懂公司。

### 2.5 项目与客户录入

```bash
# 客户
curl -X POST $WORKER/entities/clients \
  -H "authorization: Bearer $TOKEN" \
  -d '{"name":"Acme","contactName":"Jane","billingCurrency":"USD","status":"active"}'

# 项目
curl -X POST $WORKER/entities/projects \
  -H "authorization: Bearer $TOKEN" \
  -d '{"clientId":"<uuid>","name":"Acme Dashboard","projectCode":"acme-dashboard-prod","projectType":"web","status":"active","ownerUserEmail":"you@company.com","deliveryModel":"retainer"}'

# 挂成员
curl -X POST $WORKER/entities/project-members \
  -H "authorization: Bearer $TOKEN" \
  -d '{"projectId":"<uuid>","userEmail":"ming@company.com","role":"developer"}'
```

## 三、Mentor(你作为带人者)日常

### 3.1 看新人当前进度

```bash
curl "$WORKER/onboarding/programs/<program-id>/summary"
```

返回:总任务数 / 已评数 / 平均分 / 按阶段分组 / 15 条任务列表。

### 3.2 打分(人工 + AI 预评)

```bash
curl -X POST $WORKER/onboarding/tasks/<task-id>/grade \
  -H "authorization: Bearer $YOUR_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "score": 85,
    "graderNotes": "基础工具齐,扣分点:自己替换了 Claude Code 应先确认。",
    "usePrescore": true
  }'
```

- `usePrescore: true` 时,AI 用 mentor 人设先打初评分 + 3 条理由,存进 `ai_prescore` 字段
- 你自己填的 `score` 是**最终分**(覆盖 AI 评)
- 两者**都会进 `onboarding_tasks`**,便于回头对比

### 3.3 调整 Mentor

新人到了 Day 5 想切严格型:
```sql
update onboarding_programs set mentor_slug = 'oscar_ops' where id = '<program-id>';
```
下次 `/me/today` 就会用新人设。

## 四、Trainee(新人)日常

新人拿到 token 后的 5 步完整闭环:

### 4.1 入职自画像(Day 0,新人到岗当天)

```bash
curl -X POST $WORKER/onboarding/me/intake \
  -H "authorization: Bearer $MY_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "answers": "我是 3 年前端出身,React/Vue 都做过,对 Node.js 熟悉但后端系统设计薄弱。SSH/Linux 基础差。希望系统学全栈 + 部署。学习偏动手。缺点:英文文档读得慢、遇报错会慌。"
  }'
```

系统用 AI 抽取成结构化的 `user_profiles` 字段。之后 mentor 的引导会**知道他是谁**。

### 4.2 每天看今日任务

```bash
curl -H "authorization: Bearer $MY_TOKEN" "$WORKER/onboarding/me/today"
```

返回:
- 当前 Day X 的任务(标题、目标、必做、交付、评分重点)
- 选定的 mentor 用他的语气生成的今日引导(mentor_brief)
- 语义检索出的 3 条最相关 SOP(guidance_sops)

### 4.3 有问题随时问 mentor

```bash
curl -X POST $WORKER/onboarding/me/chat \
  -H "authorization: Bearer $MY_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"message":"Git clone 时报 Permission denied (publickey),怎么办?"}'
```

Mentor 会结合他的人设 + 记忆(之前他问过什么)+ 相关 SOP 给回答。**对话全部入 `mentor_conversations`,你作为 superadmin 随时回放。**

或者用 Telegram:
```
/chat Git clone 时报 Permission denied (publickey),怎么办?
```
前提:Telegram 账号已通过 `/admin/bindings/bind` 绑定。

### 4.4 提交当天作业

```bash
curl -X POST $WORKER/onboarding/tasks/<task-id>/submit \
  -H "authorization: Bearer $MY_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "notes": "完成情况:Gmail 登录、Telegram 加入、WebStorm 安装激活 ...附截图链接。",
    "uris": ["https://i.imgur.com/xxx.png","https://..."]
  }'
```

任务状态 `todo → submitted`,等 mentor 评分。

### 4.5 其他 Telegram 快捷指令

- `/ping` — 心跳
- `/help` — 指令列表
- `/status` — 最近 20 条 agent 运行统计(谁在做什么)
- `/chat <问题>` — 和当前 mentor 对话

## 五、标准 15 天节奏(推荐)

| 阶段 | Day | 默认 mentor | Superadmin 做什么 |
| --- | --- | --- | --- |
| 环境 | 1-3 | Nina | 前一天晚上 start program; 每晚检查 today 生成的引导合不合理 |
| 协作 | 4-7 | Oscar (Day 4 切) | 看新人 chat 记录,找反复被问的点 → 灌成 SOP |
| 执行 | 8-11 | Nina (Day 8 切回) | 每天用 `summary` 看节奏;打分带 usePrescore |
| 交付 | 12-15 | Ravi (Day 12 切) | Day 14 做综合演练,Day 15 面评;`final_score` 手动填入 `onboarding_programs` |

每一步切换 mentor 就一条 UPDATE。

## 六、监控与告警(自动化)

| 触发 | 动作 |
| --- | --- |
| Cron `0 9 * * *` UTC | 扫 14 天内续费的 subscriptions + 30 天内到期的 assets,生成 `notifications`,如配置了 `TG_DEFAULT_CHAT_ID` 自动发 Telegram |
| `POST /workflows/meeting` | 会议纪要入库,标 `needs_human_review=true` |
| `POST /workflows/finance` | ≥300U 的流水标 `needs_human_review=true`,Telegram 通知 |
| GitHub webhook → `/webhooks/github` | 落 `agent_runs`,如 sender 绑过 `identity_bindings` 会关联到该 user |

手动立刻跑一轮 cron:
```bash
curl -X POST $WORKER/cron/run
```

## 七、故障处理速查

| 症状 | 先查 | 常见原因 |
| --- | --- | --- |
| `/me/today` 的 `mentor_brief` 是 null | `mentor_conversations` 最新一条 | 1) program 没配 mentor_slug 2) AI Gateway 余额没 3) prompt 超长 |
| 语义检索召回的 SOP 不相关 | `knowledge_documents` 数量 + embedding_status | 知识库太薄 / embedding 没跑;跑 `/admin/knowledge/embed-pending` |
| 新人提交后 mentor 不回应 | `/me/today` 不触发主动问 | 当前没实现"主动消息";你作为 mentor 需要看 summary 然后打分反馈 |
| `insufficient_quota` 之类 | `agent_runs.error_message` | AI Gateway / OpenAI 额度 |
| Telegram 没收到通知 | 是否配了 `TG_BOT_TOKEN` + `TG_DEFAULT_CHAT_ID` | 未配则 cron 跑完 `skipped:telegram_not_configured`;配好再跑 `/cron/run` |

## 八、安全与权限(当前状态)

- **RLS 已启用**在所有业务表,service_role 自带 BYPASSRLS,Worker 正常写入
- **Bearer token**:SHA-256 哈希存储,明文只出现在 create 时一次;可以主动 `update api_tokens set revoked_at=now() where id=...` 吊销
- **Admin key**:所有 `/admin/*` 路由需要 `X-Admin-Key`;**不放前端**
- **Webhook 验签**:配 `GH_WEBHOOK_SECRET` / `TG_WEBHOOK_SECRET` 开启(HMAC-SHA256 + 头校验)
- **Agent 权限**:`agent_permissions` 表目前只做记录,未强制拦截;后续可接

## 九、扩展清单(按优先级)

1. **Retool/Appsmith 面板**(~4h):审批候选、培训看板、连接器状态。后端 API 齐了,直接拖 UI
2. **`/admin/seat/allocate`**:新员工入职,一键发 GW 邀请 + GH 邀请 + 建培训程序
3. **主动消息**:新人超 36 小时没提交当日任务时,mentor 自动在 Telegram 问候
4. **Mentor 间"交接记录"**:切换 mentor 时自动生成一段 handoff 摘要
5. **`/me/chat` 接 streaming**:长回复逐字出,TG 先发 placeholder 再 edit

## 十、备份与迁出

- Supabase 自动 daily backup(Dashboard → Backups)
- 自己额外:`pg_dump -Fc $DB_URL > oneagents_$(date +%F).dump`
- Worker 代码:本 repo 直接 git commit
- Secrets:`wrangler secret list` 看名字,值无法导出,需重新注入
