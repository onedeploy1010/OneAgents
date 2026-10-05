import type { Env } from "../../../lib/env";
import { getSupabaseAdmin } from "../../../lib/supabase";
import { sendTelegram } from "../../../lib/telegram";
import { buildProgressSnapshot } from "./assess-progress";
import { summarizePendingInvites } from "./nudge-pending-invites";

/**
 * 生成某个 program 的简短进度报告(给 Alps / superadmin)。
 * 可选 channel='telegram' 自动推。
 */
export async function generateProgramReport(
  env: Env,
  programId: string,
  opts?: { sendToTelegram?: boolean }
) {
  const snap = await buildProgressSnapshot(env, programId);
  if (!snap) return { ok: false, error: "program_not_found" as const };

  const title = `📊 ${snap.traineeDisplayName ?? "Trainee"} · ${snap.templateName ?? "培训"}`;
  const lines: string[] = [];
  lines.push(`Day ${snap.daysElapsed}/${snap.totalTasks} · mentor ${snap.mentorSlug ?? "(无)"}`);
  lines.push(
    `进度: ${snap.actualCompletedByToday}/${snap.expectedCompletedByToday}(落后 ${snap.lagDays} 天)`
  );
  if (snap.avgScore !== null) lines.push(`平均分: ${snap.avgScore}`);
  if (snap.stuckDays.length > 0) lines.push(`卡住: Day ${snap.stuckDays.join(", ")}`);
  if (snap.hoursSinceLastMessage && snap.hoursSinceLastMessage > 24) {
    lines.push(`⚠️ 已 ${Math.round(snap.hoursSinceLastMessage)} 小时无消息`);
  }
  if (snap.isPaused) lines.push(`⏸ 已暂停`);

  const body = lines.join("\n");

  if (opts?.sendToTelegram) {
    await sendTelegram(env, title, body);
  }
  return { ok: true, title, body, snapshot: snap };
}

/**
 * 每日摘要:所有 active program 一条列表,推到内部 Telegram。
 */
export async function sendDailyCoachDigest(env: Env) {
  const supabase = getSupabaseAdmin(env);
  const { data: programs } = await supabase
    .from("onboarding_programs")
    .select("id, users:trainee_user_id(display_name)")
    .eq("status", "active");

  const sections: string[] = [];

  // Active programs section
  const programLines: string[] = [];
  for (const p of programs ?? []) {
    const snap = await buildProgressSnapshot(env, p.id);
    if (!snap) continue;
    const line = `• ${snap.traineeDisplayName ?? "?"} Day ${snap.daysElapsed}: ${
      snap.actualCompletedByToday
    }/${snap.expectedCompletedByToday}${snap.stuckDays.length > 0 ? ` 卡 ${snap.stuckDays.length}` : ""}${
      snap.avgScore !== null ? ` · avg ${snap.avgScore}` : ""
    }${snap.isPaused ? " ⏸" : ""}`;
    programLines.push(line);
  }
  if (programLines.length > 0) {
    sections.push(`【进行中 ${programLines.length}】\n${programLines.join("\n")}`);
  }

  // Pending invites section (pre-accept 催促可视化)
  const inviteLines = await summarizePendingInvites(env);
  if (inviteLines.length > 0) {
    sections.push(`【待接受 ${inviteLines.length}】\n${inviteLines.join("\n")}`);
  }

  if (sections.length === 0) return { ok: true, programs: 0, invites: 0 };

  await sendTelegram(env, "📊 Coach 每日摘要", sections.join("\n\n"));
  return { ok: true, programs: programLines.length, invites: inviteLines.length };
}
