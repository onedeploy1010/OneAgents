import type { Env } from "../../../lib/env";
import { aiChatComplete } from "../../../lib/ai";

/**
 * 给 kickoff 会议后的项目,LLM 生成 5-8 条初始任务候选。
 * 调用方负责把结果写进 tasks 表(含 needs_human_review)。
 */
export async function generateInitialTasks(
  env: Env,
  opts: { projectName: string; projectType: string; summary?: string }
) {
  const system = `你是 OneAgents 的项目启动助手。根据项目信息生成 5-8 条初始任务。
只输出 JSON 数组:
[
  { "title": "<=80 字", "description": "做什么/成功标准", "track": "main|sub|branch", "priority": 1-5, "version_target": "v1" }
]
必须有 1 条 track=main(项目里程碑根节点),其余 sub。`;
  const user = `项目: ${opts.projectName} / 类型: ${opts.projectType}\n简介: ${opts.summary ?? "(无)"}`;
  try {
    const raw = await aiChatComplete(env, system, user);
    if (!raw) return [];
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) return [];
    return JSON.parse(m[0]) as Array<{
      title: string;
      description?: string;
      track: "main" | "sub" | "branch";
      priority?: number;
      version_target?: string;
    }>;
  } catch {
    return [];
  }
}
