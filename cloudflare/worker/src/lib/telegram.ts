import type { Env } from "./env";

export type TgBotRole = "employee" | "client";

export function getTgTokenForRole(env: Env, role: TgBotRole): string | undefined {
  if (role === "client") return env.TG_BOT_TOKEN_CLIENT ?? env.TG_BOT_TOKEN;
  return env.TG_BOT_TOKEN;
}

/**
 * 把 `**bold**` / `` `code` `` / ```pre``` 简单 markdown 转 Telegram HTML。
 * 先 HTML 转义用户内容,避免注入。
 */
export function mdToTgHtml(input: string): string {
  let t = input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  t = t.replace(/```([\s\S]*?)```/g, (_, c) => `<pre>${c}</pre>`);
  t = t.replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`);
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  t = t.replace(/__([^_\n]+)__/g, "<i>$1</i>");
  return t;
}

export async function sendTelegramReply(
  env: Env,
  chatId: number | string,
  text: string,
  role: TgBotRole = "employee",
  extra?: Record<string, unknown>
) {
  const token = getTgTokenForRole(env, role);
  if (!token) return { skipped: true };
  const hasOwnParseMode = extra && "parse_mode" in extra;
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: hasOwnParseMode ? text : mdToTgHtml(text),
    ...(extra ?? {})
  };
  if (!hasOwnParseMode) payload.parse_mode = "HTML";
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  return { skipped: false, ok: response.ok, status: response.status };
}

/**
 * 发通知给内部 default chat(TG_DEFAULT_CHAT_ID)— 供 cron / workflow / 客户转达用。
 */
export async function sendTelegram(env: Env, title: string, body: string) {
  if (!env.TG_BOT_TOKEN || !env.TG_DEFAULT_CHAT_ID) {
    return { skipped: true, reason: "telegram_not_configured" };
  }
  const text = `${title}\n${body}`;
  const response = await fetch(
    `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env.TG_DEFAULT_CHAT_ID, text })
    }
  );
  return { skipped: false, ok: response.ok, status: response.status };
}

export async function answerCallbackQuery(
  env: Env,
  callbackId: string,
  role: TgBotRole,
  text?: string
) {
  const token = getTgTokenForRole(env, role);
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId, text: text ?? "" })
  });
}

/**
 * Telegram 多轮 session state helpers(存在 telegram_sessions 表)。
 */
export async function getTgSession(env: Env, chatId: string) {
  const { getSupabaseAdmin } = await import("./supabase");
  const supabase = getSupabaseAdmin(env);
  const { data } = await supabase
    .from("telegram_sessions")
    .select("chat_id, bot_role, state, last_interaction_at")
    .eq("chat_id", chatId)
    .maybeSingle();
  return data as
    | { chat_id: string; bot_role: TgBotRole; state: Record<string, any> }
    | null;
}

export async function setTgSession(
  env: Env,
  chatId: string,
  botRole: TgBotRole,
  state: Record<string, any>
) {
  const { getSupabaseAdmin } = await import("./supabase");
  const supabase = getSupabaseAdmin(env);
  await supabase.from("telegram_sessions").upsert(
    {
      chat_id: chatId,
      bot_role: botRole,
      state,
      last_interaction_at: new Date().toISOString()
    },
    { onConflict: "chat_id" }
  );
}

export async function clearTgSession(env: Env, chatId: string) {
  const { getSupabaseAdmin } = await import("./supabase");
  const supabase = getSupabaseAdmin(env);
  await supabase.from("telegram_sessions").upsert(
    {
      chat_id: chatId,
      bot_role: "employee",
      state: { stage: "idle" },
      last_interaction_at: new Date().toISOString()
    },
    { onConflict: "chat_id" }
  );
}
