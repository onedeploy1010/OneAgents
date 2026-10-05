import { z } from "zod";
import type { Env } from "../lib/env";
import { json } from "../lib/http";
import { getSupabaseAdmin } from "../lib/supabase";
import { aiChatComplete } from "../lib/ai";
import { saveAgentRun, type ResolvedActor } from "../lib/actor";
import { sendTelegram } from "../lib/telegram";

// ============ schemas ============

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

export interface WorkflowStepRow {
  id: string;
  step_key: string;
  step_index: number;
  name: string;
  executor_kind: "agent" | "ai_platform" | "tool" | "webhook" | "human";
  executor_ref: string | null;
  executor_config: Record<string, any>;
  requires_approval: boolean;
  approver_roles: string[];
  depends_on: string[];
  on_success_step_key: string | null;
  on_failure_step_key: string | null;
  notification_targets: Record<string, any>;
}

function renderTemplate(tpl: string, vars: Record<string, any>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

async function notifyStep(env: Env, message: string, targets: Record<string, any>) {
  if (targets?.telegram && env.TG_BOT_TOKEN && env.TG_DEFAULT_CHAT_ID) {
    await sendTelegram(env, "Workflow", message);
  }
}

// ============ tool executors ============

async function executeToolStep(
  env: Env,
  step: WorkflowStepRow,
  runInput: Record<string, any>,
  prevOutputs: Record<string, Record<string, any>>
): Promise<{ ok: boolean; output?: Record<string, any>; error?: string }> {
  const ref = step.executor_ref ?? "";
  const config = step.executor_config ?? {};

  if (ref === "telegram/send") {
    const template = config.template ?? "Workflow step {step_key} completed.";
    const supabase = getSupabaseAdmin(env);
    const resolved: Record<string, any> = { step_key: step.step_key };
    if (runInput.traineeEmail) {
      const { data: u } = await supabase
        .from("users")
        .select("display_name")
        .eq("email", runInput.traineeEmail)
        .maybeSingle();
      resolved.trainee_name = u?.display_name ?? runInput.traineeEmail;
    }
    if (runInput.mentorSlug) {
      const { data: m } = await supabase
        .from("mentors")
        .select("display_name")
        .eq("slug", runInput.mentorSlug)
        .maybeSingle();
      resolved.mentor_name = m?.display_name ?? runInput.mentorSlug;
    }
    if (runInput.clientId) {
      const { data: c } = await supabase
        .from("clients")
        .select("name")
        .eq("id", runInput.clientId)
        .maybeSingle();
      resolved.client_name = c?.name ?? runInput.clientId;
    }
    const projectOut = prevOutputs.create_project ?? {};
    if (projectOut.projectCode) resolved.project_code = projectOut.projectCode;
    if (projectOut.projectId) {
      const { data: p } = await supabase
        .from("projects")
        .select("name")
        .eq("id", projectOut.projectId)
        .maybeSingle();
      resolved.project_name = p?.name ?? projectOut.projectCode ?? "";
    }
    const vars = { ...runInput, ...prevOutputs, ...resolved };
    const rendered = renderTemplate(template, vars);
    await sendTelegram(env, "Workflow", rendered);
    return { ok: true, output: { message: rendered } };
  }

  if (ref === "entities/projects") {
    try {
      const supabase = getSupabaseAdmin(env);
      const from = (config.from_input ?? []) as string[];
      const payload: Record<string, any> = {};
      for (const k of from) payload[k] = runInput[k];
      const { data, error } = await supabase
        .from("projects")
        .insert({
          client_id: payload.clientId,
          name: payload.name,
          project_code: payload.projectCode,
          type: payload.projectType ?? "web",
          status: "planning",
          delivery_model: payload.deliveryModel ?? "fixed"
        })
        .select("id, project_code")
        .single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, output: { projectId: data.id, projectCode: data.project_code } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  if (ref === "onboarding/start") {
    try {
      const supabase = getSupabaseAdmin(env);
      const traineeEmail = runInput.traineeEmail;
      const { data: user } = await supabase
        .from("users")
        .select("id")
        .eq("email", traineeEmail)
        .maybeSingle();
      if (!user) return { ok: false, error: "trainee_not_found" };
      const { data: tpl } = await supabase
        .from("onboarding_templates")
        .select("id, duration_days")
        .eq("name", runInput.templateName ?? "default_15_day")
        .maybeSingle();
      if (!tpl) return { ok: false, error: "template_not_found" };
      const startDate = new Date(
        (runInput.startDate ?? new Date().toISOString().slice(0, 10)) + "T00:00:00Z"
      );
      const endDate = new Date(startDate);
      endDate.setUTCDate(endDate.getUTCDate() + (tpl.duration_days - 1));
      const { data: prog, error } = await supabase
        .from("onboarding_programs")
        .insert({
          trainee_user_id: user.id,
          template_id: tpl.id,
          mentor_slug: runInput.mentorSlug ?? null,
          start_date: runInput.startDate,
          end_date: endDate.toISOString().slice(0, 10),
          status: "active"
        })
        .select("id")
        .single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, output: { programId: prog.id } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  if (ref === "onboarding/today") {
    return {
      ok: true,
      output: { hint: "trainee should call /onboarding/me/today with own token" }
    };
  }

  return { ok: false, error: `unknown_tool:${ref}` };
}

async function executeAiPlatformStep(
  env: Env,
  step: WorkflowStepRow,
  runInput: Record<string, any>
): Promise<{ ok: boolean; output?: Record<string, any>; error?: string }> {
  const cfg = step.executor_config ?? {};
  const system = cfg.system_prompt ?? "You are a workflow assistant.";
  const user = renderTemplate(cfg.user_prompt ?? "{input}", { input: JSON.stringify(runInput) });
  try {
    const content = await aiChatComplete(env, system, user);
    return { ok: true, output: { content } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function executeWebhookStep(
  env: Env,
  step: WorkflowStepRow,
  runInput: Record<string, any>
): Promise<{ ok: boolean; output?: Record<string, any>; error?: string }> {
  const cfg = step.executor_config ?? {};
  const urlStr = cfg.url as string | undefined;
  if (!urlStr) return { ok: false, error: "webhook_url_missing" };
  try {
    const res = await fetch(urlStr, {
      method: cfg.method ?? "POST",
      headers: cfg.headers ?? { "content-type": "application/json" },
      body: JSON.stringify({ ...runInput, step_key: step.step_key })
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `webhook_${res.status}:${text.slice(0, 200)}` };
    return { ok: true, output: { status: res.status, body: text.slice(0, 500) } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ============ engine ============

async function loadRunContext(env: Env, runId: string) {
  const supabase = getSupabaseAdmin(env);
  const { data: run } = await supabase.from("workflow_runs").select("*").eq("id", runId).maybeSingle();
  if (!run) return { run: null, steps: [], stepRuns: [], workflow: null };
  const { data: workflow } = await supabase
    .from("workflows")
    .select("id, slug, name")
    .eq("id", run.workflow_id)
    .maybeSingle();
  const { data: steps } = await supabase
    .from("workflow_steps")
    .select("*")
    .eq("workflow_id", run.workflow_id)
    .order("step_index", { ascending: true });
  const { data: stepRuns } = await supabase
    .from("workflow_step_runs")
    .select("*")
    .eq("run_id", runId);
  return { run, workflow, steps: (steps ?? []) as WorkflowStepRow[], stepRuns: stepRuns ?? [] };
}

export async function advanceWorkflow(env: Env, runId: string, actor: ResolvedActor) {
  const ctx = await loadRunContext(env, runId);
  if (!ctx.run) return;
  const supabase = getSupabaseAdmin(env);

  const completedKeys = new Set(
    ctx.stepRuns
      .filter(
        (sr) => sr.status === "completed" || sr.status === "approved" || sr.status === "skipped"
      )
      .map((sr) => sr.step_key)
  );
  const failedKeys = new Set(
    ctx.stepRuns.filter((sr) => sr.status === "failed").map((sr) => sr.step_key)
  );

  for (const step of ctx.steps) {
    const sr = ctx.stepRuns.find((x) => x.step_key === step.step_key);
    if (!sr) continue;
    if (sr.status !== "pending") continue;
    const deps = step.depends_on ?? [];
    if (deps.length > 0 && !deps.every((d) => completedKeys.has(d))) {
      if (deps.some((d) => failedKeys.has(d))) {
        await supabase
          .from("workflow_step_runs")
          .update({ status: "skipped", notes: "upstream_failed", updated_at: new Date().toISOString() })
          .eq("id", sr.id);
      }
      continue;
    }
    await dispatchStep(env, runId, sr.id, actor);
  }

  const refreshed = await loadRunContext(env, runId);
  const anyFailed = refreshed.stepRuns.some((sr) => sr.status === "failed");
  const anyWaiting = refreshed.stepRuns.some(
    (sr) => sr.status === "pending" || sr.status === "running" || sr.status === "awaiting_approval"
  );
  if (!anyWaiting) {
    await supabase
      .from("workflow_runs")
      .update({
        status: anyFailed ? "failed" : "completed",
        finished_at: new Date().toISOString(),
        current_step_key: null
      })
      .eq("id", runId);
  }
}

async function dispatchStep(env: Env, runId: string, stepRunId: string, actor: ResolvedActor) {
  const supabase = getSupabaseAdmin(env);
  const { data: sr } = await supabase
    .from("workflow_step_runs")
    .select("id, step_id, status, step_key, run_id, approval_required")
    .eq("id", stepRunId)
    .maybeSingle();
  if (!sr) return;
  const { data: step } = await supabase
    .from("workflow_steps")
    .select("*")
    .eq("id", sr.step_id)
    .maybeSingle<WorkflowStepRow>();
  if (!step) return;
  const { data: run } = await supabase
    .from("workflow_runs")
    .select("input_payload")
    .eq("id", runId)
    .maybeSingle();

  const { data: prevRuns } = await supabase
    .from("workflow_step_runs")
    .select("step_key, output_payload")
    .eq("run_id", runId);
  const prevOutputs: Record<string, any> = {};
  for (const r of prevRuns ?? []) prevOutputs[r.step_key] = r.output_payload ?? {};

  await supabase
    .from("workflow_step_runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", stepRunId);
  await supabase.from("workflow_runs").update({ current_step_key: step.step_key }).eq("id", runId);

  await saveAgentRun(env, {
    agent_name: "orchestrator_agent",
    trigger_source: "workflow/dispatch",
    status: "running",
    input_payload: { runId, stepKey: step.step_key, executor: step.executor_kind },
    actor
  });

  await notifyStep(
    env,
    `▶️ ${step.name} (${step.step_key}) 开始 — executor: ${step.executor_kind}:${step.executor_ref ?? ""}`,
    step.notification_targets ?? {}
  );

  let result: { ok: boolean; output?: Record<string, any>; error?: string } | null = null;

  if (step.executor_kind === "human" || step.executor_kind === "agent") {
    if (step.requires_approval) {
      await supabase
        .from("workflow_step_runs")
        .update({ status: "awaiting_approval", approval_required: true })
        .eq("id", stepRunId);
      await notifyStep(
        env,
        `⏸ ${step.name} 需要审批。通过:/approve ${stepRunId}`,
        step.notification_targets ?? {}
      );
    }
    return;
  }

  if (step.executor_kind === "tool") {
    result = await executeToolStep(env, step, run?.input_payload ?? {}, prevOutputs);
  } else if (step.executor_kind === "ai_platform") {
    result = await executeAiPlatformStep(env, step, run?.input_payload ?? {});
  } else if (step.executor_kind === "webhook") {
    result = await executeWebhookStep(env, step, run?.input_payload ?? {});
  }

  if (!result) return;

  if (!result.ok) {
    await supabase
      .from("workflow_step_runs")
      .update({
        status: "failed",
        error_message: result.error ?? "unknown",
        completed_at: new Date().toISOString()
      })
      .eq("id", stepRunId);
    await notifyStep(env, `❌ ${step.name} 失败: ${result.error}`, step.notification_targets ?? {});
    return;
  }

  if (step.requires_approval) {
    await supabase
      .from("workflow_step_runs")
      .update({
        status: "awaiting_approval",
        approval_required: true,
        output_payload: result.output ?? {}
      })
      .eq("id", stepRunId);
    await notifyStep(
      env,
      `⏸ ${step.name} 执行完,等审批。通过:/approve ${stepRunId}`,
      step.notification_targets ?? {}
    );
    return;
  }

  await supabase
    .from("workflow_step_runs")
    .update({
      status: "completed",
      output_payload: result.output ?? {},
      completed_at: new Date().toISOString()
    })
    .eq("id", stepRunId);
  await notifyStep(env, `✅ ${step.name} 完成`, step.notification_targets ?? {});
  await advanceWorkflow(env, runId, actor);
}

// ============ HTTP handlers ============

export async function handleWorkflowTrigger(
  request: Request,
  env: Env,
  actor: ResolvedActor,
  slug: string
) {
  const body = await request.json();
  const p = workflowTriggerPayloadSchema.parse(body);
  const supabase = getSupabaseAdmin(env);
  const { data: workflow } = await supabase
    .from("workflows")
    .select("id, slug, name, is_active")
    .eq("slug", slug)
    .maybeSingle();
  if (!workflow || !workflow.is_active)
    return json({ ok: false, error: "workflow_not_found" }, { status: 404 });
  const { data: steps } = await supabase
    .from("workflow_steps")
    .select("id, step_key, depends_on, requires_approval")
    .eq("workflow_id", workflow.id)
    .order("step_index", { ascending: true });
  if (!steps || steps.length === 0) return json({ ok: false, error: "no_steps" }, { status: 400 });

  const { data: run, error: runErr } = await supabase
    .from("workflow_runs")
    .insert({
      workflow_id: workflow.id,
      project_id: p.projectId ?? null,
      client_id: p.clientId ?? null,
      triggered_by_user_id: actor.userId ?? null,
      triggered_by_source: p.source,
      input_payload: p.input,
      status: "active"
    })
    .select("id")
    .single();
  if (runErr || !run) return json({ ok: false, error: runErr?.message ?? "run_insert_failed" }, { status: 500 });

  const stepRunRows = steps.map((s) => ({
    run_id: run.id,
    step_id: s.id,
    step_key: s.step_key,
    status: "pending",
    approval_required: s.requires_approval
  }));
  await supabase.from("workflow_step_runs").insert(stepRunRows);

  await advanceWorkflow(env, run.id, actor);
  return json({ ok: true, runId: run.id, workflow: workflow.slug });
}

export async function handleWorkflowStepComplete(
  request: Request,
  env: Env,
  actor: ResolvedActor,
  runId: string,
  stepKey: string
) {
  const body = await request.json();
  const p = workflowStepCompletePayloadSchema.parse(body);
  const supabase = getSupabaseAdmin(env);
  const { data: sr } = await supabase
    .from("workflow_step_runs")
    .select("id, status, step_id")
    .eq("run_id", runId)
    .eq("step_key", stepKey)
    .maybeSingle();
  if (!sr) return json({ ok: false, error: "step_run_not_found" }, { status: 404 });
  if (sr.status !== "running" && sr.status !== "pending") {
    return json({ ok: false, error: `invalid_state:${sr.status}` }, { status: 400 });
  }
  const { data: step } = await supabase
    .from("workflow_steps")
    .select("requires_approval")
    .eq("id", sr.step_id)
    .maybeSingle();
  const newStatus =
    p.outcome === "failed"
      ? "failed"
      : step?.requires_approval
      ? "awaiting_approval"
      : "completed";
  await supabase
    .from("workflow_step_runs")
    .update({
      status: newStatus,
      output_payload: p.output,
      artifacts: p.artifacts ?? {},
      notes: p.notes ?? null,
      error_message: p.outcome === "failed" ? p.notes ?? "failed" : null,
      completed_at: newStatus === "completed" ? new Date().toISOString() : null,
      assigned_user_id: actor.userId ?? null
    })
    .eq("id", sr.id);

  if (newStatus === "completed") await advanceWorkflow(env, runId, actor);
  else if (newStatus === "awaiting_approval") {
    await notifyStep(env, `⏸ ${stepKey} 已完成输出,等待审批。通过:/approve ${sr.id}`, { telegram: true });
  }
  return json({ ok: true, runId, stepKey, status: newStatus });
}

export async function handleWorkflowStepApprove(
  request: Request,
  env: Env,
  actor: ResolvedActor,
  runId: string,
  stepKey: string
) {
  const body = await request.json().catch(() => ({}));
  const p = workflowStepApprovePayloadSchema.parse(body);
  const supabase = getSupabaseAdmin(env);
  const { data: sr } = await supabase
    .from("workflow_step_runs")
    .select("id, status")
    .eq("run_id", runId)
    .eq("step_key", stepKey)
    .maybeSingle();
  if (!sr) return json({ ok: false, error: "step_run_not_found" }, { status: 404 });
  if (sr.status !== "awaiting_approval") {
    return json({ ok: false, error: `not_awaiting:${sr.status}` }, { status: 400 });
  }
  await supabase
    .from("workflow_step_runs")
    .update({
      status: "completed",
      approved_by_user_id: actor.userId ?? null,
      approved_at: new Date().toISOString(),
      notes: p.notes ?? null,
      completed_at: new Date().toISOString()
    })
    .eq("id", sr.id);
  await advanceWorkflow(env, runId, actor);
  return json({ ok: true, runId, stepKey, status: "completed" });
}

export async function handleWorkflowStepReject(
  request: Request,
  env: Env,
  actor: ResolvedActor,
  runId: string,
  stepKey: string
) {
  const body = await request.json().catch(() => ({ reason: "rejected" }));
  const p = workflowStepRejectPayloadSchema.parse(body);
  const supabase = getSupabaseAdmin(env);
  const { data: sr } = await supabase
    .from("workflow_step_runs")
    .select("id, status")
    .eq("run_id", runId)
    .eq("step_key", stepKey)
    .maybeSingle();
  if (!sr) return json({ ok: false, error: "step_run_not_found" }, { status: 404 });
  await supabase
    .from("workflow_step_runs")
    .update({
      status: "rejected",
      rejected_reason: p.reason,
      completed_at: new Date().toISOString()
    })
    .eq("id", sr.id);
  await supabase
    .from("workflow_runs")
    .update({ status: "failed", finished_at: new Date().toISOString() })
    .eq("id", runId);
  await notifyStep(env, `🛑 workflow 被拒:${p.reason}`, { telegram: true });
  return json({ ok: true, runId, stepKey, status: "rejected" });
}

export async function handleWorkflowRunGet(env: Env, runId: string) {
  const supabase = getSupabaseAdmin(env);
  const { data } = await supabase
    .from("workflow_run_timeline")
    .select("*")
    .eq("run_id", runId);
  return json({ ok: true, runId, timeline: data ?? [] });
}

export async function handleWorkflowList(env: Env) {
  const supabase = getSupabaseAdmin(env);
  const { data } = await supabase
    .from("workflows")
    .select("slug, name, description, is_active, version")
    .order("slug");
  return json({ ok: true, workflows: data ?? [] });
}

export async function approveByStepRunId(env: Env, stepRunId: string, actor: ResolvedActor) {
  const supabase = getSupabaseAdmin(env);
  const { data: sr } = await supabase
    .from("workflow_step_runs")
    .select("id, run_id, step_key, status")
    .eq("id", stepRunId)
    .maybeSingle();
  if (!sr) return { ok: false, error: "not_found" };
  if (sr.status !== "awaiting_approval") return { ok: false, error: `state:${sr.status}` };
  await supabase
    .from("workflow_step_runs")
    .update({
      status: "completed",
      approved_by_user_id: actor.userId ?? null,
      approved_at: new Date().toISOString(),
      completed_at: new Date().toISOString()
    })
    .eq("id", sr.id);
  await advanceWorkflow(env, sr.run_id, actor);
  return { ok: true, runId: sr.run_id, stepKey: sr.step_key };
}

export async function rejectByStepRunId(
  env: Env,
  stepRunId: string,
  reason: string,
  actor: ResolvedActor
) {
  const supabase = getSupabaseAdmin(env);
  const { data: sr } = await supabase
    .from("workflow_step_runs")
    .select("id, run_id")
    .eq("id", stepRunId)
    .maybeSingle();
  if (!sr) return { ok: false, error: "not_found" };
  await supabase
    .from("workflow_step_runs")
    .update({
      status: "rejected",
      rejected_reason: reason,
      completed_at: new Date().toISOString()
    })
    .eq("id", sr.id);
  await supabase
    .from("workflow_runs")
    .update({ status: "failed", finished_at: new Date().toISOString() })
    .eq("id", sr.run_id);
  return { ok: true, runId: sr.run_id };
}
