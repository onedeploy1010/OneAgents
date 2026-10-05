import type { Env } from "../../../lib/env";
import { embedText } from "../../../lib/ai";
import { getSupabaseAdmin } from "../../../lib/supabase";

/**
 * 给一条 knowledge_documents 生成 chunk + embedding,并更新 embedding_status。
 */
export async function embedDocument(
  env: Env,
  documentId: string,
  content: string,
  opts?: { metadata?: Record<string, unknown> }
): Promise<{ ok: boolean; chunkId?: string; error?: string }> {
  const supabase = getSupabaseAdmin(env);
  try {
    const vector = await embedText(env, content);
    if (!vector) {
      await supabase.from("knowledge_documents").update({ embedding_status: "failed" }).eq("id", documentId);
      return { ok: false, error: "no_vector" };
    }
    const { data: chunk, error } = await supabase
      .from("knowledge_chunks")
      .insert({
        document_id: documentId,
        chunk_index: 0,
        content,
        embedding: vector,
        metadata: opts?.metadata ?? {}
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await supabase.from("knowledge_documents").update({ embedding_status: "done" }).eq("id", documentId);
    return { ok: true, chunkId: chunk.id };
  } catch (e) {
    await supabase.from("knowledge_documents").update({ embedding_status: "failed" }).eq("id", documentId);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 批处理 embedding_status=pending 的文档。
 */
export async function embedAllPending(env: Env, limit = 25) {
  const supabase = getSupabaseAdmin(env);
  const { data: docs } = await supabase
    .from("knowledge_documents")
    .select("id, title, summary")
    .eq("embedding_status", "pending")
    .limit(limit);
  let done = 0;
  let failed = 0;
  for (const d of docs ?? []) {
    const text = d.summary ?? d.title;
    if (!text) continue;
    const r = await embedDocument(env, d.id, text, { metadata: { source: "batch_reembed" } });
    if (r.ok) done++;
    else failed++;
  }
  return { scanned: docs?.length ?? 0, done, failed };
}
