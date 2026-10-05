import { z } from "zod";
import type { Env } from "../lib/env";
import { json } from "../lib/http";
import { getSupabaseAdmin, findUserByEmail } from "../lib/supabase";
import { aiChatComplete } from "../lib/ai";
import { saveAgentRun, type ResolvedActor } from "../lib/actor";
import { sendTelegram } from "../lib/telegram";
import {
  renderMentorPrompt,
  getMemorySnippet
} from "../agents/onboarding/skills";
import { searchKnowledge } from "../agents/knowledge/skills";

const onboardingStartPayloadSchema = z.object({
  traineeEmail: z.string().email(),
  mentorEmail: z.string().email().optional(),
  startDate: z.string(),
  templateName: z.string().default("default_15_day"),
  mentorSlug: z.string().optional()
});

const mentorChatPayloadSchema = z.object({
  message: z.string().min(1)
});

const mentorIntakePayloadSchema = z.object({
  answers: z.string().min(1),
  stage: z.enum(["first_intro", "followup"]).default("first_intro").optional()
});

const onboardingSubmitPayloadSchema = z.object({
  notes: z.string().min(1),
  uris: z.array(z.string()).default([]).optional()
});

const onboardingGradePayloadSchema = z.object({
  score: z.number().min(0).max(100),
  graderNotes: z.string().optional(),
  usePrescore: z.boolean().default(false).optional()
});

interface MentorRow {
  slug: string;
  display_name: string;
  title: string | null;
  system_prompt: string;
  tone: string | null;
  strengths: string[];
}

async function loadMentor(env: Env, slug: string | null): Promise<MentorRow | null> {
  if (!slug) return null;
  const supabase = getSupabaseAdmin(env);
  const { data } = await supabase
    .from("mentors")
    .select("slug, display_name, title, system_prompt, tone, strengths")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  return (data as MentorRow | null) ?? null;
}

async function logMentorMessage(
  env: Env,
  row: {
    program_id: string | null;
    trainee_user_id: string | null;
    mentor_slug: string | null;
    role: "user" | "mentor" | "system" | "observation";
    content: string;
    context_kind?: string;
    model_used?: string;
    latency_ms?: number;
    metadata?: Record<string, unknown>;
  }
) {
  const supabase = getSupabaseAdmin(env);
  await supabase.from("mentor_conversations").insert({
    program_id: row.program_id,
    trainee_user_id: row.trainee_user_id,
    mentor_slug: row.mentor_slug,
    role: row.role,
    content: row.content,
    context_kind: row.context_kind ?? null,
    model_used: row.model_used ?? null,
    latency_ms: row.latency_ms ?? null,
    metadata: row.metadata ?? {}
  });
}

export async function handleOnboardingStart(request: Request, env: Env, actor: ResolvedActor) {
  const body = await request.json();
  const p = onboardingStartPayloadSchema.parse(body);
  const supabase = getSupabaseAdmin(env);
  const traineeId = await findUserByEmail(env, p.traineeEmail);
  if (!traineeId) return json({ ok: false, error: "trainee_not_found" }, { status: 404 });
  const mentorId = p.mentorEmail ? await findUserByEmail(env, p.mentorEmail) : null;

  const { data: template, error: tplErr } = await supabase
    .from("onboarding_templates")
    .select("id, duration_days")
    .eq("name", p.templateName)
    .maybeSingle();
  if (tplErr || !template) return json({ ok: false, error: "template_not_found" }, { status: 404 });

  const { data: tplTasks } = await supabase
    .from("onboarding_template_tasks")
    .select("id, day_number, phase, title, today_goal, required_tasks, required_outputs, score_focus")
    .eq("template_id", template.id)
    .order("day_number", { ascending: true });

  const startDate = new Date(p.startDate + "T00:00:00Z");
  const endDate = new Date(startDate);
  endDate.setUTCDate(endDate.getUTCDate() + (template.duration_days - 1));

  const { data: program, error: progErr } = await supabase
    .from("onboarding_programs")
    .insert({
      trainee_user_id: traineeId,
      mentor_user_id: mentorId,
      template_id: template.id,
      mentor_slug: p.mentorSlug ?? null,
      start_date: p.startDate,
      end_date: endDate.toISOString().slice(0, 10),
      status: "active"
    })
    .select("id, trainee_user_id, start_date, end_date")
    .single();
  if (progErr) return json({ ok: false, error: progErr.message }, { status: 500 });

  const rows = (tplTasks ?? []).map((t) => {
    const due = new Date(startDate);
    due.setUTCDate(due.getUTCDate() + (t.day_number - 1));
    due.setUTCHours(23, 59, 0, 0);
    return {
      program_id: program.id,
      template_task_id: t.id,
      day_number: t.day_number,
      title: t.title,
      phase: t.phase,
      today_goal: t.today_goal,
      required_tasks: t.required_tasks,
      required_outputs: t.required_outputs,
      score_focus: t.score_focus,
      description: t.today_goal,
      due_at: due.toISOString(),
      status: "todo"
    };
  });
  const { error: tasksErr } = await supabase.from("onboarding_tasks").insert(rows);
  if (tasksErr) return json({ ok: false, error: tasksErr.message }, { status: 500 });

  await saveAgentRun(env, {
    agent_name: "onboarding_agent",
    trigger_source: "onboarding/start",
    status: "success",
    input_payload: body,
    output_payload: { programId: program.id, taskCount: rows.length },
    actor
  });

  return json({ ok: true, program, taskCount: rows.length, templateName: p.templateName });
}

/**
 * 提交-门控的 dayNumber:返回**第一个尚未提交**的 task 的 day_number。
 * 这样必须做完上一天才能解锁下一天 — 对齐"必须提交后才能下一题"的设计。
 *
 * 已视为"过关":submitted / reviewed / done
 * 未过关(包括 failed):返回它的 day_number,让 trainee 重做这一天
 *
 * 全部过关时返回最后一天的 day_number(allDone=true)。
 */
export async function getCurrentTraineeDayNumber(
  env: Env,
  programId: string
): Promise<{ dayNumber: number; allDone: boolean }> {
  const supabase = getSupabaseAdmin(env);
  const { data: tasks } = await supabase
    .from("onboarding_tasks")
    .select("day_number, status")
    .eq("program_id", programId)
    .order("day_number", { ascending: true });
  if (!tasks || tasks.length === 0) return { dayNumber: 1, allDone: false };
  const PAST = new Set(["submitted", "reviewed", "done"]);
  const blocking = tasks.find((t) => !PAST.has(String(t.status)));
  if (blocking) return { dayNumber: blocking.day_number as number, allDone: false };
  const last = tasks[tasks.length - 1];
  return { dayNumber: last.day_number as number, allDone: true };
}

async function buildProfileText(env: Env, userId: string) {
  const supabase = getSupabaseAdmin(env);
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("experience_summary, strengths, weaknesses, learning_style, goals")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile) return "(暂无画像,按通用难度处理)";
  return [
    profile.experience_summary ? `经验概况: ${profile.experience_summary}` : null,
    Array.isArray(profile.strengths) && profile.strengths.length
      ? `擅长: ${JSON.stringify(profile.strengths)}`
      : null,
    Array.isArray(profile.weaknesses) && profile.weaknesses.length
      ? `薄弱/想学: ${JSON.stringify(profile.weaknesses)}`
      : null,
    profile.learning_style ? `学习风格: ${profile.learning_style}` : null
  ]
    .filter(Boolean)
    .join("\n");
}

export async function handleOnboardingToday(
  request: Request,
  env: Env,
  actor: ResolvedActor
) {
  if (!actor.userId) return json({ ok: false, error: "authentication_required" }, { status: 401 });
  const supabase = getSupabaseAdmin(env);
  const { data: program } = await supabase
    .from("onboarding_programs")
    .select("id, start_date, end_date, status, mentor_slug")
    .eq("trainee_user_id", actor.userId)
    .eq("status", "active")
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!program) return json({ ok: true, active: false });

  // 必须提交才能解锁下一天 — 不再按日历日推进
  const { dayNumber, allDone } = await getCurrentTraineeDayNumber(env, program.id);

  const { data: task } = await supabase
    .from("onboarding_tasks")
    .select(
      "id, day_number, title, phase, today_goal, required_tasks, required_outputs, score_focus, status, submission_notes, submission_uris, score"
    )
    .eq("program_id", program.id)
    .eq("day_number", dayNumber)
    .maybeSingle();

  if (allDone) {
    return json({
      ok: true,
      active: true,
      program,
      today_day_number: dayNumber,
      task,
      mentor_brief: "🎉 全部 15 天任务已完成。等教官最终评审 + founder 决定转正。",
      all_done: true
    });
  }

  if (!task) {
    return json({ ok: true, active: true, program, today_day_number: dayNumber, task: null });
  }

  const queryText = [task.title, task.today_goal, task.required_tasks].filter(Boolean).join(" ");
  const sops = await searchKnowledge(env, queryText, 3);

  const { data: traineeUser } = await supabase
    .from("users")
    .select("display_name, email")
    .eq("id", actor.userId)
    .maybeSingle();

  const profileText = await buildProfileText(env, actor.userId);
  const mentor = await loadMentor(env, program.mentor_slug);
  let mentorBrief: string | null = null;
  let modelUsed: string | null = null;

  if (mentor) {
    // 同一 day 已经有 daily_brief 就直接复用,避免反复 /today 触发重复生成
    // (实际生产观察:Day 1 一度被记了 9 次,白烧 token + 噪音)
    const { data: existingBrief } = await supabase
      .from("mentor_conversations")
      .select("content, model_used, latency_ms")
      .eq("program_id", program.id)
      .eq("context_kind", "daily_brief")
      .eq("metadata->>day_number", String(dayNumber))
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingBrief?.content) {
      mentorBrief = existingBrief.content;
      modelUsed = existingBrief.model_used ?? null;
    } else {
      const memory = await getMemorySnippet(env, program.id, actor.userId, 10);
      const prompt = renderMentorPrompt(mentor.system_prompt, {
        trainee_name: traineeUser?.display_name ?? "新同事",
        task_title: task.title,
        today_goal: task.today_goal ?? "",
        required_tasks: task.required_tasks ?? "",
        required_outputs: task.required_outputs ?? "",
        score_focus: task.score_focus ?? "",
        day_number: String(dayNumber),
        profile: profileText,
        sops: sops.map((s, i) => `(${i + 1}) ${s}`).join("\n"),
        memory
      });
      const t0 = Date.now();
      try {
        mentorBrief = await aiChatComplete(env, prompt, `请生成 Day ${dayNumber} 的今日引导。`);
        modelUsed = env.AI_GATEWAY_API_KEY ? "gateway:anthropic/claude-haiku-4-5" : "openai:gpt-4o-mini";
      } catch (e) {
        mentorBrief = `(${mentor.display_name} 暂时无法生成引导:${
          e instanceof Error ? e.message : String(e)
        })`;
      }
      if (mentorBrief) {
        await logMentorMessage(env, {
          program_id: program.id,
          trainee_user_id: actor.userId,
          mentor_slug: mentor.slug,
          role: "mentor",
          content: mentorBrief,
          context_kind: "daily_brief",
          model_used: modelUsed ?? undefined,
          latency_ms: Date.now() - t0,
          metadata: { day_number: dayNumber, task_id: task.id }
        });
      }
    }
  }

  return json({
    ok: true,
    active: true,
    program,
    today_day_number: dayNumber,
    task,
    mentor: mentor ? { slug: mentor.slug, name: mentor.display_name, title: mentor.title } : null,
    mentor_brief: mentorBrief,
    guidance_sops: sops
  });
}

async function handleFounderAsk(env: Env, actor: ResolvedActor, question: string) {
  const supabase = getSupabaseAdmin(env);
  const [{ data: orgs }, { data: clients }, { data: projects }, { data: recentRuns }] =
    await Promise.all([
      supabase.from("organizations").select("name, slug, description").limit(20),
      supabase.from("clients").select("name, status, billing_currency").eq("status", "active").limit(30),
      supabase
        .from("projects")
        .select("project_code, name, status, version, maintenance_mode")
        .limit(50),
      supabase
        .from("agent_runs")
        .select("agent_name, trigger_source, started_at")
        .order("started_at", { ascending: false })
        .limit(20)
    ]);
  const sops = await searchKnowledge(env, question, 3);
  const context = [
    `集团:${JSON.stringify(orgs ?? [])}`,
    `活跃客户:${JSON.stringify(clients ?? [])}`,
    `项目:${JSON.stringify(projects ?? [])}`,
    `最近 agent 运行:${JSON.stringify(recentRuns ?? [])}`,
    `相关 SOP:\n${sops.join("\n---\n")}`
  ].join("\n\n");
  const system =
    "你是 OneAgents 的内部系统助手,面向公司 founder / 管理员。基于提供的系统数据和 SOP 片段回答问题,简洁、中文、必要时给 SQL 或命令建议。不编造不存在的数据。";
  try {
    const reply = await aiChatComplete(env, system, `系统数据:\n${context}\n\n问题: ${question}`);
    return reply ?? "(无回复)";
  } catch (e) {
    return `(助手暂时不可用:${e instanceof Error ? e.message : String(e)})`;
  }
}

export async function handleMentorChat(request: Request, env: Env, actor: ResolvedActor) {
  if (!actor.userId) return json({ ok: false, error: "authentication_required" }, { status: 401 });
  const body = await request.json();
  const p = mentorChatPayloadSchema.parse(body);
  const supabase = getSupabaseAdmin(env);

  const { data: program } = await supabase
    .from("onboarding_programs")
    .select("id, mentor_slug, start_date, status")
    .eq("trainee_user_id", actor.userId)
    .eq("status", "active")
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!program) {
    const { data: user } = await supabase
      .from("users")
      .select("role")
      .eq("id", actor.userId)
      .maybeSingle();
    if (user && (user.role === "founder" || user.role === "member")) {
      const reply = await handleFounderAsk(env, actor, p.message);
      return json({
        ok: true,
        mentor: { slug: "system_assistant", name: "系统助手" },
        reply
      });
    }
    return json({ ok: false, error: "no_active_program" }, { status: 404 });
  }

  const mentor = await loadMentor(env, program.mentor_slug);
  if (!mentor) return json({ ok: false, error: "mentor_not_set" }, { status: 400 });

  await logMentorMessage(env, {
    program_id: program.id,
    trainee_user_id: actor.userId,
    mentor_slug: mentor.slug,
    role: "user",
    content: p.message,
    context_kind: "chat"
  });

  const [{ data: traineeUser }, sops, memory] = await Promise.all([
    supabase.from("users").select("display_name").eq("id", actor.userId).maybeSingle(),
    searchKnowledge(env, p.message, 3),
    getMemorySnippet(env, program.id, actor.userId, 10)
  ]);
  const profileText = await buildProfileText(env, actor.userId);

  const systemFilled = renderMentorPrompt(mentor.system_prompt, {
    trainee_name: traineeUser?.display_name ?? "新同事",
    task_title: "(自由对话)",
    today_goal: "响应新人的提问或反馈",
    required_tasks: "(参考之前 /today 返回的清单)",
    required_outputs: "一段 <=200 字的回答",
    score_focus: "帮助新人往前推进,符合你的人设",
    day_number: "",
    profile: profileText,
    sops: sops.map((s, i) => `(${i + 1}) ${s}`).join("\n"),
    memory
  });

  const t0 = Date.now();
  let reply = "";
  try {
    reply = (await aiChatComplete(env, systemFilled, p.message)) ?? "(无回复)";
  } catch (e) {
    reply = `(${mentor.display_name} 暂时无法回复:${e instanceof Error ? e.message : String(e)})`;
  }

  await logMentorMessage(env, {
    program_id: program.id,
    trainee_user_id: actor.userId,
    mentor_slug: mentor.slug,
    role: "mentor",
    content: reply,
    context_kind: "chat",
    model_used: env.AI_GATEWAY_API_KEY ? "gateway:anthropic/claude-haiku-4-5" : "openai:gpt-4o-mini",
    latency_ms: Date.now() - t0
  });

  return json({ ok: true, mentor: { slug: mentor.slug, name: mentor.display_name }, reply });
}

export async function handleMentorIntake(request: Request, env: Env, actor: ResolvedActor) {
  if (!actor.userId) return json({ ok: false, error: "authentication_required" }, { status: 401 });
  const body = await request.json();
  const p = mentorIntakePayloadSchema.parse(body);
  const supabase = getSupabaseAdmin(env);

  const system =
    "你是一个结构化信息抽取器。输入是新人对自己背景的自述。请用 JSON 返回:" +
    '{"experience_summary":"200 字以内总结","strengths":["..."],"weaknesses":["..."],"learning_style":"","goals":""}。' +
    "不要输出 JSON 之外的任何内容。缺失的字段填空字符串或空数组。";
  const extracted = await aiChatComplete(env, system, p.answers).catch(() => null);
  let parsed: any = {};
  if (extracted) {
    const match = extracted.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        parsed = { experience_summary: extracted.slice(0, 400) };
      }
    }
  }
  const normArray = (v: unknown): unknown[] =>
    Array.isArray(v) ? v : typeof v === "string" && v ? [v] : [];

  const { data: profile, error } = await supabase
    .from("user_profiles")
    .upsert(
      {
        user_id: actor.userId,
        experience_summary: parsed.experience_summary ?? null,
        strengths: normArray(parsed.strengths),
        weaknesses: normArray(parsed.weaknesses),
        learning_style: parsed.learning_style ?? null,
        goals: parsed.goals ?? null,
        raw_interview: p.answers,
        last_refreshed_at: new Date().toISOString()
      },
      { onConflict: "user_id" }
    )
    .select("user_id, experience_summary, strengths, weaknesses, learning_style, goals, last_refreshed_at")
    .single();
  if (error) return json({ ok: false, error: error.message }, { status: 500 });

  const { data: program } = await supabase
    .from("onboarding_programs")
    .select("id, mentor_slug")
    .eq("trainee_user_id", actor.userId)
    .eq("status", "active")
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (program) {
    await logMentorMessage(env, {
      program_id: program.id,
      trainee_user_id: actor.userId,
      mentor_slug: program.mentor_slug ?? null,
      role: "observation",
      content: `入职画像已更新:strengths=${JSON.stringify(profile.strengths)}; goals=${
        profile.goals ?? ""
      }`,
      context_kind: "intake"
    });
  }
  return json({ ok: true, profile });
}

export async function handleOnboardingSubmit(
  request: Request,
  env: Env,
  actor: ResolvedActor,
  taskId: string
) {
  if (!actor.userId) return json({ ok: false, error: "authentication_required" }, { status: 401 });
  const body = await request.json();
  const p = onboardingSubmitPayloadSchema.parse(body);
  const supabase = getSupabaseAdmin(env);

  const { data: task } = await supabase
    .from("onboarding_tasks")
    .select("id, program_id, title, today_goal, required_outputs, score_focus, status, day_number")
    .eq("id", taskId)
    .maybeSingle();
  if (!task) return json({ ok: false, error: "task_not_found" }, { status: 404 });

  const { data: program } = await supabase
    .from("onboarding_programs")
    .select("trainee_user_id")
    .eq("id", task.program_id)
    .maybeSingle();
  if (!program || program.trainee_user_id !== actor.userId) {
    return json({ ok: false, error: "not_your_task" }, { status: 403 });
  }

  const { error } = await supabase
    .from("onboarding_tasks")
    .update({
      submission_notes: p.notes,
      submission_uris: p.uris ?? [],
      submitted_at: new Date().toISOString(),
      status: "submitted"
    })
    .eq("id", taskId);
  if (error) return json({ ok: false, error: error.message }, { status: 500 });

  // 教练陪跑:trainee 一交完,Nina 立刻给一条暖心 first-look 反馈,而不是等评分
  // (LLM 失败不阻塞 submit,只是没回复)
  try {
    const { data: progFull } = await supabase
      .from("onboarding_programs")
      .select("id, mentor_slug")
      .eq("id", task.program_id)
      .maybeSingle();
    const { data: traineeUser } = await supabase
      .from("users")
      .select("display_name, telegram_chat_id")
      .eq("id", actor.userId)
      .maybeSingle();
    const { data: ib } = await supabase
      .from("identity_bindings")
      .select("provider_user_id")
      .eq("user_id", actor.userId)
      .eq("provider", "telegram")
      .maybeSingle();
    const chatId = ib?.provider_user_id ?? traineeUser?.telegram_chat_id;
    const mentor = await loadMentor(env, progFull?.mentor_slug ?? null);
    if (mentor && chatId) {
      const sys = `你是 ${mentor.display_name},一位 ${mentor.title ?? "engineering coach"}。学员刚刚提交了 Day ${task.day_number} 的任务。先给一条 80 字以内的中文 first-look 反馈:1)亮点(根据 submission_notes 推测)2)接下来等评分,不要现在就打分。语气符合你的人设(${mentor.tone ?? "warm"})。不要用 markdown 标题。`;
      const usr = [
        `任务: ${task.title}`,
        `今日目标: ${task.today_goal ?? ""}`,
        `要求交付: ${task.required_outputs ?? ""}`,
        `学员提交说明: ${p.notes}`,
        `提交链接: ${(p.uris ?? []).join(", ") || "(无)"}`
      ].join("\n");
      const t0 = Date.now();
      const reply = await aiChatComplete(env, sys, usr).catch(() => null);
      if (reply) {
        await sendTelegramReply(env, chatId, reply, "employee");
        await logMentorMessage(env, {
          program_id: task.program_id,
          trainee_user_id: actor.userId,
          mentor_slug: mentor.slug,
          role: "mentor",
          content: reply,
          context_kind: "submit_first_look",
          model_used: env.AI_GATEWAY_API_KEY ? "gateway:anthropic/claude-haiku-4-5" : "openai:gpt-4o-mini",
          latency_ms: Date.now() - t0,
          metadata: { day_number: task.day_number, task_id: task.id }
        });
      }
    }
  } catch {
    // 陪跑反馈失败不影响 submit
  }

  await saveAgentRun(env, {
    agent_name: "onboarding_agent",
    trigger_source: "onboarding/submit",
    status: "success",
    input_payload: { taskId, ...body },
    output_payload: { taskId, dayNumber: task.day_number },
    actor
  });
  return json({ ok: true, taskId, dayNumber: task.day_number });
}

export async function handleOnboardingGrade(
  request: Request,
  env: Env,
  actor: ResolvedActor,
  taskId: string
) {
  if (!actor.userId) return json({ ok: false, error: "authentication_required" }, { status: 401 });
  const body = await request.json();
  const p = onboardingGradePayloadSchema.parse(body);
  const supabase = getSupabaseAdmin(env);

  const { data: task } = await supabase
    .from("onboarding_tasks")
    .select(
      "id, program_id, title, today_goal, required_outputs, score_focus, submission_notes, submission_uris, day_number"
    )
    .eq("id", taskId)
    .maybeSingle();
  if (!task) return json({ ok: false, error: "task_not_found" }, { status: 404 });

  let prescore: Record<string, unknown> | null = null;
  if (p.usePrescore && task.submission_notes) {
    const system =
      "你是新人培训辅助评分员。根据给出的任务目标、交付要求与评分重点,对新人提交打一个 0-100 的初步分数,并用 2-3 条简短理由说明。用 JSON 返回 {score, reasons:[...]}。";
    const user = [
      `任务标题: ${task.title}`,
      `今日目标: ${task.today_goal}`,
      `交付要求: ${task.required_outputs}`,
      `评分重点: ${task.score_focus}`,
      `新人提交: ${task.submission_notes}`,
      `参考链接: ${(task.submission_uris ?? []).join(", ")}`
    ].join("\n");
    try {
      const raw = await aiChatComplete(env, system, user);
      if (raw) {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) prescore = JSON.parse(match[0]);
        else prescore = { raw };
      }
    } catch (e) {
      prescore = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  const { error } = await supabase
    .from("onboarding_tasks")
    .update({
      score: p.score,
      grader_notes: p.graderNotes ?? null,
      reviewer_user_id: actor.userId,
      graded_at: new Date().toISOString(),
      ai_prescore: prescore,
      status: "done"
    })
    .eq("id", taskId);
  if (error) return json({ ok: false, error: error.message }, { status: 500 });

  await saveAgentRun(env, {
    agent_name: "onboarding_agent",
    trigger_source: "onboarding/grade",
    status: "success",
    input_payload: { taskId, ...body },
    output_payload: { taskId, score: p.score, prescore },
    actor
  });
  return json({ ok: true, taskId, score: p.score, prescore });
}

export async function handleOnboardingSummary(env: Env, programId: string) {
  const supabase = getSupabaseAdmin(env);
  const { data: program } = await supabase
    .from("onboarding_programs")
    .select(
      "id, start_date, end_date, status, trainee_user_id, mentor_user_id, template_id, mentor_slug"
    )
    .eq("id", programId)
    .maybeSingle();
  if (!program) return json({ ok: false, error: "program_not_found" }, { status: 404 });

  const { data: tasks } = await supabase
    .from("onboarding_tasks")
    .select("day_number, title, phase, status, score, submitted_at, graded_at")
    .eq("program_id", programId)
    .order("day_number", { ascending: true });

  const gradedTasks = (tasks ?? []).filter((t) => t.score !== null);
  const avgScore =
    gradedTasks.length === 0
      ? null
      : gradedTasks.reduce((acc, t) => acc + Number(t.score), 0) / gradedTasks.length;

  const byPhase: Record<string, { count: number; done: number; avgScore: number | null }> = {};
  for (const t of tasks ?? []) {
    const key = t.phase ?? "未分阶段";
    byPhase[key] = byPhase[key] ?? { count: 0, done: 0, avgScore: null };
    byPhase[key].count++;
    if (t.status === "done") byPhase[key].done++;
  }
  for (const key of Object.keys(byPhase)) {
    const graded = (tasks ?? []).filter((t) => (t.phase ?? "未分阶段") === key && t.score !== null);
    byPhase[key].avgScore =
      graded.length === 0 ? null : graded.reduce((acc, t) => acc + Number(t.score), 0) / graded.length;
  }
  return json({
    ok: true,
    program,
    progress: { total: tasks?.length ?? 0, graded: gradedTasks.length, avgScore, byPhase, tasks }
  });
}
