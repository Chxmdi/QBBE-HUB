-- QBBE Hub — what a closed project leaves behind (#27, P1-PRJ-08).
--
-- Closing a project already recorded a results narrative and lessons, as the
-- text of one final `project_status_update`. That is a paragraph, not
-- evidence. A funder asking "what did the grant achieve" wants the report, the
-- photographs and the attendance sheet, and those already exist in `document`
-- — nothing pointed at them, so the closure could not be shown, only
-- described.
--
-- Two tables rather than columns on `project`:
--
--   project_closure          — one row per project. The narrative, the lessons,
--                              external links, and who closed it when.
--   project_closure_document — the documents offered as evidence. A join table
--                              rather than an array so a deleted document
--                              cannot leave a dangling id behind.
--
-- The closure row is unique per project. Reopening a project (stage moves off
-- 'completed') leaves it in place deliberately: it is the record of a closure
-- that happened, and closing again replaces it.

create table project_closure (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  project_id uuid not null unique references project (id) on delete cascade,

  -- What it delivered, in the closer's words. Required for the same reason the
  -- command requires it: a closure with no results is an abandonment.
  results text not null,
  lessons text,

  -- External evidence: [{ "label": "...", "url": "https://..." }]. Same shape
  -- as program.important_links, parsed by the same helper.
  evidence_links jsonb not null default '[]'::jsonb,

  closed_by uuid not null references user_profile (id),
  closed_at timestamptz not null default now(),

  constraint closure_links_are_a_list check (jsonb_typeof(evidence_links) = 'array')
);

create index idx_project_closure_org on project_closure (organization_id, closed_at desc);

comment on table project_closure is
  'What a closed project delivered, and the evidence for it.';

create table project_closure_document (
  closure_id uuid not null references project_closure (id) on delete cascade,
  document_id uuid not null references document (id) on delete cascade,
  primary key (closure_id, document_id)
);

comment on table project_closure_document is
  'Documents offered as evidence that a project delivered what it says it did.';

alter table project_closure enable row level security;
alter table project_closure_document enable row level security;

-- Anyone who can read the project can read how it ended. Closure evidence that
-- only its author can see defeats the point of recording it.
create policy project_closure_read on project_closure
  for select to authenticated
  using (public.has_project_capability(project_id, 'read'));

create policy project_closure_manage on project_closure
  for all to authenticated
  using (public.has_project_capability(project_id, 'manage'))
  with check (public.has_project_capability(project_id, 'manage'));

create policy project_closure_document_read on project_closure_document
  for select to authenticated
  using (
    exists (
      select 1 from public.project_closure c
      where c.id = closure_id
        and public.has_project_capability(c.project_id, 'read')
    )
  );

create policy project_closure_document_manage on project_closure_document
  for all to authenticated
  using (
    exists (
      select 1 from public.project_closure c
      where c.id = closure_id
        and public.has_project_capability(c.project_id, 'manage')
    )
  )
  with check (
    exists (
      select 1 from public.project_closure c
      where c.id = closure_id
        and public.has_project_capability(c.project_id, 'manage')
    )
  );

-- Evidence has to be evidence *for this project*. Without this an attachment
-- could name any document the closer could read, including one belonging to a
-- project the reader has no access to, and the closure page would then leak
-- its title through a join the reader was never allowed to make.
create or replace function app.validate_closure_document_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid;
  v_document_project uuid;
begin
  select project_id into v_project
  from public.project_closure
  where id = new.closure_id;

  select project_id into v_document_project
  from public.document
  where id = new.document_id;

  if v_document_project is null or v_document_project <> v_project then
    raise exception
      'Closure evidence must be a document filed against the same project'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function app.validate_closure_document_scope() from public, anon, authenticated;

create trigger trg_closure_document_scope
  before insert or update on project_closure_document
  for each row execute function app.validate_closure_document_scope();
