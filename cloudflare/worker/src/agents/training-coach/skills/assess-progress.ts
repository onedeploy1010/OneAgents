import type { Env } from "../../../lib/env";
import { getSupabaseAdmin } from "../../../lib/supabase";

export interface ProgressSnapshot {
  programId: string;
  traineeUserId: string;
  traineeDisplayName: string | null;
  mentorSlug: string | null;
  templateName: string | null;
  startDate: string;
  endDate: string | null;
  daysElapsed: number;
  totalTasks: number;
  tasksByStatus: Record<string, number>;
  gradedCount: number;
  avgScore: number | null;
  expectedCompletedByToday: number;
  actualCompletedByToday: number;
  lagDays: number;
  hoursSinceLastSubmit: number | null;
  hoursSinceLastMessage: number | null;
  recentSubmissions: Array<{ day: number; title: string; status: string; score: number | null }>;
  recentConversations: Array<{ role: string; content: string; context_kind: string | null; created_at: string }>;
  stuckDays: number[];
  isPaused: boolean;
  lastCoachReviewAt: string | null;
}

/**
 * 把一个学员的"当前状态画像"拉出来,给后续 LLM 分析。
 * 不做 LLM 调用 — 纯 SQL + 计算。
 */
export async function buildProgressSnapshot(
  env: Env,
  programId: string
): Promise<ProgressSnapshot | null> {
  const supabase = getSupabaseAdmin(env);
  const { data: program } = await supabase
    .from("onboarding_programs")
    .select(
      "id, trainee_user_id, mentor_slug, template_id, start_date, end_date, is_paused, last_coach_review_at, users:trainee_user_id(display_name), onboarding_templates:template_id(name, duration_days)"
    )
    .eq("id", programId)
    .maybeSingle<any>();
  if (!program) return null;

  const { data: tasks } = await supabase
    .from("onboarding_tasks")
    .select("id, day_number, title, status, score, submitted_at, graded_at")
    .eq("program_id", programId)
    .order("day_number");

  const { data: recentConv } = await supabase
    .from("mentor_conversations")
    .select("role, content, context_kind, created_at")
    .eq("program_id", programId)
    .order("created_at", { ascending: false })
    .limit(20);

  const now = Date.now();
  const startMs = new Date(program.start_date + "T00:00:00Z").getTime();
  const daysElapsed = Math.max(1, Math.floor((now - startMs) / (1000 * 60 * 60 * 24)) + 1);
  const durationDays = program.onboarding_templates?.duration_days ?? 15;
  const expectedCompletedByToday = Math.min(daysElapsed, durationDays);

  const tasksArr = tasks ?? [];
  const tasksByStatus: Record<string, number> = {};
  for (const t of tasksArr) tasksByStatus[t.status] = (tasksByStatus[t.status] ?? 0) + 1;
  const actualCompletedByToday = (tasksByStatus["done"] ?? 0) + (tasksByStatus["reviewed"] ?? 0);
  const gradedTasks = tasksArr.filter((t) => t.score !== null);
  const avgScore =
    gradedTasks.length === 0
      ? null
      : Number((gradedTasks.reduce((s, t) => s + Number(t.score ?? 0), 0) / gradedTasks.length).toFixed(2));

  const lastSubmit = tasksArr
    .filter((t) => t.submitted_at)
    .map((t) => new Date(t.submitted_at!).getTime())
    .sort((a, b) => b - a)[0];
  const lastMsg = (recentConv ?? [])
    .filter((c) => c.role === "user")
    .map((c) => new Date(c.created_at).getTime())
    .sort((a, b) => b - a)[0];
  const hoursSinceLastSubmit = lastSubmit ? (now - lastSubmit) / (1000 * 60 * 60) : null;
  const hoursSinceLastMessage = lastMsg ? (now - lastMsg) / (1000 * 60 * 60) : null;

  // stuck days:期望完成但仍 todo 的 day
  const stuckDays = tasksArr
    .filter((t) => t.day_number <= expectedCompletedByToday && t.status === "todo")
    .map((t) => t.day_number);

  const recentSubmissions = tasksArr
    .filter((t) => t.submitted_at || t.graded_at)
    .slice(-6)
    .map((t) => ({
      day: t.day_number,
      title: t.title,
      status: t.status,
      score: t.score === null ? null : Number(t.score)
    }));

  return {
    programId: program.id,
    traineeUserId: program.trainee_user_id,
    traineeDisplayName: program.users?.display_name ?? null,
    mentorSlug: program.mentor_slug,
    templateName: program.onboarding_templates?.name ?? null,
    startDate: program.start_date,
    endDate: program.end_date,
    daysElapsed,
    totalTasks: tasksArr.length,
    tasksByStatus,
    gradedCount: gradedTasks.length,
    avgScore,
    expectedCompletedByToday,
    actualCompletedByToday,
    lagDays: Math.max(0, expectedCompletedByToday - actualCompletedByToday),
    hoursSinceLastSubmit,
    hoursSinceLastMessage,
    recentSubmissions,
    recentConversations: recentConv ?? [],
    stuckDays,
    isPaused: program.is_paused ?? false,
    lastCoachReviewAt: program.last_coach_review_at ?? null
  };
}
