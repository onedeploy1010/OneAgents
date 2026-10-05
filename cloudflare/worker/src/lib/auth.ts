import type { Env } from "./env";
import { getSupabaseAdmin } from "./supabase";
import { emptyActor, sha256Hex, type ResolvedActor } from "./actor";
import { json, timingSafeEqual } from "./http";

export async function resolveBearer(
  env: Env,
  authHeader: string | null
): Promise<ResolvedActor | null> {
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  const supabase = getSupabaseAdmin(env);
  const hash = await sha256Hex(token);
  const { data } = await supabase
    .from("api_tokens")
    .select("id, user_id, scopes, expires_at, revoked_at, users:user_id(display_name)")
    .eq("token_hash", hash)
    .maybeSingle();
  if (!data) return null;
  if (data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  await supabase
    .from("api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);
  const name = (data as any).users?.display_name ?? null;
  return {
    userId: data.user_id,
    identityId: null,
    source: "bearer",
    scopes: data.scopes ?? [],
    displayName: name
  };
}

export async function resolveByIdentity(
  env: Env,
  provider: "telegram" | "github" | "email",
  providerUserId: string | null | undefined
): Promise<ResolvedActor | null> {
  if (!providerUserId) return null;
  const supabase = getSupabaseAdmin(env);
  const { data } = await supabase
    .from("identity_bindings")
    .select("id, user_id, display_name")
    .eq("provider", provider)
    .eq("provider_user_id", String(providerUserId))
    .maybeSingle();
  if (!data) return null;
  return {
    userId: data.user_id,
    identityId: data.id,
    source: `identity:${provider}`,
    scopes: [],
    displayName: data.display_name
  };
}

export function requireAdmin(env: Env, request: Request): Response | null {
  if (!env.ADMIN_BOOTSTRAP_KEY) {
    return json({ ok: false, error: "admin_disabled" }, { status: 503 });
  }
  const provided = request.headers.get("x-admin-key") ?? "";
  if (!timingSafeEqual(provided, env.ADMIN_BOOTSTRAP_KEY)) {
    return json({ ok: false, error: "admin_unauthorized" }, { status: 401 });
  }
  return null;
}

export async function verifyGithubSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
) {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const provided = signatureHeader.slice(7);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return timingSafeEqual(expected, provided);
}

export { emptyActor };
export type { ResolvedActor };
