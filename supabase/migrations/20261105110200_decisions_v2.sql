-- Workspace OS V1-10: decisions with the full record (stream S5b, epic #199).
--
-- Additive only. The decision table keeps every column and policy it has;
-- this adds the fields the brief asks for (problem, options considered,
-- evidence, reasoning, participants, revisit date) and the bookkeeping for
-- the revisit reminder. Existing screens (the project RAID log, meetings)
-- keep working unchanged because every new column is nullable or defaulted.
--
-- Access is exactly today's decision rule (decision_read and
-- decision_scoped_write in 20260912021000), now also available as two
-- helpers so participants, the reminder and later app.can (M10c) ask the
-- same question.
--
-- Hidden behind the `wos_decisions_v2` switch until sign-off
-- (20261105110000_s5b_feature_switches).

alter table public.decision
  add column if not exists problem text
    check (problem is null or char_length(problem) <= 4000),
  add column if not exists options_considered jsonb not null default '[]'::jsonb
    check (jsonb_typeof(options_considered) = 'array' and jsonb_array_length(options_considered) <= 20),
  add column if not exists evidence text
    check (evidence is null or char_length(evidence) <= 4000),
  add column if not exists reasoning text
    check (reasoning is null or char_length(reasoning) <= 4000),
  add column if not exists revisit_on date,
  add column if not exists revisit_reminded_at timestamptz;

comment on column public.decision.options_considered is
  'The options weighed, as a JSON array of strings (Workspace OS V1-10).';
comment on column public.decision.revisit_on is
  'When the decision should be looked at again. The decision-revisit-reminders job notifies the decider and participants on that day.';
comment on column public.decision.revisit_reminded_at is
  'When the revisit reminder went out. Cleared whenever revisit_on changes, so a new date is reminded again.';

create index if not exists idx_decision_revisit
  on public.decision (revisit_on)
  where revisit_on is not null and revisit_reminded_at is null;
create index if not exists idx_decision_project_trail
  on public.decision (project_id, decided_at desc)
  where project_id is not null;

-- Options are short strings; anything else is refused rather than stored.
create or replace function app.decision_v2_guard()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from jsonb_array_elements(new.options_considered) o
    where jsonb_typeof(o) <> 'string' or char_length(o #>> '{}') not between 1 and 500
  ) then
    raise exception 'Each option considered is a short piece of text' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.revisit_on is distinct from old.revisit_on then
    new.revisit_reminded_at := null;
  end if;
  return new;
end;
$$;
revoke all on function app.decision_v2_guard() from public, anon, authenticated;

drop trigger if exists decision_v2_guard on public.decision;
create trigger decision_v2_guard
  before insert or update on public.decision
  for each row execute function app.decision_v2_guard();

-- Today's decision rules as helpers ----------------------------------------
create or replace function app.can_read_decision(p_decision uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.decision d
    where d.id = p_decision
      and (
        (d.meeting_id is not null and app.can_read_meeting(d.meeting_id))
        or (d.project_id is not null and app.has_project_capability(d.project_id, 'read'))
        or (d.meeting_id is null and d.project_id is null and app.is_org_admin(d.organization_id))
      )
  );
$$;

create or replace function app.can_manage_decision(p_decision uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.decision d
    where d.id = p_decision
      and (
        (d.meeting_id is not null and app.can_manage_meeting(d.meeting_id))
        or (d.project_id is not null and app.has_project_capability(d.project_id, 'manage'))
        or app.is_org_admin(d.organization_id)
      )
  );
$$;

revoke all on function app.can_read_decision(uuid), app.can_manage_decision(uuid) from public, anon;
grant execute on function app.can_read_decision(uuid), app.can_manage_decision(uuid) to authenticated, service_role;

create or replace function public.can_manage_decision(p_decision uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select app.can_manage_decision(p_decision);
$$;
revoke all on function public.can_manage_decision(uuid) from public, anon;
grant execute on function public.can_manage_decision(uuid) to authenticated, service_role;

-- Whether a given person (not the caller) can read a decision. Used so a
-- participant, and a revisit reminder, only ever reaches someone who could
-- already open the decision: a reminder names it, so it must not leak it.
create or replace function app.decision_readable_by(p_decision uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user is not null and exists (
    select 1 from public.decision d
    join public.organization_membership mem
      on mem.organization_id = d.organization_id
     and mem.user_id = p_user
     and mem.status = 'active'
    where d.id = p_decision
      and (
        mem.role in ('owner', 'admin', 'leadership_viewer')
        or (d.project_id is not null and app.actor_has_project_capability(p_user, d.project_id, 'read'))
        or (d.meeting_id is not null and exists (
          select 1 from public.meeting m
          where m.id = d.meeting_id
            and (
              m.organizer_id = p_user
              or exists (select 1 from public.meeting_attendee a where a.meeting_id = m.id and a.user_id = p_user)
              or (m.project_id is not null and app.actor_has_project_capability(p_user, m.project_id, 'read'))
              or (m.project_id is null and m.program_id is not null
                  and app.actor_has_program_capability(p_user, m.program_id, 'read'))
            )
        ))
      )
  );
$$;
revoke all on function app.decision_readable_by(uuid, uuid) from public, anon, authenticated;
grant execute on function app.decision_readable_by(uuid, uuid) to service_role;

create or replace function public.decision_readable_by(p_decision uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select app.decision_readable_by(p_decision, p_user);
$$;
revoke all on function public.decision_readable_by(uuid, uuid) from public, anon, authenticated;
grant execute on function public.decision_readable_by(uuid, uuid) to service_role;

-- Participants ---------------------------------------------------------------
create table public.decision_participant (
  decision_id uuid not null references public.decision (id) on delete cascade,
  user_id uuid not null references public.user_profile (id) on delete cascade,
  organization_id uuid not null references public.organization (id) on delete cascade,
  added_by uuid references public.user_profile (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (decision_id, user_id)
);
create index idx_decision_participant_user on public.decision_participant (user_id);

comment on table public.decision_participant is
  'People who took part in a decision (Workspace OS V1-10). They are reminded when it is due for a revisit.';

create or replace function app.decision_participant_guard()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select d.organization_id into new.organization_id
  from public.decision d where d.id = new.decision_id;
  if new.organization_id is null then
    raise exception 'Decision not found' using errcode = '23503';
  end if;
  new.added_by := coalesce(auth.uid(), new.added_by);
  new.created_at := now();
  if not app.decision_readable_by(new.decision_id, new.user_id) then
    raise exception 'A participant must be an active member who can read the decision' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app.decision_participant_guard() from public, anon, authenticated;

create trigger decision_participant_guard
  before insert on public.decision_participant
  for each row execute function app.decision_participant_guard();

alter table public.decision_participant enable row level security;

create policy decision_participant_read on public.decision_participant
  for select to authenticated
  using (app.can_read_decision(decision_id));
create policy decision_participant_insert on public.decision_participant
  for insert to authenticated
  with check (app.can_manage_decision(decision_id));
create policy decision_participant_delete on public.decision_participant
  for delete to authenticated
  using (app.can_manage_decision(decision_id));

revoke all on public.decision_participant from anon, authenticated;
grant select, insert, delete on public.decision_participant to authenticated;
grant all on public.decision_participant to service_role;

-- The revisit reminder --------------------------------------------------------
insert into public.job_definition (name, description, schedule, queue, enabled, batch_size, max_attempts)
values (
  'decision-revisit-reminders',
  'Reminds the decider and participants when a decision reaches its revisit date (Workspace OS V1-10).',
  '10 11 * * *',
  'notifications',
  true,
  200,
  3
)
on conflict (name) do nothing;
