import type { Env } from "../../../lib/env";
import { aiChatComplete } from "../../../lib/ai";

export interface KickoffPlan {
  meeting: { title: string; agenda: string[]; openQuestions: string[] };
  tasks: Array<{
    title: string;
    description?: string;
    track: "main" | "sub" | "branch" | "maintenance";
    priority?: number;
    version_target?: string;
  }>;
  suggestedMentor?: string;
}

/**
 * 根据新建的客户/项目,生成 kickoff 会议议题 + 初始任务拆解。
 */
export async function generateKickoffPlan(
  env: Env,
  params: {
    clientName: string;
    projectName: string;
    projectCode: string;
    projectType: string;
    deliveryModel: string;
    summary?: string;
  }
): Promise<{ plan: KickoffPlan | null; raw: string | null; error?: string }> {
  const system = `你是 OneAgents 的项目启动助手。生成 kickoff 会议草稿 + 初始任务拆解。
只输出 JSON:
{
  "meeting": {
    "title": "",
    "agenda": ["议题 1", ...],
    "openQuestions": ["问题 1", ...]
  },
  "tasks": [
    { "title": "", "description": "", "track": "main|sub|branch", "priority": 1-5, "version_target": "v1" }
  ],
  "suggestedMentor": "nina_coach|marcus_strict|ravi_product|oscar_ops"
}
规则:
- agenda 5-7 条 / openQuestions 3-5 条
- tasks 5-8 条含 1 条 main
- web/ai → ravi;ops/automation → oscar;初期 → nina`;
  const user = `客户: ${params.clientName}\n项目: ${params.projectName} (${params.projectCode})\n类型: ${params.projectType} · 交付: ${params.deliveryModel}\n描述: ${params.summary ?? "(未填)"}`;
  try {
    const raw = await aiChatComplete(env, system, user);
    if (!raw) return { plan: null, raw: null, error: "no_response" };
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { plan: null, raw, error: "no_json" };
    return { plan: JSON.parse(match[0]) as KickoffPlan, raw };
  } catch (e) {
    return { plan: null, raw: null, error: e instanceof Error ? e.message : String(e) };
  }
}
