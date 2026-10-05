import type { Env } from "../../../lib/env";
import { getSupabaseAdmin } from "../../../lib/supabase";

function daysFromNowIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 扫 assets 表 renewal_date 在未来 N 天内的记录,生成 notifications 候选。
 * 带日内幂等:同一 asset_id 当天只会建一条。
 */
export async function scanAssetRenewals(env: Env, horizonDays?: number) {
  const supabase = getSupabaseAdmin(env);
  const horizon = horizonDays ?? Number(env.ALERT_ASSET_DAYS ?? "30");
  const todayIso = new Date().toISOString().slice(0, 10);
  const horizonIso = daysFromNowIso(horizon);

  const { data: assets, error } = await supabase
    .from("assets")
    .select("id, name, asset_type, provider, renewal_date, monthly_cost_u, status")
    .in("status", ["active", "warning"])
    .not("renewal_date", "is", null)
    .gte("renewal_date", todayIso)
    .lte("renewal_date", horizonIso);

  if (error) throw new Error(`assets scan: ${error.message}`);

  let inserted = 0;
  for (const a of assets ?? []) {
    const title = `资产到期提醒:${a.name}`;
    const body = [
      `类型:${a.asset_type}`,
      a.provider ? `供应商:${a.provider}` : null,
      `到期日:${a.renewal_date}`,
      a.monthly_cost_u ? `月成本:${a.monthly_cost_u}U` : null
    ]
      .filter(Boolean)
      .join("\n");

    const { data: existing } = await supabase
      .from("notifications")
      .select("id")
      .eq("title", title)
      .eq("payload->>asset_id", a.id)
      .gte("created_at", `${todayIso}T00:00:00Z`)
      .limit(1);

    if (existing && existing.length > 0) continue;

    const { error: insertError } = await supabase.from("notifications").insert({
      channel: "telegram",
      status: "pending",
      title,
      body,
      payload: { asset_id: a.id, kind: "asset_renewal" },
      scheduled_for: new Date().toISOString()
    });
    if (!insertError) inserted++;
  }
  return { scanned: assets?.length ?? 0, inserted, horizonDays: horizon };
}

export async function scanSubscriptionRenewals(env: Env, horizonDays?: number) {
  const supabase = getSupabaseAdmin(env);
  const horizon = horizonDays ?? Number(env.ALERT_SUBSCRIPTION_DAYS ?? "14");
  const todayIso = new Date().toISOString().slice(0, 10);
  const horizonIso = daysFromNowIso(horizon);

  const { data: subs, error } = await supabase
    .from("subscriptions")
    .select("id, service_name, plan_name, next_billing_date, amount_u, amount, currency, status")
    .eq("status", "active")
    .not("next_billing_date", "is", null)
    .gte("next_billing_date", todayIso)
    .lte("next_billing_date", horizonIso);

  if (error) throw new Error(`subscriptions scan: ${error.message}`);

  let inserted = 0;
  for (const s of subs ?? []) {
    const title = `订阅续费提醒:${s.service_name}`;
    const body = [
      `计划:${s.plan_name}`,
      `下次扣费:${s.next_billing_date}`,
      `金额:${s.amount} ${s.currency}${s.amount_u ? ` (≈${s.amount_u}U)` : ""}`
    ].join("\n");

    const { data: existing } = await supabase
      .from("notifications")
      .select("id")
      .eq("title", title)
      .eq("payload->>subscription_id", s.id)
      .gte("created_at", `${todayIso}T00:00:00Z`)
      .limit(1);

    if (existing && existing.length > 0) continue;

    const { error: insertError } = await supabase.from("notifications").insert({
      channel: "telegram",
      status: "pending",
      title,
      body,
      payload: { subscription_id: s.id, kind: "subscription_renewal" },
      scheduled_for: new Date().toISOString()
    });
    if (!insertError) inserted++;
  }
  return { scanned: subs?.length ?? 0, inserted, horizonDays: horizon };
}
