-- Workspace OS S6 Flow, V1-12 (part 1): pausing, resuming and stopping runs.
--
-- Additive to 20261106010001:
--
--   workflow_rule       gains the instant stop switch (`stopped_at`, `stopped_by`)
--                       and a per-workflow rate limit (`max_runs_per_hour`).
--   workflow_execution  gains what a run needs to pause and resume: the step to
--                       resume at and when, the run's state (step outputs and
--                       counters), and links to the run it retries or the run
--                       that started it as a sub-workflow.
--
-- The `workflow-resume` job continues waiting runs whose time has come, and
-- marks waiting runs of a stopped or switched-off workflow as stopped.

alter table public.workflow_rule
  add column if not exists stopped_at timestamptz,
  add column if not exists stopped_by uuid references public.user_profile (id) on delete set null,
  add column if not exists max_runs_per_hour int not null default 60;

alter table public.workflow_rule
  add constraint workflow_rule_max_runs_per_hour_range check (max_runs_per_hour between 1 and 1000);

comment on column public.workflow_rule.stopped_at is
  'The instant stop switch: while set, the workflow starts no run and its waiting runs are stopped.';
comment on column public.workflow_rule.max_runs_per_hour is
  'Runs started by events in the last hour beyond this are skipped and recorded as rate limited.';

alter table public.workflow_execution
  add column if not exists resume_step_id text,
  add column if not exists resume_attempt int,
  add column if not exists resume_at timestamptz,
  add column if not exists run_state jsonb,
  add column if not exists retry_of uuid references public.workflow_execution (id) on delete set null,
  add column if not exists parent_execution_id uuid references public.workflow_execution (id) on delete set null;

alter table public.workflow_execution
  add constraint workflow_execution_resume_attempt_range check (resume_attempt is null or resume_attempt between 1 and 5),
  add constraint workflow_execution_resume_step_length check (resume_step_id is null or char_length(resume_step_id) <= 64);

comment on column public.workflow_execution.run_state is
  'Step outputs and counters a graph run carries between pauses (engine.ts RunState).';
comment on column public.workflow_execution.retry_of is
  'The run this one retries from a chosen step ("retry from this step").';

create index if not exists idx_workflow_execution_waiting
  on public.workflow_execution (resume_at)
  where outcome = 'waiting';
create index if not exists idx_workflow_execution_rule_recent
  on public.workflow_execution (rule_id, created_at desc)
  where not is_test;

insert into public.job_definition (name, description, schedule, queue, enabled, batch_size, max_attempts)
values
  ('workflow-resume',
   'Resumes waiting step-graph workflow runs whose time has come; stops those of stopped workflows. Does nothing while wos_workflows_v2 is off.',
   '* * * * *', null, true, 50, 3)
on conflict (name) do update
  set description = excluded.description,
      schedule = excluded.schedule;

do $$
declare
  j record;
begin
  for j in select name, schedule from public.job_definition where name = 'workflow-resume'
  loop
    perform cron.unschedule(j.name)
      where exists (select 1 from cron.job c where c.jobname = j.name);
    perform cron.schedule(j.name, j.schedule,
      format('select app.dispatch_job(%L)', j.name));
  end loop;
end;
$$;
