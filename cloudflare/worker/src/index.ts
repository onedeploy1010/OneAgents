import { routeAgentRequest } from "agents";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { FinanceAgent } from "./agents/finance-agent";
import { MeetingAgent } from "./agents/meeting-agent";
import { OnboardingAgent } from "./agents/onboarding-agent";
import { ProjectOpsAgent } from "./agents/project-ops-agent";

export { FinanceAgent, MeetingAgent, OnboardingAgent, ProjectOpsAgent };

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
  MeetingAgent: DurableObjectNamespace;
  ProjectOpsAgent: DurableObjectNamespace;
  FinanceAgent: DurableObjectNamespace;
  OnboardingAgent: DurableObjectNamespace;
}

const meetingPayloadSchema = z.object({
  projectId: z.string().uuid().optional(),
  title: z.string().min(1),
  rawTranscript: z.string().min(1),
  sourceChannel: z.string().default("manual"),
  sourceUri: z.string().optional(),
  happenedAt: z.string().optional()
});

const financePayloadSchema = z.object({
  projectId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  entryType: z.enum(["income", "expense", "transfer"]),
  category: z.string().min(1),
  originalCurrency: z.string().min(1),
  originalAmount: z.number().positive(),
  rateToU: z.number().positive(),
  occurredAt: z.string(),
  notes: z.string().optional()
});

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data, null, 2), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {})
    }
  });
}

function getSupabaseAdmin(env: Env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

async function saveAgentRun(env: Env, payload: {
  agent_name: string;
  trigger_source: string;
  status: "queued" | "running" | "success" | "failed" | "cancelled";
  project_id?: string | null;
  input_payload?: Record<string, unknown>;
  output_payload?: Record<string, unknown>;
  error_message?: string | null;
}) {
  const supabase = getSupabaseAdmin(env);
  await supabase.from("agent_runs").insert({
    agent_name: payload.agent_name,
    trigger_source: payload.trigger_source,
    status: payload.status,
    project_id: payload.project_id ?? null,
    input_payload: payload.input_payload ?? {},
    output_payload: payload.output_payload ?? {},
    error_message: payload.error_message ?? null,
    started_at: new Date().toISOString(),
    finished_at: payload.status === "success" || payload.status === "failed" ? new Date().toISOString() : null
  });
}

async function sendTelegram(env: Env, title: string, body: string) {
  if (!env.TG_BOT_TOKEN || !env.TG_DEFAULT_CHAT_ID) {
    return { skipped: true, reason: "telegram_not_configured" };
  }

  const text = `*${title}*\n${body}`;
  const response = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TG_DEFAULT_CHAT_ID,
      text,
      parse_mode: "Markdown"
    })
  });

  return {
    skipped: false,
    ok: response.ok,
    status: response.status
  };
}

async function handleMeetingWorkflow(request: Request, env: Env) {
  const body = (await request.json()) as Record<string, unknown>;
  const payload = meetingPayloadSchema.parse(body);
  const supabase = getSupabaseAdmin(env);

  const { data: meeting, error } = await supabase
    .from("meetings")
    .insert({
      project_id: payload.projectId ?? null,
      title: payload.title,
      raw_transcript: payload.rawTranscript,
      source_channel: payload.sourceChannel,
      source_uri: payload.sourceUri ?? null,
      happened_at: payload.happenedAt ?? new Date().toISOString(),
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
    await saveAgentRun(env, {
      agent_name: "meeting_agent",
      trigger_source: "http_workflow",
      status: "failed",
      project_id: payload.projectId ?? null,
      input_payload: body,
      error_message: error.message
    });

    return json({ ok: false, error: error.message }, { status: 500 });
  }

  await saveAgentRun(env, {
    agent_name: "meeting_agent",
    trigger_source: "http_workflow",
    status: "success",
    project_id: payload.projectId ?? null,
    input_payload: body,
    output_payload: { meetingId: meeting.id }
  });

  await sendTelegram(env, "会议记录已入库", `标题：${meeting.title}\nID：${meeting.id}\n状态：待人工复核`);

  return json({
    ok: true,
    message: "meeting candidate saved",
    meeting
  });
}

async function handleFinanceWorkflow(request: Request, env: Env) {
  const body = (await request.json()) as Record<string, unknown>;
  const payload = financePayloadSchema.parse(body);
  const supabase = getSupabaseAdmin(env);

  const { data: ledger, error } = await supabase
    .from("finance_ledger")
    .insert({
      project_id: payload.projectId ?? null,
      client_id: payload.clientId ?? null,
      entry_type: payload.entryType,
      category: payload.category,
      original_currency: payload.originalCurrency,
      original_amount: payload.originalAmount,
      rate_to_u: payload.rateToU,
      occurred_at: payload.occurredAt,
      notes: payload.notes ?? null,
      created_by_agent: true,
      agent_name: "finance_agent",
      source_channel: "http_workflow",
      needs_human_review: payload.originalAmount * payload.rateToU >= 300
    })
    .select("id, entry_type, amount_u")
    .single();

  if (error) {
    await saveAgentRun(env, {
      agent_name: "finance_agent",
      trigger_source: "http_workflow",
      status: "failed",
      project_id: payload.projectId ?? null,
      input_payload: body,
      error_message: error.message
    });

    return json({ ok: false, error: error.message }, { status: 500 });
  }

  await saveAgentRun(env, {
    agent_name: "finance_agent",
    trigger_source: "http_workflow",
    status: "success",
    project_id: payload.projectId ?? null,
    input_payload: body,
    output_payload: { ledgerId: ledger.id, amountU: ledger.amount_u }
  });

  await sendTelegram(env, "财务流水已入库", `类型：${ledger.entry_type}\nID：${ledger.id}\nU：${ledger.amount_u}`);

  return json({
    ok: true,
    message: "finance ledger candidate saved",
    ledger
  });
}

async function handleGithubWebhook(request: Request, env: Env) {
  const event = request.headers.get("x-github-event") ?? "unknown";
  const body = (await request.json()) as Record<string, unknown>;

  await saveAgentRun(env, {
    agent_name: "project_ops_agent",
    trigger_source: `github:${event}`,
    status: "success",
    input_payload: body,
    output_payload: { accepted: true }
  });

  return json({ ok: true, accepted: true, event });
}

async function handleTelegramWebhook(request: Request, env: Env) {
  const body = (await request.json()) as Record<string, unknown>;

  await saveAgentRun(env, {
    agent_name: "onboarding_agent",
    trigger_source: "telegram_webhook",
    status: "success",
    input_payload: body,
    output_payload: { accepted: true }
  });

  return json({ ok: true, accepted: true });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

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
      return handleTelegramWebhook(request, env);
    }

    if (request.method === "POST" && url.pathname === "/workflows/meeting") {
      return handleMeetingWorkflow(request, env);
    }

    if (request.method === "POST" && url.pathname === "/workflows/finance") {
      return handleFinanceWorkflow(request, env);
    }

    return json({ ok: false, error: "not_found" }, { status: 404 });
  }
};
