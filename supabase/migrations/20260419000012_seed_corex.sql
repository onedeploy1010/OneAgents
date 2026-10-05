-- CoreX 首次录入。幂等,可重跑。
-- 集团 CoreX → 公司 CoreX → 3 个项目 v1(retainer, maintenance_mode) → 每项目一条 April 维护 epic。

begin;

-- 1) Organization
insert into organizations (name, slug, description, admin_email)
values (
  'CoreX',
  'corex',
  'AI 算力基础设施背景的金融定投产品。',
  'corex17888@gmail.com'
)
on conflict (name) do update set
  slug = excluded.slug,
  description = excluded.description,
  admin_email = excluded.admin_email,
  updated_at = now();

-- 2) Client(公司签约方,挂在集团下)。clients.name 没 unique,用 where not exists 保证幂等。
with org as (select id from organizations where name = 'CoreX')
insert into clients (name, contact_name, contact_channel, billing_currency, status, notes, organization_id)
select 'CoreX', 'CoreX Admin', 'email:corex17888@gmail.com', 'USDT', 'active',
       'AI 算力 + 金融定投。retainer 模式,月度维护 + 新增需求。', org.id
from org
where not exists (select 1 from clients where name = 'CoreX');

-- 补更新已存在的 CoreX 的 organization_id 与 billing
with org as (select id from organizations where name = 'CoreX')
update clients
set organization_id = org.id,
    contact_channel = 'email:corex17888@gmail.com',
    billing_currency = 'USDT',
    status = 'active',
    notes = 'AI 算力 + 金融定投。retainer 模式,月度维护 + 新增需求。',
    updated_at = now()
from org
where clients.name = 'CoreX';

-- 3) primary contact(client_contacts.email 也没 unique,用 not exists)
with c as (select id from clients where name = 'CoreX')
insert into client_contacts (client_id, name, email, role_at_client, is_primary, notes)
select c.id, 'CoreX Admin', 'corex17888@gmail.com', 'admin', true, '公司管理邮箱,所有通知默认抄送'
from c
where not exists (
  select 1 from client_contacts cc
  where cc.client_id = c.id and cc.email = 'corex17888@gmail.com'
);

-- 4) 3 个项目 v1 + maintenance_mode
with c as (select id from clients where name = 'CoreX')
insert into projects (
  client_id, name, project_code, type, status, priority,
  delivery_model, risk_level, version, maintenance_mode, summary
)
select c.id, v.* from c, (values
  ('CoreX Dapp 系统', 'corex-dapp-v1', 'web'::project_type, 'active'::project_status,
   2::smallint, 'retainer'::delivery_model, 'medium'::risk_level, 'v1', true,
   '客户前端(Dapp 钱包连接 + 定投)+ 管理后台。v1 已上线,月度维护 + 小增改 + bug 排查。'),
  ('CoreX 算力管理后台', 'corex-compute-admin-v1', 'ops'::project_type, 'active'::project_status,
   2::smallint, 'retainer'::delivery_model, 'medium'::risk_level, 'v1', true,
   '算力节点注册、调度、监控后台。v1 已上线,月度维护。'),
  ('CoreX Telegram 群管理 Bot', 'corex-tg-bot-v1', 'automation'::project_type, 'active'::project_status,
   3::smallint, 'retainer'::delivery_model, 'low'::risk_level, 'v1', true,
   'TG 群进出管理、黑名单、自动应答、广播。v1 已上线,月度维护。')
) as v(name, project_code, type, status, priority, delivery_model, risk_level, version, maintenance_mode, summary)
on conflict (project_code) do update set
  name = excluded.name,
  type = excluded.type,
  status = excluded.status,
  delivery_model = excluded.delivery_model,
  version = excluded.version,
  maintenance_mode = excluded.maintenance_mode,
  summary = excluded.summary,
  updated_at = now();

-- 5) 每项目一条 April 维护 epic(track=maintenance, version_target=v1)
--    作为本月的主线,后面加 sub/branch 都 parent_task_id 指向它
with p as (select id, project_code from projects where project_code in (
  'corex-dapp-v1','corex-compute-admin-v1','corex-tg-bot-v1'))
insert into tasks (
  project_id, title, description, status, priority,
  source_type, track, version_target,
  created_by_agent, agent_name, source_channel,
  due_at
)
select
  p.id,
  'CoreX ' || case p.project_code
    when 'corex-dapp-v1' then 'Dapp'
    when 'corex-compute-admin-v1' then '算力管理后台'
    else 'TG Bot'
  end || ' — 2026-04 月度维护',
  '本月维护主任务:服务器 / 站点健康 / 订阅续费 / bug 清单 / 小增改。子任务按周拆。',
  'todo'::task_status,
  2::smallint,
  'system'::task_source_type,
  'maintenance'::task_track,
  'v1',
  true,
  'project_ops_agent',
  'seed:corex_bootstrap',
  '2026-04-30T23:59:00+08:00'::timestamptz
from p
on conflict do nothing;

-- 6) 每项目追加 2 条典型 sub-task 示例(放到 maintenance epic 下)
with epics as (
  select t.id as parent_id, t.project_id, p.project_code
  from tasks t
  join projects p on p.id = t.project_id
  where t.track = 'maintenance'
    and t.version_target = 'v1'
    and p.project_code in ('corex-dapp-v1','corex-compute-admin-v1','corex-tg-bot-v1')
    and t.title like '%2026-04 月度维护'
)
insert into tasks (
  project_id, parent_task_id, title, description,
  status, priority, source_type, track, version_target,
  created_by_agent, agent_name, source_channel
)
select epics.project_id, epics.parent_id, s.title, s.description,
  'todo'::task_status, 3::smallint, 'system'::task_source_type,
  'sub'::task_track, 'v1', true, 'project_ops_agent', 'seed:corex_bootstrap'
from epics, lateral (values
  (epics.project_code || ' — 服务器与站点健康巡检(4 月)',
   '检查 CPU/内存/磁盘;站点 200 OK;DB 备份是否正常;订阅 30 天内到期的提前提醒。'),
  (epics.project_code || ' — 客户需求清单整理(4 月)',
   '本月收到的小增改与 bug 汇总,排期后逐条开 branch/sub 任务。')
) as s(title, description)
on conflict do nothing;

commit;
