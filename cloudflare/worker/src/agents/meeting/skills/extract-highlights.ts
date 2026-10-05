import type { Env } from "../../../lib/env";
import { aiChatComplete } from "../../../lib/ai";

/**
 * 给一段 raw_transcript,用 LLM 抽:summary / decisions / open_questions / action_items。
 * 用 JSON 结构化输出。失败返回 null,调用方负责降级到"待模型整理"。
 */
export async function extractMeetingHighlights(
  env: Env,
  rawTranscript: string,
  context?: { projectName?: string; clientName?: string }
) {
  const system = `你是会议纪要整理助手。把原始会议对话抽成 JSON:
{
  "summary": "<=300 字的会议总结",
  "decisions": ["明确的结论 1", "..."],
  "open_questions": ["待确认问题 1", "..."],
  "action_items": [
    { "title": "<=80 字动作", "assignee_hint": "可能的责任人", "due_hint": "可能的时间" }
  ]
}
不输出 JSON 外的任何内容。如某个字段抽不到,给空数组/空字符串。`;
  const user = [
    context?.clientName ? `客户: ${context.clientName}` : null,
    context?.projectName ? `项目: ${context.projectName}` : null,
    "",
    "原文:",
    rawTranscript
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const raw = await aiChatComplete(env, system, user);
    if (!raw) return null;
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    return JSON.parse(m[0]) as {
      summary: string;
      decisions: string[];
      open_questions: string[];
      action_items: Array<{ title: string; assignee_hint?: string; due_hint?: string }>;
    };
  } catch {
    return null;
  }
}
