import type { Env } from "../lib/env";
import { json } from "../lib/http";
import { getSupabaseAdmin } from "../lib/supabase";
import {
  sha256Hex,
  generateTokenPlain,
  saveAgentRun,
  type ResolvedActor
} from "../lib/actor";
import { researchAndPersist, embedAllPending } from "../agents/knowledge/skills";

export async function handleCreateToken(request: Request, env: Env) {
  const body = (await request.json()) as {
    userId?: string;
    agentName?: string;
    label: string;
    scopes?: string[];
    expiresAt?: string;
  };
  if (!body.label) return json({ ok: false, error: "label_required" }, { status: 400 });
  const { plain, prefix } = generateTokenPlain();
  const hash = await sha256Hex(plain);
  const supabase = getSupabaseAdmin(env);
  const { data, error } = await supabase
    .from("api_tokens")
    .insert({
      user_id: body.userId ?? null,
      agent_name: body.agentName ?? null,
      label: body.label,
      token_hash: hash,
      token_prefix: prefix,
      scopes: body.scopes ?? [],
      expires_at: body.expiresAt ?? null
    })
    .select("id, label, token_prefix, scopes, expires_at")
    .single();
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  return json({
    ok: true,
    token: plain,
    metadata: data,
    warning: "plaintext token shown once — store it securely"
  });
}

export async function handleBindIdentity(request: Request, env: Env) {
  const body = (await request.json()) as {
    userId?: string;
    email?: string;
    provider: "telegram" | "github" | "google" | "email" | "supabase_auth";
    providerUserId: string;
    displayName?: string;
    metadata?: Record<string, unknown>;
  };
  if (!body.provider || !body.providerUserId) {
    return json({ ok: false, error: "provider_and_providerUserId_required" }, { status: 400 });
  }
  const supabase = getSupabaseAdmin(env);
  let userId = body.userId;
  if (!userId && body.email) {
    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("email", body.email)
      .maybeSingle();
    userId = user?.id;
  }
  if (!userId) return json({ ok: false, error: "user_not_found" }, { status: 404 });
  const { data, error } = await supabase
    .from("identity_bindings")
    .upsert(
      {
        user_id: userId,
        provider: body.provider,
        provider_user_id: body.providerUserId,
        display_name: body.displayName ?? null,
        metadata: body.metadata ?? {},
        verified_at: new Date().toISOString()
      },
      { onConflict: "provider,provider_user_id" }
    )
    .select("id, user_id, provider, provider_user_id, display_name")
    .single();
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  return json({ ok: true, binding: data });
}

export async function handleRegisterConnector(request: Request, env: Env) {
  const body = (await request.json()) as {
    ownerEmail?: string;
    provider: "telegram" | "github" | "google" | "email" | "supabase_auth";
    name: string;
    config?: Record<string, unknown>;
    secretRef?: string;
  };
  const supabase = getSupabaseAdmin(env);
  let ownerId: string | null = null;
  if (body.ownerEmail) {
    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("email", body.ownerEmail)
      .maybeSingle();
    ownerId = user?.id ?? null;
  }
  const { data, error } = await supabase
    .from("connectors")
    .upsert(
      {
        owner_user_id: ownerId,
        provider: body.provider,
        name: body.name,
        config: body.config ?? {},
        secret_ref: body.secretRef ?? null,
        status: "active"
      },
      { onConflict: "provider,name" }
    )
    .select("id, provider, name, status, secret_ref")
    .single();
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  return json({ ok: true, connector: data });
}

export async function handleAdminTranscript(env: Env, programId: string) {
  const supabase = getSupabaseAdmin(env);
  const { data, error } = await supabase
    .from("mentor_conversation_replay")
    .select("*")
    .eq("program_id", programId);
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  return json({ ok: true, programId, count: data?.length ?? 0, transcript: data ?? [] });
}

export async function handleAdminConversationList(env: Env, url: URL) {
  const supabase = getSupabaseAdmin(env);
  const mentor = url.searchParams.get("mentor");
  const trainee = url.searchParams.get("trainee");
  const contextKind = url.searchParams.get("context");
  const since = url.searchParams.get("since");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "100"), 500);

  let q = supabase
    .from("mentor_conversation_replay")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (mentor) q = q.eq("mentor_slug", mentor);
  if (trainee) q = q.eq("trainee_email", trainee);
  if (contextKind) q = q.eq("context_kind", contextKind);
  if (since) q = q.gte("created_at", since);

  const { data, error } = await q;
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  return json({ ok: true, count: data?.length ?? 0, conversations: data ?? [] });
}

export async function handleAdminMentorStats(env: Env) {
  const supabase = getSupabaseAdmin(env);
  const { data } = await supabase
    .from("mentor_conversations")
    .select("mentor_slug, role, context_kind, latency_ms, created_at")
    .limit(2000);
  const buckets: Record<
    string,
    { messages: number; brief: number; chat: number; avgLatencyMs: number | null; last: string | null }
  > = {};
  for (const row of data ?? []) {
    const key = row.mentor_slug ?? "(none)";
    const b = (buckets[key] = buckets[key] ?? {
      messages: 0,
      brief: 0,
      chat: 0,
      avgLatencyMs: null,
      last: null
    });
    b.messages++;
    if (row.context_kind === "daily_brief") b.brief++;
    if (row.context_kind === "chat") b.chat++;
    if (!b.last || row.created_at > b.last) b.last = row.created_at;
  }
  const latBy: Record<string, number[]> = {};
  for (const row of data ?? []) {
    if (row.role !== "mentor" || !row.latency_ms) continue;
    const key = row.mentor_slug ?? "(none)";
    (latBy[key] = latBy[key] ?? []).push(row.latency_ms);
  }
  for (const [k, arr] of Object.entries(latBy)) {
    buckets[k].avgLatencyMs = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  }
  return json({ ok: true, stats: buckets });
}

export async function handleResearchKnowledge(
  request: Request,
  env: Env,
  actor: ResolvedActor
) {
  const body = (await request.json()) as {
    topic: string;
    projectId?: string;
    audience?: string;
  };
  if (!body.topic) return json({ ok: false, error: "topic_required" }, { status: 400 });
  const result = await researchAndPersist(env, {
    topic: body.topic,
    audience: body.audience,
    projectId: body.projectId ?? null
  });
  if (!result.ok) return json({ ok: false, error: result.error }, { status: 500 });
  await saveAgentRun(env, {
    agent_name: "knowledge_agent",
    trigger_source: "knowledge/research",
    status: "success",
    input_payload: body,
    output_payload: { documentId: result.documentId },
    actor
  });
  return json({ ok: true, document: { id: result.documentId }, article: result.article });
}

export async function handleEmbedPendingKnowledge(env: Env) {
  const result = await embedAllPending(env, 25);
  return json({ ok: true, ...result });
}

export async function handleListAgents(env: Env) {
  const supabase = getSupabaseAdmin(env);
  const agents = [
    { name: "MeetingAgent", role: "meeting_agent", desc: "会议纪要 + 行动项抽取" },
    { name: "ProjectOpsAgent", role: "project_ops_agent", desc: "项目进度 + 任务管理" },
    { name: "FinanceAgent", role: "finance_agent", desc: "财务入账 + U 折算" },
    { name: "OnboardingAgent", role: "onboarding_agent", desc: "新人培训" },
    { name: "OrchestratorAgent", role: "orchestrator_agent", desc: "总协调" },
    { name: "KnowledgeAgent", role: "knowledge_agent", desc: "知识库 + embedding" },
    { name: "InfraAgent", role: "infra_agent", desc: "资产 / 续费 / 运维" },
    { name: "TrainingCoachAgent", role: "training_coach_agent", desc: "培训督导" }
  ];
  const { data: recentRuns } = await supabase
    .from("agent_runs")
    .select("agent_name, status, started_at")
    .order("started_at", { ascending: false })
    .limit(300);
  const statsByAgent: Record<
    string,
    { runs: number; lastAt: string | null; lastStatus: string | null }
  > = {};
  for (const r of recentRuns ?? []) {
    const b = (statsByAgent[r.agent_name] = statsByAgent[r.agent_name] ?? {
      runs: 0,
      lastAt: null,
      lastStatus: null
    });
    b.runs++;
    if (!b.lastAt || r.started_at > b.lastAt) {
      b.lastAt = r.started_at;
      b.lastStatus = r.status;
    }
  }
  const items = agents.map((a) => ({
    ...a,
    stats: statsByAgent[a.role] ?? { runs: 0, lastAt: null, lastStatus: null }
  }));
  return json({ ok: true, items });
}

export async function handleAgentState(env: Env, name: string) {
  const binding = (env as any)[name] as DurableObjectNamespace | undefined;
  if (!binding) return json({ ok: false, error: "agent_not_found" }, { status: 404 });
  try {
    const id = binding.idFromName("default");
    const stub = binding.get(id);
    const resp = await stub.fetch("https://internal/callable/getSnapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    if (!resp.ok) {
      return json({ ok: false, error: `do_${resp.status}`, note: "agents 包 RPC 协议可能不同" });
    }
    const snapshot = await resp.json().catch(() => null);
    return json({ ok: true, agent: name, snapshot });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function handleListAgentRuns(env: Env, url: URL) {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "50"), 1), 500);
  const supabase = getSupabaseAdmin(env);
  let q = supabase
    .from("agent_runs")
    .select(
      "id, agent_name, trigger_source, status, actor_user_id, actor_source, project_id, started_at, finished_at, error_message, input_payload, output_payload, users(display_name)",
      { count: "exact" }
    )
    .order("started_at", { ascending: false })
    .limit(limit);
  const agent = url.searchParams.get("agent");
  if (agent) q = q.eq("agent_name", agent);
  const status = url.searchParams.get("status");
  if (status) q = q.eq("status", status);
  const since = url.searchParams.get("since");
  if (since) q = q.gte("started_at", since);
  const { data, count, error } = await q;
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  return json({ ok: true, total: count ?? null, items: data ?? [] });
}
