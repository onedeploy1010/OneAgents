# 环境变量清单

**作者：Manus AI**  
**版本：v0.1**  
**状态：MVP 配置稿**

## 一、总体说明

环境变量文档的目的，不是把真实密钥写进仓库，而是明确系统运行需要哪些配置项、每项配置属于什么模块、应由谁保管、哪些环境需要配置，以及哪些变量不能暴露到前端。对于你这种包含数据库、Agent、消息平台、部署平台和邮件入口的系统来说，环境变量如果不提前规范，后面最容易出现的就是：开发环境能跑、生产环境失控、换人后无人知道哪些变量还在生效。

因此，本文件只记录**变量名、用途、适用环境、是否敏感、建议保管位置**，绝不记录真实值。

## 二、命名约定

所有环境变量建议遵循统一命名方式。共享前缀可以减少混乱，也便于未来在 Cloudflare、Supabase、Vercel 或本地开发环境中做分层管理。

| 前缀 | 含义 |
| --- | --- |
| `APP_` | 应用基础配置 |
| `DB_` | 数据库与连接配置 |
| `SUPABASE_` | Supabase 相关配置 |
| `CF_` | Cloudflare 相关配置 |
| `GH_` | GitHub 相关配置 |
| `TG_` | Telegram Bot 相关配置 |
| `WA_` | WhatsApp 相关配置 |
| `MAIL_` | 邮件入口相关配置 |
| `AI_` | 模型 / Agent 调用配置 |
| `STORAGE_` | 对象存储相关配置 |

## 三、基础应用配置

| 变量名 | 用途 | 环境 | 敏感性 | 说明 |
| --- | --- | --- | --- | --- |
| `APP_ENV` | 运行环境 | local / staging / prod | 否 | 例如 `local`、`staging`、`production` |
| `APP_NAME` | 应用名称 | 全部 | 否 | 建议固定为运营系统名称 |
| `APP_BASE_URL` | 后台访问地址 | staging / prod | 否 | 管理面板公开地址 |
| `APP_TIMEZONE` | 时区 | 全部 | 否 | 建议统一为团队经营时区 |
| `APP_DEFAULT_CURRENCY` | 默认结算单位 | 全部 | 否 | 建议为 `U` |

## 四、数据库配置

| 变量名 | 用途 | 环境 | 敏感性 | 说明 |
| --- | --- | --- | --- | --- |
| `DB_URL` | 主数据库连接串 | local / staging / prod | 高 | 后端专用 |
| `DB_POOL_URL` | 连接池地址 | staging / prod | 高 | 高并发或 serverless 使用 |
| `DB_MIGRATION_URL` | 迁移专用连接串 | local / staging / prod | 高 | 与应用连接区分 |
| `DB_SCHEMA` | 默认 schema | 全部 | 否 | 如 `public` |

## 五、Supabase 配置

| 变量名 | 用途 | 环境 | 敏感性 | 说明 |
| --- | --- | --- | --- | --- |
| `SUPABASE_URL` | 公司运营库地址 | 全部 | 中 | 前后端都可能需要 |
| `SUPABASE_ANON_KEY` | 前端公开 Key | local / staging / prod | 中 | 仅公开能力使用 |
| `SUPABASE_SERVICE_ROLE_KEY` | 后端高权限 Key | server only | 高 | 禁止暴露到前端 |
| `SUPABASE_PROJECT_REF` | 项目标识 | 全部 | 否 | 运维与脚本使用 |
| `SUPABASE_STORAGE_BUCKET_DOCS` | 文档桶名 | 全部 | 否 | 存储知识文件 |
| `SUPABASE_STORAGE_BUCKET_MEDIA` | 媒体桶名 | 全部 | 否 | 存储录音、截图等 |

## 六、Cloudflare 配置

| 变量名 | 用途 | 环境 | 敏感性 | 说明 |
| --- | --- | --- | --- | --- |
| `CF_ACCOUNT_ID` | Cloudflare 账号 ID | staging / prod | 中 | 部署与 API 使用 |
| `CF_API_TOKEN` | Cloudflare API Token | server only | 高 | 最小权限原则 |
| `CF_WORKER_NAME` | Worker 名称 | 全部 | 否 | 部署识别 |
| `CF_QUEUE_NAME` | 队列名称 | staging / prod | 否 | 异步任务使用 |
| `CF_R2_BUCKET` | R2 存储桶 | staging / prod | 否 | 文件存储使用 |
| `CF_VECTOR_INDEX` | 向量索引名 | staging / prod | 否 | 记忆库检索 |

## 七、GitHub 配置

| 变量名 | 用途 | 环境 | 敏感性 | 说明 |
| --- | --- | --- | --- | --- |
| `GH_APP_ID` | GitHub App ID | server only | 中 | 更推荐 GitHub App 模式 |
| `GH_APP_PRIVATE_KEY` | GitHub App 私钥 | server only | 高 | 禁止前端使用 |
| `GH_WEBHOOK_SECRET` | Webhook 验证密钥 | server only | 高 | 校验事件来源 |
| `GH_ORG_NAME` | GitHub 组织名 | 全部 | 否 | 组织级配置 |
| `GH_DEFAULT_REPO` | 默认仓库名 | 全部 | 否 | 可选 |

## 八、Telegram 配置

| 变量名 | 用途 | 环境 | 敏感性 | 说明 |
| --- | --- | --- | --- | --- |
| `TG_BOT_TOKEN` | Telegram Bot Token | server only | 高 | 机器人鉴权 |
| `TG_WEBHOOK_SECRET` | Webhook 校验值 | server only | 高 | 建议启用 |
| `TG_DEFAULT_CHAT_ID` | 默认内部通知群 | server only | 中 | 运营消息群 |
| `TG_ADMIN_CHAT_ID` | 管理员群或个人窗口 | server only | 中 | 高优先级消息 |

## 九、WhatsApp 配置

| 变量名 | 用途 | 环境 | 敏感性 | 说明 |
| --- | --- | --- | --- | --- |
| `WA_ACCESS_TOKEN` | WhatsApp API Token | server only | 高 | 客户消息接口 |
| `WA_PHONE_NUMBER_ID` | 发信号码 ID | server only | 中 | 消息发送 |
| `WA_BUSINESS_ACCOUNT_ID` | 业务账号 ID | server only | 中 | 管理映射 |
| `WA_WEBHOOK_VERIFY_TOKEN` | Webhook 校验值 | server only | 高 | 验证来源 |

## 十、邮件入口配置

| 变量名 | 用途 | 环境 | 敏感性 | 说明 |
| --- | --- | --- | --- | --- |
| `MAIL_PROVIDER` | 邮件服务供应商 | 全部 | 否 | Google / Microsoft 等 |
| `MAIL_INBOX_BILLING` | 账单收件箱地址 | 全部 | 否 | 账单集中入口 |
| `MAIL_INBOX_OPS` | 运维收件箱地址 | 全部 | 否 | 告警 / 服务通知 |
| `MAIL_WEBHOOK_SECRET` | 邮件解析入口校验值 | server only | 高 | 处理收件自动化 |

## 十一、AI 与 Agent 配置

| 变量名 | 用途 | 环境 | 敏感性 | 说明 |
| --- | --- | --- | --- | --- |
| `AI_PROVIDER` | 默认模型服务商 | 全部 | 否 | 例如 OpenAI 兼容服务 |
| `AI_API_KEY` | 模型调用密钥 | server only | 高 | 统一管理 |
| `AI_MODEL_DEFAULT` | 默认模型 | 全部 | 否 | 文本整理用 |
| `AI_MODEL_REASONING` | 高复杂任务模型 | 全部 | 否 | 调研、规划用 |
| `AI_EMBEDDING_MODEL` | 向量化模型 | 全部 | 否 | 记忆索引用 |

## 十二、存储与文件配置

| 变量名 | 用途 | 环境 | 敏感性 | 说明 |
| --- | --- | --- | --- | --- |
| `STORAGE_PROVIDER` | 文件存储供应商 | 全部 | 否 | R2 / Supabase Storage |
| `STORAGE_PUBLIC_BASE_URL` | 文件公开前缀 | staging / prod | 否 | 文件访问 |
| `STORAGE_SIGNING_KEY` | 私有文件签名密钥 | server only | 高 | 临时访问控制 |

## 十三、财务配置

| 变量名 | 用途 | 环境 | 敏感性 | 说明 |
| --- | --- | --- | --- | --- |
| `FINANCE_BASE_UNIT` | 财务统一单位 | 全部 | 否 | 建议固定为 `U` |
| `FINANCE_AUTO_RATE_SOURCE` | 汇率默认来源 | server only | 中 | 汇率服务来源 |
| `FINANCE_REVIEW_THRESHOLD_U` | 大额复核阈值 | 全部 | 否 | 超过阈值必须人工确认 |

## 十四、安全规则

环境变量中最关键的安全原则有三条。第一，**`SERVICE_ROLE_KEY`、Bot Token、API Token、私钥等高敏感变量只允许后端和受控执行环境读取**。第二，**所有前端可见变量必须与敏感变量彻底分离**。第三，**不同环境应使用不同密钥**，绝不能把本地开发密钥直接延续到生产。

## 十五、推荐存放位置

| 类型 | 推荐位置 |
| --- | --- |
| 本地开发 | `.env.local` |
| 预发环境 | 平台环境变量管理器 |
| 生产环境 | Cloudflare / Supabase / Vercel 的密钥系统 |
| 长期备份 | 公司密钥管理服务 |

## 十六、不应提交到仓库的文件

以下文件必须写入 `.gitignore`，不得提交：`.env`、`.env.local`、`.env.production`、私钥文件、服务账号 JSON、导出的数据库凭证文件，以及任何包含真实 token 的调试文件。
