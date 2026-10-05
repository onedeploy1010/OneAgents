import type { Env } from "../../../lib/env";
import { aiChatComplete } from "../../../lib/ai";
import type { ProgressSnapshot } from "./assess-progress";

export type CoachRecommendationKind =
  | "switch_mentor"
  | "extend_due"
  | "add_remedial_task"
  | "pause_program"
  | "resume_program"
  | "send_encouragement"
  | "flag_for_review"
  | "promote_to_member"
  | "extend_program";

export interface CoachRecommendation {
  kind: CoachRecommendationKind;
  params: Record<string, unknown>;
  reason: string;
  urgency: "low" | "normal" | "high";
  autoApplySafe: boolean; // 是否可不经 human 直接 apply
}

export interface CoachFindings {
  state: "on_track" | "slightly_behind" | "behind" | "stuck" | "excelling" | "silent";
  morale_signal: "positive" | "neutral" | "struggling";
  notes: string;
}

/**
 * 让 LLM 根据学员快照给出:
 * - findings(评估)
 * - recommendations(具体可执行动作清单)
 */
export async function recommendAdjustment(
  env: Env,
  snapshot: ProgressSnapshot
): Promise<{ findings: CoachFindings | null; recommendations: CoachRecommendation[]; raw: string | null }> {
  const system = `你是 OneAgents 的培训督导 agent。你读学员 15 天培训的快照,判断状态并给出具体调整建议。
只输出 JSON:
{
  "findings": {
    "state": "on_track|slightly_behind|behind|stuck|excelling|silent",
    "morale_signal": "positive|neutral|struggling",
    "notes": "<=200 字中文说明你看到的关键信号"
  },
  "recommendations": [
    {
      "kind": "switch_mentor|extend_due|add_remedial_task|pause_program|resume_program|send_encouragement|flag_for_review|promote_to_member|extend_program",
      "params": { ... },
      "reason": "<=80 字为什么",
      "urgency": "low|normal|high",
      "autoApplySafe": true/false
    }
  ]
}

规则:
- 每次最多 3 条 recommendations,按 urgency 排序
- send_encouragement 和 flag_for_review 是 autoApplySafe=true,其他都 false(要 human 审)
- switch_mentor 的 params: { "new_mentor_slug": "nina_coach|marcus_strict|ravi_product|oscar_ops", "after_day": number }
- extend_due 的 params: { "task_id": "uuid", "new_due_at": "ISO" }
- add_remedial_task 的 params: { "after_day": number, "title": "", "today_goal": "", "required_tasks": "", "difficulty": 1-5 }
- pause_program 的 params: { "reason": "" }
- send_encouragement 的 params: { "tone": "warm|firm|celebratory", "channel": "telegram" }
- flag_for_review 的 params: { "why": "" }
- promote_to_member params: {}(只在 >=Day 15 且 avg_score>=80 才建议)
- extend_program 的 params: { "extra_days": number }

判断指南:
- lagDays >=3 → state=behind,考虑 extend_due 或 send_encouragement
- stuckDays >=2 且相关 day <=Day 3 → 可能需要 switch_mentor 到 nina(温和)
- avg_score >=85 且 daysElapsed >=7 → state=excelling,考虑 promote 或换更挑战 mentor
- hoursSinceLastMessage >=24 且 daysElapsed <=5 → state=silent,send_encouragement
- morale_signal 看 recentConversations 里语气:自我怀疑/沮丧/"我不会" → struggling
- 若 isPaused=true → 主要任务是看能否 resume
- 新人 Day 1-3,数据少也不能妄评,保守给 send_encouragement`;

  const user = JSON.stringify(snapshot, null, 2);
  try {
    const raw = await aiChatComplete(env, system, user);
    if (!raw) return { findings: null, recommendations: [], raw: null };
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { findings: null, recommendations: [], raw };
    const parsed = JSON.parse(match[0]);
    return {
      findings: parsed.findings ?? null,
      recommendations: (parsed.recommendations ?? []) as CoachRecommendation[],
      raw
    };
  } catch {
    return { findings: null, recommendations: [], raw: null };
  }
}
