import type { Env } from "../../../lib/env";
import { embedText } from "../../../lib/ai";
import { getSupabaseAdmin } from "../../../lib/supabase";

/**
 * 语义检索 top-K(用 pgvector RPC match_knowledge_chunks)。
 * 失败/无向量时回退 title/summary 前 N 条。
 */
export async function searchKnowledge(
  env: Env,
  query: string,
  count = 3,
  threshold = 0.3
): Promise<string[]> {
  const supabase = getSupabaseAdmin(env);
  const vector = await embedText(env, query).catch(() => null);
  if (vector) {
    try {
      const { data: matches } = await supabase.rpc("match_knowledge_chunks", {
        query_embedding: vector,
        match_threshold: threshold,
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
