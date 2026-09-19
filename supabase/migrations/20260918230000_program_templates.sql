-- Program templates, and the work items a project template can carry (P1-PROG-03,
-- and the structure P1-PRJ-09 duplicates from).
--
-- The shape is deliberately normalized rather than a second copy of the project
-- template columns: a program template names project templates, and a project
-- template carries its own milestones and standard tasks. Project duplication
-- and program instantiation then expand the same rows, so the two cannot drift.
--
-- "QBBE-approved" is approved_at. A template that has not been approved can be
-- drafted and edited but cannot be instantiated, which is the requirement's
-- point: the structure is the organization's, not whichever staff member
-- happened to create it.

create table if not exists public.program_template (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  name text not null,
  description text,
  color text not null default 'neutral',
  approved_at timestamptz,
  approved_by uuid references public.user_profile (id),
  created_by uuid references public.user_profile (id),
  created_at timestamptz not null default now(),
  constraint program_template_color_check
    check (color in ('neutral', 'blue', 'green', 'amber', 'rose')),
  -- An approval is an act by somebody; recording one without the other loses
  -- exactly the accountability the approval exists to carry.
  constraint program_template_approval_complete
    check ((approved_at is null) = (approved_by is null))
);
create index if not exists idx_program_template_org
  on public.program_template (organization_id, name);

create table if not exists public.program_template_project (
  id uuid primary key default gen_random_uuid(),
  program_template_id uuid not null
    references public.program_template (id) on delete cascade,
  project_template_id uuid not null
    references public.project_template (id) on delete restrict,
  sort_key double precision not null default 0,
  created_at timestamptz not null default now(),
  unique (program_template_id, project_template_id)
);
create index if not exists idx_program_template_project_parent
  on public.program_template_project (program_template_id, sort_key);

create table if not exists public.project_template_item (
  id uuid primary key default gen_random_uuid(),
  project_template_id uuid not null
    references public.project_template (id) on delete cascade,
  kind text not null,
  name text not null,
  description text,
  -- Days from the moment the template is expanded. A template cannot carry a
  -- real date: it is reused, and a date would be the date of the first use.
  day_offset integer,
  sort_key double precision not null default 0,
  created_at timestamptz not null default now(),
  constraint project_template_item_kind_check check (kind in ('milestone', 'task')),
  constraint project_template_item_offset_sane
    check (day_offset is null or (day_offset >= 0 and day_offset <= 3650))
);
create index if not exists idx_project_template_item_parent
  on public.project_template_item (project_template_id, sort_key);

alter table public.program_template enable row level security;
alter table public.program_template_project enable row level security;
alter table public.project_template_item enable row level security;

-- Reading a template is how somebody decides to use one, so it follows
-- organization membership. Writing one defines structure for everybody, so it
-- is an administrator action, matching how programs themselves are created.
drop policy if exists program_template_read on public.program_template;
create policy program_template_read on public.program_template
  for select to authenticated
  using (app.is_org_member(organization_id));

drop policy if exists program_template_admin_write on public.program_template;
create policy program_template_admin_write on public.program_template
  for all to authenticated
  using (app.is_org_admin(organization_id))
  with check (app.is_org_admin(organization_id));

-- The children inherit their parent's organization rather than carrying a copy
-- of it, so there is no second column to keep in step.
drop policy if exists program_template_project_read on public.program_template_project;
create policy program_template_project_read on public.program_template_project
  for select to authenticated
  using (exists (
    select 1 from public.program_template t
    where t.id = program_template_id and app.is_org_member(t.organization_id)
  ));

drop policy if exists program_template_project_admin_write on public.program_template_project;
create policy program_template_project_admin_write on public.program_template_project
  for all to authenticated
  using (exists (
    select 1 from public.program_template t
    where t.id = program_template_id and app.is_org_admin(t.organization_id)
  ))
  with check (exists (
    select 1 from public.program_template t
    where t.id = program_template_id and app.is_org_admin(t.organization_id)
  ));

drop policy if exists project_template_item_read on public.project_template_item;
create policy project_template_item_read on public.project_template_item
  for select to authenticated
  using (exists (
    select 1 from public.project_template t
    where t.id = project_template_id and app.is_org_member(t.organization_id)
  ));

drop policy if exists project_template_item_staff_write on public.project_template_item;
create policy project_template_item_staff_write on public.project_template_item
  for all to authenticated
  using (exists (
    select 1 from public.project_template t
    where t.id = project_template_id and app.is_org_staff(t.organization_id)
  ))
  with check (exists (
    select 1 from public.project_template t
    where t.id = project_template_id and app.is_org_staff(t.organization_id)
  ));

-- A program template may only name project templates from its own organization.
-- A foreign key cannot express that, because the two tables reach the
-- organization by different routes.
create or replace function app.validate_program_template_project_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_org uuid;
  v_child_org uuid;
begin
  select organization_id into v_parent_org
  from public.program_template where id = new.program_template_id;
  select organization_id into v_child_org
  from public.project_template where id = new.project_template_id;

  if v_parent_org is null or v_child_org is null or v_parent_org <> v_child_org then
    raise exception 'A program template can only contain project templates from its own organization.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_program_template_project_scope on public.program_template_project;
create trigger trg_program_template_project_scope
  before insert or update on public.program_template_project
  for each row execute function app.validate_program_template_project_scope();
