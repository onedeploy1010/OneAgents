import { z } from "zod";
import type { Env } from "../lib/env";
import { json, parseListParams } from "../lib/http";
import { getSupabaseAdmin, findUserByEmail } from "../lib/supabase";
import { saveAgentRun, type ResolvedActor } from "../lib/actor";

// ================== zod schemas ==================

const clientPayloadSchema = z.object({
  name: z.string().min(1),
  contactName: z.string().optional(),
  contactChannel: z.string().optional(),
  billingCurrency: z.string().optional(),
  status: z.enum(["lead", "active", "paused", "closed"]).optional(),
  notes: z.string().optional()
});

const projectPayloadSchema = z.object({
  clientId: z.string().uuid(),
  name: z.string().min(1),
  projectCode: z.string().min(1),
  projectType: z.enum(["web", "automation", "ops", "ai", "maintenance"]).optional(),
  status: z.enum(["planning", "active", "blocked", "maintenance", "done"]).optional(),
  ownerUserEmail: z.string().email().optional(),
  deliveryModel: z.enum(["fixed", "retainer", "hourly"]).optional(),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
  startDate: z.string().optional(),
  targetEndDate: z.string().optional(),
  description: z.string().optional()
});

const projectMemberPayloadSchema = z.object({
  projectId: z.string().uuid(),
  userEmail: z.string().email(),
  role: z.string().min(1)
});

const clientContactPayloadSchema = z.object({
  clientId: z.string().uuid(),
  name: z.string().optional(),
  email: z.string().email(),
  roleAtClient: z.string().optional(),
  isPrimary: z.boolean().optional(),
  notes: z.string().optional()
});

const patchClientSchema = z.object({
  name: z.string().optional(),
  contactName: z.string().optional(),
  contactChannel: z.string().optional(),
  billingCurrency: z.string().optional(),
  status: z.enum(["lead", "active", "paused", "closed"]).optional(),
  notes: z.string().optional(),
  organizationId: z.string().uuid().nullable().optional()
});

const patchProjectSchema = z.object({
  name: z.string().optional(),
  status: z.enum(["planning", "active", "blocked", "maintenance", "done"]).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  deliveryModel: z.enum(["fixed", "retainer", "hourly"]).optional(),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
  version: z.string().optional(),
  maintenanceMode: z.boolean().optional(),
  ownerUserEmail: z.string().email().optional(),
  targetDate: z.string().optional(),
  summary: z.string().optional()
});

const patchTaskSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["todo", "doing", "review", "blocked", "done"]).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  track: z.enum(["main", "sub", "branch", "maintenance", "hotfix"]).optional(),
  versionTarget: z.string().nullable().optional(),
  assigneeUserEmail: z.string().email().nullable().optional(),
  dueAt: z.string().nullable().optional(),
  needsHumanReview: z.boolean().optional()
});

const createTaskSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["todo", "doing", "review", "blocked", "done"]).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  track: z.enum(["main", "sub", "branch", "maintenance", "hotfix"]).optional(),
  versionTarget: z.string().nullable().optional(),
  assigneeUserEmail: z.string().email().optional(),
  reporterUserEmail: z.string().email().optional(),
  dueAt: z.string().optional(),
  estimatedHours: z.number().nonnegative().optional(),
  needsHumanReview: z.boolean().optional()
});

// ================== POST ==================

export async function handleCreateClient(request: Request, env: Env, actor: ResolvedActor) {
  const body = await request.json();
  const p = clientPayloadSchema.parse(body);
  const supabase = getSupabaseAdmin(env);
  const { data, error } = await supabase
    .from("clients")
    .insert({
      name: p.name,
      contact_name: p.contactName ?? null,
      contact_channel: p.contactChannel ?? null,
      billing_currency: p.billingCurrency ?? null,
      status: p.status ?? "lead",
      notes: p.notes ?? null
    })
    .select("id, name, status")
    .single();
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  await saveAgentRun(env, {
    agent_name: "project_ops_agent",
    trigger_source: "entities/clients",
    status: "success",
    input_payload: body,
    output_payload: { clientId: data.id },
    actor
  });
  return json({ ok: true, client: data });
}

export async function handleCreateProject(request: Request, env: Env, actor: ResolvedActor) {
  const body = await request.json();
  const p = projectPayloadSchema.parse(body);
  const supabase = getSupabaseAdmin(env);
  const ownerUserId = p.ownerUserEmail ? await findUserByEmail(env, p.ownerUserEmail) : null;
  const { data, error } = await supabase
    .from("projects")
    .insert({
      client_id: p.clientId,
      name: p.name,
      project_code: p.projectCode,
      type: p.projectType ?? "web",
      status: p.status ?? "planning",
      owner_user_id: ownerUserId,
      delivery_model: p.deliveryModel ?? "fixed",
      risk_level: p.riskLevel ?? "low",
      start_date: p.startDate ?? null,
      target_date: p.targetEndDate ?? null,
      summary: p.description ?? null
    })
    .select("id, name, project_code, status")
    .single();
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  await saveAgentRun(env, {
    agent_name: "project_ops_agent",
    trigger_source: "entities/projects",
    status: "success",
    project_id: data.id,
    input_payload: body,
    output_payload: { projectId: data.id },
    actor
  });
  return json({ ok: true, project: data });
}

export async function handleCreateProjectMember(request: Request, env: Env, actor: ResolvedActor) {
  const body = await request.json();
  const p = projectMemberPayloadSchema.parse(body);
  const supabase = getSupabaseAdmin(env);
  const userId = await findUserByEmail(env, p.userEmail);
  if (!userId) return json({ ok: false, error: "user_not_found" }, { status: 404 });
  const { data, error } = await supabase
    .from("project_members")
    .insert({ project_id: p.projectId, user_id: userId, role_in_project: p.role })
    .select("project_id, user_id, role_in_project")
    .single();
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  await saveAgentRun(env, {
    agent_name: "project_ops_agent",
    trigger_source: "entities/project-members",
    status: "success",
    project_id: p.projectId,
    input_payload: body,
    output_payload: data,
    actor
  });
  return json({ ok: true, member: data });
}

export async function handleCreateTask(request: Request, env: Env, actor: ResolvedActor) {
  const body = await request.json();
  const p = createTaskSchema.parse(body);
  const supabase = getSupabaseAdmin(env);
  const assigneeUserId = p.assigneeUserEmail ? await findUserByEmail(env, p.assigneeUserEmail) : null;
  const reporterUserId = p.reporterUserEmail
    ? await findUserByEmail(env, p.reporterUserEmail)
    : actor.userId ?? null;
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      project_id: p.projectId,
      title: p.title,
      description: p.description ?? null,
      status: p.status ?? "todo",
      priority: p.priority ?? 3,
      track: p.track ?? "main",
      version_target: p.versionTarget ?? null,
      assignee_user_id: assigneeUserId,
      reporter_user_id: reporterUserId,
      source_type: "manual",
      estimated_hours: p.estimatedHours ?? null,
      due_at: p.dueAt ?? null,
      source_channel: actor.source ?? "http",
      needs_human_review: p.needsHumanReview ?? false
    })
    .select("id, project_id, title, status, priority, track, version_target, due_at, assignee_user_id")
    .single();
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  await saveAgentRun(env, {
    agent_name: "project_ops_agent",
    trigger_source: "entities/tasks",
    status: "success",
    project_id: p.projectId,
    input_payload: body,
    output_payload: { taskId: data.id },
    actor
  });
  return json({ ok: true, task: data });
}

export async function handleCreateClientContact(request: Request, env: Env, actor: ResolvedActor) {
  const body = await request.json();
  const p = clientContactPayloadSchema.parse(body);
  const supabase = getSupabaseAdmin(env);
  if (p.isPrimary) {
    await supabase.from("client_contacts").update({ is_primary: false }).eq("client_id", p.clientId);
  }
  const { data, error } = await supabase
    .from("client_contacts")
    .insert({
      client_id: p.clientId,
      name: p.name ?? null,
      email: p.email.toLowerCase(),
      role_at_client: p.roleAtClient ?? null,
      is_primary: p.isPrimary ?? false,
      notes: p.notes ?? null
    })
    .select("id, name, email, role_at_client, is_primary")
    .single();
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  await saveAgentRun(env, {
    agent_name: "project_ops_agent",
    trigger_source: "entities/client-contacts",
    status: "success",
    input_payload: body,
    output_payload: { contactId: data.id },
    actor
  });
  return json({ ok: true, contact: data });
}

// ================== PATCH / DELETE ==================

export async function handlePatchClientContact(request: Request, env: Env, id: string) {
  const body = await request.json();
  const p = clientContactPayloadSchema.partial().parse(body);
  const supabase = getSupabaseAdmin(env);
  if (p.isPrimary && p.clientId) {
    await supabase
      .from("client_contacts")
      .update({ is_primary: false })
      .eq("client_id", p.clientId)
      .neq("id", id);
  }
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (p.name !== undefined) update.name = p.name;
  if (p.email !== undefined) update.email = p.email.toLowerCase();
  if (p.roleAtClient !== undefined) update.role_at_client = p.roleAtClient;
  if (p.isPrimary !== undefined) update.is_primary = p.isPrimary;
  if (p.notes !== undefined) update.notes = p.notes;
  const { data, error } = await supabase
    .from("client_contacts")
    .update(update)
    .eq("id", id)
    .select("id, name, email, role_at_client, is_primary")
    .single();
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  return json({ ok: true, contact: data });
}

export async function handleDeleteClientContact(env: Env, id: string) {
  const supabase = getSupabaseAdmin(env);
  const { error } = await supabase.from("client_contacts").delete().eq("id", id);
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  return json({ ok: true, deleted: id });
}

export async function handlePatchClient(request: Request, env: Env, id: string) {
  const body = await request.json();
  const p = patchClientSchema.parse(body);
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (p.name !== undefined) update.name = p.name;
  if (p.contactName !== undefined) update.contact_name = p.contactName;
  if (p.contactChannel !== undefined) update.contact_channel = p.contactChannel;
  if (p.billingCurrency !== undefined) update.billing_currency = p.billingCurrency;
  if (p.status !== undefined) update.status = p.status;
  if (p.notes !== undefined) update.notes = p.notes;
  if (p.organizationId !== undefined) update.organization_id = p.organizationId;
  const supabase = getSupabaseAdmin(env);
  const { data, error } = await supabase
    .from("clients")
    .update(update)
    .eq("id", id)
    .select("id, name, status, billing_currency, organization_id")
    .single();
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  return json({ ok: true, client: data });
}

export async function handlePatchProject(request: Request, env: Env, id: string) {
  const body = await request.json();
  const p = patchProjectSchema.parse(body);
  const supabase = getSupabaseAdmin(env);
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (p.name !== undefined) update.name = p.name;
  if (p.status !== undefined) update.status = p.status;
  if (p.priority !== undefined) update.priority = p.priority;
  if (p.deliveryModel !== undefined) update.delivery_model = p.deliveryModel;
  if (p.riskLevel !== undefined) update.risk_level = p.riskLevel;
  if (p.version !== undefined) update.version = p.version;
  if (p.maintenanceMode !== undefined) update.maintenance_mode = p.maintenanceMode;
  if (p.targetDate !== undefined) update.target_date = p.targetDate;
  if (p.summary !== undefined) update.summary = p.summary;
  if (p.ownerUserEmail !== undefined) {
    update.owner_user_id = await findUserByEmail(env, p.ownerUserEmail);
  }
  const { data, error } = await supabase
    .from("projects")
    .update(update)
    .eq("id", id)
    .select("id, project_code, name, status, version, maintenance_mode")
    .single();
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  return json({ ok: true, project: data });
}

export async function handlePatchTask(request: Request, env: Env, id: string) {
  const body = await request.json();
  const p = patchTaskSchema.parse(body);
  const supabase = getSupabaseAdmin(env);
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (p.title !== undefined) update.title = p.title;
  if (p.description !== undefined) update.description = p.description;
  if (p.status !== undefined) {
    update.status = p.status;
    if (p.status === "done") update.completed_at = new Date().toISOString();
  }
  if (p.priority !== undefined) update.priority = p.priority;
  if (p.track !== undefined) update.track = p.track;
  if (p.versionTarget !== undefined) update.version_target = p.versionTarget;
  if (p.dueAt !== undefined) update.due_at = p.dueAt;
  if (p.needsHumanReview !== undefined) update.needs_human_review = p.needsHumanReview;
  if (p.assigneeUserEmail !== undefined) {
    update.assignee_user_id =
      p.assigneeUserEmail === null ? null : await findUserByEmail(env, p.assigneeUserEmail);
  }
  const { data, error } = await supabase
    .from("tasks")
    .update(update)
    .eq("id", id)
    .select("id, title, status, priority, track, needs_human_review")
    .single();
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  return json({ ok: true, task: data });
}

// ================== GET lists ==================

export async function handleListClients(env: Env, url: URL) {
  const { limit, search } = parseListParams(url);
  const supabase = getSupabaseAdmin(env);
  let q = supabase
    .from("clients")
    .select(
      "id, name, status, billing_currency, organization_id, contact_name, created_at",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (search) q = q.ilike("name", `%${search}%`);
  const status = url.searchParams.get("status");
  if (status) q = q.eq("status", status);
  const orgId = url.searchParams.get("organizationId");
  if (orgId) q = q.eq("organization_id", orgId);
  const { data, count, error } = await q;
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  return json({ ok: true, total: count ?? null, items: data ?? [] });
}

export async function handleClientDetail(env: Env, id: string) {
  const supabase = getSupabaseAdmin(env);
  const [{ data: client }, { data: projects }, { data: contacts }] = await Promise.all([
    supabase
      .from("clients")
      .select("*, organizations(name, slug)")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("projects")
      .select("id, project_code, name, status, version, maintenance_mode, type, delivery_model")
      .eq("client_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("client_contacts")
      .select("id, name, email, role_at_client, is_primary, telegram_chat_id")
      .eq("client_id", id)
  ]);
  if (!client) return json({ ok: false, error: "not_found" }, { status: 404 });
  return json({ ok: true, client, projects: projects ?? [], contacts: contacts ?? [] });
}

export async function handleListProjects(env: Env, url: URL) {
  const { limit, search } = parseListParams(url);
  const supabase = getSupabaseAdmin(env);
  let q = supabase
    .from("projects")
    .select(
      "id, project_code, name, status, version, maintenance_mode, type, delivery_model, client_id, owner_user_id, target_date, clients(name)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (search) q = q.or(`name.ilike.%${search}%,project_code.ilike.%${search}%`);
  const status = url.searchParams.get("status");
  if (status) q = q.eq("status", status);
  const clientId = url.searchParams.get("clientId");
  if (clientId) q = q.eq("client_id", clientId);
  const { data, count, error } = await q;
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  return json({ ok: true, total: count ?? null, items: data ?? [] });
}

export async function handleProjectDetail(env: Env, id: string) {
  const supabase = getSupabaseAdmin(env);
  const [{ data: project }, { data: tasks }, { data: meetings }, { data: members }] =
    await Promise.all([
      supabase
        .from("projects")
        .select("*, clients(name, organization_id, organizations(name))")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("tasks")
        .select(
          "id, parent_task_id, title, status, priority, track, version_target, assignee_user_id, due_at, completed_at, needs_human_review"
        )
        .eq("project_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("meetings")
        .select("id, title, happened_at, needs_human_review, summary")
        .eq("project_id", id)
        .order("happened_at", { ascending: false })
        .limit(20),
      supabase
        .from("project_members")
        .select("user_id, role_in_project, is_primary, users(display_name, email, role)")
        .eq("project_id", id)
    ]);
  if (!project) return json({ ok: false, error: "not_found" }, { status: 404 });
  return json({ ok: true, project, tasks: tasks ?? [], meetings: meetings ?? [], members: members ?? [] });
}

export async function handleListTasks(env: Env, url: URL) {
  const { limit, search } = parseListParams(url);
  const supabase = getSupabaseAdmin(env);
  let q = supabase
    .from("tasks")
    .select(
      "id, project_id, parent_task_id, title, status, priority, track, version_target, assignee_user_id, reporter_user_id, due_at, needs_human_review, source_type, projects(project_code, name)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (search) q = q.ilike("title", `%${search}%`);
  const status = url.searchParams.get("status");
  if (status) q = q.eq("status", status);
  const track = url.searchParams.get("track");
  if (track) q = q.eq("track", track);
  const projectId = url.searchParams.get("projectId");
  if (projectId) q = q.eq("project_id", projectId);
  const assignee = url.searchParams.get("assignee");
  if (assignee) q = q.eq("assignee_user_id", assignee);
  const needsReview = url.searchParams.get("needsReview");
  if (needsReview === "true") q = q.eq("needs_human_review", true);
  const { data, count, error } = await q;
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  return json({ ok: true, total: count ?? null, items: data ?? [] });
}

export async function handleListMeetings(env: Env, url: URL) {
  const { limit, search } = parseListParams(url);
  const supabase = getSupabaseAdmin(env);
  let q = supabase
    .from("meetings")
    .select(
      "id, title, project_id, happened_at, needs_human_review, summary, source_channel, projects(project_code, name)",
      { count: "exact" }
    )
    .order("happened_at", { ascending: false })
    .limit(limit);
  if (search) q = q.ilike("title", `%${search}%`);
  const projectId = url.searchParams.get("projectId");
  if (projectId) q = q.eq("project_id", projectId);
  const needsReview = url.searchParams.get("needsReview");
  if (needsReview === "true") q = q.eq("needs_human_review", true);
  const { data, count, error } = await q;
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  return json({ ok: true, total: count ?? null, items: data ?? [] });
}

export async function handleListOnboardingPrograms(env: Env, url: URL) {
  const { limit } = parseListParams(url);
  const supabase = getSupabaseAdmin(env);
  let q = supabase
    .from("onboarding_programs")
    .select(
      "id, trainee_user_id, mentor_user_id, status, start_date, end_date, final_score, final_decision, summary, created_at, trainee:users!onboarding_programs_trainee_user_id_fkey(email, display_name, role), mentor:users!onboarding_programs_mentor_user_id_fkey(email, display_name)",
      { count: "exact" }
    )
    .order("start_date", { ascending: false })
    .limit(limit);
  const status = url.searchParams.get("status");
  if (status) q = q.eq("status", status);
  const traineeUserId = url.searchParams.get("traineeUserId");
  if (traineeUserId) q = q.eq("trainee_user_id", traineeUserId);
  const mentorUserId = url.searchParams.get("mentorUserId");
  if (mentorUserId) q = q.eq("mentor_user_id", mentorUserId);
  const { data, count, error } = await q;
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  return json({ ok: true, total: count ?? null, items: data ?? [] });
}

export async function handleListUsers(env: Env, url: URL) {
  const { limit, search } = parseListParams(url);
  const supabase = getSupabaseAdmin(env);
  let q = supabase
    .from("users")
    .select("id, email, display_name, role, status, telegram_chat_id, joined_at", { count: "exact" })
    .order("joined_at", { ascending: false })
    .limit(limit);
  if (search) q = q.or(`email.ilike.%${search}%,display_name.ilike.%${search}%`);
  const role = url.searchParams.get("role");
  if (role) q = q.eq("role", role);
  const status = url.searchParams.get("status");
  if (status) q = q.eq("status", status);
  const { data, count, error } = await q;
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  return json({ ok: true, total: count ?? null, items: data ?? [] });
}

export async function handleListOrganizations(env: Env, url: URL) {
  const { limit, search } = parseListParams(url);
  const supabase = getSupabaseAdmin(env);
  let q = supabase
    .from("organizations")
    .select("id, name, slug, admin_email, description, created_at", { count: "exact" })
    .order("name")
    .limit(limit);
  if (search) q = q.or(`name.ilike.%${search}%,slug.ilike.%${search}%`);
  const { data, count, error } = await q;
  if (error) return json({ ok: false, error: error.message }, { status: 500 });
  return json({ ok: true, total: count ?? null, items: data ?? [] });
}

export async function handleListConnectors(env: Env) {
  const supabase = getSupabaseAdmin(env);
  const { data } = await supabase
    .from("connectors")
    .select(
      "id, provider, name, status, secret_ref, last_health_check_at, owner_user_id, users(display_name)"
    )
    .order("provider");
  return json({ ok: true, items: data ?? [] });
}

export async function handleMeTasks(env: Env, actor: ResolvedActor) {
  if (!actor.userId) return json({ ok: false, error: "authentication_required" }, { status: 401 });
  const supabase = getSupabaseAdmin(env);
  const { data } = await supabase
    .from("tasks")
    .select(
      "id, title, status, priority, due_at, track, project_id, projects(project_code, name), needs_human_review"
    )
    .or(`assignee_user_id.eq.${actor.userId},reporter_user_id.eq.${actor.userId}`)
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(100);
  return json({ ok: true, items: data ?? [] });
}

export async function handleMeProjects(env: Env, actor: ResolvedActor) {
  if (!actor.userId) return json({ ok: false, error: "authentication_required" }, { status: 401 });
  const supabase = getSupabaseAdmin(env);
  const { data: asOwner } = await supabase
    .from("projects")
    .select("id, project_code, name, status, version, clients(name)")
    .eq("owner_user_id", actor.userId);
  const { data: asMember } = await supabase
    .from("project_members")
    .select("role_in_project, projects(id, project_code, name, status, version, clients(name))")
    .eq("user_id", actor.userId);
  const owned = asOwner ?? [];
  const memberOf = (asMember ?? []).map((m: any) => ({
    ...m.projects,
    role_in_project: m.role_in_project
  }));
  const byId = new Map<string, any>();
  for (const p of owned) byId.set(p.id, { ...p, role_in_project: "owner" });
  for (const p of memberOf) if (p && !byId.has(p.id)) byId.set(p.id, p);
  return json({ ok: true, items: Array.from(byId.values()) });
}
