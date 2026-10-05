export const TRAINING_COACH_CONNECTORS = [
  { provider: "supabase", purpose: "programs / tasks / conversations / reviews 读写", required: true, secretRef: "SUPABASE_SERVICE_ROLE_KEY" },
  { provider: "vercel_ai_gateway", purpose: "assess + 推荐 adjustment", required: true, secretRef: "AI_GATEWAY_API_KEY" },
  { provider: "telegram_employee_bot", purpose: "主动鼓励消息 + daily digest", required: true, secretRef: "TG_BOT_TOKEN" },
  { provider: "onboarding_agent", purpose: "改 mentor/task 反馈给学员侧", required: false, secretRef: null }
] as const;
