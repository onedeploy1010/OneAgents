// 每日 standup:早上 09:00 CST 推今日任务,晚上 21:00 CST 推今日总结。
// 按 users.role 个性化(founder / member / trainee)。
// 优先用 identity_bindings.telegram > users.telegram_chat_id 兜底。
//
// 不用 LLM(确定性 + 省 token);需要 LLM 包装的话后续在 generate-* 函数里加。

import type { Env } from "../lib/env";
import { getSupabaseAdmin } from "../lib/supabase";
import { sendTelegramReply } from "../lib/telegram";
import { saveAgentRun } from "../lib/actor";
import { aiChatComplete } from "../lib/ai";
import { getCurrentTraineeDayNumber } from "./onboarding";

type Role = "founder" | "member" | "trainee";

interface Recipient {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  chatId: string;
}

async function getRecipients(env: Env): Promise<Recipient[]> {
  const supabase = getSupabaseAdmin(env);
  const { data: users } = await supabase
    .from("users")
    .select("id, email, display_name, role, status, telegram_chat_id")
    .in("role", ["founder", "member", "trainee"])
    .eq("status", "active");
  const { data: trial } = await supabase
    .from("users")
    .select("id, email, display_name, role, status, telegram_chat_id")
    .in("role", ["trainee"])
    .eq("status", "trial");
  const all = [...(users ?? []), ...(trial ?? [])];

  const ids = all.map((u) => u.id);
  const { data: bindings } = await supabase
    .from("identity_bindings")
    .select("user_id, provider_user_id")
    .eq("provider", "telegram")
    .in("user_id", ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const byUser = new Map((bindings ?? []).map((b) => [b.user_id, b.provider_user_id]));

  const out: Recipient[] = [];
  for (const u of all) {
    const chatId = byUser.get(u.id) ?? u.telegram_chat_id;
    if (!chatId) continue;
    out.push({
      userId: u.id,
      email: u.email,
      displayName: u.display_name ?? u.email,
      role: u.role as Role,
      chatId
    });
  }
  return out;
}

/* ---------- 早晨:今日任务建议 ---------- */

async function buildMorningForFounder(env: Env): Promise<string> {
  const supabase = getSupabaseAdmin(env);
  const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const [
    { count: pendingApprovals },
    { count: newClientNeeds },
    { count: pendingReviews },
    { data: recentFlags },
    { data: stuckPrograms }
  ] = await Promise.all([
    supabase
      .from("workflow_step_runs")
      .select("id", { count: "exact", head: true })
      .eq("status", "awaiting_approval"),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("source_channel", "telegram_client:new_need")
      .gte("created_at", since24h),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("needs_human_review", true)
      .neq("status", "done"),
    supabase
      .from("training_coach_actions")
      .select("review_id, params, executed_at")
      .eq("kind", "flag_for_review")
      .gte("executed_at", since7d)
      .order("executed_at", { ascending: false })
      .limit(5),
    supabase
      .from("training_coach_reviews")
      .select("program_id, findings, created_at")
      .gte("created_at", since7d)
      .order("created_at", { ascending: false })
      .limit(20)
  ]);

  const distinctStuck = new Set<string>();
  for (const r of stuckPrograms ?? []) {
    const state = (r.findings as { state?: string })?.state;
    if (state === "stuck" || state === "silent" || state === "behind") {
      distinctStuck.add(r.program_id);
    }
  }

  const lines = [
    `☀️ 早上好 Alps`,
    ``,
    `**今天值得先看的事:**`,
    `• 待审批工作流:${pendingApprovals ?? 0} 条`,
    `• 24h 内新客户需求:${newClientNeeds ?? 0} 条`,
    `• 任务待复核:${pendingReviews ?? 0} 条`,
    `• 7 天内被 coach flag 的 trainee:${recentFlags?.length ?? 0} 次(影响 ${distinctStuck.size} 个 program)`,
    ``,
    `去 Retool 看详情;紧急的发 /approve 直接处理。`
  ];
  return lines.join("\n");
}

async function buildMorningForMember(env: Env, r: Recipient): Promise<string | null> {
  const supabase = getSupabaseAdmin(env);
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, status, priority, due_at, project_id")
    .eq("assignee_user_id", r.userId)
    .neq("status", "done")
    .order("priority", { ascending: true })
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(5);
  if (!tasks || tasks.length === 0) {
    return [
      `☀️ 早上好 ${r.displayName}`,
      ``,
      `今天你名下没有 active 任务。要不要去 Retool 接一两个,或者发 /chat 跟 founder 对一下方向?`
    ].join("\n");
  }
  const items = tasks.map((t, i) => {
    const due = t.due_at ? new Date(t.due_at).toISOString().slice(5, 10) : "无 due";
    return `${i + 1}. [P${t.priority}] ${t.title}  (${due} · ${t.status})`;
  });
  return [
    `☀️ 早上好 ${r.displayName}`,
    ``,
    `**今天建议先做的 ${tasks.length} 件事:**`,
    ...items,
    ``,
    `搞定一项就在 Retool 里把 status 改了,或发 /done <task-id>。`
  ].join("\n");
}

async function buildMorningForTrainee(env: Env, r: Recipient): Promise<string | null> {
  const supabase = getSupabaseAdmin(env);
  const { data: program } = await supabase
    .from("onboarding_programs")
    .select("id, start_date, end_date, mentor_slug")
    .eq("trainee_user_id", r.userId)
    .eq("status", "active")
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!program) return null;

  // 提交-门控 — 解锁的下一天才是"今天的任务"
  const { dayNumber, allDone } = await getCurrentTraineeDayNumber(env, program.id);
  if (allDone) {
    return [
      `☀️ 早上好 ${r.displayName}`,
      ``,
      `🎉 全部 15 天已经过了。等教官最终评审 + founder 决定转正。这两天可以休息或自由探索。`
    ].join("\n");
  }

  const { data: task } = await supabase
    .from("onboarding_tasks")
    .select("id, day_number, title, today_goal, status")
    .eq("program_id", program.id)
    .eq("day_number", dayNumber)
    .maybeSingle();

  if (!task) {
    return [
      `☀️ 早上好 ${r.displayName}`,
      ``,
      `今天是 Day ${dayNumber},培训表里没找到对应任务,可能 program 排错了。发 /chat 让我们看一下。`
    ].join("\n");
  }

  const statusLabel: Record<string, string> = {
    todo: "🔵 还没开始",
    doing: "🟡 进行中",
    submitted: "🟠 已交,等评分",
    reviewed: "🟣 已评",
    done: "🟢 完成",
    failed: "🔴 失败"
  };

  return [
    `☀️ 早上好 ${r.displayName}`,
    ``,
    `**Day ${dayNumber} / 15 · ${task.title}**`,
    `当前状态:${statusLabel[task.status] ?? task.status}`,
    ``,
    task.today_goal ? `今日目标:${task.today_goal}` : "",
    ``,
    `发 /today 看完整清单和教官引导。卡住发 /chat <你的问题>。`,
    `做完务必 /submit <说明 + URL/截图> — 提交后才解锁下一天。`
  ]
    .filter(Boolean)
    .join("\n");
}

/* ---------- 晚上:今日总结 ---------- */

const TODAY_START = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
};

async function buildEveningForFounder(env: Env): Promise<string> {
  const supabase = getSupabaseAdmin(env);
  const since = TODAY_START();
  const [
    { count: agentRuns },
    { count: coachReviews },
    { count: flagsToday },
    { count: completedTasks },
    { count: newClientNeeds }
  ] = await Promise.all([
    supabase.from("agent_runs").select("id", { count: "exact", head: true }).gte("created_at", since),
    supabase.from("training_coach_reviews").select("id", { count: "exact", head: true }).gte("created_at", since),
    supabase
      .from("training_coach_actions")
      .select("id", { count: "exact", head: true })
      .eq("kind", "flag_for_review")
      .gte("executed_at", since),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("status", "done").gte("updated_at", since),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("source_channel", "telegram_client:new_need")
      .gte("created_at", since)
  ]);

  return [
    `🌙 今日总结(UTC 日历日)`,
    ``,
    `• Agent runs:${agentRuns ?? 0}`,
    `• Coach reviews:${coachReviews ?? 0}(其中 flag_for_review ${flagsToday ?? 0})`,
    `• Tasks 今天 → done:${completedTasks ?? 0}`,
    `• 新客户需求:${newClientNeeds ?? 0}`,
    ``,
    `明天早上 09:00 我会再发一次。`
  ].join("\n");
}

async function buildEveningForMember(env: Env, r: Recipient): Promise<string | null> {
  const supabase = getSupabaseAdmin(env);
  const since = TODAY_START();
  const [{ data: doneToday }, { count: stillTodo }] = await Promise.all([
    supabase
      .from("tasks")
      .select("title, status")
      .eq("assignee_user_id", r.userId)
      .eq("status", "done")
      .gte("updated_at", since),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("assignee_user_id", r.userId)
      .neq("status", "done")
  ]);

  const lines = [`🌙 ${r.displayName} 今日`];
  if ((doneToday?.length ?? 0) > 0) {
    lines.push(``, `**今天完成:**`);
    for (const t of doneToday ?? []) lines.push(`✓ ${t.title}`);
  } else {
    lines.push(``, `今天没有已完成的任务记录。`);
  }
  lines.push(``, `名下还有 ${stillTodo ?? 0} 条未完成,明天早上我会再发一次提醒。`);
  return lines.join("\n");
}

async function buildEveningForTrainee(env: Env, r: Recipient): Promise<string | null> {
  const supabase = getSupabaseAdmin(env);
  const since = TODAY_START();

  const { data: program } = await supabase
    .from("onboarding_programs")
    .select("id, start_date")
    .eq("trainee_user_id", r.userId)
    .eq("status", "active")
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!program) return null;

  const { dayNumber, allDone } = await getCurrentTraineeDayNumber(env, program.id);
  if (allDone) {
    return [`🌙 ${r.displayName} 全部 15 天已完成,等评审 + 转正决定。`].join("\n");
  }

  const { data: task } = await supabase
    .from("onboarding_tasks")
    .select("id, day_number, title, status, submitted_at")
    .eq("program_id", program.id)
    .eq("day_number", dayNumber)
    .maybeSingle();

  if (!task) return null;

  const submittedToday = task.submitted_at && task.submitted_at >= since;
  if (task.status === "submitted" || submittedToday) {
    return [
      `🌙 ${r.displayName} Day ${dayNumber} 已提交 ✅`,
      `等教官 Nina 评分。明天早上自动给你 Day ${Math.min(15, dayNumber + 1)}。`
    ].join("\n");
  }
  return [
    `🌙 ${r.displayName} Day ${dayNumber} 今天还没提交。`,
    ``,
    `Task:${task.title}`,
    ``,
    `做完发 /submit <说明 + URL/截图> — 提交了才解锁下一天。`,
    `卡了发 /chat <你的问题>,Nina 帮你过。`
  ].join("\n");
}

/* ---------- 教练陪跑:白天定时 check-in ---------- */

const CHECKIN_QUIET_HOURS = 6; // 距上次任意消息超过 N 小时才发,避免 spam

export async function sendMentorMidDayCheckIn(env: Env) {
  const supabase = getSupabaseAdmin(env);
  const since = TODAY_START();
  const recipients = await getRecipients(env);
  const trainees = recipients.filter((r) => r.role === "trainee");

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const skipReasons: Record<string, number> = {};

  for (const r of trainees) {
    try {
      const { data: program } = await supabase
        .from("onboarding_programs")
        .select("id, mentor_slug, is_paused")
        .eq("trainee_user_id", r.userId)
        .eq("status", "active")
        .order("start_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!program || program.is_paused) {
        skipped++;
        skipReasons.no_active_program = (skipReasons.no_active_program ?? 0) + 1;
        continue;
      }
      const { dayNumber, allDone } = await getCurrentTraineeDayNumber(env, program.id);
      if (allDone) {
        skipped++;
        skipReasons.all_done = (skipReasons.all_done ?? 0) + 1;
        continue;
      }
      const { data: task } = await supabase
        .from("onboarding_tasks")
        .select("id, day_number, title, today_goal, status, submitted_at")
        .eq("program_id", program.id)
        .eq("day_number", dayNumber)
        .maybeSingle();
      if (!task) {
        skipped++;
        continue;
      }
      // 今天已提交 → 不打扰
      if (task.submitted_at && task.submitted_at >= since) {
        skipped++;
        skipReasons.submitted_today = (skipReasons.submitted_today ?? 0) + 1;
        continue;
      }
      // 距上次任意 mentor_conversations(任何 role)< quiet hours → 不打扰
      const { data: lastMsg } = await supabase
        .from("mentor_conversations")
        .select("created_at")
        .eq("program_id", program.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastMsg) {
        const hoursSince =
          (Date.now() - new Date(lastMsg.created_at as string).getTime()) / 3_600_000;
        if (hoursSince < CHECKIN_QUIET_HOURS) {
          skipped++;
          skipReasons.recent_activity = (skipReasons.recent_activity ?? 0) + 1;
          continue;
        }
      }
      const { data: mentor } = await supabase
        .from("mentors")
        .select("slug, display_name, title, system_prompt, tone")
        .eq("slug", program.mentor_slug ?? "nina_coach")
        .eq("is_active", true)
        .maybeSingle();
      if (!mentor) {
        skipped++;
        continue;
      }
      const sys = `你是 ${mentor.display_name},${mentor.title ?? "engineering coach"},语气 ${mentor.tone ?? "warm"}。学员 ${r.displayName} 正在做 Day ${dayNumber} 的任务,但今天还没提交、也没说话。给一条 60 字以内的中文 mid-day check-in,问她卡哪了/需要什么帮助。不要重复任务说明,不要 markdown 标题,亲切但不催促。`;
      const usr = [
        `任务: ${task.title}`,
        `今日目标: ${task.today_goal ?? ""}`,
        `当前状态: ${task.status}`
      ].join("\n");
      const t0 = Date.now();
      const reply = await aiChatComplete(env, sys, usr).catch(() => null);
      if (!reply) {
        failed++;
        continue;
      }
      const sendResult = await sendTelegramReply(env, r.chatId, reply, "employee").catch(() => null);
      const ok = sendResult && !("skipped" in sendResult && sendResult.skipped) && (sendResult as { ok?: boolean }).ok;
      if (!ok) {
        failed++;
        continue;
      }
      await supabase.from("mentor_conversations").insert({
        program_id: program.id,
        trainee_user_id: r.userId,
        mentor_slug: mentor.slug,
        role: "mentor",
        content: reply,
        context_kind: "mid_day_checkin",
        model_used: env.AI_GATEWAY_API_KEY ? "gateway:anthropic/claude-haiku-4-5" : "openai:gpt-4o-mini",
        latency_ms: Date.now() - t0,
        metadata: { day_number: dayNumber, task_id: task.id }
      });
      sent++;
    } catch {
      failed++;
    }
  }

  await saveAgentRun(env, {
    agent_name: "mentor_companion",
    trigger_source: "cron:mentor_midday_checkin",
    status: "success",
    output_payload: { trainees: trainees.length, sent, skipped, failed, skipReasons }
  });
  return { trainees: trainees.length, sent, skipped, failed, skipReasons };
}

/* ---------- 总入口 ---------- */

async function dispatchPerRecipient(
  env: Env,
  recipients: Recipient[],
  build: (r: Recipient) => Promise<string | null>
): Promise<{ sent: number; skipped: number; failed: number }> {
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const r of recipients) {
    const text = await build(r).catch(() => null);
    if (!text) {
      skipped++;
      continue;
    }
    const result = await sendTelegramReply(env, r.chatId, text, "employee").catch(() => null);
    if (result && !("skipped" in result && result.skipped) && (result as { ok?: boolean }).ok) {
      sent++;
    } else {
      failed++;
    }
  }
  return { sent, skipped, failed };
}

export async function sendMorningStandup(env: Env) {
  const recipients = await getRecipients(env);
  // founder 全公司视角共用一份
  let founderText: string | null = null;
  const result = await dispatchPerRecipient(env, recipients, async (r) => {
    if (r.role === "founder") {
      if (!founderText) founderText = await buildMorningForFounder(env);
      return founderText;
    }
    if (r.role === "member") return buildMorningForMember(env, r);
    if (r.role === "trainee") return buildMorningForTrainee(env, r);
    return null;
  });
  await saveAgentRun(env, {
    agent_name: "standup_agent",
    trigger_source: "cron:standup_morning",
    status: "success",
    output_payload: { recipients: recipients.length, ...result }
  });
  return result;
}

export async function sendEveningSummary(env: Env) {
  const recipients = await getRecipients(env);
  let founderText: string | null = null;
  const result = await dispatchPerRecipient(env, recipients, async (r) => {
    if (r.role === "founder") {
      if (!founderText) founderText = await buildEveningForFounder(env);
      return founderText;
    }
    if (r.role === "member") return buildEveningForMember(env, r);
    if (r.role === "trainee") return buildEveningForTrainee(env, r);
    return null;
  });
  await saveAgentRun(env, {
    agent_name: "standup_agent",
    trigger_source: "cron:standup_evening",
    status: "success",
    output_payload: { recipients: recipients.length, ...result }
  });
  return result;
}
