-- Workspace OS V2-7: approvals on any object (stream S5b, epic #199).
--
-- The approval engine (approval_rule / approval_item / approval_step /
-- approval_event, delegation) already routes, notifies, records and lets
-- people decide. What it lacked was a way to ask for approval of a task, a
-- project, a meeting or a decision. This adds that link, nothing more: the
-- item is created by the existing public.submit_approval with subject type
-- 'other' and the object's id, so routing rules, delegation, the approvals
-- inbox, notifications and the audit trail all work unchanged.
--
-- Who may do what:
--   request   someone who can change the object (manage a meeting or a
--             decision, edit a task or a project) and who is staff, as
--             submit_approval already requires
--   see       anyone who can read the object sees that it has an approval
--             and its status; the item itself (notes, steps, trail) stays
--             with the requester, the approvers and administrators, as today
--
-- Object kinds are the native types that exist today. More are added here as
-- the object registry (M1) gives them an access rule; after M10c this can ask
-- app.can for every type.
--
-- Hidden behind `wos_object_approvals` (20261105110000_s5b_feature_switches).

create table public.object_approval (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  object_type text not null check (object_type in ('task', 'project', 'meeting', 'decision')),
  object_id uuid not null,
  approval_item_id uuid not null unique references public.approval_item (id) on delete cascade,
  requested_by uuid not null references public.user_profile (id),
  created_at timestamptz not null default now()
);
create index idx_object_approval_object on public.object_approval (object_type, object_id, created_at desc);

comment on table public.object_approval is
  'Which object an approval item is about (Workspace OS V2-7). Written only by public.request_object_approval.';

-- The object's own access rule, by type ------------------------------------------
create or replace function app.object_approval_access(p_type text, p_object uuid, p_capability text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and case p_type
    when 'task' then app.can(p_object, case when p_capability = 'change' then 'edit_content' else 'view' end)
    when 'project' then app.can(p_object, case when p_capability = 'change' then 'edit_content' else 'view' end)
    when 'meeting' then case when p_capability = 'change'
      then app.can_manage_meeting(p_object) else app.can_read_meeting(p_object) end
    when 'decision' then exists (
      select 1 from public.decision d
      where d.id = p_object
        and case when p_capability = 'change' then (
          (d.meeting_id is not null and app.can_manage_meeting(d.meeting_id))
          or (d.project_id is not null and app.has_project_capability(d.project_id, 'manage'))
          or app.is_org_admin(d.organization_id)
        ) else (
          (d.meeting_id is not null and app.can_read_meeting(d.meeting_id))
          or (d.project_id is not null and app.has_project_capability(d.project_id, 'read'))
          or (d.meeting_id is null and d.project_id is null and app.is_org_admin(d.organization_id))
        ) end
    )
    else false
  end;
$$;
revoke all on function app.object_approval_access(text, uuid, text) from public, anon, authenticated;
-- RLS policies call it as the reader, so signed-in roles need to be able to.
grant execute on function app.object_approval_access(text, uuid, text) to authenticated, service_role;

-- The object's organization, program and title, whoever is asking -----------------
create or replace function app.object_approval_subject(p_type text, p_object uuid)
returns table (organization_id uuid, program_id uuid, title text)
language sql stable security definer set search_path = '' as $$
  select t.organization_id, t.program_id, t.title from public.task t
  where p_type = 'task' and t.id = p_object
  union all
  select p.organization_id, p.program_id, p.name from public.project p
  where p_type = 'project' and p.id = p_object
  union all
  select m.organization_id, m.program_id, m.title from public.meeting m
  where p_type = 'meeting' and m.id = p_object
  union all
  select d.organization_id, pr.program_id, d.title from public.decision d
  left join public.project pr on pr.id = d.project_id
  where p_type = 'decision' and d.id = p_object;
$$;
revoke all on function app.object_approval_subject(text, uuid) from public, anon, authenticated;

-- Request ------------------------------------------------------------------------
create or replace function public.request_object_approval(
  p_object_type text,
  p_object_id uuid,
  p_title text default null,
  p_note text default null
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_subject record;
  v_item uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to request an approval' using errcode = '42501';
  end if;
  if p_object_type not in ('task', 'project', 'meeting', 'decision') then
    raise exception 'Approvals are not available for this kind of record' using errcode = '22023';
  end if;
  if not app.object_approval_access(p_object_type, p_object_id, 'change') then
    raise exception 'You cannot request approval for this record' using errcode = '42501';
  end if;
  select * into v_subject from app.object_approval_subject(p_object_type, p_object_id);
  if not found then
    raise exception 'Record not found' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.object_approval oa
    join public.approval_item i on i.id = oa.approval_item_id
    where oa.object_type = p_object_type and oa.object_id = p_object_id and i.status = 'pending'
  ) then
    raise exception 'This record already has an approval waiting' using errcode = '23505';
  end if;

  -- The engine itself: routing rules, delegation, notifications and audit.
  v_item := public.submit_approval(
    v_subject.organization_id,
    'other',
    left(coalesce(nullif(btrim(p_title), ''), v_subject.title), 200),
    null,
    v_subject.program_id,
    p_note,
    p_object_id
  );

  insert into public.object_approval (organization_id, object_type, object_id, approval_item_id, requested_by)
  values (v_subject.organization_id, p_object_type, p_object_id, v_item, auth.uid());
  return v_item;
end;
$$;
revoke all on function public.request_object_approval(text, uuid, text, text) from public, anon;
grant execute on function public.request_object_approval(text, uuid, text, text) to authenticated;

-- Status for readers of the object ------------------------------------------------
create or replace function public.object_approvals(p_object_type text, p_object_id uuid)
returns table (
  approval_item_id uuid,
  title text,
  status text,
  current_step smallint,
  step_label text,
  requested_by_name text,
  requested_at timestamptz,
  decided_at timestamptz,
  can_open boolean
)
language sql stable security definer set search_path = '' as $$
  select i.id, i.title, i.status, i.current_step,
    (select s.label from public.approval_step s
     where s.item_id = i.id and s.step = i.current_step order by s.created_at limit 1),
    rp.full_name, i.created_at, i.decided_at,
    app.can_read_approval_item(i.id)
  from public.object_approval oa
  join public.approval_item i on i.id = oa.approval_item_id
  left join public.user_profile rp on rp.id = i.requested_by
  where oa.object_type = p_object_type
    and oa.object_id = p_object_id
    and app.object_approval_access(p_object_type, p_object_id, 'view')
  order by i.created_at desc;
$$;
revoke all on function public.object_approvals(text, uuid) from public, anon;
grant execute on function public.object_approvals(text, uuid) to authenticated;

-- RLS: readable by readers of the object; written only through the function ------
alter table public.object_approval enable row level security;
create policy object_approval_read on public.object_approval
  for select to authenticated
  using (app.object_approval_access(object_type, object_id, 'view'));

revoke all on public.object_approval from anon, authenticated;
grant select on public.object_approval to authenticated;
grant all on public.object_approval to service_role;
