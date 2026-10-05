export interface Env {
  APP_ENV: string;
  APP_NAME: string;
  APP_TIMEZONE: string;
  FINANCE_BASE_UNIT: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  GH_WEBHOOK_SECRET?: string;
  TG_WEBHOOK_SECRET?: string;
  TG_BOT_TOKEN?: string;
  TG_DEFAULT_CHAT_ID?: string;
  TG_BOT_TOKEN_CLIENT?: string;
  TG_DEFAULT_CHAT_ID_CLIENT?: string;
  OPENAI_API_KEY?: string;
  AI_GATEWAY_API_KEY?: string;
  EMBEDDING_MODEL?: string;
  EMBEDDING_PROVIDER_URL?: string;
  ADMIN_BOOTSTRAP_KEY?: string;
  ALERT_ASSET_DAYS?: string;
  ALERT_SUBSCRIPTION_DAYS?: string;
  GOOGLE_WORKSPACE_DOMAIN?: string;
  GOOGLE_WORKSPACE_ADMIN_EMAIL?: string;
  // OAuth 用户授权码流(组织政策禁用了 SA key,所以走 admin@one23x.org 代理授权)
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REDIRECT_URI?: string;
  GOOGLE_OAUTH_REFRESH_TOKEN_ADMIN?: string;
  // Neon(多租户 Postgres provisioning)
  NEON_API_KEY?: string;
  NEON_PROJECT_ID?: string;
  NEON_DEFAULT_BRANCH_ID?: string;
  NEON_DEFAULT_OWNER?: string;
  MeetingAgent: DurableObjectNamespace;
  ProjectOpsAgent: DurableObjectNamespace;
  FinanceAgent: DurableObjectNamespace;
  OnboardingAgent: DurableObjectNamespace;
  OrchestratorAgent: DurableObjectNamespace;
  KnowledgeAgent: DurableObjectNamespace;
  InfraAgent: DurableObjectNamespace;
  TrainingCoachAgent: DurableObjectNamespace;
}
