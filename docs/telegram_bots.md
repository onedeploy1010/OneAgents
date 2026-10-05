# Telegram Bots 搭建与使用手册

OneAgents 用**两个独立 bot**服务不同人群。一个不能兼做 —— 界面、指令、权限都不一样。

## 一、两个 bot 的定位

| Bot | 角色 | 面向 | 核心能力 |
| --- | --- | --- | --- |
| **Employee bot**(`@one23_tech_bot`) | `employee` | 内部员工 / 新人 | `/start` 走入职引导、对话 mentor、查培训进度、审批工作流 |
| **Client bot**(需新建,如 `@one23_client_bot`) | `client` | 客户方联系人 | `/start` 绑定客户身份、查项目进度、留言给团队 |

两个 bot 共用同一 Worker,但 webhook 路径不同,Worker 按路径分流到不同处理逻辑。

## 二、BotFather 申请两个 bot

### Employee bot(你已有)
```
@BotFather → /mybots → @one23_tech_bot
```
已经跑着了,不用重做。

### Client bot(新建)
```
@BotFather → /newbot
name(显示名):One23 Client Bot
username(全局唯一,以 _bot 结尾):one23_client_bot
→ 得到 token "<digits>:AAxxxxxxxx"

可选美化:
  /setdescription  面向客户的项目沟通入口
  /setabouttext    One23 Client Bot
  /setuserpic      上传 logo
  /setcommands     粘贴以下
      start - 开始 / 重新绑定
      status - 查项目进度
      message - 留言给项目负责人
      help - 帮助
```

### 把 token 放进 Worker

```bash
cd cloudflare/worker
printf "<client_bot_token>" | npx wrangler secret put TG_BOT_TOKEN_CLIENT
# 可选:如果你有客户共同群,也可以再设默认 chat id
# npx wrangler secret put TG_DEFAULT_CHAT_ID_CLIENT
```

### 设置两个 webhook

```bash
# Employee bot — 改到新路径
curl -X POST "https://api.telegram.org/bot<employee_token>/setWebhook" \
  --data-urlencode "url=https://oneagents-worker.one-deploy.workers.dev/webhooks/telegram/employee"

# Client bot — 新路径
curl -X POST "https://api.telegram.org/bot<client_token>/setWebhook" \
  --data-urlencode "url=https://oneagents-worker.one-deploy.workers.dev/webhooks/telegram/client"
```

旧的 `/webhooks/telegram`(不带 role)仍能工作,但会被当作 employee。建议尽快切到带 role 的路径。

### 验签(可选,推荐)

两个 bot 可以共用同一个 `TG_WEBHOOK_SECRET`(目前 Worker 只读一份 env):

```bash
WEBHOOK_SECRET="$(openssl rand -hex 32)"
printf "%s" "$WEBHOOK_SECRET" | npx wrangler secret put TG_WEBHOOK_SECRET

curl -X POST "https://api.telegram.org/bot<token>/setWebhook" \
  --data-urlencode "url=https://oneagents-worker.one-deploy.workers.dev/webhooks/telegram/employee" \
  --data-urlencode "secret_token=$WEBHOOK_SECRET"
```

## 三、Employee bot 的 `/start` 状态机

```
(新用户) /start
  └─> "欢迎,回复企业邮箱"
      session.state = awaiting_email
      │
      │ 用户回 "ming@company.com"
      │
      ├─ 查 users 表没记录 → 回"请让 admin 先登记",session 回 idle
      │
      └─ 查到 → upsert identity_bindings(telegram, chat_id, user_id)
         session.state = intake_background
         问:"问题 1/3:技术背景"
         │ 用户回 → 记到 state.answers.background
         │
         session.state = intake_weak
         问:"问题 2/3:最薄弱的是什么"
         │ 用户回 → state.answers.weak
         │
         session.state = intake_style
         问:"问题 3/3:学习风格"
         │ 用户回 → state.answers.style
         │
         汇总 → 调 handleMentorIntake(抽取 profile)
              → 触发 employee-first-day 工作流(自动)
              → 立即展示 Day 1 引导
         session 清空,回到 idle
```

(已绑定过的)`/start`:直接显示指令菜单,不再问邮箱。

### Employee bot 日常命令

| 命令 | 作用 |
| --- | --- |
| `/today` 或 `/help` | 查当日任务 + mentor 引导(需绑定) |
| `/chat <内容>` | 和 mentor 自由对话 |
| `/status` | 最近 20 条 agent 运行统计 |
| `/ping` | 心跳 |
| `/approve <step-run-id>` | 审批工作流节点 |
| `/reject <step-run-id> <reason>` | 拒绝 |
| `/cancel` | 取消当前多轮流程 |

## 四、Client bot 的 `/start` 状态机

```
(新用户) /start
  └─> "Hi, welcome to One23 Client Bot. 请回复你登记的邮箱"
      session.state = awaiting_client_email
      │
      │ 用户回邮箱
      │
      ├─ client_contacts 里没这个邮箱
      │    → 通知内部团队(Telegram),session 回 idle
      │    → 用户可继续留言(自由文本会转发)
      │
      └─ 找到 → 把 telegram_chat_id 补到 client_contacts
         session 回 idle,回"✅ 已绑定"
         显示指令菜单
```

### Client bot 日常命令

| 命令 | 作用 |
| --- | --- |
| `/status` | 列出其所属 client 下的所有 projects + 状态 |
| `/message <内容>` | 发消息给项目负责人(Telegram 转达) |
| `/help` | 帮助 |
| `<任意文本>` | 视为自由留言,自动转发 |

## 五、客户联系人登记(Superadmin 操作)

Client bot 绑定要求 `client_contacts.email` 已登记。两种方式:

**SQL 直写:**
```sql
insert into client_contacts (client_id, name, email, role_at_client, is_primary)
values ('<client-uuid>', 'Jane Doe', 'jane@acme.com', 'PM', true);
```

**或后续加 API:**(暂未实现,下一版)
```
POST /entities/client-contacts
  { clientId, name, email, roleAtClient }
```

在客户首次 `/start` 发他邮箱前,先把这行塞进去。

## 六、客户消息怎么落地

当客户在 Client bot 里输入任意文本或 `/message`:

1. 写一行 `agent_runs`(trigger_source="telegram_client:message"),含 chat_id / from_id / text / client_id
2. Worker 把消息转发到 employee 的 default chat(你会看到 `客户消息(Acme)...`)
3. 回客户 "✅ 已转达给你的项目负责人"

**回信**:目前没有自动从 employee 端写给 client bot 的路由。下一版可以加:
- `POST /clients/:id/send-message`(员工调用,消息发到该 client 绑定的 chat_id)
- 或 Telegram `/reply <contact-id> <text>` 命令

## 七、常见问题

- **为什么不用一个 bot 两套命令?** 品牌和信任感不同,客户不应该看到 `/approve` 之类内部指令。Telegram 的 BotFather `setcommands` 不支持按用户划分指令。
- **客户拒绝用 Telegram?** 加一条 email 转发线:后续可以用 GW Groups 做 `support@company.com`,客户邮件进来自动 copy 进 OneAgents,从 employee bot 看。
- **Session 过期?** 目前不自动清,`/cancel` 或 `/start` 会重置。可以加 cron 定时清 30 天没活动的 session,防表无限增长。
- **多个设备同时用?** Session 以 `chat_id` 为主键,私聊 chat_id 和 user_id 是一对一,没问题。群组另算,目前不建议在群里跑 intake。

## 八、验证部署成功(手动)

```bash
WORKER="https://oneagents-worker.one-deploy.workers.dev"

# employee bot — 模拟 /start(chat_id 1111 是新用户)
curl -X POST "$WORKER/webhooks/telegram/employee" \
  -H 'content-type: application/json' \
  -d '{"update_id":1,"message":{"message_id":1,"from":{"id":1111},"chat":{"id":1111},"text":"/start"}}'

# 应收到"欢迎 / 请回复邮箱"(如果你的 client bot token 没配就不会真发 TG,但 session 会落库)

# 查 session 是否落库
psql ... -c "select chat_id, bot_role, state from telegram_sessions order by last_interaction_at desc limit 5;"

# client bot — 模拟 /start
curl -X POST "$WORKER/webhooks/telegram/client" \
  -H 'content-type: application/json' \
  -d '{"update_id":1,"message":{"message_id":1,"from":{"id":2222},"chat":{"id":2222},"text":"/start"}}'
```

## 九、群组模式(多服务群 + 会议助手)

当你把 **@one23_support_bot 拉进 Telegram 群**(比如"Acme × OneAgents 项目群"),bot 自动进入**群模式**,和 1v1 私聊完全不一样:

### 一次性:把群绑到项目

```
群里任意员工(founder/member)发:
  /bind_project demo-dashboard-prod

Bot 回复:
  ✅ 本群已绑定到项目 *Demo Dashboard* (demo-dashboard-prod)
```

从此这个群里所有动作都**自动作用于这个项目**。表:`telegram_groups`(chat_id ↔ project_id 绑定记录)。

### 开会 + 自动入库

```
谁都可以发:
  /meeting_start 周会 / kickoff / design review

之后:
  大家随便聊,Bot 静默记录每条非命令消息(加发言人前缀)

会议结束发:
  /meeting_end

Bot 自动:
  1. 组装 transcript
  2. 调 meeting_agent 写入 meetings 表(needs_human_review=true)
  3. 群里回复 Meeting ID 和消息数
  4. Superadmin 可后续 review / 抽行动项
```

### 群里指挥 agents

| 指令 | 作用 | 幕后 |
| --- | --- | --- |
| `/task <描述>` | 在绑定项目下建任务 | `tasks` 表 insert,source_channel=telegram:group |
| `/status` | 项目进度 + 任务分布 + 最近 3 次会议 | 聚合 projects/tasks/meetings |
| `/meeting_start <title>` + `/meeting_end` | 会议记录闭环 | `telegram_meeting_buffers` → `meetings` |
| `/unbind` | 解除绑定 | telegram_groups.is_active=false |
| `/help` | 群可用指令 | |

### 权限模型

- **`/bind_project`**:只有 `identity_bindings` 能解析到 user 且 role∈{founder, member} 才能绑
- **其他命令**:只要绑过,群里任何人(含客户)都能发 `/task` `/status`。是否要收紧,下一版可以加 approver_roles
- **会议录制**:一旦 `/meeting_start`,**所有非命令文本**都会被录进 transcript。想暂停就 `/meeting_end`

### 实战:一个真实群的完整生命周期

```
Day 1  建群:"Acme × OneAgents 项目群"
       加入 @one23_support_bot
       你发 /bind_project acme-site-prod
       Bot:✅ 已绑定

Day 1  你 /meeting_start kickoff with Acme
       客户 Jane:"我们希望 3 周内上线新首页"
       你:"OK,我回去算下工作量"
       你 /meeting_end
       Bot:✅ Meeting <uuid> 已入库,3 条消息

Day 2  客户 Jane(在群里)/status
       Bot:项目=Acme Site Prod,status=planning,任务(todo=5, doing=2)...

Day 3  你:/task hero banner 3 版候选,周二交
       Bot:✅ 任务已建 <uuid>

Day 10 客户 Jane:"首页什么时候能看到?"
       你(在群里,不打断对话):/status
       Bot:...(发给所有人看)

Day 20 /meeting_start 验收会
       大家聊,bot 记录
       /meeting_end
       会议 agent 后续生成行动项(meeting_action_items),等人审后转 tasks
```

### 多群共存

一个 bot 可以同时进**任意多个**群,每个群独立绑一个项目:

| 群 | 绑定项目 | 用途 |
| --- | --- | --- |
| Acme × OneAgents | acme-site-prod | Acme 日常沟通 |
| Beta Corp 项目群 | beta-dashboard-prod | Beta 日常 |
| Internal Tech | (不绑,或绑内部项目) | 团队内部 |

每个群的 `/meeting_start` 互不干扰,会议记录落到各自绑定的项目下。

### 数据模型

```
telegram_groups
  chat_id text PK
  bot_role (employee|client|admin)
  title                 群标题(来自 TG 元数据)
  client_id             指向 clients
  project_id            指向 projects(实际工作在这一层)
  bound_by_user_id      谁绑的
  bound_at              何时绑的
  is_active             可软删
  config                jsonb(后续可放自定义行为开关)

telegram_meeting_buffers
  id PK
  chat_id               -> telegram_groups
  title
  started_by_user_id / started_by_tg_user_id
  status                active | ended | discarded
  transcript            text(持续 append)
  message_count
  started_at / ended_at
  meeting_id            -> meetings(end 后写回)
```

### 风险与后续

- **隐私**:bot 进群后看得到**所有**非命令消息;如果群里有敏感话题又不想被记录,`/meeting_end` 或开会前别 `/meeting_start`
- **滥用**:任何人都能 `/task`,会塞垃圾任务。想收紧加 `approver_roles` 或只有群管能 task
- **没回信机制**:员工在内部 Telegram 看到客户消息后,目前没法一键从内部 bot 回传到客户群。下一版:员工 bot `/reply <group-chat-id> <text>` 或在 Retool 里做按钮
- **消息数限制**:会议 buffer 一直写 text,单次建议 <2 小时 + <1000 条。超长的话分批 `/meeting_end` 再 `/meeting_start`

## 十、TL;DR

1. BotFather 申请 client bot,拿 token
2. `npx wrangler secret put TG_BOT_TOKEN_CLIENT`,粘贴 token
3. 两个 bot 的 webhook 分别指到 `/webhooks/telegram/employee` 和 `/webhooks/telegram/client`
4. 给客户联系人先建 `client_contacts` 行(含 email)
5. 让员工和客户各自 `/start`,系统自动完成绑定 + 引导
