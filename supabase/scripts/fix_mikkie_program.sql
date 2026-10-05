-- 一次性补救:Mikkie 在 invite intake 时 program 静默失败,这里手工把
--   * onboarding_programs (active)
--   * onboarding_tasks    (按 replit_panel_15day 模板复制 15 天)
-- 补回去。完全幂等:已经有 active program 就不重建,已有 task 就 skip。
--
-- 使用:Supabase Dashboard → SQL Editor → New query → 粘贴执行。
-- 也可以本地跑:psql "$SUPABASE_DB_URL" -f supabase/scripts/fix_mikkie_program.sql
--
-- 跑完会 RAISE NOTICE 报告做了什么:
--   * trainee_user_id / template_id / program_id
--   * 新建了几条 task(0 表示已经有了,没动)
-- 任何前置缺失(template / user)都会 RAISE EXCEPTION 中止,不会半建。

do $$
declare
  v_email           text := 'mikkizoon@gmail.com';
  v_template_slug   text := 'replit_panel_15day';
  v_mentor_slug     text := 'nina_coach';
  v_start_date      date := current_date;
  v_user_id         uuid;
  v_template_id     uuid;
  v_template_days   int;
  v_program_id      uuid;
  v_existing_tasks  int;
  v_inserted_tasks  int;
begin
  -- 1) 找 user
  select id into v_user_id from users where email = v_email;
  if v_user_id is null then
    raise exception '用户不存在(email=%),先确认 invite intake 走完到 user 创建那一步', v_email;
  end if;
  raise notice 'trainee_user_id = %', v_user_id;

  -- 2) 找 template
  select id, duration_days into v_template_id, v_template_days
    from onboarding_templates where name = v_template_slug;
  if v_template_id is null then
    raise exception '模板 % 不存在 — 先跑 migration 20260419000015_replit_template.sql', v_template_slug;
  end if;
  raise notice 'template_id = % (% days)', v_template_id, v_template_days;

  -- 3) 找已存在的 active program;没有就建
  select id into v_program_id
    from onboarding_programs
   where trainee_user_id = v_user_id
     and status = 'active'
   order by start_date desc
   limit 1;

  if v_program_id is null then
    insert into onboarding_programs (
      trainee_user_id, template_id, mentor_slug,
      start_date, end_date, status, summary
    ) values (
      v_user_id, v_template_id, v_mentor_slug,
      v_start_date,
      v_start_date + (v_template_days - 1),
      'active',
      'manual fix · invite intake 时 program 静默失败 · 模板 ' || v_template_slug
    )
    returning id into v_program_id;
    raise notice '新建 program_id = %', v_program_id;
  else
    raise notice '已有 active program_id = %,不重建', v_program_id;
  end if;

  -- 4) 复制模板任务到 onboarding_tasks(按 template_task_id 去重)
  select count(*) into v_existing_tasks
    from onboarding_tasks where program_id = v_program_id;

  with src as (
    select
      v_program_id as program_id,
      tt.id        as template_task_id,
      tt.day_number,
      tt.title,
      tt.today_goal as description,
      tt.phase,
      tt.today_goal,
      tt.required_tasks,
      tt.required_outputs,
      tt.score_focus,
      'todo'::onboarding_task_status as status,
      ((v_start_date + (tt.day_number - 1))::timestamp + interval '23 hours 59 minutes')
        at time zone 'UTC' as due_at
    from onboarding_template_tasks tt
    where tt.template_id = v_template_id
  )
  insert into onboarding_tasks (
    program_id, template_task_id, day_number, title, description,
    phase, today_goal, required_tasks, required_outputs, score_focus,
    status, due_at
  )
  select
    s.program_id, s.template_task_id, s.day_number, s.title, s.description,
    s.phase, s.today_goal, s.required_tasks, s.required_outputs, s.score_focus,
    s.status, s.due_at
  from src s
  where not exists (
    select 1 from onboarding_tasks ot
     where ot.program_id = s.program_id
       and ot.template_task_id = s.template_task_id
  );
  get diagnostics v_inserted_tasks = row_count;
  raise notice 'tasks: 已存在 %, 新增 %', v_existing_tasks, v_inserted_tasks;

  -- 5) 留一条 audit row 在 agent_runs,方便 Retool 活动日志看到"这是手工补的"
  insert into agent_runs (
    agent_name, trigger_source, status,
    input_payload, output_payload
  ) values (
    'onboarding_agent',
    'manual:fix_invite_program',
    'success',
    jsonb_build_object('email', v_email, 'template_slug', v_template_slug),
    jsonb_build_object(
      'user_id',           v_user_id,
      'program_id',        v_program_id,
      'template_id',       v_template_id,
      'tasks_inserted',    v_inserted_tasks,
      'tasks_pre_existing', v_existing_tasks
    )
  );

  raise notice '✅ 完成:program % / tasks 总数 %',
    v_program_id,
    (select count(*) from onboarding_tasks where program_id = v_program_id);
end $$;
