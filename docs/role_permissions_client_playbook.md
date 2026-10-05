# 角色权限 + 客户/项目录入 Playbook

**面向:founder / member / contractor — 任何需要管客户和项目的人**
**先读第一节看自己是什么角色,再直接跳到自己对应的章节**

---

## 一、角色矩阵(我能管什么?)

### 1.1 内部角色定义

| 角色 | `users.role` 值 | 谁是 | 能做什么 |
| --- | --- | --- | --- |
| **Founder** | `founder` | 你(Alps)、合伙人 | 全部。看所有数据,改所有数据,发 token,绑所有连接器 |
| **Member** | `member` | 正式员工(通过 15 天培训后升) | 管自己项目下的客户沟通、建任务、写会议。跨项目需要 founder 授权 |
| **Trainee** | `trainee` | 试用期员工 | 只能看自己的培训,不能建客户/项目。只能给自己项目建任务 |
| **Contractor** | `member`(加 contractor 标签,下一版加独立枚举) | 外包/按任务合作 | 只读自己被邀请的项目;不能改客户数据 |
| **Agent** | `agent` | AI Agent 系统账户 | 程序化,按 `agent_permissions` 表 |

### 1.2 每种权限能碰什么

| 动作 | Founder | Member | Trainee | Contractor |
| --- | --- | --- | --- | --- |
| 查看所有客户 | ✅ | ⚠️ 自己有份的 | ❌ | ❌ |
| 新建 organization(集团) | ✅ | ❌(找 founder) | ❌ | ❌ |
| 新建 client(客户) | ✅ | ⚠️ 需要 founder 授权 | ❌ | ❌ |
| 新建 project(项目) | ✅ | ✅ 只要挂在已有 client 下 | ❌ | ❌ |
| 新建 client_contact | ✅ | ✅ 自己项目的 | ❌ | ❌ |
| 挂 project_members | ✅ | ✅ 自己是 owner 的项目 | ❌ | ❌ |
| 建任务 | ✅ | ✅ | ⚠️ 只自己的培训任务 | ⚠️ 只分配给他的 |
| 开会议 | ✅ | ✅ | ❌ | ❌ |
| `/bind_org` 绑群 | ✅ | ✅ | ❌ | ❌ |
| `/bind_client` 绑群 | ✅ | ✅ | ❌ | ❌ |
| `/bind_project` 绑群 | ✅ | ✅ | ❌ | ❌ |
| `/admin` 菜单 | ✅ | ❌ | ❌ | ❌ |
| 发 API token(给别人) | ✅(ADMIN_KEY) | ❌ | ❌ | ❌ |
| 审批工作流 | ✅ | ⚠️ 按 `approver_roles` | ❌ | ❌ |
| 改 `fx_rates` / 财务分类 | ✅ | ⚠️ 需 founder 审批 | ❌ | ❌ |
| 删除数据 | ⚠️ 慎用(生产无 undo) | ❌ | ❌ | ❌ |

### 1.3 快速判断你是哪个角色

```bash
# 在 @one23_tech_bot 私聊里
/chat 我是什么角色?有哪些权限?
```
系统助手会查你的 `users.role` + 相关 `agent_permissions` 直接告诉你。

或直接看 DB:
```sql
select email, display_name, role, status from users where email = 'you@company.com';
```

---

## 二、录入新客户完整流程(适用 founder / member)

### 2.1 什么时候需要走完整录入
- 你接到一个**新对接方**(意向客户、合作方、新供应商 — 只要会产生项目/会议/账单)
- 对方是你**已有客户的子公司**(这时用 organization 层级)
- 你和对方要开**正式项目**(不是 PoC)

**不需要完整录入的场景**:
- 一次性咨询
- 还没聊到合作意向
- 已登记的客户只是加新联系人 → 跳到 2.4

### 2.2 决策:需不需要 organization 层?

| 情况 | 要不要 org | 为什么 |
| --- | --- | --- |
| 客户就一个法人,不分子公司 | ❌ 不需要 | 只建 `clients` 即可 |
| 客户是集团,有多个子公司,你要给不同子公司开不同项目 | ✅ 需要 | 建 org,各子公司挂到 org 下作为独立 `clients` |
| 客户目前只一家,将来可能拓展 | ⚠️ 建议建 | 预留,后面不用迁数据 |
| 你服务同一批股东的多家公司(比如 CoreX + CoreY 都是一个老板) | ✅ 强烈建议 | 同 org 下管理方便 |

### 2.3 录入步骤(最完整版)

**Step 1:建 organization**(如决定要)

```sql
insert into organizations (name, slug, description, admin_email)
values (
  'Acme Holdings',
  'acme',
  '电商集团,主业跨境美妆',
  'admin@acme.com'
);
```

Slug 要**全局唯一**、小写、连字符、简短。后面群里 `/bind_org acme` 用。

**Step 2:建 client**

```sql
insert into clients (
  name, contact_name, contact_channel, billing_currency, status,
  notes, organization_id
)
values (
  'Acme Japan K.K.',
  'Takeshi Suzuki',
  'email:takeshi@acme.jp',
  'USDT',
  'active',
  '电商主站 + 物流后台。retainer 模式,每月 5000U。',
  (select id from organizations where slug = 'acme')
);
```

字段规则:
- `name`:显示名,可以中日英文
- `status`:`lead`(还没签)/ `active`(在合作) / `paused`(暂停)/ `closed`(结束)
- `billing_currency`:`USDT` / `USD` / `CNY` 等,用于 `finance_ledger` 折算
- `contact_channel`:默认联系渠道,格式 `email:xxx` 或 `tg:@xxx` 或 `whatsapp:+xxx`

**Step 3:建 client_contacts(每个对接人一行)**

```sql
insert into client_contacts (client_id, name, email, role_at_client, is_primary, notes)
values
  ((select id from clients where name='Acme Japan K.K.'), 'Takeshi Suzuki', 'takeshi@acme.jp', 'CEO', true, '最终决策人'),
  ((select id from clients where name='Acme Japan K.K.'), 'Aiko Tanaka',   'aiko@acme.jp',    'PM',  false, '日常对接'),
  ((select id from clients where name='Acme Japan K.K.'), 'Dev Lead',      'dev@acme.jp',     'Tech', false, '技术群接口人');
```

规则:
- 每个 contact 一行,分开存
- `is_primary=true` 的会默认作为通知目标
- `email` 很重要 — 客户走 @one23_support_bot /start 绑定时用的就是这个邮箱
- `role_at_client` 是**客户方的角色**(CEO / PM / Tech / Finance / Legal),不是你这边给他开的权限

**Step 4:建 project(项目)**

```sql
insert into projects (
  client_id, name, project_code,
  type, status, priority, owner_user_id,
  delivery_model, risk_level,
  version, maintenance_mode,
  start_date, target_date,
  summary
)
values (
  (select id from clients where name='Acme Japan K.K.'),
  'Acme 跨境主站 v1',
  'acme-site-v1',
  'web',
  'planning',
  2,
  (select id from users where email='you@company.com'),  -- 你自己是 owner
  'fixed',
  'medium',
  'v1',
  false,
  '2026-04-25',
  '2026-07-01',
  '客户前端商城 + 管理后台。v1 MVP = 商品展示 + 下单 + 基础后台。'
);
```

**project_code 命名规则(严格)**:`<client-slug>-<short-description>-v<version>` 或 `-<env>`,全局唯一,小写连字符。
好例子:`acme-site-v1`、`corex-dapp-v1`、`acme-logistics-prod`。
坏例子:`ACME Site V1`(大写空格)、`project-1`(无 client 前缀)。

其他字段:
- `type`: `web` / `automation` / `ops` / `ai` / `maintenance`
- `status`: `planning`(讨论)/ `active`(进行)/ `blocked`(卡住)/ `maintenance`(只维护)/ `done`(交付完)
- `delivery_model`: `fixed`(按项目固定)/ `retainer`(按月包)/ `hourly`(按时)
- `risk_level`: `low` / `medium` / `high` — 风险越高,你该越谨慎安排和 code review
- `version`: 语义化版本 `v1` / `v1.1` / `v2`
- `maintenance_mode`: `true` 表示进入维护期(v1 上线后的月度维护)

**Step 5(可选):挂团队成员到项目**

```sql
insert into project_members (project_id, user_id, role)
values
  ((select id from projects where project_code='acme-site-v1'),
   (select id from users where email='xiaoming@company.com'),
   'developer'),
  ((select id from projects where project_code='acme-site-v1'),
   (select id from users where email='xiaohong@company.com'),
   'designer');
```

`role` 是**你这边给他开的权限角色**(developer / designer / pm / reviewer),不是客户方的。

### 2.4 只是加新联系人(已有客户)

```sql
insert into client_contacts (client_id, name, email, role_at_client, notes)
values ((select id from clients where name='Acme Japan K.K.'), 'New Person', 'new@acme.jp', 'BD', null);
```

### 2.5 用 Worker API(不用写 SQL)

如果你有 bearer token:

```bash
WORKER="https://oneagents-worker.one-deploy.workers.dev"
TOKEN="oa_your_bearer_token"

# 新客户
curl -X POST "$WORKER/entities/clients" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Acme Japan K.K.","contactName":"Takeshi","contactChannel":"email:takeshi@acme.jp","billingCurrency":"USDT","status":"active","notes":"..."}'

# 新项目
curl -X POST "$WORKER/entities/projects" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"clientId":"<uuid>","name":"Acme 跨境主站 v1","projectCode":"acme-site-v1","projectType":"web","status":"planning","deliveryModel":"fixed","ownerUserEmail":"you@company.com"}'

# 挂成员
curl -X POST "$WORKER/entities/project-members" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"projectId":"<uuid>","userEmail":"xiaoming@company.com","role":"developer"}'
```

注意:**当前 Worker 还没实现 `POST /entities/organizations` 和 `POST /entities/client-contacts`**。这两个暂时只能 SQL 直写(或等下一版加路由)。

---

## 三、正式立项:走工作流(推荐)

不建议"偷偷"在 SQL 里直接 active 状态建项目,最好走 `new-client-intake` 工作流让立项过程留痕:

```bash
curl -X POST "$WORKER/workflows/new-client-intake/trigger" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{
    "clientId": "<client-uuid>",
    "input": {
      "clientId": "<client-uuid>",
      "name": "Acme 跨境主站 v1",
      "projectCode": "acme-site-v1",
      "projectType": "web",
      "deliveryModel": "fixed"
    },
    "source": "manual"
  }'
```

工作流 6 步:
```
1. intake_call          (human) 初次沟通会议
2. summarize_intake     (agent) meeting_agent 整理纪要
3. scope_review         (human, 需审批) Founder 确认 scope 和报价
4. create_project       (tool)  自动建项目
5. initial_tasks        (agent, 需审批) 生成启动任务候选
6. handoff              (tool)  Telegram 通知团队
```

你作为 founder 会在 Telegram 收到审批按钮(scope_review 那步),点批准后自动继续。立项完成后:
- `projects` 里有正式行
- `meetings` 里有 kickoff 纪要
- 一堆候选任务等你筛选后转正

---

## 四、客户权限边界(你给客户看多少)

### 4.1 客户方看得到什么

客户通过 @one23_support_bot 私聊或群能看到:
- ✅ 他自己公司名下的项目列表和状态
- ✅ 他自己公司绑定的群里的会议 / 任务
- ✅ 他自己留的消息和收到的回复
- ❌ 其他客户(即使同集团)
- ❌ 你的内部 agent 审批队列
- ❌ 财务数据 / 团队内部讨论

### 4.2 怎么给客户邀请码
客户来信说"我想看项目进度",步骤:

1. **确认他邮箱**。跟你联系过的邮箱,或客户方告诉你。
2. **在 `client_contacts` 登记**(如果还没):见 2.3 Step 3
3. **告诉他**:
   > 请在 Telegram 添加 @one23_support_bot,发送 /start,按提示输入你的邮箱(就是你刚给我的这个)完成绑定。

4. **他绑好后**,`client_contacts.telegram_chat_id` 自动填上,他就能发:
   - `/status` 看他所属 client 的全部 projects
   - `/message xxx` 给你留言(自动转发到你内部 Telegram)
   - 任何文本 = 自动转留言

### 4.3 建一个"客户专属服务群"的最佳流程
1. 在 Telegram 建新群,比如 "Acme × One23 项目群"
2. 加 @one23_support_bot 进群(bot 会自动发欢迎消息 + 通知你收到)
3. 把你自己的工作账号和 Acme 侧的对接人拉进群
4. 群里你发:`/bind_client Acme Japan K.K.` (或直接 `/bind_project acme-site-v1`)
5. 从此所有人都能:
   - `/status` 看项目情况
   - `/meeting_start 周会` → 聊 → `/meeting_end` 自动入库会议纪要
   - `/task 加个筛选框` → 建候选任务(标 needs_human_review)
   - 客户说任何内容,bot 都能感知(会议录制时全记录)

---

## 五、Version 管理:什么时候开新项目 vs 继续当前项目

决策树:

```
收到需求
  │
  ├─ 改文案 / 改 color / layout 微调
  │    → 当前项目的 branch/maintenance task
  │
  ├─ 加一个页面 / 加一个小接口 / 加一个新的管理员功能
  │    → 当前项目的 sub task,version_target="v1.1"
  │
  ├─ 改设计思路 / 重构 / 换技术栈 / 大的模块增加
  │    → 新项目,project_code 变(比如 acme-site-v2),spawned_from_project_id 指回
  │
  ├─ 生产 bug:可以 1 天内修完
  │    → 当前项目的 hotfix task,track=hotfix
  │
  └─ 生产 bug:复杂,牵连设计/测试/改库
       → 升级成 sub task,version_target=下一小版本,排期讨论
```

用 track 字段:
- `main`:产品主线(vN 的核心交付)
- `sub`:主线下的拆分(parent_task_id 指向 main)
- `branch`:短期分叉(bugfix / 实验 / 快速开关)
- `maintenance`:月度维护主任务
- `hotfix`:紧急生产修复

看 CoreX 的例子(已 seed):
```sql
select project_code, title, track, version_target, parent_task_id is not null as has_parent
from tasks t join projects p on p.id=t.project_id
where p.project_code like 'corex-%'
order by project_code, created_at;
```
你会看到每项目一条 `maintenance` epic + 挂在它下的 sub 任务。

---

## 六、常见问题

**Q: 我是 member,想建新客户,怎么办?**
A: 找 founder 在 /admin 里点"模拟新公司"或让他帮你 insert 一行 `clients`。然后 founder 把这个 client 的 owner 给你。

**Q: 客户说不想用 Telegram,邮箱行不行?**
A: 目前客户侧入口只有 Telegram。邮箱通道在 roadmap(需接 GW API),暂时可以让员工做邮件中转。

**Q: 我删了一个 project 的 task,会不会影响历史会议?**
A: 不会。`meetings` 有自己的 `project_id`,只要项目在,会议就在。但删 task 可能会断 `meeting_action_items.task_id` 链接 — 小心。建议标 `status='done'` 或 `'cancelled'`,别真删。

**Q: `/bind_org` 把 CoreX 整个集团绑一个群,合适吗?**
A: 看**谁在群里**。如果只有你 + CoreX CEO,合适(跨项目一次性看完)。如果有 Dapp 团队的客户对接人 + 算力后台客户对接人,分开建 3 个 `/bind_project` 群更好,信息更不互相打扰。

**Q: 我怎么知道一个客户"值不值得升到 organization"?**
A: 三条之中任意一条符合就升:(1) 他想拓展给关联公司用(2) 他的账单由集团统一付但执行方是多家公司(3) 你预期 6 个月内他会在国内再开一家 — 现在就建 org 省得将来迁移数据。

**Q: Contractor 能参与会议吗?**
A: 能。`/bind_project` 群里谁都能 `/meeting_start`,都能留言。但他们拿不到 bearer token 所以不能改 tasks / 审批。

---

## 七、新建真实客户的 10 分钟 checklist(打印)

```
☐ 决定 org 层 / 还是直接 client
☐ 建 organization(如需)— 记 slug
☐ 建 client — 选 delivery_model / billing_currency
☐ 建 client_contacts(至少 primary 一条)
☐ 给 primary contact 发 @one23_support_bot /start 邀请
☐ 建 project — 确定 project_code 命名
☐ 挂 project_members(你自己 + 执行同事)
☐ 用 new-client-intake workflow 正式立项(留痕)
☐ 建 Telegram 项目群,把 support_bot 和客户拉进去
☐ 群里 /bind_project <code>,顺手 /status 验证
```
