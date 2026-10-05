import { createClient } from "@supabase/supabase-js";
import type { Env } from "./env";

export function getSupabaseAdmin(env: Env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

export async function findUserByEmail(env: Env, email: string): Promise<string | null> {
  const supabase = getSupabaseAdmin(env);
  const { data } = await supabase.from("users").select("id").eq("email", email).maybeSingle();
  return data?.id ?? null;
}
