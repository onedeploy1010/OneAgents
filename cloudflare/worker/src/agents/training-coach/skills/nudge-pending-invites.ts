import type { Env } from "../../../lib/env";
import { getSupabaseAdmin } from "../../../lib/supabase";
import { sendTelegram, sendTelegramReply } from "../../../lib/telegram";

export type NudgeTier = 0 | 1 | 2 | 3;

export type NudgeOutcome = {
  inviteId: string;
  displayName: string;
  templateSlug: string | null;
  ageHours: number;
  tier: NudgeTier;
  stage: string | null;
  traineeNudged: boolean;
  founderAlerted: boolean;
  caseReviewSent: boolean;
  skipped?: "too_early" | "spam_guard" | "no_chat" | "case_review_already_sent";
};

const TIER1_MIN_H = 12;
const TIER2_MIN_H = 48;
const TIER3_MIN_H = 72;

const TIER1_GAP_H = 18;
const TIER2_GAP_H = 12;
const TIER3_GAP_H = 36;

type InviteRow = {
  id: string;
  telegram_username: string | null;
  telegram_user_id: string | null;
  mentor_slug: string | null;
  notes: string | null;
  template_slug: string | null;
  created_at: string;
  last_nudged_at: string | null;
  nudge_count: number | null;
  case_review_sent_at: string | null;
};

type SessionRow = {
  chat_id: string;
  state: Record<string, any> | null;
};

function extractDisplayName(inv: InviteRow): string {
  const notes = inv.notes ?? "";
  const match = notes.match(/^([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9 _\-]{0,30})/);
  if (match && match[1].trim()) return match[1].trim();
  if (inv.telegram_username) return `@${inv.telegram_username}`;
  return "新人";
}

function stageLabel(stage: string | null): { label: string; qIdx: 1 | 2 | 3 | null } {
  switch (stage) {
    case "invite_awaiting_display_name":
      return { label: "姓名", qIdx: 1 };
    case "invite_awaiting_email":
      return { label: "邮箱", qIdx: 2 };
    case "invite_awaiting_background":
      return { label: "背景", qIdx: 3 };
    default:
      return { label: "intake", qIdx: null };
  }
}

function tier1Message(name: string, stage: string | null): string {
  const { label, qIdx } = stageLabel(stage);
  if (qIdx === null) {
    return [
      `嗨 ${name} 👋`,
      ``,
      `15 天 Replit 培训还没开 — 去 @one23_tech_bot 发一条 /start 就能继续。`,
      `真就一条消息的事,别被自己劝退了。`
    ].join("\n");
  }
  return [
    `嗨 ${name} 👋`,
    ``,
    `你停在第 ${qIdx} 题(${label})有段时间了。不是在催,是真的在等。`,
    `回一句话就能继续 — 把它想成"我愿意"的按钮,不是考试。`,
    ``,
    qIdx === 1
      ? `下一步:回你的姓名(中文英文都行)。`
      : qIdx === 2
      ? `下一步:回一个邮箱(你之前说过是 mikkizoon@gmail.com,直接粘就行)。`
      : `下一步:一段话讲技术背景 — 怎么说都行,我按你说的调任务难度,不会压垮你。`
  ].join("\n");
}

function tier2Message(name: string, stage: string | null): string {
  const { label, qIdx } = stageLabel(stage);
  const stuckLine =
    qIdx !== null
      ? `快 2 天了还停在第 ${qIdx} 题(${label})。说实话,敲一行字不至于这么难 😅`
      : `快 2 天了,/start 都没发。这条桥你得自己走一步。`;
  return [
    `${name},`,
    ``,
    stuckLine,
    ``,
    `两种可能:你在观望,或者你在犹豫。都正常 — 但我需要知道是哪种。`,
    `• 想干 → 回一个字,哪怕就"在",咱们继续。`,
    `• 不想干 → 直接说"先不了",不怪你,但不要消失。`,
    ``,
    `24 小时内没动静,我这边就当 case review 处理,坑位会让给下一位。`
  ].join("\n");
}

function caseReviewMessage(outcome: NudgeOutcome, inv: InviteRow): string {
  const lines: string[] = [];
  lines.push(`${outcome.displayName}(invite ${inv.id.slice(0, 8)})`);
  lines.push(
    `- 创建: ${inv.created_at.slice(0, 16).replace("T", " ")} · ${Math.round(outcome.ageHours)}h 前`
  );
  lines.push(`- 模板: ${inv.template_slug ?? "—"}`);
  lines.push(`- mentor: ${inv.mentor_slug ?? "—"}`);
  lines.push(`- tg: @${inv.telegram_username ?? "—"}${inv.telegram_user_id ? ` (uid ${inv.telegram_user_id})` : ""}`);
  lines.push(`- 当前 stage: ${outcome.stage ?? "(从未 /start)"}`);
  lines.push(`- 已 nudge: ${(inv.nudge_count ?? 0)} 次`);
  lines.push(``);
  lines.push(`要不要继续?`);
  lines.push(`1. 再等等(再 DM 一次温柔的)`);
  lines.push(`2. 换人 — 把坑给下一位候选人`);
  lines.push(`3. 归档为"流失案例",进复盘`);
  lines.push(``);
  lines.push(`今天 DM 会停,等你决策。`);
  return lines.join("\n");
}

async function findActiveSession(
  env: Env,
  inviteId: string,
  telegramUserId: string | null
): Promise<SessionRow | null> {
  if (!telegramUserId) return null;
  const supabase = getSupabaseAdmin(env);
  const { data } = await supabase
    .from("telegram_sessions")
    .select("chat_id, state")
    .eq("bot_role", "employee")
    .filter("state->>invite_id", "eq", inviteId)
    .maybeSingle();
  return (data as SessionRow | null) ?? null;
}

/**
 * 扫所有 pending invite,按 tier(12/48/72h)做 nudge。
 * - Tier 1(12-48h):DM trainee 本人(温和+催)
 * - Tier 2(48-72h):DM trainee(加重)+ 给 founder 首次 alert
 * - Tier 3(>=72h):停 DM + 给 founder 发 case review(等决策)
 * - spam guard:同 tier 内 last_nudged_at 未过窗口则跳过
 */
export async function nudgePendingInvites(env: Env): Promise<{
  ok: true;
  scanned: number;
  results: NudgeOutcome[];
}> {
  const supabase = getSupabaseAdmin(env);
  const { data: invites } = await supabase
    .from("employee_invites")
    .select(
      "id, telegram_username, telegram_user_id, mentor_slug, notes, template_slug, created_at, last_nudged_at, nudge_count, case_review_sent_at"
    )
    .eq("status", "pending");

  const rows = (invites ?? []) as InviteRow[];
  const results: NudgeOutcome[] = [];
  const now = Date.now();

  for (const inv of rows) {
    const ageHours = (now - new Date(inv.created_at).getTime()) / 3_600_000;
    const sinceNudgeHours = inv.last_nudged_at
      ? (now - new Date(inv.last_nudged_at).getTime()) / 3_600_000
      : Infinity;

    const session = await findActiveSession(env, inv.id, inv.telegram_user_id);
    const stage = (session?.state?.stage as string | null | undefined) ?? null;
    const displayName = extractDisplayName(inv);

    let tier: NudgeTier = 0;
    if (ageHours >= TIER3_MIN_H) tier = 3;
    else if (ageHours >= TIER2_MIN_H) tier = 2;
    else if (ageHours >= TIER1_MIN_H) tier = 1;

    const base: NudgeOutcome = {
      inviteId: inv.id,
      displayName,
      templateSlug: inv.template_slug,
      ageHours: Math.round(ageHours * 10) / 10,
      tier,
      stage,
      traineeNudged: false,
      founderAlerted: false,
      caseReviewSent: false
    };

    if (tier === 0) {
      results.push({ ...base, skipped: "too_early" });
      continue;
    }

    const gap =
      tier === 1 ? TIER1_GAP_H : tier === 2 ? TIER2_GAP_H : TIER3_GAP_H;
    if (sinceNudgeHours < gap) {
      results.push({ ...base, skipped: "spam_guard" });
      continue;
    }

    if (tier === 1) {
      if (!session?.chat_id) {
        // 还没 /start,告诉 founder 而不是静默
        await sendTelegram(
          env,
          "⏰ Trainee 未 /start (12h+)",
          `${displayName}(invite ${inv.id.slice(0, 8)}, ${inv.template_slug ?? "—"}): 12h+ 未私聊 bot。@${inv.telegram_username ?? "未知"}`
        );
        base.founderAlerted = true;
        base.skipped = "no_chat";
      } else {
        await sendTelegramReply(env, session.chat_id, tier1Message(displayName, stage), "employee");
        base.traineeNudged = true;
      }
    } else if (tier === 2) {
      if (session?.chat_id) {
        await sendTelegramReply(env, session.chat_id, tier2Message(displayName, stage), "employee");
        base.traineeNudged = true;
      }
      await sendTelegram(
        env,
        "⚠️ Trainee 拖延 48h+",
        `${displayName}(invite ${inv.id.slice(0, 8)}): ${Math.round(ageHours)}h 未完成 intake${
          stage ? ` · 卡在 ${stage}` : " · 从未 /start"
        }`
      );
      base.founderAlerted = true;
    } else if (tier === 3) {
      if (inv.case_review_sent_at) {
        // 已发过一次 case review,这轮不再发(等 founder 决策)
        results.push({ ...base, skipped: "case_review_already_sent" });
        continue;
      }
      await sendTelegram(env, "🚨 Case Review — Trainee 72h+ 零进展", caseReviewMessage(base, inv));
      base.founderAlerted = true;
      base.caseReviewSent = true;
      await supabase
        .from("employee_invites")
        .update({ case_review_sent_at: new Date().toISOString() })
        .eq("id", inv.id);
    }

    await supabase
      .from("employee_invites")
      .update({
        last_nudged_at: new Date().toISOString(),
        nudge_count: (inv.nudge_count ?? 0) + 1
      })
      .eq("id", inv.id);

    results.push(base);
  }

  return { ok: true, scanned: rows.length, results };
}

/**
 * 给 daily digest 用的 pending invite 概览行(纯文本)。
 */
export async function summarizePendingInvites(env: Env): Promise<string[]> {
  const supabase = getSupabaseAdmin(env);
  const { data } = await supabase
    .from("employee_invites")
    .select("id, telegram_username, notes, template_slug, created_at, nudge_count, case_review_sent_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as InviteRow[];
  if (rows.length === 0) return [];
  const now = Date.now();
  return rows.map((inv) => {
    const ageHours = Math.round((now - new Date(inv.created_at).getTime()) / 3_600_000);
    const flag =
      ageHours >= TIER3_MIN_H
        ? inv.case_review_sent_at
          ? "🚨 case"
          : "🚨"
        : ageHours >= TIER2_MIN_H
        ? "⚠️"
        : ageHours >= TIER1_MIN_H
        ? "⏰"
        : "·";
    const who = extractDisplayName(inv);
    const tpl = inv.template_slug ?? "—";
    const nc = inv.nudge_count ?? 0;
    return `${flag} ${who}(${tpl}) ${ageHours}h · nudge ${nc}`;
  });
}
