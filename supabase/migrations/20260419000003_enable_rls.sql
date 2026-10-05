-- 启用 RLS。service_role 自带 BYPASSRLS,Worker 继续可写。
-- 不加任何 policy 的情况下,anon/authenticated 默认读不到 —— 对当前"后端自治"阶段是期望的安全默认。
-- 后续给前端/用户侧授权时,再按表单独补 policy。

begin;

alter table users enable row level security;
alter table clients enable row level security;
alter table projects enable row level security;
alter table project_members enable row level security;
alter table meetings enable row level security;
alter table meeting_action_items enable row level security;
alter table tasks enable row level security;
alter table fx_rates enable row level security;
alter table finance_ledger enable row level security;
alter table assets enable row level security;
alter table subscriptions enable row level security;
alter table deployments enable row level security;
alter table project_databases enable row level security;
alter table onboarding_programs enable row level security;
alter table onboarding_tasks enable row level security;
alter table performance_reviews enable row level security;
alter table knowledge_documents enable row level security;
alter table knowledge_chunks enable row level security;
alter table agent_runs enable row level security;
alter table notifications enable row level security;

commit;
