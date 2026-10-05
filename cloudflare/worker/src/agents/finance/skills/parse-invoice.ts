import type { Env } from "../../../lib/env";
import { aiChatComplete } from "../../../lib/ai";

/**
 * 从账单邮件正文(或 PDF OCR 文本)抽结构化字段。
 * 供后续 Email Worker 接入时用。
 */
export async function parseInvoiceText(env: Env, text: string) {
  const system = `你是账单解析器。从邮件正文抽:
{
  "service_name": "",
  "amount": 0.0,
  "currency": "USD|USDT|CNY|...",
  "period": "monthly|yearly|usage_based|one_time",
  "occurred_at": "YYYY-MM-DD",
  "invoice_id": "",
  "notes": ""
}
只输出 JSON。缺失字段留空/0。`;
  try {
    const raw = await aiChatComplete(env, system, text);
    if (!raw) return null;
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}
