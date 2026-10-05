-- OneAgents
-- 基础参考数据种子脚本
-- 说明：仅写入低风险参考数据，真实用户、客户和项目请在业务初始化阶段创建

insert into fx_rates (base_currency, quote_currency, rate, source, effective_at)
values
  ('USDT', 'U', 1.000000, 'default_manual_seed', now()),
  ('USDC', 'U', 1.000000, 'default_manual_seed', now()),
  ('USD', 'U', 1.000000, 'default_manual_seed', now())
on conflict do nothing;
