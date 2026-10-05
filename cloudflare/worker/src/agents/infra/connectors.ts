export const INFRA_CONNECTORS = [
  { provider: "supabase", purpose: "assets + subscriptions + deployments 读写", required: true, secretRef: "SUPABASE_SERVICE_ROLE_KEY" },
  { provider: "cloudflare_api", purpose: "未来:直接查 CF 部署状态 / R2 用量", required: false, secretRef: "ONEDEPLOY_CLOUDFLARE_TOKEN" },
  { provider: "telegram_default_chat", purpose: "续费 / 到期提醒推送", required: false, secretRef: "TG_BOT_TOKEN" }
] as const;
