# 用 Agent 录入真实客户

**角色要求**:founder。Member 暂不能触发。
**前提**:你已在 @one23_tech_bot 私聊 /start 过 + 你的 Telegram chat_id 绑定到 `users.role='founder'`。

---

## 一、3 步完事

### Step 1 — 在 bot 私聊发 `/admin`

Bot 返回菜单,第一个按钮就是:

```
🆕 录入真实客户(对话)
```

点它。

### Step 2 — 用一段话描述这个客户

Bot 会提示:

> 🆕 录入真实客户
> 请用一段话描述新客户,我会自动抽成结构化记录让你确认。

你发一段自然语言,不用规范格式。例子:

```
Acme 集团(slug acme),公司 Acme Japan,CEO Takeshi 邮箱 takeshi@acme.jp,
PM Aiko 邮箱 aiko@acme.jp。第一个项目是 Acme 跨境主站 v1,code acme-site-v1,
web 类型,fixed 结算 USDT,planning 状态。
```

可以**任意省略**:
- 不写 slug → LLM 自动生成
- 不写 projectCode → LLM 按规则生成(client-slug + desc + v1)
- 不写 deliveryModel → 默认 fixed
- 不写 billingCurrency → 默认 USDT
- 不写 projectType → LLM 猜(看描述里有"前端/后台/自动化/运维/AI")

LLM(走 Vercel AI Gateway → Claude Haiku)抽字段。

### Step 3 — 看预览,按确认

Bot 会回给你:

```
准备创建以下记录:
📁 集团: Acme (slug acme)
🏢 客户: Acme Japan · 结算 USDT · lead
👤 主联系人: Takeshi <takeshi@acme.jp> · CEO
   + Aiko <aiko@acme.jp> · PM
📂 项目: Acme 跨境主站 v1 (acme-site-v1) · web · fixed · v1

[✅ 确认创建]  [❌ 取消]
```

**查一遍**,特别注意:
- `projectCode` 是否符合命名规则
- 邮箱没漏
- `billingCurrency` 对不对

点 **✅ 确认创建**,bot 返回每一步执行结果:

```
✅ 集团 Acme 已建
✅ 客户 Acme Japan 已建
✅ 主联系人 takeshi@acme.jp 已建
✅ 联系人 aiko@acme.jp 已建
✅ 项目 Acme 跨境主站 v1 (acme-site-v1) 已建

[🚀 启动 new-client-intake 工作流]
[⬅️ 返回菜单]
```

### Step 4(可选)— 启动 new-client-intake 工作流

点 **🚀 启动 new-client-intake 工作流**,会自动把这个客户跑进 6 步流程:

```
1. intake_call (human)         ← 你开 kickoff 会议
2. summarize_intake (agent)     ← meeting_agent 整理
3. scope_review (human, 审批) ← 你确认 scope 和报价
4. create_project (tool)        ← 自动建/更新项目
5. initial_tasks (agent, 审批) ← 生成启动任务候选
6. handoff (tool)               ← 发 Telegram 通知团队
```

这一步是**可选**的。如果你只是先建个客户档案还没到立项阶段,**不点** 🚀,走到这结束。

---

## 二、缺字段会怎样

预览里如果 LLM 抽不到必填字段(客户名 / 项目名 / projectCode / 主联系人邮箱),bot 会加一行:

```
⚠️ 缺:主联系人邮箱 · 缺:项目代码
请再次用一段话补充
```

session 保持,你再发一段**补齐这些信息**,bot 重新抽,重新预览。不用从头来。

中途想退:发 `/cancel`。

---

## 三、重复的怎么办

- **客户名已存在**:不报错,bot 说"↪️ 已存在,复用",不会重复建
- **项目代码已存在**:同上,复用
- **集团已存在**(name 匹配):复用,同时会把客户挂到该集团下(如果之前没挂)
- **联系人邮箱已存在**:跳过,不重复建

所以**重跑同一个描述不会造垃圾数据**。

---

## 四、跟客户方的后续

创建完,把这几件事跟进:

1. **把主联系人的 Telegram chat_id 绑上**:让他去 @one23_support_bot 发 `/start`,输入他邮箱,自动绑到 `client_contacts.telegram_chat_id`
2. **建项目专属群**(如需):拉 @one23_support_bot 和客户侧对接人进群,发 `/bind_project <code>`
3. **跑 kickoff 会议**:`/meeting_start kickoff` → 聊 → `/meeting_end`,自动入 `meetings`

---

## 五、别的方式(非 bot 对话)

对照一下所有入口:

| 入口 | 适合 | 字段准确度 | 留痕 |
| --- | --- | --- | --- |
| **🆕 录入真实客户 按钮(本文)** | 日常快速录入 | 高(LLM 抽 + 你预览确认) | 完整 |
| **🧪 模拟新公司 按钮** | 测试 / 演示 | 低(全自动假数据) | 标 `sim:` |
| `POST /entities/clients` / `/projects` | 脚本 / 自动化 / Retool | 高 | 部分 |
| SQL 直写 | 大批量迁移 | 高 | 无自动留痕 |
| `new-client-intake` 工作流(requires clientId) | 正式立项(已建客户之后) | 高 | 完整 |

**建议**:日常录入用 bot 对话;大批量第一次导入用 SQL 批量,之后再用 bot 对话补/改。

---

## 六、Debug:如果 agent 抽错了字段

1. 在预览里看哪个字段错
2. 点 **❌ 取消**
3. 重新点 🆕 录入真实客户
4. 用更明确的措辞(尤其带字段名):
   - ❌ "他们叫 Acme"
   - ✅ "公司名是 Acme Japan"
   - ✅ "集团 slug 写作 acme"

或者:

```bash
curl -X POST https://oneagents-worker.one-deploy.workers.dev/entities/clients \
  -H "authorization: Bearer $YOUR_TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Acme Japan","billingCurrency":"USDT","status":"active"}'
```
直连 API 跳过 LLM。精确但没对话体验。

---

## 七、数据留痕

每一次录入会在 `agent_runs` 写一行:

```sql
select actor_source, input_payload, output_payload, started_at
from agent_runs
where trigger_source = 'intake:real_client'
order by started_at desc limit 5;
```

你能看到:
- 是谁触发的(actor_user_id 关联 users)
- 原始 LLM 抽出来的 draft(input_payload)
- 建了什么 org/client/project 的 UUID(output_payload)

将来出问题可回溯。

---

## 八、常见问题

**Q: 一次能录多少个客户?**
A: 一次一个。LLM 抽取单个客户效果最好。批量建议用 SQL。

**Q: 能在手机 Telegram 上用吗?**
A: 可以。按钮和文本流都支持。

**Q: 我不小心按了"确认"发现名字写错了怎么办?**
A: 去 Supabase Studio 改 `clients.name`;或发一段新的描述让 bot 建一个新的(LLM 不会自动同名合并,会留下错的那条和对的那条 — 记得去 Supabase Studio 删错的)。

**Q: 对话式录入可以让 member 用吗?**
A: 目前只 founder。下一版可以让 member 也用,但会限制只能在他是 owner 的 org 下建。

**Q: 能给项目一次性录多个 v 版本吗?**
A: 不能,一次一个项目。多版本的思路是:第一次建 v1;后续开 v2 时再走一次对话(说"给 Acme Japan 加一个 acme-site-v2 项目,基于 v1")。
