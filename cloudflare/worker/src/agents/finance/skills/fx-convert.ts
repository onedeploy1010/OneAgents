import type { Env } from "../../../lib/env";
import { getSupabaseAdmin } from "../../../lib/supabase";

/**
 * 查 fx_rates 表当前生效汇率,把 amount 从 from_currency 折算到 U。
 * 找不到汇率时返回 null,调用方负责标 needs_human_review。
 */
export async function convertToU(env: Env, amount: number, fromCurrency: string) {
  const supabase = getSupabaseAdmin(env);
  const { data } = await supabase
    .from("fx_rates")
    .select("rate, effective_at")
    .eq("base_currency", fromCurrency.toUpperCase())
    .eq("quote_currency", "U")
    .order("effective_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { amountU: Number((amount * Number(data.rate)).toFixed(2)), rate: Number(data.rate) };
}
