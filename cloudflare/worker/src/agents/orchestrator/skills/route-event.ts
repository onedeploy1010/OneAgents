import type { Env } from "../../../lib/env";

/**
 * 给定外部事件(GitHub push / Telegram 消息 / Email 到达),决定路由到哪个 agent。
 * 当前是固定映射;后续可以用 LLM 做智能分派。
 */
export function routeEvent(event: {
  source: string; // 'github' | 'telegram' | 'email' | 'workflow' | 'manual'
  type: string;   // 具体动作
  payload?: Record<string, unknown>;
}): { agent: string; confidence: number; reason: string } {
  if (event.source === "github") {
    return { agent: "project_ops_agent", confidence: 0.95, reason: "GitHub 事件默认归 project_ops" };
  }
  if (event.source === "telegram" && event.type === "group_meeting") {
    return { agent: "meeting_agent", confidence: 0.9, reason: "群会议 /meeting_end 转 meeting_agent" };
  }
  if (event.source === "email" && /invoice|billing|receipt/i.test(event.type)) {
    return { agent: "finance_agent", confidence: 0.85, reason: "邮件主题含账单关键词" };
  }
  if (event.source === "telegram" && event.type === "client_need") {
    return { agent: "project_ops_agent", confidence: 0.8, reason: "客户需求转 tasks" };
  }
  return { agent: "orchestrator_agent", confidence: 0.5, reason: "没匹配的 rule,自己吃下" };
}
