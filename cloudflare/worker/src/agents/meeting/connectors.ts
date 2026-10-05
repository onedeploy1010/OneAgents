/**
 * Meeting agent 的外部连接:
 * - Supabase(写 meetings / meeting_action_items)
 * - AI Gateway(未来:总结 raw_transcript 为 summary + decisions + action_items)
 * - Telegram group meeting buffer
 * - Vercel AI Gateway(抽行动项)
 * - Google Calendar / Meet(one23x.org,OAuth refresh_token 代 admin 读写)
 */
export const MEETING_CONNECTORS = [
  { provider: "supabase", purpose: "meetings + action_items 写入", required: true, secretRef: "SUPABASE_SERVICE_ROLE_KEY" },
  { provider: "vercel_ai_gateway", purpose: "抽取决定/行动项", required: true, secretRef: "AI_GATEWAY_API_KEY" },
  { provider: "telegram_client_bot", purpose: "群组会议 buffer + 结束通知", required: false, secretRef: "TG_BOT_TOKEN_CLIENT" },
  { provider: "google_calendar", purpose: "读/写 one23x.org 日历事件(kickoff / standup)", required: false, secretRef: "GOOGLE_OAUTH_REFRESH_TOKEN_ADMIN" },
  { provider: "google_meet", purpose: "生成 Meet 链接 + 拉会后录音/字幕", required: false, secretRef: "GOOGLE_OAUTH_REFRESH_TOKEN_ADMIN" }
] as const;
