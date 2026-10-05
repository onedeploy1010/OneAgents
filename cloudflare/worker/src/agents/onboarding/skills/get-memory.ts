import type { Env } from "../../../lib/env";
import { getSupabaseAdmin } from "../../../lib/supabase";

/**
 * 取 program 下最近 N 条对话,格式化成 "- [角色/context] 内容" 的历史块。
 */
export async function getMemorySnippet(
  env: Env,
  programId: string | null,
  traineeUserId: string,
  limit = 10
): Promise<string> {
  if (!programId) return "(无历史)";
  const supabase = getSupabaseAdmin(env);
  const { data } = await supabase
    .from("mentor_conversations")
    .select("role, content, context_kind, created_at")
    .eq("program_id", programId)
    .in("role", ["user", "mentor", "observation"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!data || data.length === 0) return "(无历史)";
  return data
    .slice()
    .reverse()
    .map((r) => {
      const label = r.role === "user" ? "新人" : r.role === "mentor" ? "教官" : "观察";
      return `- [${label}/${r.context_kind ?? "chat"}] ${r.content}`;
    })
    .join("\n");
}
