/**
 * 所有 agent 的统一 barrel。
 * 每个 agent 有自己一个 folder:
 * - do.ts         — Cloudflare Durable Object class(状态 + @callable 方法)
 * - skills/       — 该 agent 用得上的 LLM helper / 结构化动作
 * - personas/     — 如果是多性格 agent(onboarding 的 4 mentor、orchestrator 的 4 client_agent)
 * - connectors.ts — 声明该 agent 依赖的外部连接,便于面板可视化
 */

export { MeetingAgent } from "./meeting";
export { ProjectOpsAgent } from "./project-ops";
export { FinanceAgent } from "./finance";
export { OnboardingAgent } from "./onboarding";
export { KnowledgeAgent } from "./knowledge";
export { InfraAgent } from "./infra";
export { OrchestratorAgent } from "./orchestrator";
export { TrainingCoachAgent } from "./training-coach";

// Personas
export * from "./onboarding/personas";
export * from "./orchestrator/personas";

// Connectors registry — 面板能看到每个 agent 的外部依赖
export { MEETING_CONNECTORS } from "./meeting/connectors";
export { PROJECT_OPS_CONNECTORS } from "./project-ops/connectors";
export { FINANCE_CONNECTORS } from "./finance/connectors";
export { ONBOARDING_CONNECTORS } from "./onboarding/connectors";
export { KNOWLEDGE_CONNECTORS } from "./knowledge/connectors";
export { INFRA_CONNECTORS } from "./infra/connectors";
export { ORCHESTRATOR_CONNECTORS } from "./orchestrator/connectors";
export { TRAINING_COACH_CONNECTORS } from "./training-coach/connectors";
