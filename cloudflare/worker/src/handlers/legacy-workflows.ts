/**
 * Legacy workflow handlers(旧路由)
 * 对应 POST /workflows/meeting|finance|knowledge|infra
 * 新项目建议走 workflow engine(/workflows/:slug/trigger),这里保留兼容。
 */
import { z } from "zod";
import type { Env } from "../lib/env";
import { json } from "../lib/http";
import { getSupabaseAdmin } from "../lib/supabase";
import { embedText } from "../lib/ai";
import { saveAgentRun, type ResolvedActor } from "../lib/actor";
import { sendTelegram } from "../lib/telegram";

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
  entryStatus: z
    .enum(["expected", "received", "confirmed", "refunded", "bad_debt_risk"])
    .optional(),
  category: z.string().min(1),
  originalCurrency: z.string().min(1),
  originalAmount: z.number().positive(),
  rateToU: z.number().positive(),
  occurredAt: z.string(),
  counterparty: z.string().optional(),
  evidenceUrl: z.string().optional(),
  notes: z.string().optional()
});

const knowledgePayloadSchema = z.object({
  projectId: z.string().uuid().optional(),
  title: z.string().min(1),
  docType: z.enum([
    "meeting_note",
    "sop",
    "spec",
    "report",
    "email",
    "proposal",
    "research",
    "training"
  ]),
  sourceUri: z.string().optional(),
  storagePath: z.string().optional(),
  summary: z.string().optional()
});

const infraPayloadSchema = z.object({
  projectId: z.string().uuid().optional(),
  assetType: z.enum([
    "domain",
    "server",
    "site",
    "repo",
    "email",
    "bot",
    "api_key",
    "database",
    "monitoring",
    "storage",
    "other"
  ]),
  name: z.string().min(1),
  provider: z.string().optional(),
  identifier: z.string().optional(),
  renewalDate: z.string().optional(),
  monthlyCostU: z.number().nonnegative().optional(),
  notes: z.string().optional()
});

export async function handleMeetingWorkflow(request: Request, env: Env, actor: ResolvedActor) {
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
      error_message: error.message,
      actor
    });
    return json({ ok: false, error: error.message }, { status: 500 });
  }

  await saveAgentRun(env, {
    agent_name: "meeting_agent",
    trigger_source: "http_workflow",
    status: "success",
    project_id: payload.projectId ?? null,
    input_payload: body,
    output_payload: { meetingId: meeting.id },
    actor
  });

  await sendTelegram(env, "会议记录已入库", `标题：${meeting.title}\nID：${meeting.id}\n状态：待人工复核`);
  return json({ ok: true, message: "meeting candidate saved", meeting });
}

export async function handleFinanceWorkflow(request: Request, env: Env, actor: ResolvedActor) {
  const body = (await request.json()) as Record<string, unknown>;
  const payload = financePayloadSchema.parse(body);
  const supabase = getSupabaseAdmin(env);

  const { data: ledger, error } = await supabase
    .from("finance_ledger")
    .insert({
      project_id: payload.projectId ?? null,
      client_id: payload.clientId ?? null,
      entry_type: payload.entryType,
      entry_status: payload.entryStatus ?? "confirmed",
      category: payload.category,
      original_currency: payload.originalCurrency,
      original_amount: payload.originalAmount,
      rate_to_u: payload.rateToU,
      occurred_at: payload.occurredAt,
      counterparty: payload.counterparty ?? null,
      evidence_url: payload.evidenceUrl ?? null,
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
      error_message: error.message,
      actor
    });
    return json({ ok: false, error: error.message }, { status: 500 });
  }

  await saveAgentRun(env, {
    agent_name: "finance_agent",
    trigger_source: "http_workflow",
    status: "success",
    project_id: payload.projectId ?? null,
    input_payload: body,
    output_payload: { ledgerId: ledger.id, amountU: ledger.amount_u },
    actor
  });

  await sendTelegram(
    env,
    "财务流水已入库",
    `类型：${ledger.entry_type}\nID：${ledger.id}\nU：${ledger.amount_u}`
  );
  return json({ ok: true, message: "finance ledger candidate saved", ledger });
}

export async function handleKnowledgeWorkflow(
  request: Request,
  env: Env,
  actor: ResolvedActor
) {
  const body = (await request.json()) as Record<string, unknown>;
  const payload = knowledgePayloadSchema.parse(body);
  const supabase = getSupabaseAdmin(env);

  const { data: doc, error } = await supabase
    .from("knowledge_documents")
    .insert({
      project_id: payload.projectId ?? null,
      title: payload.title,
      doc_type: payload.docType,
      source_uri: payload.sourceUri ?? null,
      storage_path: payload.storagePath ?? null,
      summary: payload.summary ?? null,
      embedding_status: "pending"
    })
    .select("id, title")
    .single();

  if (error) {
    await saveAgentRun(env, {
      agent_name: "knowledge_agent",
      trigger_source: "http_workflow",
      status: "failed",
      project_id: payload.projectId ?? null,
      input_payload: body,
      error_message: error.message,
      actor
    });
    return json({ ok: false, error: error.message }, { status: 500 });
  }

  let embeddingStatus: "done" | "failed" | "pending" = "pending";
  let chunkId: string | null = null;
  const chunkText = payload.summary ?? payload.title;

  if (env.OPENAI_API_KEY && chunkText.trim().length > 0) {
    try {
      const vector = await embedText(env, chunkText);
      if (vector) {
        const { data: chunk, error: chunkError } = await supabase
          .from("knowledge_chunks")
          .insert({
            document_id: doc.id,
            chunk_index: 0,
            content: chunkText,
            embedding: vector,
            metadata: { source: "summary_or_title" }
          })
          .select("id")
          .single();
        if (chunkError) throw new Error(chunkError.message);
        chunkId = chunk.id;
        embeddingStatus = "done";
        await supabase
          .from("knowledge_documents")
          .update({ embedding_status: "done" })
          .eq("id", doc.id);
      } else {
        embeddingStatus = "failed";
        await supabase
          .from("knowledge_documents")
          .update({ embedding_status: "failed" })
          .eq("id", doc.id);
      }
    } catch (e) {
      embeddingStatus = "failed";
      await supabase
        .from("knowledge_documents")
        .update({ embedding_status: "failed" })
        .eq("id", doc.id);
      await saveAgentRun(env, {
        agent_name: "knowledge_agent",
        trigger_source: "http_workflow",
        status: "failed",
        project_id: payload.projectId ?? null,
        input_payload: body,
        output_payload: { documentId: doc.id, stage: "embedding" },
        error_message: e instanceof Error ? e.message : String(e),
        actor
      });
      return json({
        ok: true,
        message: "knowledge document saved; embedding failed",
        document: doc,
        embeddingStatus
      });
    }
  }

  await saveAgentRun(env, {
    agent_name: "knowledge_agent",
    trigger_source: "http_workflow",
    status: "success",
    project_id: payload.projectId ?? null,
    input_payload: body,
    output_payload: { documentId: doc.id, chunkId, embeddingStatus },
    actor
  });

  return json({
    ok: true,
    message: "knowledge document saved",
    document: doc,
    embeddingStatus,
    chunkId
  });
}

export async function handleInfraWorkflow(request: Request, env: Env, actor: ResolvedActor) {
  const body = (await request.json()) as Record<string, unknown>;
  const payload = infraPayloadSchema.parse(body);
  const supabase = getSupabaseAdmin(env);

  const { data: asset, error } = await supabase
    .from("assets")
    .insert({
      project_id: payload.projectId ?? null,
      asset_type: payload.assetType,
      name: payload.name,
      provider: payload.provider ?? null,
      identifier: payload.identifier ?? null,
      renewal_date: payload.renewalDate ?? null,
      monthly_cost_u: payload.monthlyCostU ?? null,
      notes: payload.notes ?? null
    })
    .select("id, name, asset_type")
    .single();

  if (error) {
    await saveAgentRun(env, {
      agent_name: "infra_agent",
      trigger_source: "http_workflow",
      status: "failed",
      project_id: payload.projectId ?? null,
      input_payload: body,
      error_message: error.message,
      actor
    });
    return json({ ok: false, error: error.message }, { status: 500 });
  }

  await saveAgentRun(env, {
    agent_name: "infra_agent",
    trigger_source: "http_workflow",
    status: "success",
    project_id: payload.projectId ?? null,
    input_payload: body,
    output_payload: { assetId: asset.id },
    actor
  });

  return json({ ok: true, message: "asset candidate saved", asset });
}
