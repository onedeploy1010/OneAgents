import { routeAgentRequest } from "agents";
import { z } from "zod";

// Shared lib — 所有核心 helper 都在这里
import { json, corsPreflight, parseListParams, timingSafeEqual, CORS_HEADERS } from "./lib/http";
import { getSupabaseAdmin, findUserByEmail } from "./lib/supabase";
import { aiChatComplete, embedText } from "./lib/ai";
import {
  saveAgentRun,
  sha256Hex,
  generateTokenPlain,
  emptyActor,
  type ResolvedActor
} from "./lib/actor";
import {
  resolveBearer,
  resolveByIdentity,
  requireAdmin,
  verifyGithubSignature
} from "./lib/auth";
import {
  sendTelegram,
  sendTelegramReply,
  answerCallbackQuery,
  mdToTgHtml,
  getTgTokenForRole,
  getTgSession,
  setTgSession,
  clearTgSession,
  type TgBotRole
} from "./lib/telegram";
import {
  scanAssetRenewals,
  scanSubscriptionRenewals
} from "./agents/infra/skills";
import {
  flushPendingTelegramNotifications
} from "./handlers/cron";
import {
  searchKnowledge,
  embedDocument
} from "./agents/knowledge/skills";
import {
  renderMentorPrompt,
  getMemorySnippet
} from "./agents/onboarding/skills";

import {
  FinanceAgent,
  InfraAgent,
  KnowledgeAgent,
  MeetingAgent,
  OnboardingAgent,
  OrchestratorAgent,
  ProjectOpsAgent,
  TrainingCoachAgent
} from "./agents";
import {
  runCoachReview,
  runDailyCoachSweep,
  applyRecommendation as coachApply,
  sendDailyCoachDigest,
  buildProgressSnapshot,
  generateProgramReport,
  nudgePendingInvites
} from "./agents/training-coach/skills";

// 新 handlers — 渐进式迁移。dispatcher 已切到这些。
import * as entityHandlers from "./handlers/entities";
import * as onboardingHandlers from "./handlers/onboarding";
import * as workflowHandlers from "./handlers/workflow";
import { advanceWorkflow } from "./handlers/workflow";
import * as adminHandlers from "./handlers/admin";
import * as cronHandlers from "./handlers/cron";
import * as legacyWorkflowHandlers from "./handlers/legacy-workflows";
import * as superadminHandlers from "./handlers/superadmin";
import * as googleOAuthHandlers from "./handlers/google-oauth";

export {
  FinanceAgent,
  InfraAgent,
  KnowledgeAgent,
  MeetingAgent,
  OnboardingAgent,
  OrchestratorAgent,
  ProjectOpsAgent,
  TrainingCoachAgent
};

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
  MeetingAgent: DurableObjectNamespace;
  ProjectOpsAgent: DurableObjectNamespace;
  FinanceAgent: DurableObjectNamespace;
  OnboardingAgent: DurableObjectNamespace;
  OrchestratorAgent: DurableObjectNamespace;
  KnowledgeAgent: DurableObjectNamespace;
  InfraAgent: DurableObjectNamespace;
  TrainingCoachAgent: DurableObjectNamespace;
}

const clientPayloadSchema = z.object({
  name: z.string().min(1),
  contactName: z.string().optional(),
  contactChannel: z.string().optional(),
  billingCurrency: z.string().optional(),
  status: z.enum(["lead", "active", "paused", "closed"]).optional(),
  notes: z.string().optional()
});

const projectPayloadSchema = z.object({
  clientId: z.string().uuid(),
  name: z.string().min(1),
  projectCode: z.string().min(1),
  projectType: z.enum(["web", "automation", "ops", "ai", "maintenance"]).optional(),
  status: z.enum(["planning", "active", "blocked", "maintenance", "done"]).optional(),
  ownerUserEmail: z.string().email().optional(),
  deliveryModel: z.enum(["fixed", "retainer", "hourly"]).optional(),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
  startDate: z.string().optional(),
  targetEndDate: z.string().optional(),
  description: z.string().optional()
});

const projectMemberPayloadSchema = z.object({
  projectId: z.string().uuid(),
  userEmail: z.string().email(),
  role: z.string().min(1)
});

const clientContactPayloadSchema = z.object({
  clientId: z.string().uuid(),
  name: z.string().optional(),
  email: z.string().email(),
  roleAtClient: z.string().optional(),
  isPrimary: z.boolean().optional(),
  notes: z.string().optional()
});

const patchClientSchema = z.object({
  name: z.string().optional(),
  contactName: z.string().optional(),
  contactChannel: z.string().optional(),
  billingCurrency: z.string().optional(),
  status: z.enum(["lead", "active", "paused", "closed"]).optional(),
  notes: z.string().optional(),
  organizationId: z.string().uuid().nullable().optional()
});

const patchProjectSchema = z.object({
  name: z.string().optional(),
  status: z.enum(["planning", "active", "blocked", "maintenance", "done"]).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  deliveryModel: z.enum(["fixed", "retainer", "hourly"]).optional(),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
  version: z.string().optional(),
  maintenanceMode: z.boolean().optional(),
  ownerUserEmail: z.string().email().optional(),
  targetDate: z.string().optional(),
  summary: z.string().optional()
});

const patchTaskSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["todo", "doing", "review", "blocked", "done"]).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  track: z.enum(["main", "sub", "branch", "maintenance", "hotfix"]).optional(),
  versionTarget: z.string().nullable().optional(),
  assigneeUserEmail: z.string().email().nullable().optional(),
  dueAt: z.string().nullable().optional(),
  needsHumanReview: z.boolean().optional()
});

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

const researchPayloadSchema = z.object({
  topic: z.string().min(1),
  projectId: z.string().uuid().optional(),
  audience: z.string().optional()
});

const workflowTriggerPayloadSchema = z.object({
  projectId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  input: z.record(z.unknown()).default({}),
  source: z.string().default("manual")
});

const workflowStepCompletePayloadSchema = z.object({
  output: z.record(z.unknown()).default({}),
  artifacts: z.record(z.unknown()).default({}).optional(),
  notes: z.string().optional(),
  outcome: z.enum(["success", "failed"]).default("success")
});

const workflowStepApprovePayloadSchema = z.object({
  notes: z.string().optional()
});

const workflowStepRejectPayloadSchema = z.object({
  reason: z.string().min(1)
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

type TgBotRole = "employee" | "client";

interface ResolvedActor {
  userId: string | null;
  identityId: string | null;
  source: string;
  scopes: string[];
  displayName?: string | null;
}





async function handleGithubWebhook(request: Request, env: Env) {
  const event = request.headers.get("x-github-event") ?? "unknown";
  const signature = request.headers.get("x-hub-signature-256");
  const rawBody = await request.text();

  if (env.GH_WEBHOOK_SECRET) {
    const valid = await verifyGithubSignature(rawBody, signature, env.GH_WEBHOOK_SECRET);
    if (!valid) {
      return json({ ok: false, error: "invalid_signature" }, { status: 401 });
    }
  }

  let body: Record<string, any> = {};
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const senderId = body?.sender?.id ? String(body.sender.id) : null;
  const actor =
    (await resolveByIdentity(env, "github", senderId)) ?? emptyActor(`github:${event}`);

  await saveAgentRun(env, {
    agent_name: "project_ops_agent",
    trigger_source: `github:${event}`,
    status: "success",
    input_payload: body,
    output_payload: { accepted: true },
    actor
  });

  await saveAgentRun(env, {
    agent_name: "orchestrator_agent",
    trigger_source: `github:${event}`,
    status: "success",
    input_payload: { event, senderId },
    output_payload: { routedTo: "project_ops_agent", actorResolved: actor.userId !== null },
    actor
  });

  return json({ ok: true, accepted: true, event, actor: { userId: actor.userId, source: actor.source } });
}

async function handleEmployeeStart(
  env: Env,
  chatId: string,
  fromId: string,
  fromUsername?: string | null
) {
  const existing = await resolveByIdentity(env, "telegram", fromId);
  if (existing?.userId) {
    const supabase = getSupabaseAdmin(env);
    const { data: u } = await supabase.from("users").select("display_name").eq("id", existing.userId).maybeSingle();
    await sendTelegramReply(
      env,
      chatId,
      `欢迎回来 ${u?.display_name ?? ""}\n\n可用指令:\n/today — 查看今日任务\n/submit <内容> — 提交今日任务(做完后)\n/chat <内容> — 跟 mentor 对话\n/status — 活动统计\n/help — 帮助`,
      "employee"
    );
    await setTgSession(env, chatId, "employee", { stage: "idle" });
    return;
  }
  // 检查是否有等待该 telegram username 或 user_id 的邀请
  const supa = getSupabaseAdmin(env);
  const username = (fromUsername ?? "").toLowerCase();
  let invite: any = null;
  if (fromId) {
    const { data } = await supa
      .from("employee_invites")
      .select("id, telegram_username, mentor_slug")
      .eq("status", "pending")
      .eq("telegram_user_id", fromId)
      .maybeSingle();
    invite = data;
  }
  if (!invite && username) {
    const { data } = await supa
      .from("employee_invites")
      .select("id, telegram_username, mentor_slug")
      .eq("status", "pending")
      .eq("telegram_username", username)
      .maybeSingle();
    invite = data;
  }
  if (invite) {
    await setTgSession(env, chatId, "employee", {
      stage: "invite_awaiting_display_name",
      invite_id: invite.id,
      mentor_slug: invite.mentor_slug,
      telegram_user_id: fromId,
      telegram_username: username || null
    });
    await sendTelegramReply(
      env,
      chatId,
      [
        "欢迎加入 OneAgents 👋",
        "",
        `你的教官是 ${invite.mentor_slug},我会帮你把资料录进系统并自动开 15 天培训。`,
        "",
        "问题 1/3:请回复你的姓名(显示名)。"
      ].join("\n"),
      "employee"
    );
    return;
  }
  await setTgSession(env, chatId, "employee", { stage: "awaiting_email" });
  await sendTelegramReply(
    env,
    chatId,
    "欢迎加入 OneAgents\n\n我是内部助手 bot。第一步:请回复你的企业邮箱(或你注册时用的邮箱),我来把你绑到系统里。",
    "employee"
  );
}

async function handleInviteStage(
  env: Env,
  botRole: TgBotRole,
  chatId: string,
  fromId: string,
  session: any,
  text: string,
  stageKind: "display_name" | "email" | "background"
): Promise<{ handled: boolean; command?: string }> {
  const state = session?.state ?? {};
  if (stageKind === "display_name") {
    const name = text.trim();
    if (!name || name.length > 100) {
      await sendTelegramReply(env, chatId, "名字格式不对,重发一次。", botRole);
      return { handled: true, command: "invite:bad_name" };
    }
    await setTgSession(env, chatId, "employee", {
      ...state,
      stage: "invite_awaiting_email",
      display_name: name
    });
    await sendTelegramReply(
      env,
      chatId,
      `好的 ${name}!\n\n问题 2/3:你的工作邮箱?`,
      botRole
    );
    return { handled: true, command: "invite:name_ok" };
  }
  if (stageKind === "email") {
    const email = text.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await sendTelegramReply(env, chatId, "邮箱格式看起来不对,重发。", botRole);
      return { handled: true, command: "invite:bad_email" };
    }
    await setTgSession(env, chatId, "employee", {
      ...state,
      stage: "invite_awaiting_background",
      email
    });
    await sendTelegramReply(
      env,
      chatId,
      [
        "问题 3/3:用一段话介绍你的<b>技术背景</b>。",
        "",
        "例:",
        "• 用过什么语言/框架(React / Node / Python …)",
        "• 经验年限",
        "• 做过的项目类型",
        "• 擅长 vs 薄弱"
      ].join("\n"),
      botRole
    );
    return { handled: true, command: "invite:email_ok" };
  }
  if (stageKind === "background") {
    const background = text.trim();
    const supabase = getSupabaseAdmin(env);
    // 查 invite 有效性
    const { data: invite } = await supabase
      .from("employee_invites")
      .select("id, mentor_slug, status, template_slug")
      .eq("id", state.invite_id)
      .maybeSingle();
    if (!invite || invite.status !== "pending") {
      await sendTelegramReply(env, chatId, "邀请已失效,请联系 founder。", botRole);
      await clearTgSession(env, chatId);
      return { handled: true, command: "invite:expired" };
    }
    // 建 user
    const existingByEmail = await supabase
      .from("users")
      .select("id")
      .eq("email", state.email)
      .maybeSingle();
    let userId: string;
    if (existingByEmail.data) {
      userId = existingByEmail.data.id;
      await supabase
        .from("users")
        .update({ display_name: state.display_name, role: "trainee", status: "trial" })
        .eq("id", userId);
    } else {
      const { data, error } = await supabase
        .from("users")
        .insert({
          email: state.email,
          display_name: state.display_name,
          role: "trainee",
          status: "trial"
        })
        .select("id")
        .single();
      if (error) {
        await sendTelegramReply(env, chatId, `建 user 失败:${error.message}`, botRole);
        return { handled: true, command: "invite:user_insert_failed" };
      }
      userId = data.id;
    }
    // 绑 telegram identity
    await supabase.from("identity_bindings").upsert(
      {
        user_id: userId,
        provider: "telegram",
        provider_user_id: fromId,
        display_name: `${state.display_name} (telegram)`,
        verified_at: new Date().toISOString()
      },
      { onConflict: "provider,provider_user_id" }
    );
    // 记 user_profiles
    await supabase.from("user_profiles").upsert(
      {
        user_id: userId,
        experience_summary: background,
        raw_interview: background,
        last_refreshed_at: new Date().toISOString()
      },
      { onConflict: "user_id" }
    );
    // 消费 invite
    await supabase
      .from("employee_invites")
      .update({
        status: "consumed",
        consumed_at: new Date().toISOString(),
        consumed_user_id: userId,
        telegram_user_id: fromId
      })
      .eq("id", invite.id);
    // 启 15 天培训
    const actor: ResolvedActor = {
      userId,
      identityId: null,
      source: "telegram:invite_consumed",
      scopes: []
    };
    // 跳过 employee-first-day workflow(含 GW human 步会卡),直接建 program + tasks
    const templateSlug = invite.template_slug ?? "default_15_day";
    let programId: string | undefined;
    let programError: string | undefined;
    let taskCount = 0;
    try {
      const { data: tpl, error: tplErr } = await supabase
        .from("onboarding_templates")
        .select("id, duration_days")
        .eq("name", templateSlug)
        .maybeSingle();
      if (tplErr) {
        programError = `template_lookup_failed:${tplErr.message}`;
      } else if (!tpl) {
        programError = `template_not_found:${templateSlug}`;
      } else {
        const startDate = new Date();
        const endDate = new Date(startDate);
        endDate.setUTCDate(endDate.getUTCDate() + tpl.duration_days - 1);
        const { data: prog, error: progErr } = await supabase
          .from("onboarding_programs")
          .insert({
            trainee_user_id: userId,
            template_id: tpl.id,
            mentor_slug: invite.mentor_slug ?? "nina_coach",
            start_date: startDate.toISOString().slice(0, 10),
            end_date: endDate.toISOString().slice(0, 10),
            status: "active",
            summary: `invite 触发 · 模板 ${templateSlug}`
          })
          .select("id")
          .single();
        if (progErr || !prog) {
          programError = `program_insert_failed:${progErr?.message ?? "no_row_returned"}`;
        } else {
          programId = prog.id;
          const { data: templateTasks, error: tplTaskErr } = await supabase
            .from("onboarding_template_tasks")
            .select("id, day_number, phase, title, today_goal, required_tasks, required_outputs, score_focus")
            .eq("template_id", tpl.id)
            .order("day_number");
          if (tplTaskErr) {
            programError = `template_tasks_lookup_failed:${tplTaskErr.message}`;
          } else if (!templateTasks || templateTasks.length === 0) {
            programError = `template_tasks_empty:${templateSlug}`;
          } else {
            const rows = templateTasks.map((t) => {
              const due = new Date(startDate);
              due.setUTCDate(due.getUTCDate() + t.day_number - 1);
              due.setUTCHours(23, 59, 0, 0);
              return {
                program_id: prog.id,
                template_task_id: t.id,
                day_number: t.day_number,
                title: t.title,
                description: t.today_goal,
                phase: t.phase,
                today_goal: t.today_goal,
                required_tasks: t.required_tasks,
                required_outputs: t.required_outputs,
                score_focus: t.score_focus,
                status: "todo",
                due_at: due.toISOString()
              };
            });
            const { error: tasksErr } = await supabase.from("onboarding_tasks").insert(rows);
            if (tasksErr) {
              programError = `tasks_insert_failed:${tasksErr.message}`;
            } else {
              taskCount = rows.length;
            }
          }
        }
      }
    } catch (e) {
      programError = `unexpected:${e instanceof Error ? e.message : String(e)}`;
    }
    const runId: string | undefined = programId;
    const programOk = !programError && !!programId && taskCount > 0;

    await saveAgentRun(env, {
      agent_name: "onboarding_agent",
      trigger_source: "invite:consumed",
      status: programOk ? "success" : "failed",
      input_payload: {
        invite_id: invite.id,
        email: state.email,
        display_name: state.display_name,
        template_slug: templateSlug
      },
      output_payload: { userId, runId, taskCount, programError: programError ?? null },
      error_message: programError ?? undefined,
      actor
    });

    await clearTgSession(env, chatId);
    if (programOk) {
      await sendTelegramReply(
        env,
        chatId,
        [
          `✅ 已注册并开启 15 天培训`,
          `姓名:${state.display_name}`,
          `邮箱:${state.email}`,
          `教官:${invite.mentor_slug ?? "nina_coach"}`,
          ``,
          "发 /today 查看 Day 1 任务。",
          "做完后发 /submit <简述 + URL/截图> 提交。",
          "卡住发 /chat <问题> 问教官。"
        ].join("\n"),
        botRole
      );
      await sendTelegram(
        env,
        "新员工已自助注册",
        `姓名: ${state.display_name}\n邮箱: ${state.email}\n教官: ${invite.mentor_slug ?? "nina_coach"}\n模板: ${templateSlug}\ntasks: ${taskCount}\ninvite_id: ${invite.id}`
      );
    } else {
      // user 已建,但 program 没建成 — 不要假装一切正常
      await sendTelegramReply(
        env,
        chatId,
        [
          `⚠️ 账号已注册,但 15 天培训没启动成功。`,
          `原因:${programError ?? "未知"}`,
          ``,
          `已通知 founder,稍等几分钟会有人手动给你开。`,
          `期间不用做任何事。`
        ].join("\n"),
        botRole
      );
      await sendTelegram(
        env,
        "⚠️ 新员工注册了但 program 没建成",
        [
          `姓名: ${state.display_name}`,
          `邮箱: ${state.email}`,
          `教官: ${invite.mentor_slug ?? "nina_coach"}`,
          `模板: ${templateSlug}`,
          `invite_id: ${invite.id}`,
          `user_id: ${userId}`,
          `失败原因: ${programError ?? "未知"}`,
          ``,
          `补救:确认模板已 seed,然后手工调 POST /onboarding/programs/start 给该 user 建 program。`
        ].join("\n")
      );
    }
    return { handled: true, command: programOk ? "invite:completed" : "invite:program_failed" };
  }
  return { handled: false };
}

async function handleEmployeeAwaitingEmail(env: Env, chatId: string, fromId: string, text: string) {
  const email = text.trim().toLowerCase();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!emailOk) {
    await sendTelegramReply(env, chatId, "格式看起来不像邮箱,请再试一次(或 /cancel 取消)。", "employee");
    return;
  }
  const supabase = getSupabaseAdmin(env);
  const { data: user } = await supabase
    .from("users")
    .select("id, display_name, role, status")
    .eq("email", email)
    .maybeSingle();
  if (!user) {
    await sendTelegramReply(
      env,
      chatId,
      `邮箱 \`${email}\` 还没登记。请联系 superadmin 登记你的账户后再发 /start。`,
      "employee"
    );
    await setTgSession(env, chatId, "employee", { stage: "idle" });
    return;
  }
  await supabase
    .from("identity_bindings")
    .upsert(
      {
        user_id: user.id,
        provider: "telegram",
        provider_user_id: fromId,
        display_name: `${user.display_name} (telegram)`,
        verified_at: new Date().toISOString()
      },
      { onConflict: "provider,provider_user_id" }
    );
  await supabase
    .from("users")
    .update({ telegram_chat_id: chatId })
    .eq("id", user.id)
    .is("telegram_chat_id", null);

  await setTgSession(env, chatId, "employee", {
    stage: "intake_background",
    user_id: user.id
  });

  await sendTelegramReply(
    env,
    chatId,
    `✅ 已绑定到 *${user.display_name}*(${user.role})。\n\n接下来做一次 2 分钟的入职画像。回答越具体越好,mentor 后面会根据这些调整引导。\n\n*问题 1/3*:简单介绍你的**技术背景** — 用过什么语言、做过什么项目、多少年。`,
    "employee"
  );
}

async function handleEmployeeIntake(env: Env, chatId: string, session: any, text: string) {
  const stage = session.state.stage;
  const userId = session.state.user_id;
  const answers = session.state.answers ?? {};

  if (stage === "intake_background") {
    answers.background = text;
    await setTgSession(env, chatId, "employee", { ...session.state, stage: "intake_weak", answers });
    await sendTelegramReply(
      env,
      chatId,
      "*问题 2/3*:你觉得自己**最薄弱**或**最想学**的是什么?(比如:部署、排查、后端架构、英文文档…)",
      "employee"
    );
    return;
  }
  if (stage === "intake_weak") {
    answers.weak = text;
    await setTgSession(env, chatId, "employee", { ...session.state, stage: "intake_style", answers });
    await sendTelegramReply(
      env,
      chatId,
      "*问题 3/3*:你的**学习风格**更偏哪种?(例:先看文档再动手 / 先跑起来再查问题 / 跟着示例改 / 需要人手把手)",
      "employee"
    );
    return;
  }
  if (stage === "intake_style") {
    answers.style = text;
    const summary = `技术背景:${answers.background}\n薄弱/想学:${answers.weak}\n学习风格:${answers.style}`;

    // 调内部 intake 抽取
    try {
      const req = new Request("https://internal/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers: summary })
      });
      const actor: ResolvedActor = {
        userId,
        identityId: null,
        source: "telegram:intake",
        scopes: []
      };
      await handleMentorIntake(req, env, actor);
    } catch {}

    // 触发 employee-first-day 工作流
    const supabase = getSupabaseAdmin(env);
    const { data: user } = await supabase.from("users").select("email, display_name").eq("id", userId).maybeSingle();
    try {
      await supabase.from("workflow_runs"); // no-op to ensure supabase ready
      const trigger = await fetch("https://oneagents-worker.one-deploy.workers.dev/workflows/employee-first-day/trigger", {
        method: "POST",
        headers: {
          "content-type": "application/json"
          // 内部调用不带 bearer,actor 会是 anonymous;这是 acceptable
        },
        body: JSON.stringify({
          input: {
            traineeEmail: user?.email,
            startDate: new Date().toISOString().slice(0, 10),
            mentorSlug: "nina_coach"
          },
          source: "telegram:self_start"
        })
      });
      await trigger.text();
    } catch {}

    await clearTgSession(env, chatId);

    await sendTelegramReply(
      env,
      chatId,
      `✅ 画像已记录。\n\n已为你启动 15 天培训程序(mentor: *Nina*)。\n\n从明天开始每天发 \`/today\` 会看到当日任务。现在先看看 Day 1:`,
      "employee"
    );

    // 立即展示 Day 1 引导
    try {
      const actor: ResolvedActor = { userId, identityId: null, source: "telegram", scopes: [] };
      const req = new Request("https://internal/today", { method: "GET" });
      const response = await onboardingHandlers.handleOnboardingToday(req, env, actor);
      const payload = (await response.json()) as any;
      if (payload.ok && payload.active) {
        const lines: string[] = [];
        lines.push(`*Day ${payload.today_day_number}:${payload.task?.title ?? ""}*`);
        if (payload.task?.today_goal) lines.push(`目标:${payload.task.today_goal}`);
        if (payload.mentor_brief) lines.push(`\n*${payload.mentor?.name ?? "教官"}*:\n${payload.mentor_brief}`);
        await sendTelegramReply(env, chatId, lines.join("\n"), "employee");
      }
    } catch {}
    return;
  }
}

async function handleClientStart(env: Env, chatId: string, fromId: string) {
  const supabase = getSupabaseAdmin(env);
  const { data: existing } = await supabase
    .from("client_contacts")
    .select("id, client_id, name, clients(name)")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  if (existing) {
    await sendTelegramReply(
      env,
      chatId,
      `*欢迎回来 ${existing.name ?? ""}*\n\n可用指令:\n/status — 查你们项目的进度\n/message <内容> — 把消息留给我们团队\n/help — 帮助`,
      "client"
    );
    await setTgSession(env, chatId, "client", { stage: "idle" });
    return;
  }
  await setTgSession(env, chatId, "client", { stage: "awaiting_client_email" });
  await sendTelegramReply(
    env,
    chatId,
    "*Hi, welcome to One23 Client Bot*\n\n我是你们项目的沟通入口。第一步:请回复你**登记在我们系统里的邮箱**(如果不确定,请和你的项目负责人确认)。",
    "client"
  );
}

async function handleClientAwaitingEmail(env: Env, chatId: string, text: string) {
  const email = text.trim().toLowerCase();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!emailOk) {
    await sendTelegramReply(env, chatId, "格式看起来不像邮箱,请再试一次,或 /cancel。", "client");
    return;
  }
  const supabase = getSupabaseAdmin(env);
  const { data: contact } = await supabase
    .from("client_contacts")
    .select("id, client_id, name")
    .eq("email", email)
    .maybeSingle();
  if (!contact) {
    await setTgSession(env, chatId, "client", { stage: "idle" });
    await sendTelegramReply(
      env,
      chatId,
      `邮箱 \`${email}\` 还没登记到系统里。我已通知团队。在此期间你也可以直接输入诉求,我会留言给你的项目负责人。`,
      "client"
    );
    if (env.TG_DEFAULT_CHAT_ID && env.TG_BOT_TOKEN) {
      await sendTelegram(env, "未知客户联系入口", `chat_id=${chatId}, 自称邮箱=${email}`);
    }
    return;
  }
  await supabase
    .from("client_contacts")
    .update({ telegram_chat_id: chatId })
    .eq("id", contact.id);
  await setTgSession(env, chatId, "client", { stage: "idle", client_id: contact.client_id });
  await sendTelegramReply(
    env,
    chatId,
    `✅ 已绑定到 *${contact.name ?? "您"}*。\n\n可用:\n/status — 项目进度\n/message <内容> — 留言`,
    "client"
  );
}

async function handleClientMessage(env: Env, chatId: string, fromId: string, text: string) {
  const supabase = getSupabaseAdmin(env);
  const { data: contact } = await supabase
    .from("client_contacts")
    .select("id, client_id, name, clients(id, name, default_agent_slug)")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  const client = (contact as any)?.clients;
  const clientName = client?.name ?? "(未知客户)";

  // 转达到内部
  if (env.TG_DEFAULT_CHAT_ID && env.TG_BOT_TOKEN) {
    await sendTelegram(env, `客户消息(${clientName})`, `来自:${contact?.name ?? chatId}\n内容:${text}`);
  }

  // 如果客户有绑定的 persona agent,用 agent 回复
  const agentSlug = client?.default_agent_slug;
  if (agentSlug && contact) {
    const agent = await loadMentor(env, agentSlug);
    if (agent) {
      // 拉项目上下文
      const { data: projects } = await supabase
        .from("projects")
        .select("project_code, name, status, version, maintenance_mode")
        .eq("client_id", client.id)
        .limit(5);
      const projectContext = (projects ?? [])
        .map((p) => `- ${p.project_code} ${p.name} (${p.status}, ${p.version ?? ""})`)
        .join("\n");
      const sops = await getRelevantSops(env, text, 3);
      // 用 mentor_conversations 复用历史记忆(program_id=null,按 client 维度)
      const { data: pastConv } = await supabase
        .from("mentor_conversations")
        .select("role, content, created_at")
        .eq("mentor_slug", agentSlug)
        .eq("trainee_user_id", (contact as any).id) // 借用 trainee_user_id 存 contact.id 不严谨;新表更好,这里先省
        .order("created_at", { ascending: false })
        .limit(8);
      const memory = (pastConv ?? [])
        .slice()
        .reverse()
        .map((r) => `- [${r.role}] ${r.content}`)
        .join("\n") || "(无历史)";
      const prompt = renderMentorPrompt(agent.system_prompt, {
        client_name: clientName,
        project_context: projectContext || "(该客户暂无项目)",
        sops: sops.join("\n---\n"),
        memory
      });
      const t0 = Date.now();
      try {
        const reply = await aiChatComplete(env, prompt, text);
        if (reply) {
          await sendTelegramReply(env, chatId, reply, "client");
          // 记入 mentor_conversations
          await supabase.from("mentor_conversations").insert([
            {
              trainee_user_id: null, // 客户不是 trainee
              mentor_slug: agentSlug,
              role: "user",
              content: text,
              context_kind: "client_chat",
              metadata: { client_id: client.id, contact_id: contact.id, chat_id: chatId }
            },
            {
              trainee_user_id: null,
              mentor_slug: agentSlug,
              role: "mentor",
              content: reply,
              context_kind: "client_chat",
              model_used: env.AI_GATEWAY_API_KEY
                ? "gateway:anthropic/claude-haiku-4-5"
                : "openai:gpt-4o-mini",
              latency_ms: Date.now() - t0,
              metadata: { client_id: client.id, contact_id: contact.id, chat_id: chatId }
            }
          ]);
          await saveAgentRun(env, {
            agent_name: agentSlug,
            trigger_source: "telegram_client:ai_reply",
            status: "success",
            input_payload: { chat_id: chatId, from_id: fromId, text, client_id: client.id },
            output_payload: { reply_length: reply.length }
          });
          return;
        }
      } catch (e) {
        // fallthrough to plain ack
      }
    }
  }

  await saveAgentRun(env, {
    agent_name: "orchestrator_agent",
    trigger_source: "telegram_client:message",
    status: "success",
    input_payload: { chat_id: chatId, from_id: fromId, text, client_id: contact?.client_id ?? null },
    output_payload: { forwarded: true }
  });
  await sendTelegramReply(env, chatId, "✅ 已转达给你的项目负责人。", "client");
}

async function handleClientNewNeed(env: Env, chatId: string, fromId: string, text: string) {
  const supabase = getSupabaseAdmin(env);
  const { data: contact } = await supabase
    .from("client_contacts")
    .select("id, client_id, name, clients(id, name)")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  if (!contact) {
    await sendTelegramReply(env, chatId, "请先 /start 绑定客户身份。", "client");
    return;
  }
  // 找该客户名下最接近的一个活跃项目
  const { data: projects } = await supabase
    .from("projects")
    .select("id, project_code, name, status")
    .eq("client_id", contact.client_id)
    .eq("status", "active")
    .limit(1);
  const proj = projects?.[0];
  if (!proj) {
    await sendTelegramReply(
      env,
      chatId,
      "没找到你的活跃项目。请先跟我们开 kickoff 会议建项目,或直接留言说明。",
      "client"
    );
    return;
  }
  // 让 LLM 把需求转成任务候选
  const system =
    "你是一个需求转任务的整理器。输入是客户用自然语言描述的需求。输出 JSON: " +
    '{"title":"不超过 80 字","description":"2-3 句说明 + 成功标准","priority":1-5,"urgency":"high|normal|low"}。' +
    "只输出 JSON。不要评论。";
  let draft: { title: string; description?: string; priority?: number; urgency?: string } | null = null;
  try {
    const raw = await aiChatComplete(env, system, text);
    const m = raw?.match(/\{[\s\S]*\}/);
    if (m) draft = JSON.parse(m[0]);
  } catch {}
  if (!draft?.title) {
    // 兜底:原文作标题
    draft = { title: text.slice(0, 80), description: text, priority: 3, urgency: "normal" };
  }
  const priorityMap = { high: 1, normal: 3, low: 4 } as Record<string, number>;
  const priority = draft.priority ?? (draft.urgency ? priorityMap[draft.urgency] ?? 3 : 3);
  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      project_id: proj.id,
      title: draft.title,
      description: draft.description ?? text,
      status: "todo",
      priority,
      source_type: "agent",
      track: "branch",
      version_target: null,
      created_by_agent: true,
      agent_name: "orchestrator_agent",
      source_channel: "telegram_client:new_need",
      needs_human_review: true
    })
    .select("id, title")
    .single();
  if (error) {
    await sendTelegramReply(env, chatId, `记录失败:${error.message}`, "client");
    return;
  }
  await saveAgentRun(env, {
    agent_name: "orchestrator_agent",
    trigger_source: "telegram_client:new_need",
    status: "success",
    project_id: proj.id,
    input_payload: { chat_id: chatId, from_id: fromId, text, draft },
    output_payload: { taskId: task.id }
  });
  if (env.TG_DEFAULT_CHAT_ID && env.TG_BOT_TOKEN) {
    await sendTelegram(
      env,
      `🆕 客户新需求 — ${(contact as any).clients?.name ?? ""}`,
      `联系人: ${contact.name ?? chatId}\n项目: ${proj.name} (${proj.project_code})\n\n标题: ${task.title}\n优先级: ${priority}\n\n原文: ${text}\n\nTask ID: ${task.id}(待团队排期)`
    );
  }
  await sendTelegramReply(
    env,
    chatId,
    [
      "✅ 需求已录入,团队会尽快安排。",
      "",
      `<b>我理解为</b>:${draft.title}`,
      draft.description ? `<b>细节</b>:${draft.description}` : null,
      `<b>优先级</b>:${priority === 1 ? "高" : priority === 3 ? "正常" : "低"}`,
      "",
      "排好期后我会回来告诉你时间表。"
    ]
      .filter(Boolean)
      .join("\n"),
    "client"
  );
}

async function handleClientProgress(env: Env, chatId: string) {
  const supabase = getSupabaseAdmin(env);
  const { data: contact } = await supabase
    .from("client_contacts")
    .select("client_id, clients(name)")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  if (!contact) {
    await sendTelegramReply(env, chatId, "请先 /start 绑定。", "client");
    return;
  }
  const { data: projects } = await supabase
    .from("projects")
    .select("id, project_code, name, status, version, target_date")
    .eq("client_id", contact.client_id);
  if (!projects || projects.length === 0) {
    await sendTelegramReply(env, chatId, "你们暂无项目登记。", "client");
    return;
  }
  const lines: string[] = [`<b>${(contact as any).clients?.name ?? "你们"}的项目进度</b>`, ""];
  for (const p of projects) {
    const [{ data: tasks }, { data: meetings }] = await Promise.all([
      supabase.from("tasks").select("status").eq("project_id", p.id),
      supabase
        .from("meetings")
        .select("title, happened_at")
        .eq("project_id", p.id)
        .order("happened_at", { ascending: false })
        .limit(2)
    ]);
    const counts: Record<string, number> = {};
    for (const t of tasks ?? []) counts[t.status] = (counts[t.status] ?? 0) + 1;
    const done = counts["done"] ?? 0;
    const total = (tasks ?? []).length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    lines.push(`📂 <b>${p.name}</b> (${p.project_code}) · ${p.status}${p.version ? ` · ${p.version}` : ""}`);
    lines.push(`   进度: ${done}/${total} 完成 (${pct}%) · ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ")}`);
    if (p.target_date) lines.push(`   目标日期: ${p.target_date}`);
    if ((meetings ?? []).length > 0) {
      lines.push(`   最近会议:`);
      for (const m of meetings!) {
        lines.push(`   - ${m.title} (${String(m.happened_at).slice(0, 10)})`);
      }
    }
    lines.push("");
  }
  lines.push("发 /newneed &lt;需求&gt; 提新需求;或直接说话我来整理。");
  await sendTelegramReply(env, chatId, lines.join("\n"), "client");
}

async function loadTelegramGroup(env: Env, chatId: string) {
  const supabase = getSupabaseAdmin(env);
  const { data } = await supabase
    .from("telegram_groups")
    .select("chat_id, bot_role, title, client_id, project_id, is_active, config")
    .eq("chat_id", chatId)
    .maybeSingle();
  return data;
}

async function handleGroupBindOrg(
  env: Env,
  botRole: TgBotRole,
  chatId: string,
  chatTitle: string,
  fromTgUserId: string,
  argText: string
) {
  const actor = await resolveByIdentity(env, "telegram", fromTgUserId);
  if (!actor?.userId) {
    await sendTelegramReply(env, chatId, "先在私聊 /start 绑定你的内部身份。", botRole);
    return;
  }
  const supabase = getSupabaseAdmin(env);
  const { data: user } = await supabase.from("users").select("role").eq("id", actor.userId).maybeSingle();
  if (!user || !["founder", "member"].includes(user.role)) {
    await sendTelegramReply(env, chatId, "需要内部员工身份。", botRole);
    return;
  }
  if (!argText.trim()) {
    await sendTelegramReply(env, chatId, "用法:/bind_org <org-slug 或 org-name>", botRole);
    return;
  }
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug")
    .or(`slug.eq.${argText.trim()},name.eq.${argText.trim()}`)
    .maybeSingle();
  if (!org) {
    await sendTelegramReply(env, chatId, `找不到 org \`${argText.trim()}\`。`, botRole);
    return;
  }
  await supabase.from("telegram_groups").upsert(
    {
      chat_id: chatId,
      bot_role: botRole,
      title: chatTitle,
      organization_id: org.id,
      client_id: null,
      project_id: null,
      bound_by_user_id: actor.userId,
      bound_at: new Date().toISOString(),
      is_active: true
    },
    { onConflict: "chat_id" }
  );
  await sendTelegramReply(
    env,
    chatId,
    `✅ 本群已绑到集团 ${org.name}(slug ${org.slug})\n\n集团级群指令:\n/status — 集团下所有公司和项目\n/projects — 列项目\n/focus <project-code> — 聚焦到某项目\n/task 和 /meeting_start 需要先 focus`,
    botRole
  );
}

async function handleGroupBindClient(
  env: Env,
  botRole: TgBotRole,
  chatId: string,
  chatTitle: string,
  fromTgUserId: string,
  argText: string
) {
  const actor = await resolveByIdentity(env, "telegram", fromTgUserId);
  if (!actor?.userId) {
    await sendTelegramReply(env, chatId, "先在私聊 /start 绑定你的内部身份。", botRole);
    return;
  }
  const supabase = getSupabaseAdmin(env);
  const { data: user } = await supabase.from("users").select("role").eq("id", actor.userId).maybeSingle();
  if (!user || !["founder", "member"].includes(user.role)) {
    await sendTelegramReply(env, chatId, "需要内部员工身份。", botRole);
    return;
  }
  if (!argText.trim()) {
    await sendTelegramReply(env, chatId, "用法:/bind_client <client name>", botRole);
    return;
  }
  const { data: client } = await supabase
    .from("clients")
    .select("id, name, organization_id")
    .eq("name", argText.trim())
    .maybeSingle();
  if (!client) {
    await sendTelegramReply(env, chatId, `找不到 client \`${argText.trim()}\`。`, botRole);
    return;
  }
  await supabase.from("telegram_groups").upsert(
    {
      chat_id: chatId,
      bot_role: botRole,
      title: chatTitle,
      organization_id: client.organization_id,
      client_id: client.id,
      project_id: null,
      bound_by_user_id: actor.userId,
      bound_at: new Date().toISOString(),
      is_active: true
    },
    { onConflict: "chat_id" }
  );
  await sendTelegramReply(
    env,
    chatId,
    `✅ 本群已绑到公司 ${client.name}\n\n/status 看该公司所有项目\n/projects 列项目\n/focus <project-code> 后再 /task 或 /meeting_start`,
    botRole
  );
}

async function handleGroupFocus(
  env: Env,
  botRole: TgBotRole,
  chatId: string,
  argText: string
) {
  const group = await loadTelegramGroup(env, chatId);
  if (!group) {
    await sendTelegramReply(env, chatId, "群未绑定,先 /bind_org 或 /bind_client 或 /bind_project。", botRole);
    return;
  }
  if (!argText.trim()) {
    await sendTelegramReply(env, chatId, "用法:/focus <project-code>", botRole);
    return;
  }
  const supabase = getSupabaseAdmin(env);
  let projectQuery = supabase
    .from("projects")
    .select("id, name, client_id")
    .eq("project_code", argText.trim());
  if (group.client_id) projectQuery = projectQuery.eq("client_id", group.client_id);
  const { data: project } = await projectQuery.maybeSingle();
  if (!project) {
    await sendTelegramReply(env, chatId, `找不到项目 \`${argText.trim()}\`(或不在本群绑定的公司/集团下)。`, botRole);
    return;
  }
  await supabase
    .from("telegram_groups")
    .update({ project_id: project.id, updated_at: new Date().toISOString() })
    .eq("chat_id", chatId);
  await sendTelegramReply(
    env,
    chatId,
    `🎯 已聚焦到项目 *${project.name}*。后续 /task /meeting_start 都作用于这个项目,直到再 /focus 或 /unfocus。`,
    botRole
  );
}

async function handleGroupUnfocus(env: Env, botRole: TgBotRole, chatId: string) {
  const supabase = getSupabaseAdmin(env);
  await supabase.from("telegram_groups").update({ project_id: null }).eq("chat_id", chatId);
  await sendTelegramReply(env, chatId, "已取消项目聚焦。", botRole);
}

async function handleGroupListProjects(env: Env, botRole: TgBotRole, chatId: string) {
  const group = await loadTelegramGroup(env, chatId);
  if (!group) {
    await sendTelegramReply(env, chatId, "群未绑定。", botRole);
    return;
  }
  const supabase = getSupabaseAdmin(env);
  let query = supabase
    .from("projects")
    .select("project_code, name, status, version, maintenance_mode")
    .order("project_code");
  if (group.project_id) query = query.eq("id", group.project_id);
  else if (group.client_id) query = query.eq("client_id", group.client_id);
  else if (group.organization_id) {
    const { data: cs } = await supabase
      .from("clients")
      .select("id")
      .eq("organization_id", group.organization_id);
    const ids = (cs ?? []).map((c) => c.id);
    if (ids.length === 0) {
      await sendTelegramReply(env, chatId, "该集团下暂无客户/项目。", botRole);
      return;
    }
    query = query.in("client_id", ids);
  }
  const { data: ps } = await query;
  const lines: string[] = ["*本群范围内的项目*"];
  for (const p of ps ?? []) {
    const tag = [p.version, p.maintenance_mode ? "maint" : null].filter(Boolean).join(" ");
    lines.push(`- \`${p.project_code}\` — ${p.name} (${p.status}${tag ? ` · ${tag}` : ""})`);
  }
  if ((ps ?? []).length === 0) lines.push("(空)");
  lines.push("\n/focus <project-code> 聚焦后再用 /task /meeting_start");
  await sendTelegramReply(env, chatId, lines.join("\n"), botRole);
}

async function handleGroupBindProject(
  env: Env,
  botRole: TgBotRole,
  chatId: string,
  chatTitle: string,
  fromTgUserId: string,
  argText: string
) {
  const actor = await resolveByIdentity(env, "telegram", fromTgUserId);
  if (!actor?.userId) {
    await sendTelegramReply(env, chatId, "未绑定的身份,不能操作。先在私聊里 /start 绑定你的账号。", botRole);
    return;
  }
  const supabase = getSupabaseAdmin(env);
  const { data: user } = await supabase.from("users").select("role").eq("id", actor.userId).maybeSingle();
  if (!user || !["founder", "member"].includes(user.role)) {
    await sendTelegramReply(env, chatId, "需要内部员工身份才能绑定群。", botRole);
    return;
  }
  const projectCode = argText.trim();
  if (!projectCode) {
    await sendTelegramReply(env, chatId, "用法:/bind_project <project-code>", botRole);
    return;
  }
  const { data: proj } = await supabase
    .from("projects")
    .select("id, name, client_id, clients!inner(organization_id)")
    .eq("project_code", projectCode)
    .maybeSingle();
  if (!proj) {
    await sendTelegramReply(env, chatId, `找不到项目代码 \`${projectCode}\`。`, botRole);
    return;
  }
  const orgId = (proj as any).clients?.organization_id ?? null;
  await supabase.from("telegram_groups").upsert(
    {
      chat_id: chatId,
      bot_role: botRole,
      title: chatTitle,
      organization_id: orgId,
      client_id: proj.client_id,
      project_id: proj.id,
      bound_by_user_id: actor.userId,
      bound_at: new Date().toISOString(),
      is_active: true
    },
    { onConflict: "chat_id" }
  );
  await sendTelegramReply(
    env,
    chatId,
    `✅ 本群已绑定到项目 *${proj.name}* (\`${projectCode}\`)。\n\n群指令:\n/meeting_start <标题>\n/meeting_end\n/task <描述>\n/status\n/unbind(解除)`,
    botRole
  );
}

async function handleGroupUnbind(env: Env, botRole: TgBotRole, chatId: string, fromTgUserId: string) {
  const actor = await resolveByIdentity(env, "telegram", fromTgUserId);
  if (!actor?.userId) {
    await sendTelegramReply(env, chatId, "未绑定身份,无法操作。", botRole);
    return;
  }
  const supabase = getSupabaseAdmin(env);
  await supabase.from("telegram_groups").update({ is_active: false }).eq("chat_id", chatId);
  await sendTelegramReply(env, chatId, "已解除绑定,群里所有触发动作暂停。", botRole);
}

async function handleGroupMeetingStart(
  env: Env,
  botRole: TgBotRole,
  chatId: string,
  fromTgUserId: string,
  title: string
) {
  const group = await loadTelegramGroup(env, chatId);
  if (!group || !group.is_active || !group.project_id) {
    await sendTelegramReply(env, chatId, "群还没绑项目。请先 /bind_project <code>。", botRole);
    return;
  }
  const actor = await resolveByIdentity(env, "telegram", fromTgUserId);
  const supabase = getSupabaseAdmin(env);
  const { data: existing } = await supabase
    .from("telegram_meeting_buffers")
    .select("id")
    .eq("chat_id", chatId)
    .eq("status", "active")
    .maybeSingle();
  if (existing) {
    await sendTelegramReply(env, chatId, "已经有一个进行中的会议。先 /meeting_end 再开新的。", botRole);
    return;
  }
  const { data: buf, error } = await supabase
    .from("telegram_meeting_buffers")
    .insert({
      chat_id: chatId,
      title: title || `Group meeting @ ${new Date().toISOString().slice(0, 16)}`,
      started_by_user_id: actor?.userId ?? null,
      started_by_tg_user_id: fromTgUserId,
      status: "active"
    })
    .select("id, title")
    .single();
  if (error) {
    await sendTelegramReply(env, chatId, `开会失败:${error.message}`, botRole);
    return;
  }
  await sendTelegramReply(
    env,
    chatId,
    `🎙 *会议已开始*:${buf.title}\n\n后面的**所有非命令消息**会被我记录下来,结束时发 /meeting_end 我自动整理入库。`,
    botRole
  );
}

async function appendToActiveBuffer(
  env: Env,
  chatId: string,
  speakerName: string | null,
  content: string
) {
  const supabase = getSupabaseAdmin(env);
  const { data: buf } = await supabase
    .from("telegram_meeting_buffers")
    .select("id, transcript, message_count")
    .eq("chat_id", chatId)
    .eq("status", "active")
    .maybeSingle();
  if (!buf) return false;
  const line = `${speakerName ? `[${speakerName}] ` : ""}${content}`;
  const updatedTranscript = buf.transcript ? `${buf.transcript}\n${line}` : line;
  await supabase
    .from("telegram_meeting_buffers")
    .update({
      transcript: updatedTranscript,
      message_count: buf.message_count + 1
    })
    .eq("id", buf.id);
  return true;
}

async function handleGroupMeetingEnd(env: Env, botRole: TgBotRole, chatId: string, fromTgUserId: string) {
  const group = await loadTelegramGroup(env, chatId);
  if (!group) {
    await sendTelegramReply(env, chatId, "群未绑定,无法结束会议。", botRole);
    return;
  }
  const supabase = getSupabaseAdmin(env);
  const { data: buf } = await supabase
    .from("telegram_meeting_buffers")
    .select("id, title, transcript, message_count, started_at")
    .eq("chat_id", chatId)
    .eq("status", "active")
    .maybeSingle();
  if (!buf) {
    await sendTelegramReply(env, chatId, "当前没有进行中的会议。", botRole);
    return;
  }
  if (!buf.transcript || buf.transcript.trim().length === 0) {
    await supabase
      .from("telegram_meeting_buffers")
      .update({ status: "discarded", ended_at: new Date().toISOString() })
      .eq("id", buf.id);
    await sendTelegramReply(
      env,
      chatId,
      [
        "⚠️ 会议结束,但**没收到任何聊天内容**,已丢弃。",
        "",
        "最常见原因:bot 在群里开了 *Privacy Mode*,看不到非命令消息。",
        "修法:`@BotFather` → `/mybots` → 选本 bot → `Bot Settings` → `Group Privacy` → **Turn off**。",
        "改完后**把 bot 从群里踢出再重新加**(老群不会自动生效)。",
        "再 `/meeting_start` 试一遍即可。"
      ].join("\n"),
      botRole
    );
    return;
  }

  const { data: meeting, error } = await supabase
    .from("meetings")
    .insert({
      project_id: group.project_id,
      title: buf.title,
      raw_transcript: buf.transcript,
      source_channel: `telegram:${botRole}:group`,
      source_uri: `tg://chat/${chatId}`,
      happened_at: buf.started_at,
      created_by_agent: true,
      agent_name: "meeting_agent",
      needs_human_review: true,
      summary: "待模型整理",
      decisions: "待抽取",
      open_questions: "待抽取"
    })
    .select("id, title")
    .single();

  if (error) {
    await sendTelegramReply(env, chatId, `入库失败:${error.message}`, botRole);
    return;
  }

  await supabase
    .from("telegram_meeting_buffers")
    .update({
      status: "ended",
      ended_at: new Date().toISOString(),
      meeting_id: meeting.id
    })
    .eq("id", buf.id);

  const actor = await resolveByIdentity(env, "telegram", fromTgUserId);
  await saveAgentRun(env, {
    agent_name: "meeting_agent",
    trigger_source: "telegram:group_meeting",
    status: "success",
    project_id: group.project_id,
    input_payload: { chat_id: chatId, buffer_id: buf.id, message_count: buf.message_count },
    output_payload: { meetingId: meeting.id },
    actor: actor ?? undefined
  });

  await sendTelegramReply(
    env,
    chatId,
    `✅ 会议已入库\n标题:${meeting.title}\nID:\`${meeting.id}\`\n共 ${buf.message_count} 条消息\n状态:待人工复核`,
    botRole
  );
}

async function handleGroupCreateTask(
  env: Env,
  botRole: TgBotRole,
  chatId: string,
  fromTgUserId: string,
  description: string
) {
  const group = await loadTelegramGroup(env, chatId);
  if (!group || !group.project_id) {
    await sendTelegramReply(env, chatId, "群还没绑项目。先 /bind_project <code>。", botRole);
    return;
  }
  if (!description.trim()) {
    await sendTelegramReply(env, chatId, "用法:/task <描述>", botRole);
    return;
  }
  const actor = await resolveByIdentity(env, "telegram", fromTgUserId);
  const supabase = getSupabaseAdmin(env);
  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      project_id: group.project_id,
      title: description.trim().slice(0, 200),
      description: description.trim(),
      status: "todo",
      source_type: "agent",
      reporter_user_id: actor?.userId ?? null,
      created_by_agent: true,
      agent_name: "project_ops_agent",
      source_channel: "telegram:group",
      needs_human_review: true
    })
    .select("id, title")
    .single();
  if (error) {
    await sendTelegramReply(env, chatId, `建任务失败:${error.message}`, botRole);
    return;
  }
  await saveAgentRun(env, {
    agent_name: "project_ops_agent",
    trigger_source: "telegram:group_task",
    status: "success",
    project_id: group.project_id,
    input_payload: { chat_id: chatId, description },
    output_payload: { taskId: task.id },
    actor: actor ?? undefined
  });
  await sendTelegramReply(env, chatId, `✅ 任务已建\n\`${task.id}\`\n${task.title}`, botRole);
}

async function handleGroupStatus(env: Env, botRole: TgBotRole, chatId: string) {
  const group = await loadTelegramGroup(env, chatId);
  if (!group) {
    await sendTelegramReply(env, chatId, "群未绑定。先 /bind_org 或 /bind_client 或 /bind_project。", botRole);
    return;
  }
  const supabase = getSupabaseAdmin(env);

  if (group.project_id) {
    const [{ data: proj }, { data: tasks }, { data: recentMeetings }] = await Promise.all([
      supabase.from("projects").select("name, status, target_date, version").eq("id", group.project_id).maybeSingle(),
      supabase.from("tasks").select("status").eq("project_id", group.project_id),
      supabase
        .from("meetings")
        .select("title, happened_at")
        .eq("project_id", group.project_id)
        .order("happened_at", { ascending: false })
        .limit(3)
    ]);
    const counts: Record<string, number> = {};
    for (const t of tasks ?? []) counts[t.status] = (counts[t.status] ?? 0) + 1;
    const lines: string[] = [];
    lines.push(`*${proj?.name ?? "项目"}* ${proj?.version ?? ""} — ${proj?.status ?? "?"}${proj?.target_date ? ` · 目标 ${proj.target_date}` : ""}`);
    lines.push(`任务:${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join("  ") || "(空)"}`);
    if ((recentMeetings ?? []).length > 0) {
      lines.push("最近会议:");
      for (const m of recentMeetings!) lines.push(`- ${m.title} (${String(m.happened_at).slice(0, 10)})`);
    }
    await sendTelegramReply(env, chatId, lines.join("\n"), botRole);
    return;
  }

  if (group.client_id) {
    const [{ data: client }, { data: projects }] = await Promise.all([
      supabase.from("clients").select("name, status, billing_currency").eq("id", group.client_id).maybeSingle(),
      supabase
        .from("projects")
        .select("project_code, name, status, version, maintenance_mode")
        .eq("client_id", group.client_id)
        .order("project_code")
    ]);
    const lines: string[] = [];
    lines.push(`*${client?.name ?? "客户"}* — ${client?.status ?? "?"} · ${client?.billing_currency ?? ""}`);
    lines.push(`项目(${projects?.length ?? 0}):`);
    for (const p of projects ?? []) {
      const tag = [p.version, p.maintenance_mode ? "维护中" : null].filter(Boolean).join(" · ");
      lines.push(`- \`${p.project_code}\` ${p.name} (${p.status}${tag ? ` · ${tag}` : ""})`);
    }
    lines.push("\n/focus <project-code> 聚焦一个项目再 /task");
    await sendTelegramReply(env, chatId, lines.join("\n"), botRole);
    return;
  }

  if (group.organization_id) {
    const [{ data: org }, { data: clients }] = await Promise.all([
      supabase.from("organizations").select("name").eq("id", group.organization_id).maybeSingle(),
      supabase
        .from("clients")
        .select("id, name, status")
        .eq("organization_id", group.organization_id)
    ]);
    const lines: string[] = [];
    lines.push(`*集团 ${org?.name ?? ""}*`);
    lines.push(`公司(${clients?.length ?? 0}):`);
    for (const c of clients ?? []) {
      const { data: ps } = await supabase
        .from("projects")
        .select("project_code, name, status")
        .eq("client_id", c.id);
      lines.push(`\n• *${c.name}* (${c.status}) — 项目 ${(ps ?? []).length}`);
      for (const p of ps ?? []) lines.push(`  - \`${p.project_code}\` ${p.name} (${p.status})`);
    }
    lines.push("\n/focus <project-code> 聚焦一个项目");
    await sendTelegramReply(env, chatId, lines.join("\n"), botRole);
    return;
  }

  await sendTelegramReply(env, chatId, "群没绑定到任何层级。", botRole);
}

async function handleGroupHelp(env: Env, botRole: TgBotRole, chatId: string) {
  await sendTelegramReply(
    env,
    chatId,
    [
      "*群组可用指令*",
      "",
      "*绑定(需内部员工)*",
      "/bind_org <slug|name> — 绑到集团(跨多公司)",
      "/bind_client <name> — 绑到公司(跨多项目)",
      "/bind_project <code> — 绑到单项目",
      "/unbind — 解除",
      "",
      "*项目聚焦(跨项目群使用前必须 focus)*",
      "/projects — 列当前范围内项目",
      "/focus <code> — 聚焦到某项目",
      "/unfocus — 取消聚焦",
      "",
      "*动作*",
      "/meeting_start <标题> — 开始会议记录",
      "/meeting_end — 结束并入库(需已 focus 项目)",
      "/task <描述> — 建任务(需已 focus 项目)",
      "/status — 按绑定层级返回(集团/公司/项目)",
      "/help — 本帮助"
    ].join("\n"),
    botRole
  );
}

async function getActiveHumanStepsForRun(
  env: Env,
  runId: string
): Promise<Array<{ id: string; step_key: string; step_name: string }>> {
  const supabase = getSupabaseAdmin(env);
  const { data } = await supabase
    .from("workflow_step_runs")
    .select("id, step_key, workflow_steps!inner(name, executor_kind)")
    .eq("run_id", runId)
    .in("status", ["running", "awaiting_approval"]);
  const rows: Array<{ id: string; step_key: string; step_name: string }> = [];
  for (const r of data ?? []) {
    const step = (r as any).workflow_steps;
    if (step?.executor_kind === "human") {
      rows.push({ id: r.id, step_key: r.step_key, step_name: step.name });
    }
  }
  return rows;
}

async function completeStepRunById(
  env: Env,
  stepRunId: string,
  actor: ResolvedActor,
  outcome: "success" | "failed" = "success"
): Promise<{ ok: boolean; runId?: string; stepKey?: string; error?: string }> {
  const supabase = getSupabaseAdmin(env);
  const { data: sr } = await supabase
    .from("workflow_step_runs")
    .select("id, run_id, step_key, status, step_id")
    .eq("id", stepRunId)
    .maybeSingle();
  if (!sr) return { ok: false, error: "not_found" };
  if (sr.status !== "running" && sr.status !== "pending") {
    return { ok: false, error: `state:${sr.status}` };
  }
  const { data: step } = await supabase
    .from("workflow_steps")
    .select("requires_approval")
    .eq("id", sr.step_id)
    .maybeSingle();
  const newStatus =
    outcome === "failed"
      ? "failed"
      : step?.requires_approval
      ? "awaiting_approval"
      : "completed";
  await supabase
    .from("workflow_step_runs")
    .update({
      status: newStatus,
      completed_at: newStatus === "completed" ? new Date().toISOString() : null,
      assigned_user_id: actor.userId ?? null
    })
    .eq("id", sr.id);
  if (newStatus === "completed") await advanceWorkflow(env, sr.run_id, actor);
  return { ok: true, runId: sr.run_id, stepKey: sr.step_key };
}

async function runSimEmployee(env: Env, actor: ResolvedActor, arg: string): Promise<string> {
  const supabase = getSupabaseAdmin(env);
  const stamp = Date.now().toString(36);
  const email = arg && /@/.test(arg) ? arg.toLowerCase() : `sim-employee-${stamp}@demo.local`;
  const displayName = arg && !/@/.test(arg) ? arg : `Sim Employee ${stamp}`;
  const { data: user, error: userErr } = await supabase
    .from("users")
    .upsert({ email, display_name: displayName, role: "trainee", status: "trial" }, { onConflict: "email" })
    .select("id, email, display_name")
    .single();
  if (userErr) return `❌ 建 user 失败:${userErr.message}`;
  const today = new Date().toISOString().slice(0, 10);
  const req = new Request("https://internal/trigger", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      input: { traineeEmail: user.email, startDate: today, mentorSlug: "nina_coach" },
      source: `sim:admin:${actor.userId}`
    })
  });
  const res = await workflowHandlers.handleWorkflowTrigger(req, env, actor, "employee-first-day");
  const trig = (await res.json()) as any;
  await saveAgentRun(env, {
    agent_name: "orchestrator_agent",
    trigger_source: "sim:employee",
    status: "success",
    input_payload: { email, displayName },
    output_payload: { userId: user.id, runId: trig.runId },
    actor
  });
  return [
    `🧪 sim_employee 已启动`,
    `user: ${user.display_name} (${user.email})`,
    `workflow run: ${trig.runId ?? "?"}`
  ].join("\n");
}

async function runSimClient(env: Env, actor: ResolvedActor, arg: string): Promise<string> {
  const supabase = getSupabaseAdmin(env);
  const stamp = Date.now().toString(36);
  const clientName = arg || `Sim Client ${stamp}`;
  const contactEmail = `sim-contact-${stamp}@demo.local`;
  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .insert({
      name: clientName,
      contact_name: "Sim Jane",
      contact_channel: `email:${contactEmail}`,
      billing_currency: "USD",
      status: "lead",
      notes: "simulated via /sim_client"
    })
    .select("id, name")
    .single();
  if (clientErr) return `❌ 建 client 失败:${clientErr.message}`;
  await supabase.from("client_contacts").insert({
    client_id: client.id,
    name: "Sim Jane",
    email: contactEmail,
    role_at_client: "PM",
    is_primary: true
  });
  const req = new Request("https://internal/trigger", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientId: client.id,
      input: {
        clientId: client.id,
        name: `${clientName} Site`,
        projectCode: `sim-${stamp}-site`,
        projectType: "web",
        deliveryModel: "fixed"
      },
      source: `sim:admin:${actor.userId}`
    })
  });
  const res = await workflowHandlers.handleWorkflowTrigger(req, env, actor, "new-client-intake");
  const trig = (await res.json()) as any;
  await saveAgentRun(env, {
    agent_name: "orchestrator_agent",
    trigger_source: "sim:client",
    status: "success",
    input_payload: { clientName, contactEmail },
    output_payload: { clientId: client.id, contactEmail, runId: trig.runId },
    actor
  });
  return [
    `*🧪 sim_client 已启动*`,
    `client: ${client.name}`,
    `client_id: \`${client.id}\``,
    `contact_email(客户 bot /start 用): \`${contactEmail}\``,
    `workflow run: \`${trig.runId ?? "?"}\``
  ].join("\n");
}

async function runSimOrg(env: Env, actor: ResolvedActor): Promise<string> {
  const supabase = getSupabaseAdmin(env);
  const stamp = Date.now().toString(36);
  const orgName = `Sim Org ${stamp}`;
  const { data: org, error: orgErr } = await supabase
    .from("organizations")
    .insert({ name: orgName, slug: `sim-org-${stamp}`, admin_email: `sim-org-${stamp}@demo.local` })
    .select("id, name")
    .single();
  if (orgErr) return `❌ 建 org 失败:${orgErr.message}`;
  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .insert({
      name: `Sim Client ${stamp}`,
      contact_channel: `email:sim-contact-${stamp}@demo.local`,
      billing_currency: "USDT",
      status: "active",
      organization_id: org.id
    })
    .select("id, name")
    .single();
  if (clientErr) return `❌ 建 client 失败:${clientErr.message}`;
  await supabase.from("client_contacts").insert({
    client_id: client.id,
    name: "Sim Admin",
    email: `sim-contact-${stamp}@demo.local`,
    role_at_client: "admin",
    is_primary: true
  });
  const projectCode = `sim-proj-${stamp}`;
  const { data: project } = await supabase
    .from("projects")
    .insert({
      client_id: client.id,
      name: `Sim Project ${stamp}`,
      project_code: projectCode,
      type: "web",
      status: "planning",
      delivery_model: "fixed",
      risk_level: "low",
      version: "v1",
      summary: "simulated via /sim_org"
    })
    .select("id, project_code")
    .single();
  await saveAgentRun(env, {
    agent_name: "orchestrator_agent",
    trigger_source: "sim:org",
    status: "success",
    output_payload: { orgId: org.id, clientId: client.id, projectId: project?.id },
    actor
  });
  return [
    `*🧪 sim_org 已建立*`,
    `org: ${orgName}`,
    `client: ${client.name}`,
    `project: ${projectCode}`,
    "",
    "接下来可以试:在测试群里 /bind_org " + `sim-org-${stamp}`
  ].join("\n");
}

interface ClientIntakeDraft {
  organization?: { name?: string; slug?: string; adminEmail?: string; description?: string };
  client?: { name: string; billingCurrency?: string; status?: string; notes?: string };
  primaryContact?: { name?: string; email: string; roleAtClient?: string };
  additionalContacts?: Array<{ name?: string; email: string; roleAtClient?: string }>;
  project?: {
    name: string;
    projectCode: string;
    projectType?: string;
    deliveryModel?: string;
    riskLevel?: string;
    version?: string;
    summary?: string;
  };
}

async function extractClientIntakeFromText(
  env: Env,
  text: string
): Promise<{ draft: ClientIntakeDraft | null; rawLlm: string | null; error?: string }> {
  const system = `你是一个结构化信息抽取器,把用户用自然语言描述的新客户信息,抽成 JSON。
只输出一个 JSON,不要任何解释。缺失字段留空或省略。

JSON schema:
{
  "organization": { "name": "", "slug": "", "adminEmail": "", "description": "" },
  "client": { "name": "", "billingCurrency": "", "status": "lead|active", "notes": "" },
  "primaryContact": { "name": "", "email": "", "roleAtClient": "" },
  "additionalContacts": [ { "name": "", "email": "", "roleAtClient": "" } ],
  "project": {
    "name": "",
    "projectCode": "",
    "projectType": "web|automation|ops|ai|maintenance",
    "deliveryModel": "fixed|retainer|hourly",
    "riskLevel": "low|medium|high",
    "version": "v1",
    "summary": ""
  }
}

规则:
- organization 只有当用户明说"集团/holdings/group"或提到多家关联公司时才填;普通单公司客户就省略 organization
- projectCode 必须小写连字符、带 client slug 前缀:<client-slug>-<desc>-v<n>(例 acme-site-v1)。如果用户没给,你基于 client 名字生成一个合理的
- billingCurrency 默认 USDT 如果没说
- status 默认 lead 如果没说
- projectType 基于项目性质猜:有前端→web;自动化流程→automation;运维→ops;纯 AI 产品→ai;维护老项目→maintenance`;

  try {
    const raw = await aiChatComplete(env, system, text);
    if (!raw) return { draft: null, rawLlm: null, error: "llm_no_response" };
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { draft: null, rawLlm: raw, error: "no_json" };
    const parsed = JSON.parse(match[0]);
    return { draft: parsed as ClientIntakeDraft, rawLlm: raw };
  } catch (e) {
    return { draft: null, rawLlm: null, error: e instanceof Error ? e.message : String(e) };
  }
}

function formatClientIntakePreview(d: ClientIntakeDraft): string {
  const lines: string[] = ["准备创建以下记录:"];
  if (d.organization?.name) {
    lines.push(`📁 集团: ${d.organization.name}${d.organization.slug ? ` (slug ${d.organization.slug})` : ""}`);
    if (d.organization.adminEmail) lines.push(`   admin: ${d.organization.adminEmail}`);
  }
  if (d.client?.name) {
    lines.push(
      `🏢 客户: ${d.client.name}` +
        (d.client.billingCurrency ? ` · 结算 ${d.client.billingCurrency}` : "") +
        (d.client.status ? ` · ${d.client.status}` : "")
    );
  }
  if (d.primaryContact?.email) {
    lines.push(
      `👤 主联系人: ${d.primaryContact.name ?? "?"} <${d.primaryContact.email}>` +
        (d.primaryContact.roleAtClient ? ` · ${d.primaryContact.roleAtClient}` : "")
    );
  }
  for (const c of d.additionalContacts ?? []) {
    lines.push(
      `   + ${c.name ?? "?"} <${c.email}>` + (c.roleAtClient ? ` · ${c.roleAtClient}` : "")
    );
  }
  if (d.project?.name) {
    lines.push(
      `📂 项目: ${d.project.name} (${d.project.projectCode})` +
        ` · ${d.project.projectType ?? "web"}` +
        ` · ${d.project.deliveryModel ?? "fixed"}` +
        ` · ${d.project.version ?? "v1"}`
    );
    if (d.project.summary) lines.push(`   简述: ${d.project.summary}`);
  }
  const issues: string[] = [];
  if (!d.client?.name) issues.push("缺:客户名称");
  if (!d.primaryContact?.email) issues.push("缺:主联系人邮箱");
  if (!d.project?.name) issues.push("缺:项目名称");
  if (!d.project?.projectCode) issues.push("缺:项目代码");
  if (issues.length > 0) lines.push("\n⚠️ " + issues.join(" · ") + "\n请再次用一段话补充");
  return lines.join("\n");
}

async function executeClientIntake(
  env: Env,
  actor: ResolvedActor,
  draft: ClientIntakeDraft
): Promise<{ ok: boolean; summary: string; projectId?: string; clientId?: string; orgId?: string }> {
  const supabase = getSupabaseAdmin(env);
  const steps: string[] = [];
  let orgId: string | null = null;
  if (draft.organization?.name) {
    const { data: existing } = await supabase
      .from("organizations")
      .select("id")
      .eq("name", draft.organization.name)
      .maybeSingle();
    if (existing) {
      orgId = existing.id;
      steps.push(`↪️ 集团 ${draft.organization.name} 已存在,复用`);
    } else {
      const { data, error } = await supabase
        .from("organizations")
        .insert({
          name: draft.organization.name,
          slug: draft.organization.slug ?? null,
          admin_email: draft.organization.adminEmail ?? null,
          description: draft.organization.description ?? null
        })
        .select("id")
        .single();
      if (error) return { ok: false, summary: `❌ 建集团失败:${error.message}` };
      orgId = data.id;
      steps.push(`✅ 集团 ${draft.organization.name} 已建`);
    }
  }
  let clientId: string | null = null;
  if (draft.client?.name) {
    const { data: existing } = await supabase
      .from("clients")
      .select("id")
      .eq("name", draft.client.name)
      .maybeSingle();
    if (existing) {
      clientId = existing.id;
      if (orgId) {
        await supabase.from("clients").update({ organization_id: orgId }).eq("id", clientId);
      }
      steps.push(`↪️ 客户 ${draft.client.name} 已存在,复用${orgId ? "(已挂集团)" : ""}`);
    } else {
      const { data, error } = await supabase
        .from("clients")
        .insert({
          name: draft.client.name,
          contact_name: draft.primaryContact?.name ?? null,
          contact_channel: draft.primaryContact?.email ? `email:${draft.primaryContact.email}` : null,
          billing_currency: draft.client.billingCurrency ?? "USDT",
          status: draft.client.status ?? "lead",
          notes: draft.client.notes ?? null,
          organization_id: orgId
        })
        .select("id")
        .single();
      if (error) return { ok: false, summary: `❌ 建客户失败:${error.message}` };
      clientId = data.id;
      steps.push(`✅ 客户 ${draft.client.name} 已建`);
    }
  }
  if (clientId && draft.primaryContact?.email) {
    const { data: existingC } = await supabase
      .from("client_contacts")
      .select("id")
      .eq("client_id", clientId)
      .eq("email", draft.primaryContact.email)
      .maybeSingle();
    if (!existingC) {
      await supabase.from("client_contacts").insert({
        client_id: clientId,
        name: draft.primaryContact.name ?? null,
        email: draft.primaryContact.email,
        role_at_client: draft.primaryContact.roleAtClient ?? null,
        is_primary: true
      });
      steps.push(`✅ 主联系人 ${draft.primaryContact.email} 已建`);
    } else {
      steps.push(`↪️ 主联系人 ${draft.primaryContact.email} 已存在`);
    }
  }
  for (const c of draft.additionalContacts ?? []) {
    if (!clientId || !c.email) continue;
    const { data: existingC } = await supabase
      .from("client_contacts")
      .select("id")
      .eq("client_id", clientId)
      .eq("email", c.email)
      .maybeSingle();
    if (!existingC) {
      await supabase.from("client_contacts").insert({
        client_id: clientId,
        name: c.name ?? null,
        email: c.email,
        role_at_client: c.roleAtClient ?? null,
        is_primary: false
      });
      steps.push(`✅ 联系人 ${c.email} 已建`);
    }
  }
  let projectId: string | null = null;
  if (clientId && draft.project?.projectCode) {
    const { data: existingP } = await supabase
      .from("projects")
      .select("id")
      .eq("project_code", draft.project.projectCode)
      .maybeSingle();
    if (existingP) {
      projectId = existingP.id;
      steps.push(`↪️ 项目 ${draft.project.projectCode} 已存在,复用`);
    } else {
      const { data, error } = await supabase
        .from("projects")
        .insert({
          client_id: clientId,
          name: draft.project.name,
          project_code: draft.project.projectCode,
          type: draft.project.projectType ?? "web",
          status: "planning",
          owner_user_id: actor.userId ?? null,
          delivery_model: draft.project.deliveryModel ?? "fixed",
          risk_level: draft.project.riskLevel ?? "low",
          version: draft.project.version ?? "v1",
          summary: draft.project.summary ?? null
        })
        .select("id")
        .single();
      if (error) return { ok: false, summary: `❌ 建项目失败:${error.message}` };
      projectId = data.id;
      steps.push(`✅ 项目 ${draft.project.name} (${draft.project.projectCode}) 已建`);
    }
  }
  await saveAgentRun(env, {
    agent_name: "orchestrator_agent",
    trigger_source: "intake:real_client",
    status: "success",
    project_id: projectId,
    input_payload: draft as unknown as Record<string, unknown>,
    output_payload: { orgId, clientId, projectId },
    actor
  });
  return {
    ok: true,
    summary: steps.join("\n"),
    orgId: orgId ?? undefined,
    clientId: clientId ?? undefined,
    projectId: projectId ?? undefined
  };
}

// KickoffPlan interface — 复用自 agents/orchestrator/skills/kickoff-plan.ts
import type { KickoffPlan } from "./agents/orchestrator/skills";

function formatKickoffPreview(plan: KickoffPlan, clientName: string, projectName: string): string {
  const lines: string[] = [];
  lines.push(`<b>🌱 ${clientName} / ${projectName} kickoff 方案</b>`);
  lines.push("");
  lines.push(`<b>👣 第一步:会议</b>`);
  lines.push(`标题:${plan.meeting.title}`);
  lines.push(`议题:`);
  for (const a of plan.meeting.agenda ?? []) lines.push(`• ${a}`);
  if ((plan.meeting.openQuestions ?? []).length > 0) {
    lines.push(``);
    lines.push(`待客户确认:`);
    for (const q of plan.meeting.openQuestions) lines.push(`❓ ${q}`);
  }
  lines.push("");
  lines.push(`<b>📋 第二步:初始任务(${plan.tasks?.length ?? 0})</b>`);
  for (const t of plan.tasks ?? []) {
    const tag = [t.track, t.version_target].filter(Boolean).join(" · ");
    lines.push(`• [${tag}] ${t.title}`);
  }
  lines.push("");
  lines.push(`推荐 mentor:${plan.suggestedMentor ?? "nina_coach"}`);
  lines.push("");
  lines.push(`<b>💬 下一步</b>`);
  lines.push(`点 ✅ 建会议+任务 入库(全部标 needs_human_review),或 ❌ 取消重录。`);
  return lines.join("\n");
}

async function executeKickoffPlan(
  env: Env,
  actor: ResolvedActor,
  projectId: string,
  clientId: string,
  plan: KickoffPlan
): Promise<{ ok: boolean; summary: string; meetingId?: string; taskIds?: string[] }> {
  const supabase = getSupabaseAdmin(env);
  const { data: meeting, error: mErr } = await supabase
    .from("meetings")
    .insert({
      project_id: projectId,
      title: plan.meeting.title,
      raw_transcript: [
        "Kickoff 会议(候选,待真实会议覆盖)",
        "议题:",
        ...plan.meeting.agenda.map((a, i) => `${i + 1}. ${a}`),
        "",
        "待客户确认:",
        ...(plan.meeting.openQuestions ?? []).map((q, i) => `Q${i + 1}. ${q}`)
      ].join("\n"),
      source_channel: "kickoff_planner",
      summary: `Agenda: ${plan.meeting.agenda.join(" / ")}`,
      decisions: "(待真实会议后填)",
      open_questions: (plan.meeting.openQuestions ?? []).join(" | "),
      happened_at: new Date().toISOString(),
      created_by_agent: true,
      agent_name: "orchestrator_agent",
      needs_human_review: true
    })
    .select("id")
    .single();
  if (mErr) return { ok: false, summary: `❌ 建会议失败:${mErr.message}` };

  const taskIds: string[] = [];
  let parentId: string | null = null;
  for (const t of plan.tasks ?? []) {
    const isMain = t.track === "main";
    const { data: task, error: tErr } = await supabase
      .from("tasks")
      .insert({
        project_id: projectId,
        parent_task_id: isMain ? null : parentId,
        title: t.title,
        description: t.description ?? null,
        status: "todo",
        priority: t.priority ?? 3,
        source_type: "agent",
        track: t.track,
        version_target: t.version_target ?? "v1",
        reporter_user_id: actor.userId ?? null,
        created_by_agent: true,
        agent_name: "orchestrator_agent",
        source_channel: "kickoff_planner",
        needs_human_review: true
      })
      .select("id")
      .single();
    if (tErr) continue;
    taskIds.push(task.id);
    if (isMain) parentId = task.id;
  }

  await saveAgentRun(env, {
    agent_name: "orchestrator_agent",
    trigger_source: "kickoff:auto_plan",
    status: "success",
    project_id: projectId,
    input_payload: plan as unknown as Record<string, unknown>,
    output_payload: { meetingId: meeting.id, taskIds },
    actor
  });

  return {
    ok: true,
    summary: [
      `✅ Kickoff 方案已入库(全部标 needs_human_review)`,
      `会议 ID: ${meeting.id}`,
      `任务数: ${taskIds.length}`,
      ``,
      `下一步:`,
      `• 到 Supabase Studio 或等面板上线后确认/改`,
      `• 约真实 kickoff 会议,开完在群里 /meeting_start → /meeting_end 会覆盖这个草稿`,
      `• 在群里 /bind_project ${projectId ? "(项目 code)" : ""} 之后就能用 /task /status 跟进`
    ].join("\n"),
    meetingId: meeting.id,
    taskIds
  };
}

interface EmployeeIntakeDraft {
  email: string;
  displayName: string;
  role?: "trainee" | "member" | "founder" | "contractor";
  mentorSlug?: string;
  startDate?: string;
  backgroundHint?: string;
  autoStartProgram?: boolean;
}

async function executeEmployeeIntake(
  env: Env,
  actor: ResolvedActor,
  draft: EmployeeIntakeDraft
): Promise<{ ok: boolean; summary: string; userId?: string; workflowRunId?: string }> {
  const supabase = getSupabaseAdmin(env);
  const steps: string[] = [];
  const role = draft.role ?? "trainee";

  const { data: existingUser } = await supabase
    .from("users")
    .select("id, display_name")
    .eq("email", draft.email.toLowerCase())
    .maybeSingle();

  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
    steps.push(`↪️ user ${draft.email} 已存在,复用(${existingUser.display_name})`);
    // 更新 role 和 status
    await supabase
      .from("users")
      .update({ role, status: role === "trainee" ? "trial" : "active" })
      .eq("id", userId);
  } else {
    const { data, error } = await supabase
      .from("users")
      .insert({
        email: draft.email.toLowerCase(),
        display_name: draft.displayName,
        role,
        status: role === "trainee" ? "trial" : "active"
      })
      .select("id")
      .single();
    if (error) return { ok: false, summary: `❌ 建 user 失败:${error.message}` };
    userId = data.id;
    steps.push(`✅ user ${draft.displayName} <${draft.email}> 已建(role=${role})`);
  }

  // 如果有 background hint,顺手写 user_profiles 里
  if (draft.backgroundHint) {
    await supabase.from("user_profiles").upsert(
      {
        user_id: userId,
        experience_summary: draft.backgroundHint,
        last_refreshed_at: new Date().toISOString()
      },
      { onConflict: "user_id" }
    );
    steps.push(`✅ 背景画像草稿已记(后续新人 /start 做 intake 会覆盖)`);
  }

  let workflowRunId: string | undefined;
  const shouldStart =
    role === "trainee" && (draft.autoStartProgram === undefined || draft.autoStartProgram === true);
  if (shouldStart) {
    const req = new Request("https://internal/trigger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: {
          traineeEmail: draft.email.toLowerCase(),
          startDate: draft.startDate ?? new Date().toISOString().slice(0, 10),
          mentorSlug: draft.mentorSlug ?? "nina_coach"
        },
        source: `real:employee:${actor.userId}`
      })
    });
    try {
      const res = await workflowHandlers.handleWorkflowTrigger(req, env, actor, "employee-first-day");
      const trig = (await res.json()) as any;
      if (trig.ok) {
        workflowRunId = trig.runId;
        steps.push(`✅ employee-first-day 工作流已启动 run=${trig.runId}`);
      } else {
        steps.push(`⚠️ 工作流启动失败: ${trig.error ?? "unknown"}`);
      }
    } catch (e) {
      steps.push(`⚠️ 工作流启动异常: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  await saveAgentRun(env, {
    agent_name: "onboarding_agent",
    trigger_source: "intake:real_employee",
    status: "success",
    input_payload: draft as unknown as Record<string, unknown>,
    output_payload: { userId, workflowRunId },
    actor
  });

  steps.push(
    "",
    "📤 下一步:把下面这段发给新人,让他在 @one23_tech_bot 私聊 /start:",
    "",
    `  1. 打开 Telegram,搜索 @one23_tech_bot`,
    `  2. 发 /start,按提示回复邮箱 ${draft.email.toLowerCase()}`,
    `  3. 回答 3 道入职画像,mentor ${draft.mentorSlug ?? "nina_coach"} 会展示 Day 1 引导`
  );

  return { ok: true, summary: steps.join("\n"), userId, workflowRunId };
}

async function listClientsForPicker(env: Env): Promise<Array<{ id: string; name: string }>> {
  const supabase = getSupabaseAdmin(env);
  const { data } = await supabase
    .from("clients")
    .select("id, name")
    .eq("status", "active")
    .order("name")
    .limit(20);
  return data ?? [];
}

async function runSimProject(env: Env, actor: ResolvedActor, arg: string): Promise<string> {
  const supabase = getSupabaseAdmin(env);
  let clientId: string | null = null;
  let clientName = "";
  if (arg) {
    const { data: c } = await supabase.from("clients").select("id, name").eq("id", arg).maybeSingle();
    if (!c) {
      const { data: c2 } = await supabase.from("clients").select("id, name").eq("name", arg).maybeSingle();
      if (!c2) return `找不到 client "${arg}"。`;
      clientId = c2.id;
      clientName = c2.name;
    } else {
      clientId = c.id;
      clientName = c.name;
    }
  } else {
    return "没指定 client。回到菜单用 🧪 模拟新项目 选客户。";
  }
  const stamp = Date.now().toString(36);
  const projectCode = `sim-proj-${stamp}`;
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .insert({
      client_id: clientId,
      name: `Sim Project ${stamp}`,
      project_code: projectCode,
      type: "web",
      status: "planning",
      owner_user_id: actor.userId,
      delivery_model: "fixed",
      risk_level: "low",
      summary: "simulated via /sim_project"
    })
    .select("id, name, project_code")
    .single();
  if (projErr) return `❌ 建 project 失败:${projErr.message}`;
  await supabase.from("tasks").insert([
    { project_id: project.id, title: "Kickoff 会议", status: "todo", source_type: "system" },
    { project_id: project.id, title: "设计稿初稿", status: "todo", source_type: "system" },
    { project_id: project.id, title: "首次部署到 staging", status: "todo", source_type: "system" }
  ]);
  await saveAgentRun(env, {
    agent_name: "project_ops_agent",
    trigger_source: "sim:project",
    status: "success",
    project_id: project.id,
    input_payload: { clientId, clientName },
    output_payload: { projectId: project.id, projectCode: project.project_code },
    actor
  });
  return [
    `*🧪 sim_project 已建立*`,
    `client: ${clientName}`,
    `project: ${project.name} (\`${project.project_code}\`)`,
    "附 3 条占位任务。可在任意群里发 /bind_project " + project.project_code
  ].join("\n");
}

async function runSimCleanup(env: Env, actor: ResolvedActor): Promise<string> {
  const supabase = getSupabaseAdmin(env);
  const { count: ucount } = await supabase.from("users").delete({ count: "exact" }).like("email", "sim-%@demo.local");
  const { count: pcount } = await supabase.from("projects").delete({ count: "exact" }).like("project_code", "sim-%");
  const { count: ccount } = await supabase.from("clients").delete({ count: "exact" }).like("name", "Sim Client %");
  await saveAgentRun(env, {
    agent_name: "orchestrator_agent",
    trigger_source: "sim:cleanup",
    status: "success",
    output_payload: { users: ucount ?? 0, projects: pcount ?? 0, clients: ccount ?? 0 },
    actor
  });
  return `🧹 cleanup: users=${ucount ?? 0}  projects=${pcount ?? 0}  clients=${ccount ?? 0}`;
}

function adminMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🆕 录入真实客户(对话)", callback_data: "real:new_client" }
      ],
      [
        { text: "🆕 录入新员工(培训期)", callback_data: "real:new_employee" }
      ],
      [
        { text: "🧪 模拟新员工(入职 + 培训)", callback_data: "sim:employee" }
      ],
      [
        { text: "🏢 模拟新公司(集团+客户+1 项目)", callback_data: "sim:org" }
      ],
      [
        { text: "📁 在现有公司加新项目", callback_data: "sim:project:pick" }
      ],
      [
        { text: "🧹 清理 sim 数据", callback_data: "sim:cleanup" }
      ],
      [
        { text: "📊 最近 agent 运行", callback_data: "view:agent_runs" },
        { text: "📑 等审批队列", callback_data: "view:approvals" }
      ]
    ]
  };
}

async function isFounderByTgId(env: Env, tgId: string): Promise<{ actor: ResolvedActor; role: string } | null> {
  const actor = await resolveByIdentity(env, "telegram", tgId);
  if (!actor?.userId) return null;
  const supabase = getSupabaseAdmin(env);
  const { data: u } = await supabase.from("users").select("role").eq("id", actor.userId).maybeSingle();
  if (!u) return null;
  return { actor, role: u.role };
}

async function handleCallbackQuery(env: Env, botRole: TgBotRole, cq: Record<string, any>) {
  const callbackId = cq.id;
  const chatId = String(cq.message?.chat?.id ?? "");
  const fromId = String(cq.from?.id ?? "");
  const data: string = cq.data ?? "";

  const gate = await isFounderByTgId(env, fromId);
  if (!gate || gate.role !== "founder") {
    await answerCallbackQuery(env, callbackId, botRole, "仅限 founder");
    return { handled: true, command: "cb:denied" };
  }
  const { actor } = gate;

  await answerCallbackQuery(env, callbackId, botRole, "处理中...");

  let replyText = "";
  let extraMarkup: Record<string, unknown> | undefined;
  let nextSteps: string[] = [];

  if (data === "sim:employee") {
    replyText = await runSimEmployee(env, actor, "");
    const runIdMatch = replyText.match(/workflow run:\s*`?([0-9a-f-]{36})`?/);
    if (runIdMatch) {
      const steps = await getActiveHumanStepsForRun(env, runIdMatch[1]);
      if (steps.length > 0) {
        extraMarkup = {
          inline_keyboard: [
            ...steps.map((s) => [
              { text: `✅ 完成: ${s.step_name}`, callback_data: `wf:complete:${s.id}` }
            ]),
            [{ text: "⬅️ 返回菜单", callback_data: "admin:home" }]
          ]
        };
      }
    }
    nextSteps = ["下一步:点下方按钮一键完成 human 步,或回菜单。"];
  } else if (data === "sim:client") {
    replyText = await runSimClient(env, actor, "");
    const runIdMatch = replyText.match(/workflow run:\s*`?([0-9a-f-]{36})`?/);
    if (runIdMatch) {
      const steps = await getActiveHumanStepsForRun(env, runIdMatch[1]);
      if (steps.length > 0) {
        extraMarkup = {
          inline_keyboard: [
            ...steps.map((s) => [
              { text: `✅ 完成: ${s.step_name}`, callback_data: `wf:complete:${s.id}` }
            ]),
            [{ text: "⬅️ 返回菜单", callback_data: "admin:home" }]
          ]
        };
      }
    }
    nextSteps = ["下一步:点按钮完成 human 步,或到 client bot 让客户侧 /start。"];
  } else if (data.startsWith("wf:complete:")) {
    const stepRunId = data.slice("wf:complete:".length);
    const r = await completeStepRunById(env, stepRunId, actor);
    if (!r.ok) {
      replyText = `❌ 完成失败: ${r.error}`;
    } else {
      replyText = `✅ 已完成 ${r.stepKey}`;
      if (r.runId) {
        const more = await getActiveHumanStepsForRun(env, r.runId);
        if (more.length > 0) {
          extraMarkup = {
            inline_keyboard: [
              ...more.map((s) => [
                { text: `✅ 完成: ${s.step_name}`, callback_data: `wf:complete:${s.id}` }
              ]),
              [{ text: "⬅️ 返回菜单", callback_data: "admin:home" }]
            ]
          };
          nextSteps = [`还有 ${more.length} 个 human 步等人处理。`];
        } else {
          nextSteps = ["此 workflow 的 human 步全部完成。后续自动节点会继续跑。"];
        }
      }
    }
  } else if (data === "sim:org") {
    replyText = await runSimOrg(env, actor);
    nextSteps = [
      "下一步:",
      "• 在客户群里 /bind_org <slug>",
      "• 或 🏢 模拟新公司 再造一个,测多集团"
    ];
  } else if (data === "sim:project" || data === "sim:project:pick") {
    const clients = await listClientsForPicker(env);
    if (clients.length === 0) {
      replyText = "还没有 active 客户。先点 🏢 模拟新公司 建一个。";
    } else {
      replyText = "选一个客户,给他加新项目(点下方按钮):";
      extraMarkup = {
        inline_keyboard: [
          ...clients.map((c) => [{ text: c.name, callback_data: `sim:project:${c.id}` }]),
          [{ text: "⬅️ 返回 admin 菜单", callback_data: "admin:home" }]
        ]
      };
    }
  } else if (data.startsWith("sim:project:")) {
    const clientId = data.slice("sim:project:".length);
    replyText = await runSimProject(env, actor, clientId);
    nextSteps = [
      "下一步:",
      "• 在任意群里 /bind_project <code>",
      "• 或回到 admin 菜单做下一件事"
    ];
  } else if (data === "sim:cleanup") {
    replyText = await runSimCleanup(env, actor);
    nextSteps = ["所有 sim- 前缀的 user / project / client 已删除。"];
  } else if (data === "admin:home") {
    replyText = "Admin 菜单";
  } else if (data === "real:new_client") {
    await setTgSession(env, chatId, "employee", { stage: "intake_new_client_desc" });
    replyText = [
      "🆕 录入真实客户",
      "",
      "请用一段话描述新客户,我会自动抽成结构化记录让你确认。",
      "",
      "模板(复制改):",
      "集团 Acme(slug acme),公司 Acme Japan,CEO Takeshi 邮箱 takeshi@acme.jp。第一个项目是 Acme 跨境主站 v1,code acme-site-v1,web 类型,fixed 结算,USDT,planning 状态。",
      "",
      "发 /cancel 取消。"
    ].join("\n");
    extraMarkup = { inline_keyboard: [[{ text: "⬅️ 返回菜单", callback_data: "admin:home" }]] };
  } else if (data.startsWith("real:confirm_new_client:")) {
    const sessionRow = await getTgSession(env, chatId);
    const draft = sessionRow?.state?.draft as ClientIntakeDraft | undefined;
    if (!draft) {
      replyText = "没找到草稿,请重新点 🆕 录入真实客户。";
    } else {
      const result = await executeClientIntake(env, actor, draft);
      replyText = result.summary;
      if (result.ok && result.projectId && result.clientId && draft.client?.name && draft.project?.name) {
        // 自动生成 kickoff 方案
        const { plan, error: kickErr } = await generateKickoffPlan(
          env,
          draft.client.name,
          draft.project.name,
          draft.project.projectCode,
          draft.project.projectType ?? "web",
          draft.project.deliveryModel ?? "fixed",
          draft.project.summary ?? ""
        );
        if (plan) {
          // 存 plan 到 session,等用户点确认入库
          await setTgSession(env, chatId, "employee", {
            stage: "kickoff_preview",
            kickoff_plan: plan,
            project_id: result.projectId,
            client_id: result.clientId
          });
          replyText += "\n\n" + formatKickoffPreview(plan, draft.client.name, draft.project.name);
          extraMarkup = {
            inline_keyboard: [
              [{ text: "✅ 建会议 + 任务", callback_data: "real:kickoff_confirm" }],
              [{ text: "❌ 取消 kickoff(项目仍保留)", callback_data: "real:kickoff_skip" }]
            ]
          };
        } else {
          await clearTgSession(env, chatId);
          replyText += `\n\n(kickoff 规划失败: ${kickErr ?? "?"} — 项目已建,后续手动加会议和任务)`;
          extraMarkup = {
            inline_keyboard: [[{ text: "⬅️ 返回菜单", callback_data: "admin:home" }]]
          };
        }
      } else {
        await clearTgSession(env, chatId);
      }
    }
  } else if (data === "real:kickoff_confirm") {
    const sessionRow = await getTgSession(env, chatId);
    const plan = sessionRow?.state?.kickoff_plan as KickoffPlan | undefined;
    const projectId = sessionRow?.state?.project_id as string | undefined;
    const clientId = sessionRow?.state?.client_id as string | undefined;
    if (!plan || !projectId || !clientId) {
      replyText = "草稿丢失,请重来。";
    } else {
      const r = await executeKickoffPlan(env, actor, projectId, clientId, plan);
      await clearTgSession(env, chatId);
      replyText = r.summary;
      extraMarkup = {
        inline_keyboard: [[{ text: "⬅️ 返回菜单", callback_data: "admin:home" }]]
      };
    }
  } else if (data === "real:kickoff_skip") {
    await clearTgSession(env, chatId);
    replyText = "已跳过 kickoff 自动规划。项目仍保留,后面可手动建会议/任务。";
    extraMarkup = {
      inline_keyboard: [[{ text: "⬅️ 返回菜单", callback_data: "admin:home" }]]
    };
  } else if (data.startsWith("real:trigger_intake_wf:")) {
    const clientId = data.slice("real:trigger_intake_wf:".length);
    const req = new Request("https://internal/trigger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId,
        input: { clientId },
        source: `admin:${actor.userId}`
      })
    });
    const res = await workflowHandlers.handleWorkflowTrigger(req, env, actor, "new-client-intake");
    const trig = (await res.json()) as any;
    replyText = trig.ok
      ? `🚀 工作流 new-client-intake 已启动\nrun: ${trig.runId ?? "?"}\n\n第一步 intake_call (human) 等你发起,到项目群里 /meeting_start 或手动 /complete。`
      : `❌ 启动失败: ${trig.error}`;
  } else if (data === "real:cancel_new_client") {
    await clearTgSession(env, chatId);
    replyText = "已取消新客户录入。";
  } else if (data === "real:new_employee") {
    await setTgSession(env, chatId, "employee", { stage: "invite_awaiting_tg_username" });
    replyText = [
      "🆕 录入新员工(培训期)",
      "",
      "直接发新员工的 Telegram 用户名,我会建一张邀请,让他自己来 /start 完成录入。",
      "",
      "格式:",
      "@xiaoming  (或不带 @)",
      "可选:@xiaoming mentor=marcus_strict  (默认 nina_coach)",
      "",
      "发 /cancel 取消。"
    ].join("\n");
    extraMarkup = { inline_keyboard: [[{ text: "⬅️ 返回菜单", callback_data: "admin:home" }]] };
  } else if (data === "real:confirm_new_employee") {
    const sessionRow = await getTgSession(env, chatId);
    const draft = sessionRow?.state?.draft as EmployeeIntakeDraft | undefined;
    if (!draft) {
      replyText = "没找到草稿,请重新点 🆕 录入新员工。";
    } else {
      const result = await executeEmployeeIntake(env, actor, draft);
      await clearTgSession(env, chatId);
      replyText = result.summary;
      if (result.ok && result.workflowRunId) {
        const steps = await getActiveHumanStepsForRun(env, result.workflowRunId);
        if (steps.length > 0) {
          extraMarkup = {
            inline_keyboard: [
              ...steps.map((s) => [
                { text: `✅ 完成: ${s.step_name}`, callback_data: `wf:complete:${s.id}` }
              ]),
              [{ text: "⬅️ 返回菜单", callback_data: "admin:home" }]
            ]
          };
        }
      }
    }
  } else if (data === "real:cancel_new_employee") {
    await clearTgSession(env, chatId);
    replyText = "已取消。";
  }
  else if (data === "view:agent_runs") {
    const supabase = getSupabaseAdmin(env);
    const { data: rows } = await supabase
      .from("agent_runs")
      .select("agent_name, trigger_source, status, started_at")
      .order("started_at", { ascending: false })
      .limit(10);
    const lines = ["*最近 10 条 agent_runs*"];
    for (const r of rows ?? [])
      lines.push(`- ${r.agent_name} / ${r.trigger_source} / ${r.status}`);
    replyText = lines.join("\n");
  } else if (data === "view:approvals") {
    const supabase = getSupabaseAdmin(env);
    const { data: rows } = await supabase
      .from("workflow_step_runs")
      .select("id, step_key, status, run_id")
      .eq("status", "awaiting_approval")
      .limit(10);
    const lines = ["*等审批的工作流节点*"];
    if ((rows ?? []).length === 0) lines.push("(空)");
    for (const r of rows ?? [])
      lines.push(`- \`${r.id}\` step=${r.step_key}\n  /approve ${r.id}\n  /reject ${r.id} <reason>`);
    replyText = lines.join("\n");
  } else {
    replyText = `未识别 callback: ${data}`;
  }

  const markup = extraMarkup ?? adminMenuKeyboard();
  const fullText = nextSteps.length > 0 ? `${replyText}\n\n${nextSteps.join("\n")}` : replyText;
  await sendTelegramReply(env, chatId, fullText, botRole, { reply_markup: markup });
  return { handled: true, command: `cb:${data}` };
}

async function handleMyChatMember(
  env: Env,
  botRole: TgBotRole,
  update: Record<string, any>
) {
  const chat = update?.chat ?? {};
  const chatId = String(chat?.id ?? "");
  const chatTitle = chat?.title ?? "";
  const chatType = chat?.type ?? "";
  const inviter = update?.from ?? {};
  const inviterName = inviter?.first_name || inviter?.username || "某人";
  const newStatus = update?.new_chat_member?.status;
  const oldStatus = update?.old_chat_member?.status;
  const isGroup = chatType === "group" || chatType === "supergroup";
  if (!isGroup || !chatId) return { handled: false };

  const supabase = getSupabaseAdmin(env);
  const joinedStatuses = ["member", "administrator"];
  const leftStatuses = ["left", "kicked"];

  if (joinedStatuses.includes(newStatus) && !joinedStatuses.includes(oldStatus)) {
    await supabase.from("telegram_groups").upsert(
      {
        chat_id: chatId,
        bot_role: botRole,
        title: chatTitle,
        is_active: true
      },
      { onConflict: "chat_id" }
    );
    const inviterActor = await resolveByIdentity(env, "telegram", String(inviter?.id ?? ""));
    await saveAgentRun(env, {
      agent_name: "orchestrator_agent",
      trigger_source: `telegram:${botRole}:bot_added`,
      status: "success",
      input_payload: {
        chat_id: chatId,
        chat_title: chatTitle,
        chat_type: chatType,
        inviter_tg_id: inviter?.id,
        inviter_name: inviterName,
        new_status: newStatus
      },
      output_payload: { registered: true, active: true },
      actor: inviterActor ?? undefined
    });
    // 给新群发欢迎 + 绑定指引
    const welcome = botRole === "client"
      ? [
          `👋 大家好,我是 One23 Support`,
          ``,
          `这个群可以绑到一个集团/公司/项目,然后做:`,
          `• 开会自动记录(/meeting_start → 聊 → /meeting_end)`,
          `• 建任务(/task <描述>)`,
          `• 查进度(/status)`,
          ``,
          `请内部员工先发其中一条来绑:`,
          `  /bind_org <org-slug>`,
          `  /bind_client <公司名>`,
          `  /bind_project <project-code>`,
          ``,
          `发 /help 查看全部指令`
        ].join("\n")
      : [
          `👋 One23 Tech bot 已加入`,
          ``,
          `绑定:`,
          `  /bind_project <project-code>`,
          `发 /help 查看指令`
        ].join("\n");
    await sendTelegramReply(env, chatId, welcome, botRole);
    // 通知 superadmin
    await sendTelegram(
      env,
      `bot(${botRole})被加入新群`,
      `群名:${chatTitle}\nchat_id: ${chatId}\ntype: ${chatType}\n邀请人: ${inviterName}\n状态: ${newStatus}`
    );
    return { handled: true, command: "bot_added" };
  }

  if (leftStatuses.includes(newStatus) && !leftStatuses.includes(oldStatus)) {
    await supabase
      .from("telegram_groups")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("chat_id", chatId);
    await saveAgentRun(env, {
      agent_name: "orchestrator_agent",
      trigger_source: `telegram:${botRole}:bot_removed`,
      status: "success",
      input_payload: { chat_id: chatId, chat_title: chatTitle, new_status: newStatus }
    });
    await sendTelegram(
      env,
      `bot(${botRole})被移出群`,
      `群名:${chatTitle}\nchat_id: ${chatId}\n新状态: ${newStatus}`
    );
    return { handled: true, command: "bot_removed" };
  }

  // 权限变化(member ↔ administrator 之间)
  if (newStatus !== oldStatus) {
    await sendTelegram(
      env,
      `bot(${botRole})权限变化`,
      `群名:${chatTitle}\nchat_id: ${chatId}\n${oldStatus} → ${newStatus}`
    );
    return { handled: true, command: "bot_status_changed" };
  }

  return { handled: false };
}

async function handleTelegramMessage(env: Env, botRole: TgBotRole, message: Record<string, any>) {
  const text: string = message?.text ?? "";
  const chatId = String(message?.chat?.id ?? "");
  const fromId = String(message?.from?.id ?? chatId);
  const chatType = message?.chat?.type ?? "private"; // private | group | supergroup | channel
  const chatTitle = message?.chat?.title ?? "";
  if (!chatId) return { handled: false };

  // 处理 group → supergroup 升级:Telegram 在新 supergroup 的第一条消息上带 migrate_from_chat_id。
  const migrateFrom = message?.migrate_from_chat_id;
  if (migrateFrom) {
    const oldId = String(migrateFrom);
    const supabase = getSupabaseAdmin(env);
    await supabase
      .from("telegram_groups")
      .update({ chat_id: chatId, updated_at: new Date().toISOString() })
      .eq("chat_id", oldId);
    await supabase
      .from("telegram_meeting_buffers")
      .update({ chat_id: chatId })
      .eq("chat_id", oldId);
    await sendTelegramReply(env, chatId, "(检测到群升级为超级群,绑定已自动迁移)", botRole);
  }

  const isGroup = chatType === "group" || chatType === "supergroup";

  // 群聊分支:命令走群处理,非命令文本如果在会议窗口内就追加到 transcript
  if (isGroup) {
    // 群里的命令可能带 @botname 后缀,strip 一下
    const rawCmd = text.trim().split(/\s+/)[0] ?? "";
    const cmd = rawCmd.toLowerCase().split("@")[0];
    const argText = text.trim().slice(rawCmd.length).trim();
    const speakerName =
      message?.from?.first_name ||
      message?.from?.username ||
      message?.from?.id?.toString() ||
      null;

    if (cmd === "/help" || cmd === "/start") {
      await handleGroupHelp(env, botRole, chatId);
      return { handled: true, command: cmd };
    }
    if (cmd === "/bind_project") {
      await handleGroupBindProject(env, botRole, chatId, chatTitle, fromId, argText);
      return { handled: true, command: cmd };
    }
    if (cmd === "/bind_client") {
      await handleGroupBindClient(env, botRole, chatId, chatTitle, fromId, argText);
      return { handled: true, command: cmd };
    }
    if (cmd === "/bind_org") {
      await handleGroupBindOrg(env, botRole, chatId, chatTitle, fromId, argText);
      return { handled: true, command: cmd };
    }
    if (cmd === "/focus") {
      await handleGroupFocus(env, botRole, chatId, argText);
      return { handled: true, command: cmd };
    }
    if (cmd === "/unfocus") {
      await handleGroupUnfocus(env, botRole, chatId);
      return { handled: true, command: cmd };
    }
    if (cmd === "/projects") {
      await handleGroupListProjects(env, botRole, chatId);
      return { handled: true, command: cmd };
    }
    if (cmd === "/unbind") {
      await handleGroupUnbind(env, botRole, chatId, fromId);
      return { handled: true, command: cmd };
    }
    if (cmd === "/meeting_start") {
      await handleGroupMeetingStart(env, botRole, chatId, fromId, argText);
      return { handled: true, command: cmd };
    }
    if (cmd === "/meeting_end") {
      await handleGroupMeetingEnd(env, botRole, chatId, fromId);
      return { handled: true, command: cmd };
    }
    if (cmd === "/task") {
      await handleGroupCreateTask(env, botRole, chatId, fromId, argText);
      return { handled: true, command: cmd };
    }
    if (cmd === "/status") {
      await handleGroupStatus(env, botRole, chatId);
      return { handled: true, command: cmd };
    }
    // 非命令文本:若在会议窗口,追加到 transcript
    if (text && !text.startsWith("/")) {
      const appended = await appendToActiveBuffer(env, chatId, speakerName, text);
      return { handled: appended, command: appended ? "meeting_append" : undefined };
    }
    return { handled: false };
  }

  const session = await getTgSession(env, chatId);
  const stage = session?.state?.stage;

  if (text === "/cancel") {
    await clearTgSession(env, chatId);
    await sendTelegramReply(env, chatId, "已取消。", botRole);
    return { handled: true, command: "/cancel" };
  }

  // employee 多轮入职流程
  if (botRole === "employee") {
    if (text === "/start") {
      const fromUsername = message?.from?.username ?? null;
      await handleEmployeeStart(env, chatId, fromId, fromUsername);
      return { handled: true, command: "/start" };
    }
    if (stage === "awaiting_email") {
      await handleEmployeeAwaitingEmail(env, chatId, fromId, text);
      return { handled: true, command: "intake:email" };
    }
    if (stage === "invite_awaiting_tg_username") {
      const actor = await resolveByIdentity(env, "telegram", fromId);
      const supa = getSupabaseAdmin(env);
      const { data: u } = actor?.userId
        ? await supa.from("users").select("role").eq("id", actor.userId).maybeSingle()
        : { data: null };
      if (!u || u.role !== "founder") {
        await sendTelegramReply(env, chatId, "仅 founder 可建邀请。", botRole);
        await clearTgSession(env, chatId);
        return { handled: true, command: "invite:denied" };
      }
      const parts = text.trim().split(/\s+/);
      const rawUser = parts[0]?.replace(/^@/, "").trim().toLowerCase();
      if (!rawUser || !/^[a-zA-Z0-9_]{3,32}$/.test(rawUser)) {
        await sendTelegramReply(
          env,
          chatId,
          "用户名格式不对。Telegram username 只含字母数字下划线,3-32 字符。",
          botRole
        );
        return { handled: true, command: "invite:bad_username" };
      }
      let mentorSlug = "nina_coach";
      for (const p of parts.slice(1)) {
        const m = p.match(/^mentor=(\w+)$/);
        if (m) mentorSlug = m[1];
      }
      const { data: invite, error } = await supa
        .from("employee_invites")
        .insert({
          telegram_username: rawUser,
          mentor_slug: mentorSlug,
          invited_by_user_id: actor!.userId,
          status: "pending"
        })
        .select("id, telegram_username, mentor_slug")
        .single();
      if (error) {
        await sendTelegramReply(env, chatId, `❌ 建邀请失败:${error.message}`, botRole);
        return { handled: true, command: "invite:db_error" };
      }
      await clearTgSession(env, chatId);
      await saveAgentRun(env, {
        agent_name: "onboarding_agent",
        trigger_source: "intake:invite_created",
        status: "success",
        input_payload: { telegram_username: rawUser, mentor_slug: mentorSlug },
        output_payload: { inviteId: invite.id },
        actor: actor ?? undefined
      });
      await sendTelegramReply(
        env,
        chatId,
        [
          `✅ 邀请已建`,
          `username: @${invite.telegram_username}`,
          `教官: ${invite.mentor_slug}`,
          ``,
          `📤 把下面这段发给他:`,
          ``,
          `Hi,欢迎加入!第一步:`,
          `1) Telegram 打开 @one23_tech_bot`,
          `2) 发 /start`,
          `3) 按提示回答你的姓名、邮箱、技术背景`,
          `4) bot 会自动给你开 15 天培训`
        ].join("\n"),
        botRole,
        { reply_markup: { inline_keyboard: [[{ text: "⬅️ 返回菜单", callback_data: "admin:home" }]] } }
      );
      return { handled: true, command: "invite:created" };
    }
    if (stage === "intake_new_employee_desc") {
      // 旧路径 — 保留兼容,但建议用 invite 流程
      const actor = await resolveByIdentity(env, "telegram", fromId);
      if (!actor?.userId) {
        await sendTelegramReply(env, chatId, "身份未绑定,请先 /start。", botRole);
        return { handled: true, command: "intake:new_employee_noauth" };
      }
      await sendTelegramReply(env, chatId, "该入口已停用,请用 /admin → 🆕 录入新员工。", botRole);
      await clearTgSession(env, chatId);
      return { handled: true, command: "intake:new_employee_deprecated" };
    }
    if (stage === "invite_awaiting_display_name") {
      return await handleInviteStage(env, botRole, chatId, fromId, session, text, "display_name");
    }
    if (stage === "invite_awaiting_email") {
      return await handleInviteStage(env, botRole, chatId, fromId, session, text, "email");
    }
    if (stage === "invite_awaiting_background") {
      return await handleInviteStage(env, botRole, chatId, fromId, session, text, "background");
    }
    if (stage === "intake_new_client_desc") {
      const actor = await resolveByIdentity(env, "telegram", fromId);
      if (!actor?.userId) {
        await sendTelegramReply(env, chatId, "身份未绑定,请先 /start。", botRole);
        return { handled: true, command: "intake:new_client_noauth" };
      }
      const supa = getSupabaseAdmin(env);
      const { data: u } = await supa.from("users").select("role").eq("id", actor.userId).maybeSingle();
      if (!u || u.role !== "founder") {
        await sendTelegramReply(env, chatId, "仅 founder 可录入真实客户。", botRole);
        await clearTgSession(env, chatId);
        return { handled: true, command: "intake:new_client_denied" };
      }
      await sendTelegramReply(env, chatId, "正在抽取信息...", botRole);
      const { draft, error } = await extractClientIntakeFromText(env, text);
      if (!draft) {
        await sendTelegramReply(
          env,
          chatId,
          `抽取失败:${error ?? "?"}\n请再描述一次。`,
          botRole
        );
        return { handled: true, command: "intake:new_client_extract_failed" };
      }
      await setTgSession(env, chatId, "employee", {
        stage: "intake_new_client_confirm",
        draft
      });
      const preview = formatClientIntakePreview(draft);
      await sendTelegramReply(env, chatId, preview, botRole, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ 确认创建", callback_data: "real:confirm_new_client:preview" }],
            [{ text: "❌ 取消", callback_data: "real:cancel_new_client" }]
          ]
        }
      });
      return { handled: true, command: "intake:new_client_preview" };
    }
    if (stage && stage.startsWith("intake_")) {
      await handleEmployeeIntake(env, chatId, session, text);
      return { handled: true, command: `intake:${stage}` };
    }
  }

  // client 多轮入职
  if (botRole === "client") {
    if (text === "/start") {
      await handleClientStart(env, chatId, fromId);
      return { handled: true, command: "/start" };
    }
    if (stage === "awaiting_client_email") {
      await handleClientAwaitingEmail(env, chatId, text);
      return { handled: true, command: "client:email" };
    }
    if (text === "/status" || text === "/progress") {
      await handleClientProgress(env, chatId);
      return { handled: true, command: text };
    }
    if (text.startsWith("/newneed ")) {
      await handleClientNewNeed(env, chatId, fromId, text.slice(9).trim());
      return { handled: true, command: "/newneed" };
    }
    if (text === "/newneed") {
      await sendTelegramReply(
        env,
        chatId,
        "用法:/newneed 后面直接跟你想提的需求。\n例如:/newneed 希望首页加一个新用户注册引导,点击注册按钮弹出 3 步引导。",
        "client"
      );
      return { handled: true, command: "/newneed" };
    }
    if (text.startsWith("/message ")) {
      await handleClientMessage(env, chatId, fromId, text.slice(9).trim());
      return { handled: true, command: "/message" };
    }
    if (text === "/help") {
      await sendTelegramReply(
        env,
        chatId,
        "<b>可用指令</b>\n/start — 开始/重新绑定\n/progress 或 /status — 查项目进度\n/newneed &lt;需求&gt; — 提新需求,自动整理成任务候选给团队\n/message &lt;内容&gt; — 直接留言给负责人\n\n也可以直接说话,你的专属 agent 会回你。",
        "client"
      );
      return { handled: true, command: "/help" };
    }
    // 任何其他文本:当自由消息转达
    if (text && !text.startsWith("/")) {
      await handleClientMessage(env, chatId, fromId, text);
      return { handled: true, command: "client:free_text" };
    }
  }

  // employee 旧指令继续走原有 handleTelegramCommand
  if (botRole === "employee") {
    return await handleTelegramCommand(env, message);
  }

  return { handled: false };
}

async function handleTelegramCommand(env: Env, message: Record<string, any>) {
  const text: string = message?.text ?? "";
  const chatId = message?.chat?.id;
  if (!text.startsWith("/") || !chatId) {
    return { handled: false };
  }

  const [cmd] = text.split(/\s+/);
  const command = cmd.toLowerCase().split("@")[0];

  if (command === "/ping") {
    await sendTelegramReply(env, chatId, "pong");
    return { handled: true, command };
  }

  if (command === "/help") {
    await sendTelegramReply(
      env,
      chatId,
      [
        "OneAgents 命令",
        "/ping — 心跳",
        "/today — 查看今日任务(支持 /role 切换视角)",
        "/submit <简述 + URL/截图> — 提交今日任务(做完后)",
        "/chat <内容> — 和 mentor 或系统助手对话",
        "/status — 最近 Agent 运行统计",
        "/role — 查看/切换当前视角(founder 专用)",
        "/admin — 管理菜单",
        "/approve <step-run-id> — 审批工作流节点",
        "/reject <step-run-id> <reason> — 拒绝",
        "/cancel — 取消当前多轮流程",
        "/help — 本帮助"
      ].join("\n")
    );
    return { handled: true, command };
  }

  if (command === "/status") {
    const supabase = getSupabaseAdmin(env);
    const { data } = await supabase
      .from("agent_runs")
      .select("agent_name, status")
      .order("started_at", { ascending: false })
      .limit(20);
    const lines: string[] = ["*最近 20 条 agent 运行*"];
    const buckets: Record<string, number> = {};
    for (const row of data ?? []) {
      const key = `${row.agent_name}:${row.status}`;
      buckets[key] = (buckets[key] ?? 0) + 1;
    }
    for (const [key, count] of Object.entries(buckets)) {
      lines.push(`- ${key}: ${count}`);
    }
    await sendTelegramReply(env, chatId, lines.join("\n"));
    return { handled: true, command };
  }

  const fromIdGlobal = String(message?.from?.id ?? message?.chat?.id ?? "");

  if (command === "/admin" || command === "/sim_employee" || command === "/sim_client" || command === "/sim_project" || command === "/sim_cleanup") {
    const actor = await resolveByIdentity(env, "telegram", fromIdGlobal);
    if (!actor?.userId) {
      await sendTelegramReply(env, chatId, "需要先 /start 绑定你的 OneAgents 身份。");
      return { handled: true, command };
    }
    const supabase = getSupabaseAdmin(env);
    const { data: u } = await supabase.from("users").select("role").eq("id", actor.userId).maybeSingle();
    if (!u || u.role !== "founder") {
      await sendTelegramReply(env, chatId, "这些命令仅限 founder 使用。");
      return { handled: true, command };
    }

    if (command === "/admin") {
      await sendTelegramReply(
        env,
        chatId,
        "*Admin menu*\n直接点下方按钮触发。",
        "employee",
        { reply_markup: adminMenuKeyboard() }
      );
      return { handled: true, command };
    }

    if (command === "/sim_employee") {
      const arg = text.slice(cmd.length).trim();
      const stamp = Date.now().toString(36);
      const email = arg && /@/.test(arg) ? arg : `sim-employee-${stamp}@demo.local`;
      const displayName = arg && !/@/.test(arg) ? arg : `Sim Employee ${stamp}`;
      const { data: user, error: userErr } = await supabase
        .from("users")
        .upsert(
          { email, display_name: displayName, role: "trainee", status: "trial" },
          { onConflict: "email" }
        )
        .select("id, email, display_name")
        .single();
      if (userErr) {
        await sendTelegramReply(env, chatId, `❌ 建 user 失败:${userErr.message}`);
        return { handled: true, command };
      }
      const today = new Date().toISOString().slice(0, 10);
      const internalReq = new Request("https://internal/trigger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: {
            traineeEmail: user.email,
            startDate: today,
            mentorSlug: "nina_coach"
          },
          source: `sim:admin:${actor.userId}`
        })
      });
      const triggerRes = await workflowHandlers.handleWorkflowTrigger(internalReq, env, actor, "employee-first-day");
      const trig = (await triggerRes.json()) as any;
      await saveAgentRun(env, {
        agent_name: "orchestrator_agent",
        trigger_source: "sim:employee",
        status: "success",
        input_payload: { email, displayName },
        output_payload: { userId: user.id, runId: trig.runId },
        actor
      });
      await sendTelegramReply(
        env,
        chatId,
        [
          `*🧪 sim_employee 已启动*`,
          `user: ${user.display_name} (\`${user.email}\`)`,
          `user_id: \`${user.id}\``,
          `workflow run: \`${trig.runId ?? "?"}\``,
          "",
          "流程:2 个 human 步(confirm_gw_seat / confirm_gh_invite)需 /complete 推进。可以直接 complete:",
          `\`curl -X POST $WORKER/workflow-runs/${trig.runId}/steps/confirm_gw_seat/complete -H 'content-type: application/json' -d '{}'\``,
          "",
          "或直接 `/start_as <email>` 代入该员工身份走 bot 多轮流程(未实现,直接用 token 走私聊更真)。"
        ].join("\n")
      );
      return { handled: true, command };
    }

    if (command === "/sim_client") {
      const arg = text.slice(cmd.length).trim();
      const stamp = Date.now().toString(36);
      const clientName = arg || `Sim Client ${stamp}`;
      const contactEmail = `sim-contact-${stamp}@demo.local`;
      const { data: client, error: clientErr } = await supabase
        .from("clients")
        .insert({
          name: clientName,
          contact_name: "Sim Jane",
          contact_channel: `email:${contactEmail}`,
          billing_currency: "USD",
          status: "lead",
          notes: "simulated via /sim_client"
        })
        .select("id, name")
        .single();
      if (clientErr) {
        await sendTelegramReply(env, chatId, `❌ 建 client 失败:${clientErr.message}`);
        return { handled: true, command };
      }
      await supabase.from("client_contacts").insert({
        client_id: client.id,
        name: "Sim Jane",
        email: contactEmail,
        role_at_client: "PM",
        is_primary: true
      });
      const internalReq2 = new Request("https://internal/trigger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId: client.id,
          input: { clientId: client.id, name: `${clientName} Site`, projectCode: `sim-${stamp}-site`, projectType: "web", deliveryModel: "fixed" },
          source: `sim:admin:${actor.userId}`
        })
      });
      const triggerRes = await workflowHandlers.handleWorkflowTrigger(internalReq2, env, actor, "new-client-intake");
      const trig = (await triggerRes.json()) as any;
      await saveAgentRun(env, {
        agent_name: "orchestrator_agent",
        trigger_source: "sim:client",
        status: "success",
        input_payload: { clientName, contactEmail },
        output_payload: { clientId: client.id, contactEmail, runId: trig.runId },
        actor
      });
      await sendTelegramReply(
        env,
        chatId,
        [
          `*🧪 sim_client 已启动*`,
          `client: ${client.name}`,
          `client_id: \`${client.id}\``,
          `contact_email(用于 client bot /start): \`${contactEmail}\``,
          `workflow run(new-client-intake): \`${trig.runId ?? "?"}\``,
          "",
          "测:@one23_support_bot → /start → 回邮箱",
          `→ \`${contactEmail}\``
        ].join("\n")
      );
      return { handled: true, command };
    }

    if (command === "/sim_project") {
      const arg = text.slice(cmd.length).trim();
      let clientId: string | null = null;
      let clientName: string = "";
      if (arg) {
        const { data: c } = await supabase.from("clients").select("id, name").eq("name", arg).maybeSingle();
        if (!c) {
          await sendTelegramReply(env, chatId, `找不到 client "${arg}"。可以直接调用不带参数,会自动建一个。`);
          return { handled: true, command };
        }
        clientId = c.id;
        clientName = c.name;
      } else {
        const stamp = Date.now().toString(36);
        const { data: c, error } = await supabase
          .from("clients")
          .insert({ name: `Sim Client ${stamp}`, status: "active" })
          .select("id, name")
          .single();
        if (error) {
          await sendTelegramReply(env, chatId, `❌ 建 client 失败:${error.message}`);
          return { handled: true, command };
        }
        clientId = c.id;
        clientName = c.name;
      }
      const stamp = Date.now().toString(36);
      const projectCode = `sim-proj-${stamp}`;
      const { data: project, error: projErr } = await supabase
        .from("projects")
        .insert({
          client_id: clientId,
          name: `Sim Project ${stamp}`,
          project_code: projectCode,
          type: "web",
          status: "planning",
          owner_user_id: actor.userId,
          delivery_model: "fixed",
          risk_level: "low",
          summary: "simulated via /sim_project"
        })
        .select("id, name, project_code")
        .single();
      if (projErr) {
        await sendTelegramReply(env, chatId, `❌ 建 project 失败:${projErr.message}`);
        return { handled: true, command };
      }
      // 顺带建 3 条占位任务,让 /status 能看到内容
      await supabase.from("tasks").insert([
        { project_id: project.id, title: "Kickoff 会议", status: "todo", source_type: "system" },
        { project_id: project.id, title: "设计稿初稿", status: "todo", source_type: "system" },
        { project_id: project.id, title: "首次部署到 staging", status: "todo", source_type: "system" }
      ]);
      await saveAgentRun(env, {
        agent_name: "project_ops_agent",
        trigger_source: "sim:project",
        status: "success",
        project_id: project.id,
        input_payload: { clientId, clientName },
        output_payload: { projectId: project.id, projectCode: project.project_code },
        actor
      });
      await sendTelegramReply(
        env,
        chatId,
        [
          `*🧪 sim_project 已建立*`,
          `client: ${clientName}`,
          `project: ${project.name} (\`${project.project_code}\`)`,
          `project_id: \`${project.id}\``,
          "已附 3 条占位任务",
          "",
          "测:在任意群里发 /bind_project " + project.project_code
        ].join("\n")
      );
      return { handled: true, command };
    }

    if (command === "/sim_cleanup") {
      const supabase2 = getSupabaseAdmin(env);
      const results: Record<string, number> = {};
      // 清 sim users(会级联 onboarding_programs / onboarding_tasks / api_tokens / identity_bindings)
      const { count: ucount } = await supabase2
        .from("users")
        .delete({ count: "exact" })
        .like("email", "sim-%@demo.local");
      results.users = ucount ?? 0;
      // 清 sim projects(会级联 tasks / deployments / project_members)
      const { count: pcount } = await supabase2
        .from("projects")
        .delete({ count: "exact" })
        .like("project_code", "sim-%");
      results.projects = pcount ?? 0;
      // 清 sim clients(级联 projects / client_contacts)
      const { count: ccount } = await supabase2
        .from("clients")
        .delete({ count: "exact" })
        .like("name", "Sim Client %");
      results.clients = ccount ?? 0;
      await saveAgentRun(env, {
        agent_name: "orchestrator_agent",
        trigger_source: "sim:cleanup",
        status: "success",
        output_payload: results,
        actor
      });
      await sendTelegramReply(
        env,
        chatId,
        `🧹 cleanup: users=${results.users} projects=${results.projects} clients=${results.clients}`
      );
      return { handled: true, command };
    }
  }

  if (command === "/today") {
    const fromId = message?.from?.id ?? message?.chat?.id;
    const actor = await resolveByIdentity(env, "telegram", fromId ? String(fromId) : null);
    if (!actor?.userId) {
      await sendTelegramReply(env, chatId, "先 /start 绑定身份。");
      return { handled: true, command };
    }
    const session = await getTgSession(env, chatId);
    const viewAs = session?.state?.view_as_role;
    const viewAsUserId = session?.state?.view_as_user_id;
    const effectiveActor: ResolvedActor =
      viewAs === "trainee" && viewAsUserId
        ? { ...actor, userId: viewAsUserId, source: `${actor.source}:view_as_trainee` }
        : actor;
    const req = new Request("https://internal/today", { method: "GET" });
    const response = await onboardingHandlers.handleOnboardingToday(req, env, effectiveActor);
    const payload = (await response.json()) as any;
    if (!payload.ok) {
      await sendTelegramReply(env, chatId, `查询失败:${payload.error ?? "?"}`);
      return { handled: true, command };
    }
    if (!payload.active) {
      await sendTelegramReply(
        env,
        chatId,
        viewAs === "trainee" ? "这个 trainee 没有进行中的培训程序。" : "你没有进行中的培训程序。founder 用 /role trainee <email> 切换视角看别人的。"
      );
      return { handled: true, command };
    }
    const task = payload.task;
    const lines: string[] = [];
    lines.push(`Day ${payload.today_day_number}: ${task?.title ?? "(无任务)"}`);
    if (task?.today_goal) lines.push(`目标:${task.today_goal}`);
    if (task?.required_tasks) lines.push(`必做:${task.required_tasks}`);
    if (task?.required_outputs) lines.push(`产出:${task.required_outputs}`);
    if (payload.mentor_brief) lines.push(`\n${payload.mentor?.name ?? "教官"}:\n${payload.mentor_brief}`);
    if ((payload.guidance_sops ?? []).length > 0) {
      lines.push("\n相关 SOP:");
      for (const s of payload.guidance_sops) lines.push(`• ${String(s).slice(0, 120)}`);
    }
    if (task?.status === "todo" || task?.status === "doing") {
      lines.push("\n做完后:`/submit <简述 + URL/截图链接>`");
      lines.push("卡住:`/chat <你的问题>` 问 Nina");
    } else if (task?.status === "submitted") {
      lines.push("\n已提交,等 Nina 评分。需要修改:`/chat 我想改提交` 告诉 Nina。");
    } else if (task?.status === "done" || task?.status === "reviewed") {
      lines.push("\n✅ 此 Day 已完成。明天发 /today 看下一天。");
    }
    const prefix = viewAs === "trainee" ? "(以 trainee 视角)\n" : "";
    await sendTelegramReply(env, chatId, prefix + lines.join("\n"));
    return { handled: true, command };
  }

  if (command === "/submit") {
    const notes = text.slice(cmd.length).trim();
    if (!notes) {
      await sendTelegramReply(
        env,
        chatId,
        "用法:`/submit <简述 + URL/截图链接>`\n\n例:\n`/submit 做完 Phase 0,Replit URL https://oneagents-panel-xxx.replit.dev,env 已填`"
      );
      return { handled: true, command };
    }
    const fromId = message?.from?.id ?? message?.chat?.id;
    const actor = await resolveByIdentity(env, "telegram", fromId ? String(fromId) : null);
    if (!actor?.userId) {
      await sendTelegramReply(env, chatId, "先 /start 绑定身份。");
      return { handled: true, command };
    }
    const todayReq = new Request("https://internal/today", { method: "GET" });
    const todayRes = await onboardingHandlers.handleOnboardingToday(todayReq, env, actor);
    const todayPayload = (await todayRes.json()) as any;
    if (!todayPayload.ok || !todayPayload.active || !todayPayload.task?.id) {
      await sendTelegramReply(env, chatId, "没有进行中的培训 — 无法提交。");
      return { handled: true, command };
    }
    const taskId = todayPayload.task.id;
    const currentStatus = todayPayload.task.status;
    if (currentStatus !== "todo" && currentStatus !== "doing") {
      await sendTelegramReply(
        env,
        chatId,
        `Day ${todayPayload.today_day_number} 已经是 \`${currentStatus}\` 状态,无需再次提交。需要修改请 /chat 告诉 Nina。`
      );
      return { handled: true, command };
    }
    const uris = notes.match(/https?:\/\/[^\s)]+/g) ?? [];
    const submitReq = new Request(`https://internal/onboarding/tasks/${taskId}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes, uris })
    });
    const submitRes = await onboardingHandlers.handleOnboardingSubmit(submitReq, env, actor, taskId);
    const submitPayload = (await submitRes.json()) as any;
    if (submitPayload.ok) {
      const day = submitPayload.dayNumber;
      await sendTelegramReply(
        env,
        chatId,
        `✅ Day ${day} 已提交!${uris.length > 0 ? `(已记录 ${uris.length} 个链接)` : ""}\n\nNina 稍后会 review。\n明天发 /today 看 Day ${day + 1}。`
      );
    } else {
      await sendTelegramReply(env, chatId, `提交失败:${submitPayload.error ?? "unknown"}`);
    }
    return { handled: true, command };
  }

  if (command === "/role") {
    const actor = await resolveByIdentity(env, "telegram", fromIdGlobal);
    if (!actor?.userId) {
      await sendTelegramReply(env, chatId, "先 /start 绑定身份。");
      return { handled: true, command };
    }
    const supabase = getSupabaseAdmin(env);
    const { data: me } = await supabase.from("users").select("role").eq("id", actor.userId).maybeSingle();
    if (!me || me.role !== "founder") {
      await sendTelegramReply(env, chatId, "仅 founder 可切换视角。");
      return { handled: true, command };
    }
    const parts = text.split(/\s+/);
    const target = (parts[1] ?? "").toLowerCase();
    const session = await getTgSession(env, chatId);
    const currentState = session?.state ?? {};

    if (!target) {
      const view = currentState.view_as_role ?? me.role;
      const viewUser = currentState.view_as_user_email ?? "self";
      await sendTelegramReply(
        env,
        chatId,
        [
          `当前视角: ${view} (${viewUser})`,
          "",
          "切换:",
          "/role founder — 默认",
          "/role member — 隐藏 admin 内容",
          "/role trainee <email> — 作为指定学员看 /today /chat",
          "/role client <client-email> — 模拟客户侧(体验有限,真正客户走 client bot)",
          "/role reset — 回到真实身份"
        ].join("\n")
      );
      return { handled: true, command };
    }

    if (target === "reset" || target === "founder") {
      await setTgSession(env, chatId, "employee", {
        ...currentState,
        view_as_role: undefined,
        view_as_user_id: undefined,
        view_as_user_email: undefined,
        stage: "idle"
      });
      await sendTelegramReply(env, chatId, "✅ 已切回 founder 视角。");
      return { handled: true, command };
    }

    if (target === "member") {
      await setTgSession(env, chatId, "employee", {
        ...currentState,
        view_as_role: "member",
        view_as_user_id: undefined,
        view_as_user_email: undefined,
        stage: "idle"
      });
      await sendTelegramReply(env, chatId, "✅ 已切到 member 视角(仍用你自己的身份)。");
      return { handled: true, command };
    }

    if (target === "trainee") {
      const email = (parts[2] ?? "").toLowerCase();
      if (!email) {
        const { data: trainees } = await supabase
          .from("users")
          .select("email, display_name")
          .eq("role", "trainee")
          .eq("status", "trial")
          .order("created_at", { ascending: false })
          .limit(10);
        const list = (trainees ?? []).map((t) => `  ${t.display_name} <${t.email}>`).join("\n");
        await sendTelegramReply(
          env,
          chatId,
          `用法:/role trainee <email>\n\n当前 trainees:\n${list || "(无)"}`
        );
        return { handled: true, command };
      }
      const { data: u } = await supabase.from("users").select("id, display_name").eq("email", email).maybeSingle();
      if (!u) {
        await sendTelegramReply(env, chatId, `找不到 ${email}`);
        return { handled: true, command };
      }
      await setTgSession(env, chatId, "employee", {
        ...currentState,
        view_as_role: "trainee",
        view_as_user_id: u.id,
        view_as_user_email: email,
        stage: "idle"
      });
      await sendTelegramReply(
        env,
        chatId,
        `✅ 已切到 trainee 视角 → ${u.display_name} <${email}>\n\n现在发 /today 看他的当日任务,/chat 体验他的 mentor 对话。`
      );
      return { handled: true, command };
    }

    if (target === "client") {
      const email = (parts[2] ?? "").toLowerCase();
      if (!email) {
        await sendTelegramReply(env, chatId, "用法:/role client <client_contact_email>");
        return { handled: true, command };
      }
      const { data: c } = await supabase
        .from("client_contacts")
        .select("id, client_id, name, clients(name)")
        .eq("email", email)
        .maybeSingle();
      if (!c) {
        await sendTelegramReply(env, chatId, `找不到客户联系人 ${email}`);
        return { handled: true, command };
      }
      await setTgSession(env, chatId, "employee", {
        ...currentState,
        view_as_role: "client",
        view_as_client_id: c.client_id,
        view_as_user_email: email,
        stage: "idle"
      });
      await sendTelegramReply(
        env,
        chatId,
        `✅ 已切到 client 视角 → ${(c as any).clients?.name ?? "?"} / ${c.name}\n\n/status 会显示这个 client 的项目(只读风格)。真实客户用 @one23_support_bot。`
      );
      return { handled: true, command };
    }

    await sendTelegramReply(env, chatId, `未知角色 ${target}。/role 查用法。`);
    return { handled: true, command };
  }

  if (command === "/approve") {
    const stepRunId = text.split(/\s+/)[1]?.trim();
    if (!stepRunId) {
      await sendTelegramReply(env, chatId, "用法:/approve <step-run-id>");
      return { handled: true, command };
    }
    const fromId = message?.from?.id ?? message?.chat?.id;
    const actor = (await resolveByIdentity(env, "telegram", fromId ? String(fromId) : null)) ?? emptyActor("telegram");
    const r = await workflowHandlers.approveByStepRunId(env, stepRunId, actor);
    await sendTelegramReply(env, chatId, r.ok ? `✅ approved step ${r.stepKey}` : `❌ ${r.error}`);
    return { handled: true, command };
  }

  if (command === "/reject") {
    const parts = text.split(/\s+/);
    const stepRunId = parts[1]?.trim();
    const reason = parts.slice(2).join(" ").trim() || "rejected via telegram";
    if (!stepRunId) {
      await sendTelegramReply(env, chatId, "用法:/reject <step-run-id> <reason>");
      return { handled: true, command };
    }
    const fromId = message?.from?.id ?? message?.chat?.id;
    const actor = (await resolveByIdentity(env, "telegram", fromId ? String(fromId) : null)) ?? emptyActor("telegram");
    const r = await workflowHandlers.rejectByStepRunId(env, stepRunId, reason, actor);
    await sendTelegramReply(env, chatId, r.ok ? `🛑 rejected` : `❌ ${r.error}`);
    return { handled: true, command };
  }

  if (command === "/chat") {
    const userText = text.slice(cmd.length).trim();
    if (!userText) {
      await sendTelegramReply(env, chatId, "用法:/chat 你想问的内容");
      return { handled: true, command };
    }
    const fromId = message?.from?.id ?? message?.chat?.id;
    const actor = await resolveByIdentity(env, "telegram", fromId ? String(fromId) : null);
    if (!actor?.userId) {
      await sendTelegramReply(env, chatId, "你还没有绑定到 OneAgents 账号,请让管理员走 /admin/bindings/bind 绑定你的 Telegram。");
      return { handled: true, command };
    }
    // 检查 view_as 视角:如果 founder 切到 trainee,用那个 trainee 的 userId 调 mentor chat
    const session = await getTgSession(env, chatId);
    const viewAs = session?.state?.view_as_role;
    const viewAsUserId = session?.state?.view_as_user_id;
    const effectiveActor: ResolvedActor =
      viewAs === "trainee" && viewAsUserId
        ? { ...actor, userId: viewAsUserId, source: `${actor.source}:view_as_trainee` }
        : actor;
    const chatReq = new Request("https://internal/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: userText })
    });
    const response = await handleMentorChat(chatReq, env, effectiveActor);
    const payload = (await response.json()) as { ok: boolean; mentor?: { name: string }; reply?: string; error?: string };
    if (payload.ok) {
      const prefix = viewAs === "trainee" ? "(以 trainee 视角)" : "";
      await sendTelegramReply(env, chatId, `${prefix}${payload.mentor?.name}:\n${payload.reply}`);
    } else {
      await sendTelegramReply(env, chatId, `无法对话:${payload.error}`);
    }
    return { handled: true, command };
  }

  await sendTelegramReply(env, chatId, `未知指令 \`${command}\`,发送 /help 查看可用指令。`);
  return { handled: true, command: "unknown" };
}

async function handleTelegramWebhook(request: Request, env: Env, botRole: TgBotRole = "employee") {
  if (env.TG_WEBHOOK_SECRET) {
    const providedSecret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (!timingSafeEqual(providedSecret, env.TG_WEBHOOK_SECRET)) {
      return json({ ok: false, error: "invalid_secret" }, { status: 401 });
    }
  }

  const body = (await request.json()) as Record<string, any>;
  const callbackQuery = body?.callback_query ?? null;
  const myChatMember = body?.my_chat_member ?? null;
  const message = body?.message ?? body?.edited_message ?? null;
  const fromId =
    (myChatMember?.from?.id ?? callbackQuery?.from?.id ?? message?.from?.id ?? message?.chat?.id) ?? null;
  const actor =
    (await resolveByIdentity(env, "telegram", fromId ? String(fromId) : null)) ??
    emptyActor(`telegram:${botRole}:anonymous`);

  let dispatch: { handled: boolean; command?: string } = { handled: false };
  if (myChatMember) {
    dispatch = await handleMyChatMember(env, botRole, myChatMember);
  } else if (callbackQuery) {
    dispatch = await handleCallbackQuery(env, botRole, callbackQuery);
  } else if (message) {
    dispatch = await handleTelegramMessage(env, botRole, message);
  }

  await saveAgentRun(env, {
    agent_name: "onboarding_agent",
    trigger_source: "telegram_webhook",
    status: "success",
    input_payload: body,
    output_payload: { accepted: true, ...dispatch },
    actor
  });

  await saveAgentRun(env, {
    agent_name: "orchestrator_agent",
    trigger_source: "telegram_webhook",
    status: "success",
    input_payload: { command: dispatch.command ?? null, fromId },
    output_payload: { routedTo: "onboarding_agent", actorResolved: actor.userId !== null },
    actor
  });

  return json({
    ok: true,
    accepted: true,
    ...dispatch,
    actor: { userId: actor.userId, source: actor.source }
  });
}

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

async function getRelevantSops(
  env: Env,
  queryText: string,
  count = 3
): Promise<string[]> {
  const supabase = getSupabaseAdmin(env);
  const vector = await embedText(env, queryText).catch(() => null);
  if (vector) {
    try {
      const { data: matches } = await supabase.rpc("match_knowledge_chunks", {
        query_embedding: vector,
        match_threshold: 0.3,
        match_count: count
      });
      if (Array.isArray(matches) && matches.length > 0) {
        return (matches as Array<{ content: string }>).map((m) => m.content);
      }
    } catch {}
  }
  const { data: fallback } = await supabase
    .from("knowledge_documents")
    .select("title, summary")
    .eq("doc_type", "sop")
    .limit(count);
  return (fallback ?? []).map((d) => `${d.title}: ${d.summary}`);
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const task = (async () => {
      // 三个 cron:
      //   0 1 * * *  (09:00 CST) → 早晨 standup
      //   0 13 * * * (21:00 CST) → 晚间总结
      //   0 9 * * *  (17:00 CST) → 既有的全量扫(订阅/资产/coach digest 等)
      if (controller.cron === "0 1 * * *") {
        const standup = await import("./handlers/daily_standup").then((m) =>
          m.sendMorningStandup(env).catch((e) => ({ error: String(e) }))
        );
        await saveAgentRun(env, {
          agent_name: "standup_agent",
          trigger_source: `cron:${controller.cron}`,
          status: "success",
          output_payload: { standup }
        });
        return;
      }
      if (controller.cron === "0 13 * * *") {
        const summary = await import("./handlers/daily_standup").then((m) =>
          m.sendEveningSummary(env).catch((e) => ({ error: String(e) }))
        );
        await saveAgentRun(env, {
          agent_name: "standup_agent",
          trigger_source: `cron:${controller.cron}`,
          status: "success",
          output_payload: { summary }
        });
        return;
      }
      if (controller.cron === "0 4,7,10 * * *") {
        const checkin = await import("./handlers/daily_standup").then((m) =>
          m.sendMentorMidDayCheckIn(env).catch((e) => ({ error: String(e) }))
        );
        await saveAgentRun(env, {
          agent_name: "mentor_companion",
          trigger_source: `cron:${controller.cron}`,
          status: "success",
          output_payload: { checkin }
        });
        return;
      }
      // 默认走原 17:00 CST 全量扫
      const sub = await scanSubscriptionRenewals(env).catch((e) => ({ error: String(e) }));
      const ast = await scanAssetRenewals(env).catch((e) => ({ error: String(e) }));
      const tg = await flushPendingTelegramNotifications(env).catch((e) => ({ error: String(e) }));
      const invitesNudge = await nudgePendingInvites(env).catch((e) => ({ error: String(e) }));
      const coachSweep = await runDailyCoachSweep(env).catch((e) => ({ error: String(e) }));
      const coachDigest = await sendDailyCoachDigest(env).catch((e) => ({ error: String(e) }));
      await saveAgentRun(env, {
        agent_name: "orchestrator_agent",
        trigger_source: `cron:${controller.cron}`,
        status: "success",
        output_payload: { sub, ast, tg, invitesNudge, coachSweep, coachDigest }
      });
    })();
    ctx.waitUntil(task);
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return corsPreflight();

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) {
      return agentResponse;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        app: env.APP_NAME,
        env: env.APP_ENV,
        now: new Date().toISOString()
      });
    }

    if (request.method === "POST" && url.pathname === "/webhooks/github") {
      return handleGithubWebhook(request, env);
    }

    if (request.method === "POST" && url.pathname === "/webhooks/telegram") {
      return handleTelegramWebhook(request, env, "employee");
    }

    if (request.method === "POST" && url.pathname === "/webhooks/telegram/employee") {
      return handleTelegramWebhook(request, env, "employee");
    }

    if (request.method === "POST" && url.pathname === "/webhooks/telegram/client") {
      return handleTelegramWebhook(request, env, "client");
    }

    if (request.method === "GET" && url.pathname === "/oauth/google/start") {
      return googleOAuthHandlers.handleGoogleOAuthStart(request, env);
    }

    if (request.method === "GET" && url.pathname === "/oauth/google/callback") {
      return googleOAuthHandlers.handleGoogleOAuthCallback(request, env);
    }

    const bearerActor = (await resolveBearer(env, request.headers.get("authorization"))) ??
      emptyActor("anonymous");

    if (request.method === "GET" && url.pathname === "/me") {
      if (!bearerActor.userId) {
        return json({ ok: true, authenticated: false, source: bearerActor.source });
      }
      const supabase = getSupabaseAdmin(env);
      const { data: user } = await supabase
        .from("users")
        .select("id, email, display_name, role, status")
        .eq("id", bearerActor.userId)
        .maybeSingle();
      const { data: bindings } = await supabase
        .from("identity_bindings")
        .select("provider, provider_user_id, display_name")
        .eq("user_id", bearerActor.userId);
      return json({
        ok: true,
        authenticated: true,
        source: bearerActor.source,
        scopes: bearerActor.scopes,
        user,
        bindings: bindings ?? []
      });
    }

    if (request.method === "POST" && url.pathname === "/admin/tokens/create") {
      const guard = requireAdmin(env, request);
      if (guard) return guard;
      return adminHandlers.handleCreateToken(request, env);
    }

    if (request.method === "POST" && url.pathname === "/admin/bindings/bind") {
      const guard = requireAdmin(env, request);
      if (guard) return guard;
      return adminHandlers.handleBindIdentity(request, env);
    }

    if (request.method === "POST" && url.pathname === "/admin/connectors/register") {
      const guard = requireAdmin(env, request);
      if (guard) return guard;
      return adminHandlers.handleRegisterConnector(request, env);
    }

    if (request.method === "POST" && url.pathname === "/workflows/meeting") {
      return legacyWorkflowHandlers.handleMeetingWorkflow(request, env, bearerActor);
    }

    if (request.method === "POST" && url.pathname === "/workflows/finance") {
      return legacyWorkflowHandlers.handleFinanceWorkflow(request, env, bearerActor);
    }

    if (request.method === "POST" && url.pathname === "/workflows/knowledge") {
      return legacyWorkflowHandlers.handleKnowledgeWorkflow(request, env, bearerActor);
    }

    if (request.method === "POST" && url.pathname === "/workflows/infra") {
      return legacyWorkflowHandlers.handleInfraWorkflow(request, env, bearerActor);
    }

    if (request.method === "GET" && url.pathname === "/mentors") {
      const supabase = getSupabaseAdmin(env);
      const { data } = await supabase
        .from("mentors")
        .select("slug, display_name, title, tone, strengths, suits_phases, persona")
        .eq("is_active", true)
        .order("slug");
      return json({ ok: true, mentors: data ?? [] });
    }

    if (request.method === "POST" && url.pathname === "/onboarding/me/chat") {
      return onboardingHandlers.handleMentorChat(request, env, bearerActor);
    }

    if (request.method === "POST" && url.pathname === "/onboarding/me/intake") {
      return onboardingHandlers.handleMentorIntake(request, env, bearerActor);
    }

    if (request.method === "POST" && url.pathname === "/admin/knowledge/research") {
      const guard = requireAdmin(env, request);
      if (guard) return guard;
      return adminHandlers.handleResearchKnowledge(request, env, bearerActor);
    }

    const transcriptMatch = url.pathname.match(/^\/admin\/programs\/([0-9a-f-]{36})\/transcript$/);
    if (request.method === "GET" && transcriptMatch) {
      const guard = requireAdmin(env, request);
      if (guard) return guard;
      return adminHandlers.handleAdminTranscript(env, transcriptMatch[1]);
    }

    if (request.method === "GET" && url.pathname === "/admin/conversations") {
      const guard = requireAdmin(env, request);
      if (guard) return guard;
      return adminHandlers.handleAdminConversationList(env, url);
    }

    if (request.method === "GET" && url.pathname === "/admin/mentors/stats") {
      const guard = requireAdmin(env, request);
      if (guard) return guard;
      return adminHandlers.handleAdminMentorStats(env);
    }

    if (request.method === "POST" && url.pathname === "/entities/clients") {
      return entityHandlers.handleCreateClient(request, env, bearerActor);
    }

    if (request.method === "POST" && url.pathname === "/entities/projects") {
      return entityHandlers.handleCreateProject(request, env, bearerActor);
    }

    if (request.method === "POST" && url.pathname === "/entities/project-members") {
      return entityHandlers.handleCreateProjectMember(request, env, bearerActor);
    }

    if (request.method === "POST" && url.pathname === "/entities/tasks") {
      return entityHandlers.handleCreateTask(request, env, bearerActor);
    }

    if (request.method === "POST" && url.pathname === "/onboarding/programs/start") {
      return onboardingHandlers.handleOnboardingStart(request, env, bearerActor);
    }

    if (request.method === "GET" && url.pathname === "/onboarding/me/today") {
      return onboardingHandlers.handleOnboardingToday(request, env, bearerActor);
    }

    const submitMatch = url.pathname.match(/^\/onboarding\/tasks\/([0-9a-f-]{36})\/submit$/);
    if (request.method === "POST" && submitMatch) {
      return onboardingHandlers.handleOnboardingSubmit(request, env, bearerActor, submitMatch[1]);
    }

    const gradeMatch = url.pathname.match(/^\/onboarding\/tasks\/([0-9a-f-]{36})\/grade$/);
    if (request.method === "POST" && gradeMatch) {
      return onboardingHandlers.handleOnboardingGrade(request, env, bearerActor, gradeMatch[1]);
    }

    const summaryMatch = url.pathname.match(/^\/onboarding\/programs\/([0-9a-f-]{36})\/summary$/);
    if (request.method === "GET" && summaryMatch) {
      return onboardingHandlers.handleOnboardingSummary(request, env, summaryMatch[1]);
    }

    // --- GET 列表族 ---
    if (request.method === "GET" && url.pathname === "/entities/clients") {
      return entityHandlers.handleListClients(env, url);
    }
    if (request.method === "GET" && url.pathname === "/entities/projects") {
      return entityHandlers.handleListProjects(env, url);
    }
    if (request.method === "GET" && url.pathname === "/entities/tasks") {
      return entityHandlers.handleListTasks(env, url);
    }
    if (request.method === "GET" && url.pathname === "/entities/meetings") {
      return entityHandlers.handleListMeetings(env, url);
    }
    if (request.method === "GET" && url.pathname === "/entities/users") {
      return entityHandlers.handleListUsers(env, url);
    }
    if (request.method === "GET" && url.pathname === "/entities/onboarding-programs") {
      return entityHandlers.handleListOnboardingPrograms(env, url);
    }
    if (request.method === "GET" && url.pathname === "/entities/organizations") {
      return entityHandlers.handleListOrganizations(env, url);
    }
    if (request.method === "GET" && url.pathname === "/connectors") {
      return entityHandlers.handleListConnectors(env);
    }
    // 注意:/agents 前缀被 agents SDK 的 routeAgentRequest 截,用 /admin/agents
    if (request.method === "GET" && url.pathname === "/admin/agents") {
      return adminHandlers.handleListAgents(env);
    }
    if (request.method === "GET" && url.pathname === "/agent-runs") {
      return adminHandlers.handleListAgentRuns(env, url);
    }
    const agentStateMatch = url.pathname.match(/^\/admin\/agents\/([A-Za-z]+)\/state$/);
    if (request.method === "GET" && agentStateMatch) {
      return adminHandlers.handleAgentState(env, agentStateMatch[1]);
    }

    // --- GET 详情 ---
    const clientDetailMatch = url.pathname.match(/^\/entities\/clients\/([0-9a-f-]{36})$/);
    if (request.method === "GET" && clientDetailMatch) {
      return entityHandlers.handleClientDetail(env, clientDetailMatch[1]);
    }
    const projectDetailMatch = url.pathname.match(/^\/entities\/projects\/([0-9a-f-]{36})$/);
    if (request.method === "GET" && projectDetailMatch) {
      return entityHandlers.handleProjectDetail(env, projectDetailMatch[1]);
    }

    // --- PATCH (/DELETE) ---
    if (request.method === "PATCH" && clientDetailMatch) {
      return entityHandlers.handlePatchClient(request, env, clientDetailMatch[1]);
    }
    if (request.method === "PATCH" && projectDetailMatch) {
      return entityHandlers.handlePatchProject(request, env, projectDetailMatch[1]);
    }
    const taskDetailMatch = url.pathname.match(/^\/entities\/tasks\/([0-9a-f-]{36})$/);
    if (request.method === "PATCH" && taskDetailMatch) {
      return entityHandlers.handlePatchTask(request, env, taskDetailMatch[1]);
    }

    // --- client contacts CRUD ---
    if (request.method === "POST" && url.pathname === "/entities/client-contacts") {
      return entityHandlers.handleCreateClientContact(request, env, bearerActor);
    }
    const contactDetailMatch = url.pathname.match(/^\/entities\/client-contacts\/([0-9a-f-]{36})$/);
    if (request.method === "PATCH" && contactDetailMatch) {
      return entityHandlers.handlePatchClientContact(request, env, contactDetailMatch[1]);
    }
    if (request.method === "DELETE" && contactDetailMatch) {
      return entityHandlers.handleDeleteClientContact(env, contactDetailMatch[1]);
    }

    // --- /me convenience ---
    if (request.method === "GET" && url.pathname === "/me/tasks") {
      return entityHandlers.handleMeTasks(env, bearerActor);
    }
    if (request.method === "GET" && url.pathname === "/me/projects") {
      return entityHandlers.handleMeProjects(env, bearerActor);
    }

    if (request.method === "GET" && url.pathname === "/workflows") {
      return workflowHandlers.handleWorkflowList(env);
    }

    const wfTriggerMatch = url.pathname.match(/^\/workflows\/([a-z0-9-]+)\/trigger$/);
    if (request.method === "POST" && wfTriggerMatch) {
      return workflowHandlers.handleWorkflowTrigger(request, env, bearerActor, wfTriggerMatch[1]);
    }

    const wfRunMatch = url.pathname.match(/^\/workflow-runs\/([0-9a-f-]{36})$/);
    if (request.method === "GET" && wfRunMatch) {
      return workflowHandlers.handleWorkflowRunGet(env, wfRunMatch[1]);
    }

    const wfCompleteMatch = url.pathname.match(/^\/workflow-runs\/([0-9a-f-]{36})\/steps\/([a-z0-9_]+)\/complete$/);
    if (request.method === "POST" && wfCompleteMatch) {
      return workflowHandlers.handleWorkflowStepComplete(request, env, bearerActor, wfCompleteMatch[1], wfCompleteMatch[2]);
    }

    const wfApproveMatch = url.pathname.match(/^\/workflow-runs\/([0-9a-f-]{36})\/steps\/([a-z0-9_]+)\/approve$/);
    if (request.method === "POST" && wfApproveMatch) {
      return workflowHandlers.handleWorkflowStepApprove(request, env, bearerActor, wfApproveMatch[1], wfApproveMatch[2]);
    }

    const wfRejectMatch = url.pathname.match(/^\/workflow-runs\/([0-9a-f-]{36})\/steps\/([a-z0-9_]+)\/reject$/);
    if (request.method === "POST" && wfRejectMatch) {
      return workflowHandlers.handleWorkflowStepReject(request, env, bearerActor, wfRejectMatch[1], wfRejectMatch[2]);
    }

    if (request.method === "POST" && url.pathname === "/admin/knowledge/embed-pending") {
      const guard = requireAdmin(env, request);
      if (guard) return guard;
      const result = await adminHandlers.handleEmbedPendingKnowledge(env);
      return json({ ok: true, ...result });
    }

    // --- Training Coach ---
    const coachReviewMatch = url.pathname.match(/^\/training-coach\/review\/([0-9a-f-]{36})$/);
    if (request.method === "POST" && coachReviewMatch) {
      const result = await runCoachReview(env, coachReviewMatch[1], "manual", bearerActor);
      return json(result);
    }
    if (request.method === "POST" && url.pathname === "/training-coach/sweep") {
      const guard = requireAdmin(env, request);
      if (guard) return guard;
      const result = await runDailyCoachSweep(env);
      return json(result);
    }
    if (request.method === "POST" && url.pathname === "/training-coach/digest") {
      const guard = requireAdmin(env, request);
      if (guard) return guard;
      const result = await sendDailyCoachDigest(env);
      return json(result);
    }
    if (request.method === "POST" && url.pathname === "/training-coach/nudge-invites") {
      const guard = requireAdmin(env, request);
      if (guard) return guard;
      const result = await nudgePendingInvites(env);
      return json(result);
    }
    const coachReportMatch = url.pathname.match(/^\/training-coach\/report\/([0-9a-f-]{36})$/);
    if (request.method === "GET" && coachReportMatch) {
      const r = await generateProgramReport(env, coachReportMatch[1]);
      return json(r);
    }
    const coachApplyMatch = url.pathname.match(/^\/training-coach\/reviews\/([0-9a-f-]{36})\/apply$/);
    if (request.method === "POST" && coachApplyMatch) {
      const supabase = getSupabaseAdmin(env);
      const { data: review } = await supabase
        .from("training_coach_reviews")
        .select("id, program_id, recommendations, applied_at")
        .eq("id", coachApplyMatch[1])
        .maybeSingle<any>();
      if (!review) return json({ ok: false, error: "review_not_found" }, { status: 404 });
      if (review.applied_at) return json({ ok: false, error: "already_applied" });
      const { data: prog } = await supabase
        .from("onboarding_programs")
        .select("trainee_user_id")
        .eq("id", review.program_id)
        .maybeSingle();
      if (!prog) return json({ ok: false, error: "program_missing" }, { status: 404 });
      const results: any[] = [];
      for (const rec of review.recommendations ?? []) {
        const r = await coachApply(env, review.program_id, prog.trainee_user_id, rec);
        await supabase.from("training_coach_actions").insert({
          review_id: review.id,
          kind: rec.kind,
          params: rec.params,
          result: r as any
        });
        results.push({ kind: rec.kind, ok: r.ok });
      }
      await supabase
        .from("training_coach_reviews")
        .update({
          applied_at: new Date().toISOString(),
          applied_by_user_id: bearerActor.userId
        })
        .eq("id", review.id);
      return json({ ok: true, applied: results.length, results });
    }

    // --- Superadmin(多租户管理)---
    // 鉴权:Bearer token scopes 里必须有 'superadmin'
    if (url.pathname.startsWith("/superadmin/")) {
      const guard = superadminHandlers.requireSuperadmin(bearerActor);
      if (guard) return guard;

      if (request.method === "GET" && url.pathname === "/superadmin/tenants") {
        return await superadminHandlers.listTenants(env);
      }
      if (request.method === "POST" && url.pathname === "/superadmin/tenants") {
        const body = await request.json().catch(() => ({}));
        return await superadminHandlers.createTenant(env, body as any, bearerActor);
      }
      const tenantIdMatch = url.pathname.match(/^\/superadmin\/tenants\/([0-9a-f-]{36})(?:\/(modules|agents))?$/);
      if (tenantIdMatch) {
        const tenantId = tenantIdMatch[1];
        const sub = tenantIdMatch[2];
        if (!sub) {
          if (request.method === "GET") return await superadminHandlers.getTenant(env, tenantId);
          if (request.method === "PUT") {
            const body = await request.json().catch(() => ({}));
            return await superadminHandlers.updateTenant(env, tenantId, body as any);
          }
        } else if (sub === "modules") {
          if (request.method === "GET") return await superadminHandlers.listTenantModules(env, tenantId);
          if (request.method === "PUT") {
            const body = await request.json().catch(() => ({ updates: [] }));
            return await superadminHandlers.bulkSetTenantModules(env, tenantId, (body as any).updates ?? []);
          }
        } else if (sub === "agents") {
          if (request.method === "GET") return await superadminHandlers.listTenantAgents(env, tenantId);
          if (request.method === "PUT") {
            const body = await request.json().catch(() => ({ updates: [] }));
            return await superadminHandlers.bulkSetTenantAgents(env, tenantId, (body as any).updates ?? []);
          }
        }
      }
      return json({ ok: false, error: "superadmin_route_not_found" }, { status: 404 });
    }

    if (request.method === "POST" && url.pathname === "/cron/run") {
      const sub = await scanSubscriptionRenewals(env).catch((e) => ({ error: String(e) }));
      const ast = await scanAssetRenewals(env).catch((e) => ({ error: String(e) }));
      const tg = await flushPendingTelegramNotifications(env).catch((e) => ({ error: String(e) }));
      return json({ ok: true, sub, ast, tg });
    }

    if (request.method === "POST" && url.pathname === "/cron/standup-morning") {
      const guard = requireAdmin(env, request);
      if (guard) return guard;
      const { sendMorningStandup } = await import("./handlers/daily_standup");
      const result = await sendMorningStandup(env);
      return json({ ok: true, ...result });
    }

    if (request.method === "POST" && url.pathname === "/cron/standup-evening") {
      const guard = requireAdmin(env, request);
      if (guard) return guard;
      const { sendEveningSummary } = await import("./handlers/daily_standup");
      const result = await sendEveningSummary(env);
      return json({ ok: true, ...result });
    }

    if (request.method === "POST" && url.pathname === "/cron/mentor-checkin") {
      const guard = requireAdmin(env, request);
      if (guard) return guard;
      const { sendMentorMidDayCheckIn } = await import("./handlers/daily_standup");
      const result = await sendMentorMidDayCheckIn(env);
      return json({ ok: true, ...result });
    }

    return json({ ok: false, error: "not_found" }, { status: 404 });
  }
};
