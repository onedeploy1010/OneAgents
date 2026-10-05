import type { Env } from "../lib/env";
import { getSupabaseAdmin } from "../lib/supabase";
import { json } from "../lib/http";
import type { ResolvedActor } from "../lib/actor";

/**
 * Superadmin 路由 — 多租户管理。
 *
 * 鉴权:Bearer token 的 scopes 里必须含 'superadmin'。
 * 所有 tenant 元数据存 OneAgents Supabase(tenants / tenant_modules / tenant_agents)。
 * 每 tenant 的运营数据在各自 Neon DB(本文件不直连,只记 connection 信息)。
 *
 * 决策 reference: 用户 2026-04-23 选 α-soft(一个 Neon project 多 DB)+ (N)(agent 数据跟 tenant)+ 缓(Worker 重构延后)。
 */

export function requireSuperadmin(actor: ResolvedActor | null): Response | null {
  if (!actor || !actor.userId) {
    return json({ ok: false, error: "authentication_required" }, { status: 401 });
  }
  if (!(actor.scopes ?? []).includes("superadmin")) {
    return json({ ok: false, error: "superadmin_scope_required" }, { status: 403 });
  }
  return null;
}

// ──────────────────────────────────────────────────────────────
// Tenants CRUD
// ──────────────────────────────────────────────────────────────

export async function listTenants(env: Env): Promise<Response> {
  const supabase = getSupabaseAdmin(env);
  const { data, error } = await supabase
    .from("tenants")
    .select(
      "id, slug, name, status, neon_project_id, db_name, branding, owner_email, created_at, updated_at"
    )
    .order("created_at", { ascending: false });
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  return json({ ok: true, tenants: data ?? [] });
}

export async function getTenant(env: Env, tenantId: string): Promise<Response> {
  const supabase = getSupabaseAdmin(env);
  const { data, error } = await supabase
    .from("tenants")
    .select(
      "id, slug, name, status, neon_project_id, neon_branch_id, db_host, db_name, db_user, connection_secret_name, branding, owner_user_id, owner_email, notes, created_at, updated_at"
    )
    .eq("id", tenantId)
    .maybeSingle();
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return json({ ok: false, error: "tenant_not_found" }, { status: 404 });
  return json({ ok: true, tenant: data });
}

type CreateTenantBody = {
  slug: string;
  name: string;
  owner_email?: string;
  branding?: Record<string, unknown>;
  notes?: string;
  // 可选:直接粘 Neon 连接信息(跳过 API 自动建库)
  db_host?: string;
  db_name?: string;
  db_user?: string;
  connection_secret_name?: string;
  neon_project_id?: string;
  neon_branch_id?: string;
};

export async function createTenant(env: Env, body: CreateTenantBody, actor: ResolvedActor): Promise<Response> {
  if (!body.slug || !body.name) {
    return json({ ok: false, error: "slug_and_name_required" }, { status: 400 });
  }
  if (!/^[a-z0-9][a-z0-9_-]{1,30}$/.test(body.slug)) {
    return json({ ok: false, error: "slug_invalid_format" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin(env);

  // 幂等保护
  const { data: existing } = await supabase
    .from("tenants")
    .select("id, slug, status")
    .eq("slug", body.slug)
    .maybeSingle();
  if (existing) {
    return json({ ok: false, error: "slug_already_exists", tenant_id: existing.id }, { status: 409 });
  }

  // 尝试 Neon 自动 provision(有 NEON_API_KEY 才跑;否则只记一行 provisioning 状态,人工补)
  let neonInfo: {
    neon_project_id: string | null;
    neon_branch_id: string | null;
    db_host: string | null;
    db_name: string | null;
    db_user: string | null;
    connection_secret_name: string | null;
  } = {
    neon_project_id: body.neon_project_id ?? null,
    neon_branch_id: body.neon_branch_id ?? null,
    db_host: body.db_host ?? null,
    db_name: body.db_name ?? `tenant_${body.slug.replace(/-/g, "_")}`,
    db_user: body.db_user ?? null,
    connection_secret_name: body.connection_secret_name ?? null
  };

  let status: "provisioning" | "active" = "provisioning";

  if (env.NEON_API_KEY && env.NEON_PROJECT_ID && !body.db_host) {
    try {
      const provisioned = await provisionNeonDatabase(env, body.slug);
      neonInfo = { ...neonInfo, ...provisioned };
      status = "active";
    } catch (e) {
      // 记下错,tenant 仍以 provisioning 状态创建,人工 resolve
      console.error(`Neon provisioning failed for slug=${body.slug}:`, e);
    }
  } else if (body.db_host) {
    // 用户手动粘了 connection — 直接认为 active
    status = "active";
  }

  const { data, error } = await supabase
    .from("tenants")
    .insert({
      slug: body.slug,
      name: body.name,
      status,
      owner_email: body.owner_email ?? null,
      owner_user_id: actor.userId ?? null,
      branding: body.branding ?? {},
      notes: body.notes ?? null,
      ...neonInfo
    })
    .select(
      "id, slug, name, status, neon_project_id, db_name, branding, owner_email, created_at"
    )
    .single();

  if (error) return json({ ok: false, error: error.message }, { status: 500 });

  return json({ ok: true, tenant: data, neon_provisioned: status === "active" });
}

type UpdateTenantBody = Partial<
  Pick<
    CreateTenantBody,
    "name" | "owner_email" | "branding" | "notes" | "db_host" | "db_name" | "db_user" | "connection_secret_name"
  >
> & { status?: "provisioning" | "active" | "suspended" | "archived" };

export async function updateTenant(env: Env, tenantId: string, body: UpdateTenantBody): Promise<Response> {
  const supabase = getSupabaseAdmin(env);
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined) patch[k] = v;
  }
  if (Object.keys(patch).length === 0) {
    return json({ ok: false, error: "empty_patch" }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("tenants")
    .update(patch)
    .eq("id", tenantId)
    .select("id, slug, name, status")
    .maybeSingle();
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return json({ ok: false, error: "tenant_not_found" }, { status: 404 });
  return json({ ok: true, tenant: data });
}

// ──────────────────────────────────────────────────────────────
// Modules(页面级 on/off)
// ──────────────────────────────────────────────────────────────

export async function listTenantModules(env: Env, tenantId: string): Promise<Response> {
  const supabase = getSupabaseAdmin(env);
  const { data, error } = await supabase
    .from("tenant_modules")
    .select("module_slug, enabled, config, updated_at")
    .eq("tenant_id", tenantId)
    .order("module_slug");
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  return json({ ok: true, modules: data ?? [] });
}

type ModuleToggle = { module_slug: string; enabled: boolean; config?: Record<string, unknown> };

export async function bulkSetTenantModules(
  env: Env,
  tenantId: string,
  updates: ModuleToggle[]
): Promise<Response> {
  if (!Array.isArray(updates) || updates.length === 0) {
    return json({ ok: false, error: "updates_required" }, { status: 400 });
  }
  const supabase = getSupabaseAdmin(env);
  const rows = updates.map((u) => ({
    tenant_id: tenantId,
    module_slug: u.module_slug,
    enabled: u.enabled,
    config: u.config ?? {}
  }));
  const { error } = await supabase
    .from("tenant_modules")
    .upsert(rows, { onConflict: "tenant_id,module_slug" });
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  return json({ ok: true, updated: rows.length });
}

// ──────────────────────────────────────────────────────────────
// Agents(启用/配置)
// ──────────────────────────────────────────────────────────────

export async function listTenantAgents(env: Env, tenantId: string): Promise<Response> {
  const supabase = getSupabaseAdmin(env);
  const { data, error } = await supabase
    .from("tenant_agents")
    .select("agent_slug, enabled, config, last_run_at, updated_at")
    .eq("tenant_id", tenantId)
    .order("agent_slug");
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  return json({ ok: true, agents: data ?? [] });
}

type AgentToggle = { agent_slug: string; enabled: boolean; config?: Record<string, unknown> };

export async function bulkSetTenantAgents(
  env: Env,
  tenantId: string,
  updates: AgentToggle[]
): Promise<Response> {
  if (!Array.isArray(updates) || updates.length === 0) {
    return json({ ok: false, error: "updates_required" }, { status: 400 });
  }
  const supabase = getSupabaseAdmin(env);
  const rows = updates.map((u) => ({
    tenant_id: tenantId,
    agent_slug: u.agent_slug,
    enabled: u.enabled,
    config: u.config ?? {}
  }));
  const { error } = await supabase
    .from("tenant_agents")
    .upsert(rows, { onConflict: "tenant_id,agent_slug" });
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  return json({ ok: true, updated: rows.length });
}

// ──────────────────────────────────────────────────────────────
// Neon API — 自动 provision 一个 tenant-scoped database
// ──────────────────────────────────────────────────────────────

/**
 * 在现有 Neon project 里建一个新的 database,命名 `tenant_<slug>`。
 * 要求 env.NEON_API_KEY + env.NEON_PROJECT_ID + env.NEON_DEFAULT_BRANCH_ID(可选,不填用 main)。
 * 返回字段可直接 merge 进 tenants 行。
 */
async function provisionNeonDatabase(env: Env, slug: string) {
  const apiKey = env.NEON_API_KEY;
  const projectId = env.NEON_PROJECT_ID;
  if (!apiKey || !projectId) {
    throw new Error("NEON_API_KEY or NEON_PROJECT_ID not configured");
  }
  // 查默认 branch(用户没显式配就取第一个)
  let branchId = env.NEON_DEFAULT_BRANCH_ID ?? null;
  if (!branchId) {
    const branchesRes = await fetch(`https://console.neon.tech/api/v2/projects/${projectId}/branches`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }
    });
    if (!branchesRes.ok) {
      throw new Error(`neon list branches: ${branchesRes.status} ${await branchesRes.text()}`);
    }
    const branchesBody = (await branchesRes.json()) as any;
    const firstBranch = branchesBody?.branches?.[0];
    if (!firstBranch?.id) throw new Error("neon no branch found");
    branchId = firstBranch.id as string;
  }

  const dbName = `tenant_${slug.replace(/-/g, "_")}`;
  const ownerName = env.NEON_DEFAULT_OWNER ?? "neondb_owner";

  const createRes = await fetch(
    `https://console.neon.tech/api/v2/projects/${projectId}/branches/${branchId}/databases`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ database: { name: dbName, owner_name: ownerName } })
    }
  );
  if (!createRes.ok) {
    throw new Error(`neon create db: ${createRes.status} ${await createRes.text()}`);
  }

  // 查 project 的 connection URI 以取 host
  const projRes = await fetch(`https://console.neon.tech/api/v2/projects/${projectId}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }
  });
  const projBody = (await projRes.json()) as any;
  const host = projBody?.project?.pg_host ?? null;

  return {
    neon_project_id: projectId,
    neon_branch_id: branchId,
    db_host: host,
    db_name: dbName,
    db_user: ownerName,
    connection_secret_name: `TENANT_DB_PASS_${slug}` // 密码仍然需要你手工塞 Cloudflare secret
  };
}
