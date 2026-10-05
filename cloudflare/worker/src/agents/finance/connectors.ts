export const FINANCE_CONNECTORS = [
  { provider: "supabase", purpose: "finance_ledger + fx_rates + subscriptions", required: true, secretRef: "SUPABASE_SERVICE_ROLE_KEY" },
  { provider: "vercel_ai_gateway", purpose: "账单邮件解析", required: false, secretRef: "AI_GATEWAY_API_KEY" },
  { provider: "cloudflare_email_routing", purpose: "账单邮件入口(one23x.com)", required: false, secretRef: null },
  { provider: "telegram_default_chat", purpose: "异常/续费提醒", required: false, secretRef: "TG_BOT_TOKEN" }
] as const;
