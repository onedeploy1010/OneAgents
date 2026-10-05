/**
 * Knowledge agent 依赖的外部连接器:
 * - Vercel AI Gateway(embedding + chat)— env.AI_GATEWAY_API_KEY
 * - OpenAI 直连(回退)— env.OPENAI_API_KEY
 * - Supabase pgvector — 通过 service_role
 * - Supabase Storage(未来文件入库时)
 *
 * 目前连接方式在 lib/ai.ts 和 lib/supabase.ts,这里仅声明依赖清单,
 * 便于面板可视化展示 agent 的能力图谱。
 */
export const KNOWLEDGE_CONNECTORS = [
  { provider: "vercel_ai_gateway", purpose: "LLM completions + embeddings", required: true, secretRef: "AI_GATEWAY_API_KEY" },
  { provider: "openai", purpose: "fallback embedding/chat", required: false, secretRef: "OPENAI_API_KEY" },
  { provider: "supabase_pgvector", purpose: "向量检索存储", required: true, secretRef: "SUPABASE_SERVICE_ROLE_KEY" },
  { provider: "supabase_storage", purpose: "未来:文件附件入库", required: false, secretRef: "SUPABASE_SERVICE_ROLE_KEY" },
  { provider: "google_drive", purpose: "one23x.org 共享盘文档 / SOP 拉取后 embed 入库", required: false, secretRef: "GOOGLE_OAUTH_REFRESH_TOKEN_ADMIN" }
] as const;
