import type { Env } from "../../../lib/env";
import { aiChatComplete } from "../../../lib/ai";
import { getSupabaseAdmin } from "../../../lib/supabase";
import { embedDocument } from "./embed";

/**
 * 让 LLM 围绕一个主题写一份 <=500 字中文培训文档,入 knowledge_documents + 立即 embed。
 */
export async function researchAndPersist(
  env: Env,
  opts: { topic: string; audience?: string; projectId?: string | null }
): Promise<{ ok: boolean; documentId?: string; article?: string; error?: string }> {
  const system =
    "你是 OneAgents 内部培训资料的编辑。请根据给出的主题产出一篇 <=500 字的中文培训文档,结构化分段:背景 / 关键概念 / 操作要点 / 常见错误 / 核对清单。只输出文档正文。";
  const userText = `主题:${opts.topic}\n面向:${opts.audience ?? "新人试用期"}`;
  let article: string | null = null;
  try {
    article = await aiChatComplete(env, system, userText);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!article) return { ok: false, error: "no_content" };

  const supabase = getSupabaseAdmin(env);
  const { data: doc, error } = await supabase
    .from("knowledge_documents")
    .insert({
      project_id: opts.projectId ?? null,
      title: `研究:${opts.topic}`,
      doc_type: "research",
      summary: article,
      embedding_status: "pending"
    })
    .select("id, title")
    .single();
  if (error) return { ok: false, error: error.message };

  await embedDocument(env, doc.id, article, { metadata: { source: "research", topic: opts.topic } });
  return { ok: true, documentId: doc.id, article };
}
