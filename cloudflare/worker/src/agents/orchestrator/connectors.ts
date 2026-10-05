export const ORCHESTRATOR_CONNECTORS = [
  { provider: "supabase", purpose: "workflow_runs + step_runs + agent_runs 写入", required: true, secretRef: "SUPABASE_SERVICE_ROLE_KEY" },
  { provider: "vercel_ai_gateway", purpose: "客户 persona 回复 + kickoff plan", required: true, secretRef: "AI_GATEWAY_API_KEY" },
  { provider: "telegram_client_bot", purpose: "4 种 client persona 回复客户", required: true, secretRef: "TG_BOT_TOKEN_CLIENT" },
  { provider: "telegram_employee_bot", purpose: "内部审批 / approve 通知", required: true, secretRef: "TG_BOT_TOKEN" },
  { provider: "google_calendar", purpose: "kickoff / 里程碑会议自动排日历,邀请客户 + 内部", required: false, secretRef: "GOOGLE_OAUTH_REFRESH_TOKEN_ADMIN" },
  { provider: "google_gmail", purpose: "kickoff 确认 / 合同附件邮件(from one23x.org)", required: false, secretRef: "GOOGLE_OAUTH_REFRESH_TOKEN_ADMIN" }
] as const;
