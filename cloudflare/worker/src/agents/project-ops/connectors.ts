export const PROJECT_OPS_CONNECTORS = [
  { provider: "supabase", purpose: "projects + tasks 写入", required: true, secretRef: "SUPABASE_SERVICE_ROLE_KEY" },
  { provider: "github", purpose: "push/PR/issue webhook 驱动任务更新", required: false, secretRef: "GH_WEBHOOK_SECRET" },
  { provider: "vercel_ai_gateway", purpose: "初始任务生成", required: false, secretRef: "AI_GATEWAY_API_KEY" },
  { provider: "telegram_client_bot", purpose: "群组 /task /status", required: false, secretRef: "TG_BOT_TOKEN_CLIENT" }
] as const;
