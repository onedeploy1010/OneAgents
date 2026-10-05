import type { Env } from "../lib/env";
import { getSupabaseAdmin } from "../lib/supabase";
import { sendTelegram } from "../lib/telegram";
import {
  scanAssetRenewals,
  scanSubscriptionRenewals
} from "../agents/infra/skills";
import {
  runDailyCoachSweep,
  sendDailyCoachDigest
} from "../agents/training-coach/skills";

export async function flushPendingTelegramNotifications(env: Env) {
  if (!env.TG_BOT_TOKEN || !env.TG_DEFAULT_CHAT_ID) {
    return { sent: 0, skipped: "telegram_not_configured" };
  }
  const supabase = getSupabaseAdmin(env);
  const { data: pending, error } = await supabase
    .from("notifications")
    .select("id, title, body")
    .eq("channel", "telegram")
    .eq("status", "pending")
    .limit(20);
  if (error) throw new Error(`notifications fetch: ${error.message}`);

  let sent = 0;
  for (const n of pending ?? []) {
    const r = await sendTelegram(env, n.title, n.body);
    const success = "ok" in r ? r.ok : false;
    await supabase
      .from("notifications")
      .update({
        status: success ? "sent" : "failed",
        sent_at: success ? new Date().toISOString() : null
      })
      .eq("id", n.id);
    if (success) sent++;
  }
  return { sent, total: pending?.length ?? 0 };
}

/**
 * 每日 cron 完整扫描:订阅续费 + 资产到期 + 刷通知 + coach sweep + coach digest。
 * 单次调用串行执行,容错:任一失败不阻止其他。
 */
export async function runFullDailyCron(env: Env) {
  const sub = await scanSubscriptionRenewals(env).catch((e) => ({ error: String(e) }));
  const ast = await scanAssetRenewals(env).catch((e) => ({ error: String(e) }));
  const tg = await flushPendingTelegramNotifications(env).catch((e) => ({ error: String(e) }));
  const coachSweep = await runDailyCoachSweep(env).catch((e) => ({ error: String(e) }));
  const coachDigest = await sendDailyCoachDigest(env).catch((e) => ({ error: String(e) }));
  return { sub, ast, tg, coachSweep, coachDigest };
}
