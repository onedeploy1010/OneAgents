import type { Env } from "./env";
import { getSupabaseAdmin } from "./supabase";

export interface ResolvedActor {
  userId: string | null;
  identityId: string | null;
  source: string;
  scopes: string[];
  displayName?: string | null;
}

export function emptyActor(source: string): ResolvedActor {
  return { userId: null, identityId: null, source, scopes: [] };
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateTokenPlain(): { plain: string; prefix: string } {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const plain =
    "oa_" +
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return { plain, prefix: plain.slice(0, 12) };
}

export async function saveAgentRun(
  env: Env,
  payload: {
    agent_name: string;
    trigger_source: string;
    status: "queued" | "running" | "success" | "failed" | "cancelled";
    project_id?: string | null;
    input_payload?: Record<string, unknown>;
    output_payload?: Record<string, unknown>;
    error_message?: string | null;
    actor?: ResolvedActor | null;
  }
) {
  const supabase = getSupabaseAdmin(env);
  await supabase.from("agent_runs").insert({
    agent_name: payload.agent_name,
    trigger_source: payload.trigger_source,
    status: payload.status,
    project_id: payload.project_id ?? null,
    input_payload: payload.input_payload ?? {},
    output_payload: payload.output_payload ?? {},
    error_message: payload.error_message ?? null,
    actor_user_id: payload.actor?.userId ?? null,
    actor_identity_id: payload.actor?.identityId ?? null,
    actor_source: payload.actor?.source ?? null,
    started_at: new Date().toISOString(),
    finished_at:
      payload.status === "success" || payload.status === "failed"
        ? new Date().toISOString()
        : null
  });
}
