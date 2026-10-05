import type { Env } from "../../../lib/env";
import { getSupabaseAdmin } from "../../../lib/supabase";
import { sendTelegramReply } from "../../../lib/telegram";
import type { CoachRecommendation } from "./recommend-adjustment";

/**
 * 把一条 recommendation 真正执行(改 DB / 发消息 / 加任务)。
 * 返回结果 JSON 供写入 training_coach_actions.result。
 */
export async function applyRecommendation(
  env: Env,
  programId: string,
  traineeUserId: string,
  rec: CoachRecommendation
): Promise<{ ok: boolean; result?: Record<string, unknown>; error?: string }> {
  const supabase = getSupabaseAdmin(env);
  const params = rec.params ?? {};
  switch (rec.kind) {
    case "switch_mentor": {
      const newSlug = params["new_mentor_slug"];
      if (!newSlug || typeof newSlug !== "string") return { ok: false, error: "missing_new_mentor_slug" };
      const { error } = await supabase
        .from("onboarding_programs")
        .update({ mentor_slug: newSlug, updated_at: new Date().toISOString() })
        .eq("id", programId);
      if (error) return { ok: false, error: error.message };
      return { ok: true, result: { mentor_slug: newSlug } };
    }
    case "extend_due": {
      const taskId = params["task_id"];
      const newDue = params["new_due_at"];
      if (!taskId || !newDue) return { ok: false, error: "missing_task_or_due" };
      const { error } = await supabase
        .from("onboarding_tasks")
        .update({ due_at: newDue, updated_at: new Date().toISOString() })
        .eq("id", taskId as string);
      if (error) return { ok: false, error: error.message };
      return { ok: true, result: { task_id: taskId, new_due_at: newDue } };
    }
    case "add_remedial_task": {
      const afterDay = Number(params["after_day"] ?? 1);
      const title = String(params["title"] ?? "补救练习");
      const goal = String(params["today_goal"] ?? "");
      const required = String(params["required_tasks"] ?? "");
      const difficulty = Number(params["difficulty"] ?? 2);
      const due = new Date();
      due.setUTCDate(due.getUTCDate() + 1);
      due.setUTCHours(23, 59, 0, 0);
      const { data, error } = await supabase
        .from("onboarding_tasks")
        .insert({
          program_id: programId,
          day_number: afterDay,
          title,
          description: goal,
          status: "todo",
          phase: "补救",
          today_goal: goal,
          required_tasks: required,
          difficulty,
          is_remedial: true,
          due_at: due.toISOString()
        })
        .select("id")
        .single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, result: { task_id: data.id } };
    }
    case "pause_program": {
      const reason = String(params["reason"] ?? "coach_requested");
      const { error } = await supabase
        .from("onboarding_programs")
        .update({ is_paused: true, pause_reason: reason, updated_at: new Date().toISOString() })
        .eq("id", programId);
      if (error) return { ok: false, error: error.message };
      return { ok: true, result: { paused: true, reason } };
    }
    case "resume_program": {
      const { error } = await supabase
        .from("onboarding_programs")
        .update({ is_paused: false, pause_reason: null, updated_at: new Date().toISOString() })
        .eq("id", programId);
      if (error) return { ok: false, error: error.message };
      return { ok: true, result: { paused: false } };
    }
    case "send_encouragement": {
      const tone = String(params["tone"] ?? "warm");
      const { data: user } = await supabase
        .from("users")
        .select("telegram_chat_id, display_name")
        .eq("id", traineeUserId)
        .maybeSingle();
      const { data: ib } = await supabase
        .from("identity_bindings")
        .select("provider_user_id")
        .eq("user_id", traineeUserId)
        .eq("provider", "telegram")
        .maybeSingle();
      // identity_bindings 比 users.telegram_chat_id 更可靠(后者很多 trainee 是 NULL)
      const chatId = ib?.provider_user_id ?? user?.telegram_chat_id;
      if (!chatId) return { ok: false, error: "no_telegram_chat_id" };
      const text =
        tone === "celebratory"
          ? `🎉 ${user.display_name ?? ""},你做得很好!保持节奏,continues。`
          : tone === "firm"
          ? `${user.display_name ?? ""},今天还没看到你的进展。哪里卡住了?发 /chat 告诉教官,我们一起过。`
          : `嘿 ${user.display_name ?? ""} 👋 好久没听到你了。Day 进度到哪?没想法就 /chat 问一声,我们不想让你憋着。`;
      await sendTelegramReply(env, chatId, text, "employee");
      return { ok: true, result: { sent_to: chatId, tone } };
    }
    case "extend_program": {
      const extra = Number(params["extra_days"] ?? 3);
      const { data: prog } = await supabase
        .from("onboarding_programs")
        .select("end_date")
        .eq("id", programId)
        .maybeSingle();
      if (!prog?.end_date) return { ok: false, error: "no_end_date" };
      const newEnd = new Date(prog.end_date);
      newEnd.setUTCDate(newEnd.getUTCDate() + extra);
      const { error } = await supabase
        .from("onboarding_programs")
        .update({ end_date: newEnd.toISOString().slice(0, 10), updated_at: new Date().toISOString() })
        .eq("id", programId);
      if (error) return { ok: false, error: error.message };
      return { ok: true, result: { extra_days: extra, new_end: newEnd.toISOString().slice(0, 10) } };
    }
    case "promote_to_member": {
      const { error: userErr } = await supabase
        .from("users")
        .update({ role: "member", status: "active", updated_at: new Date().toISOString() })
        .eq("id", traineeUserId);
      if (userErr) return { ok: false, error: `user_update_failed:${userErr.message}` };
      // 把 program 关闭 — 失败要上报,否则 user 已转正但 program 还挂着 active
      const { error: progErr } = await supabase
        .from("onboarding_programs")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", programId);
      if (progErr) {
        return {
          ok: false,
          error: `program_close_failed_after_user_promoted:${progErr.message}`,
          result: { user_promoted: true, program_closed: false }
        };
      }
      // 通知 trainee — 不通知就没人知道转正了
      let notified = false;
      try {
        const { data: user } = await supabase
          .from("users")
          .select("display_name, telegram_chat_id")
          .eq("id", traineeUserId)
          .maybeSingle();
        const { data: ib } = await supabase
          .from("identity_bindings")
          .select("provider_user_id")
          .eq("user_id", traineeUserId)
          .eq("provider", "telegram")
          .maybeSingle();
        const chatId = ib?.provider_user_id ?? user?.telegram_chat_id;
        if (chatId) {
          const reason = String(params["reason"] ?? "");
          const text = [
            `🎉 ${user?.display_name ?? ""},恭喜!你已正式转正为 member。`,
            reason ? `\n教官评语:${reason}` : "",
            `\n你的角色已切到 member,后续可以接真实项目任务。`
          ].join("");
          await sendTelegramReply(env, chatId, text, "employee");
          notified = true;
        }
      } catch {
        // 通知失败不回滚转正
      }
      return { ok: true, result: { promoted: true, program_closed: true, notified } };
    }
    case "flag_for_review": {
      const why = String(params["why"] ?? "");
      // 真的发一条到 founder 的 default chat,否则 flag 就只是 DB 里的死字段
      let notified = false;
      try {
        const { data: trainee } = await supabase
          .from("users")
          .select("display_name, email")
          .eq("id", traineeUserId)
          .maybeSingle();
        const { data: prog } = await supabase
          .from("onboarding_programs")
          .select("start_date, end_date, mentor_slug, status")
          .eq("id", programId)
          .maybeSingle();
        const { sendTelegram } = await import("../../../lib/telegram");
        const result = await sendTelegram(
          env,
          "🚩 Coach flag_for_review",
          [
            `trainee: ${trainee?.display_name ?? ""} (${trainee?.email ?? ""})`,
            `program: ${programId}`,
            `mentor: ${prog?.mentor_slug ?? ""}  status: ${prog?.status ?? ""}`,
            `dates: ${prog?.start_date ?? ""} → ${prog?.end_date ?? ""}`,
            ``,
            `why: ${why}`,
            ``,
            `Retool 看这个 trainee 详情,决定 pause / extend / switch_mentor / 给她打电话。`
          ].join("\n")
        );
        notified = !result.skipped && result.ok === true;
      } catch {
        // 通知失败不要让 review 报错
      }
      return { ok: true, result: { flagged: true, why, notified } };
    }
    default:
      return { ok: false, error: `unknown_kind:${rec.kind}` };
  }
}
