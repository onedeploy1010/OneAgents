# 数据库结构设计

**作者：Manus AI**  
**版本：v0.1**  
**状态：MVP 结构稿**

## 一、设计原则

本数据库并不是客户业务数据的总仓库，而是公司的**运营主库**。它负责保存项目、任务、会议、财务、资产、培训、Agent 日志与知识索引元数据。客户项目自身的业务数据继续保留在各自的 Supabase 项目中；主运营库只保存必要的映射、摘要和备份策略信息。

因此，数据库设计遵循三个原则。第一，**公司运营事实与客户业务事实分离**。第二，**所有核心实体都要有状态字段、归属字段和时间字段**。第三，**所有可被 Agent 写入的表，都必须预留来源、置信度和审计字段**。

## 二、核心实体总览

| 表名 | 作用 | 关键关联 |
| --- | --- | --- |
| `users` | 系统用户与团队成员 | 关联任务、会议、培训、绩效 |
| `clients` | 客户基础信息 | 关联项目、报价、财务流水 |
| `projects` | 项目主表 | 关联任务、资产、部署、数据库、报价 |
| `project_members` | 项目参与关系 | 连接项目与成员 |
| `tasks` | 任务主表 | 关联项目、责任人、会议、代码变更 |
| `meetings` | 会议记录主表 | 关联项目、纪要、行动项 |
| `meeting_action_items` | 会议行动项 | 可转为任务 |
| `finance_ledger` | 收入支出流水 | 关联项目、客户、币种、折算规则 |
| `fx_rates` | 货币与稳定币折算表 | 为 U 结算提供依据 |
| `assets` | 域名、服务器、站点、服务账号等资产 | 关联项目与订阅 |
| `subscriptions` | 订阅与周期费用 | 关联供应商和资产 |
| `deployments` | 部署记录 | 关联项目与平台 |
| `project_databases` | 客户数据库与备份映射 | 关联项目、Supabase、备份策略 |
| `onboarding_programs` | 培训计划主表 | 关联新人、评分、任务 |
| `onboarding_tasks` | 新人训练任务 | 关联培训计划与评分 |
| `performance_reviews` | 绩效记录 | 关联成员与周期 |
| `knowledge_documents` | 文档索引与知识条目 | 关联向量索引、项目与来源 |
| `agent_runs` | Agent 执行日志 | 关联输入来源、结果、状态 |
| `notifications` | 系统提醒与消息队列 | 关联用户、渠道、优先级 |

## 三、建议的表结构

### 1. `users`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid pk | 用户主键 |
| `email` | text unique | 企业邮箱 |
| `display_name` | text | 显示名称 |
| `role` | text | `founder` / `member` / `trainee` / `agent` |
| `status` | text | `active` / `inactive` / `trial` |
| `telegram_chat_id` | text nullable | Telegram 通知目标 |
| `github_username` | text nullable | GitHub 账号映射 |
| `joined_at` | timestamptz | 加入时间 |
| `created_at` | timestamptz | 创建时间 |
| `updated_at` | timestamptz | 更新时间 |

### 2. `clients`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid pk | 客户主键 |
| `name` | text | 客户名称 |
| `contact_name` | text nullable | 联系人 |
| `contact_channel` | text nullable | WhatsApp / Telegram / Email 等 |
| `billing_currency` | text nullable | 默认结算币种 |
| `status` | text | `lead` / `active` / `paused` / `closed` |
| `notes` | text nullable | 备注 |
| `created_at` | timestamptz | 创建时间 |
| `updated_at` | timestamptz | 更新时间 |

### 3. `projects`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid pk | 项目主键 |
| `client_id` | uuid fk | 所属客户 |
| `name` | text | 项目名称 |
| `project_code` | text unique | 内部项目编号 |
| `type` | text | `web` / `automation` / `ops` / `ai` / `maintenance` |
| `status` | text | `planning` / `active` / `blocked` / `maintenance` / `done` |
| `priority` | integer | 1-5 优先级 |
| `owner_user_id` | uuid fk | 项目负责人 |
| `delivery_model` | text | `fixed` / `retainer` / `hourly` |
| `quoted_u` | numeric(12,2) nullable | 报价折算为 U |
| `start_date` | date nullable | 开始时间 |
| `target_date` | date nullable | 目标时间 |
| `risk_level` | text | `low` / `medium` / `high` |
| `summary` | text nullable | 项目摘要 |
| `created_at` | timestamptz | 创建时间 |
| `updated_at` | timestamptz | 更新时间 |

### 4. `tasks`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid pk | 任务主键 |
| `project_id` | uuid fk | 所属项目 |
| `title` | text | 任务标题 |
| `description` | text nullable | 任务说明 |
| `status` | text | `todo` / `doing` / `review` / `blocked` / `done` |
| `priority` | integer | 1-5 |
| `assignee_user_id` | uuid fk nullable | 执行人 |
| `reporter_user_id` | uuid fk nullable | 提交人 |
| `source_type` | text | `manual` / `meeting` / `github` / `agent` |
| `source_ref_id` | uuid nullable | 来源记录 |
| `estimated_hours` | numeric(8,2) nullable | 预计工时 |
| `due_at` | timestamptz nullable | 截止时间 |
| `completed_at` | timestamptz nullable | 完成时间 |
| `created_at` | timestamptz | 创建时间 |
| `updated_at` | timestamptz | 更新时间 |

### 5. `finance_ledger`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid pk | 流水主键 |
| `project_id` | uuid fk nullable | 关联项目 |
| `client_id` | uuid fk nullable | 关联客户 |
| `entry_type` | text | `income` / `expense` / `transfer` |
| `category` | text | 收入、服务器、域名、订阅、工资等分类 |
| `original_currency` | text | `USDT` / `USDC` / `USD` / `MYR` / `CNY` 等 |
| `original_amount` | numeric(18,6) | 原始金额 |
| `rate_to_u` | numeric(18,6) | 结算时折算汇率 |
| `amount_u` | numeric(18,6) | 折算后金额 |
| `counterparty` | text nullable | 对手方 |
| `occurred_at` | timestamptz | 发生时间 |
| `evidence_url` | text nullable | 凭证 |
| `entered_by` | uuid fk nullable | 录入人 |
| `notes` | text nullable | 备注 |
| `created_at` | timestamptz | 创建时间 |

### 6. `fx_rates`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid pk | 主键 |
| `base_currency` | text | 原币种 |
| `quote_currency` | text | 目标币种，默认 `U` |
| `rate` | numeric(18,6) | 汇率 |
| `source` | text | 汇率来源 |
| `effective_at` | timestamptz | 生效时间 |
| `created_at` | timestamptz | 创建时间 |

### 7. `assets`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid pk | 主键 |
| `project_id` | uuid fk nullable | 所属项目 |
| `asset_type` | text | `domain` / `server` / `site` / `repo` / `email` / `bot` / `api_key` |
| `name` | text | 资产名 |
| `provider` | text nullable | 提供商 |
| `identifier` | text nullable | 域名、实例 ID、仓库地址等 |
| `owner_scope` | text | `company` / `client` |
| `status` | text | `active` / `expired` / `warning` / `archived` |
| `renewal_date` | date nullable | 续费日 |
| `monthly_cost_u` | numeric(12,2) nullable | 月均成本 |
| `notes` | text nullable | 备注 |
| `created_at` | timestamptz | 创建时间 |
| `updated_at` | timestamptz | 更新时间 |

### 8. `subscriptions`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid pk | 主键 |
| `asset_id` | uuid fk nullable | 关联资产 |
| `service_name` | text | 服务名称 |
| `plan_name` | text | 套餐名 |
| `billing_cycle` | text | `monthly` / `yearly` |
| `currency` | text | 计费币种 |
| `amount` | numeric(12,2) | 原始费用 |
| `amount_u` | numeric(12,2) nullable | 折算 U |
| `next_billing_date` | date nullable | 下次扣费日 |
| `auto_renew` | boolean | 是否自动续费 |
| `status` | text | `active` / `paused` / `cancelled` |
| `created_at` | timestamptz | 创建时间 |
| `updated_at` | timestamptz | 更新时间 |

### 9. `project_databases`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid pk | 主键 |
| `project_id` | uuid fk | 所属项目 |
| `platform` | text | 例如 `supabase` |
| `environment` | text | `prod` / `staging` / `dev` |
| `instance_name` | text | 实例标识 |
| `primary_region` | text nullable | 区域 |
| `backup_policy` | text | 备份策略摘要 |
| `mirror_to_main_db` | boolean | 是否同步关键表到主运营库 |
| `restore_contact` | text nullable | 恢复责任人 |
| `status` | text | `active` / `warning` / `archived` |
| `created_at` | timestamptz | 创建时间 |
| `updated_at` | timestamptz | 更新时间 |

### 10. `knowledge_documents`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid pk | 主键 |
| `project_id` | uuid fk nullable | 所属项目 |
| `title` | text | 标题 |
| `doc_type` | text | `meeting_note` / `sop` / `spec` / `report` / `email` |
| `source_uri` | text nullable | 来源地址 |
| `storage_path` | text nullable | 文件位置 |
| `summary` | text nullable | 摘要 |
| `vector_namespace` | text nullable | 向量空间 |
| `embedding_status` | text | `pending` / `done` / `failed` |
| `created_by` | uuid fk nullable | 创建者 |
| `created_at` | timestamptz | 创建时间 |
| `updated_at` | timestamptz | 更新时间 |

## 四、建议的关系约束

数据库关系中最关键的是清楚区分“归属”“参与”“来源”和“映射”。项目一定归属于客户，但任务既可以来自人工也可以来自会议或 Agent；财务流水既可以归属于项目，也可以只归属于公司级支出；资产既可以归属于项目，也可以是公司共享资产。设计上应允许这些关系存在空值，但必须通过业务规则约束其合法性。

| 关系 | 约束建议 |
| --- | --- |
| `projects.client_id -> clients.id` | 必填 |
| `tasks.project_id -> projects.id` | 必填 |
| `tasks.assignee_user_id -> users.id` | 可空 |
| `finance_ledger.project_id -> projects.id` | 可空 |
| `assets.project_id -> projects.id` | 可空 |
| `subscriptions.asset_id -> assets.id` | 可空 |
| `project_databases.project_id -> projects.id` | 必填 |
| `knowledge_documents.project_id -> projects.id` | 可空 |

## 五、状态枚举建议

为了减少后续前后端不一致，状态字段应尽量枚举化并写入数据库约束或应用常量。

| 实体 | 建议枚举 |
| --- | --- |
| 项目状态 | `planning`, `active`, `blocked`, `maintenance`, `done` |
| 任务状态 | `todo`, `doing`, `review`, `blocked`, `done` |
| 用户状态 | `active`, `inactive`, `trial` |
| 资产状态 | `active`, `warning`, `expired`, `archived` |
| 订阅状态 | `active`, `paused`, `cancelled` |
| 知识嵌入状态 | `pending`, `done`, `failed` |

## 六、审计与 Agent 写入规则

所有 Agent 写入的业务表，建议统一附带以下审计语义字段，哪怕不是每张表都在首版中完全实现。至少应当能追踪：**是谁写入的、来自哪里、基于什么上下文、可信度如何、是否需要人工复核**。这对于财务、任务分派和知识抽取尤其重要。

| 字段 | 说明 |
| --- | --- |
| `created_by_agent` | 是否由 Agent 创建 |
| `agent_name` | 哪个 Agent 产生 |
| `source_channel` | Telegram / Email / Meeting / GitHub 等 |
| `confidence_score` | 0-1 置信度 |
| `needs_human_review` | 是否待人工复核 |

## 七、MVP 实施顺序

数据库不建议一次性全部上线。更现实的做法是先做最短闭环：`users`、`clients`、`projects`、`tasks`、`finance_ledger`、`assets`、`subscriptions`、`project_databases`。等系统能跑起来之后，再补 `knowledge_documents`、`agent_runs`、`performance_reviews` 等增强表。
