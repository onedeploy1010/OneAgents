import type { Env } from "../../../lib/env";
import { getSupabaseAdmin } from "../../../lib/supabase";
import { saveAgentRun, type ResolvedActor } from "../../../lib/actor";
import { buildProgressSnapshot } from "./assess-progress";
import { recommendAdjustment, type CoachRecommendation } from "./recommend-adjustment";
import { applyRecommendation } from "./apply-adjustment";

/**
 * 对单个 program 跑一次完整 review。
 * - 构造 snapshot
 * - LLM 出 findings + recommendations
 * - 立即写 training_coach_reviews
 * - 自动 apply 所有 autoApplySafe=true 的建议(e.g. 鼓励消息)
 * - 其他建议等人审批
 */
export async function runCoachReview(
  env: Env,
  programId: string,
  trigger:
    | "cron_daily"
    | "cron_weekly"
    | "manual"
    | "submission_lag"
    | "low_score"
    | "silence_24h",
  actor?: ResolvedActor
): Promise<{
  ok: boolean;
  reviewId?: string;
  findings?: any;
  recommendations?: CoachRecommendation[];
  autoApplied?: number;
  error?: string;
}> {
  const supabase = getSupabaseAdmin(env);

  const snapshot = await buildProgressSnapshot(env, programId);
  if (!snapshot) return { ok: false, error: "program_not_found" };

  const { findings, recommendations, raw } = await recommendAdjustment(env, snapshot);

  const { data: review, error: reviewErr } = await supabase
    .from("training_coach_reviews")
    .insert({
      program_id: programId,
      trigger,
      findings: (findings ?? {}) as any,
      recommendations: recommendations as any,
      raw_llm_response: raw
    })
    .select("id")
    .single();
  if (reviewErr) return { ok: false, error: reviewErr.message };

  // 自动 apply safe 的建议(一般只有 send_encouragement 和 flag_for_review)
  let autoApplied = 0;
  for (const rec of recommendations) {
    if (!rec.autoApplySafe) continue;
    const r = await applyRecommendation(env, programId, snapshot.traineeUserId, rec);
    await supabase.from("training_coach_actions").insert({
      review_id: review.id,
      kind: rec.kind,
      params: rec.params as any,
      result: r as any
    });
    if (r.ok) autoApplied++;
  }
  if (autoApplied > 0) {
    await supabase
      .from("training_coach_reviews")
      .update({ applied_at: new Date().toISOString(), auto_applied: true })
      .eq("id", review.id);
  }

  // 更新 program 上的 review 时间 + coach_state
  await supabase
    .from("onboarding_programs")
    .update({
      last_coach_review_at: new Date().toISOString(),
      coach_state: {
        last_state: findings?.state ?? null,
        last_morale: findings?.morale_signal ?? null,
        last_notes: findings?.notes ?? null
      }
    })
    .eq("id", programId);

  await saveAgentRun(env, {
    agent_name: "training_coach_agent",
    trigger_source: `coach:${trigger}`,
    status: "success",
    project_id: null,
    input_payload: { programId, trigger },
    output_payload: {
      reviewId: review.id,
      state: findings?.state,
      recommendationCount: recommendations.length,
      autoApplied
    },
    actor: actor ?? null
  });

  return {
    ok: true,
    reviewId: review.id,
    findings,
    recommendations,
    autoApplied
  };
}

/**
 * 批量跑:所有 active 且 last_coach_review_at >24h 前的 program。
 * 被 cron 调用。
 */
export async function runDailyCoachSweep(env: Env) {
  const supabase = getSupabaseAdmin(env);
  const cutoff = new Date(Date.now() - 22 * 60 * 60 * 1000).toISOString();
  const { data: programs } = await supabase
    .from("onboarding_programs")
    .select("id, last_coach_review_at")
    .eq("status", "active")
    .or(`last_coach_review_at.is.null,last_coach_review_at.lt.${cutoff}`);
  const results: Array<{ programId: string; ok: boolean; autoApplied: number }> = [];
  for (const p of programs ?? []) {
    const r = await runCoachReview(env, p.id, "cron_daily");
    results.push({ programId: p.id, ok: r.ok, autoApplied: r.autoApplied ?? 0 });
  }
  return { ok: true, reviewed: results.length, results };
}
