export const ONBOARDING_CONNECTORS = [
  { provider: "supabase", purpose: "onboarding_programs/tasks/mentor_conversations/user_profiles", required: true, secretRef: "SUPABASE_SERVICE_ROLE_KEY" },
  { provider: "vercel_ai_gateway", purpose: "mentor daily_brief + /chat 回复 + /grade 预评", required: true, secretRef: "AI_GATEWAY_API_KEY" },
  { provider: "telegram_employee_bot", purpose: "/today /chat /submit 入口", required: true, secretRef: "TG_BOT_TOKEN" },
  { provider: "knowledge_agent", purpose: "RAG 相关 SOP 召回", required: false, secretRef: null },
  { provider: "google_gmail", purpose: "mentor 代发入职邀请 / 提醒邮件(from one23x.org)", required: false, secretRef: "GOOGLE_OAUTH_REFRESH_TOKEN_ADMIN" }
] as const;
