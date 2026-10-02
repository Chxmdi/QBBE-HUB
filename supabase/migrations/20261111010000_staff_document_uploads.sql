-- Files added in the editor follow the page (or task, or meeting notes) they
-- were added to.
--
-- The editor stored pasted and uploaded images and files as unscoped,
-- staff-only library documents. The insert policy allowed an unscoped
-- document only when it was organization-visible, so everyone but
-- administrators had their editor uploads refused; and the read rule let only
-- the uploader and administrators open them, so others reading the page saw
-- the file as unavailable.
--
-- Now an editor file records the object it belongs to. Whoever may edit that
-- object's content may add a file to it, and whoever may view the object may
-- read the file, through the same app.can_editor_object check the editor
-- document itself uses. Private pages stay private: nothing else widens.

alter table public.document
  add column editor_object_type text,
  add column editor_object_id uuid;

alter table public.document
  add constraint document_editor_object_type_check
    check (editor_object_type is null or editor_object_type in ('page', 'task', 'meeting')),
  add constraint document_editor_object_pair_check
    check ((editor_object_type is null) = (editor_object_id is null));

comment on column public.document.editor_object_id is
  'The page, task or meeting whose editor this file was added in. Its readers read the file; its editors may add files to it.';

create index document_editor_object_idx on public.document (editor_object_type, editor_object_id)
  where editor_object_id is not null;

-- A file stays with the object it was added to.
create or replace function app.document_editor_object_fixed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.editor_object_type is distinct from old.editor_object_type
     or new.editor_object_id is distinct from old.editor_object_id then
    raise exception 'A file added in the editor cannot move to another page' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.document_editor_object_fixed() from public, anon, authenticated;

create trigger document_editor_object_fixed
  before update on public.document
  for each row execute function app.document_editor_object_fixed();

drop policy if exists document_member_insert on public.document;
create policy document_member_insert on public.document for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and app.is_org_member(organization_id)
    and (
      app.is_org_admin(organization_id)
      or (
        project_id is not null
        and app.has_project_capability(project_id, 'collaborate')
      )
      or (
        program_id is not null
        and app.has_program_capability(program_id, 'collaborate')
      )
      or (
        meeting_id is not null
        and app.can_manage_meeting(meeting_id)
      )
      or (
        crm_organization_id is not null
        and app.can_access_crm(organization_id)
      )
      or (
        program_id is null and project_id is null
        and meeting_id is null and crm_organization_id is null
        and editor_object_id is null
        and visibility = 'organization'
      )
      or (
        program_id is null and project_id is null
        and meeting_id is null and crm_organization_id is null
        and editor_object_id is not null
        and app.can_editor_object(editor_object_type, editor_object_id, 'edit_content')
      )
    )
  );

create or replace function app.can_read_document(p_document uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.document d
    join public.organization_membership mem
      on mem.organization_id = d.organization_id
     and mem.user_id = (select auth.uid())
     and mem.status = 'active'
    left join public.document_folder f on f.id = d.folder_id
    where d.id = p_document
      and (
        mem.role in ('owner', 'admin', 'leadership_viewer')
        or d.owner_id = (select auth.uid())
        or d.created_by = (select auth.uid())
        or (
          -- A staff folder narrows every other route in to staff only.
          (f.id is null or f.visibility = 'organization'
            or app.is_org_staff(d.organization_id))
          and (
            (
              d.project_id is not null
              and app.has_project_capability(d.project_id, 'read')
            )
            or (
              d.program_id is not null
              and app.has_program_capability(d.program_id, 'read')
            )
            or (
              d.meeting_id is not null
              and app.can_read_meeting(d.meeting_id)
            )
            or (
              d.event_id is not null
              and app.can_read_event(d.event_id)
            )
            or (
              d.crm_organization_id is not null
              and app.can_access_crm(d.organization_id)
            )
            or (
              d.editor_object_id is not null
              and app.can_editor_object(d.editor_object_type, d.editor_object_id, 'view')
            )
            or (
              d.visibility = 'organization'
              and d.program_id is null
              and d.project_id is null
              and d.meeting_id is null
              and d.event_id is null
              and d.crm_organization_id is null
              and d.editor_object_id is null
              and app.is_org_member(d.organization_id)
            )
          )
        )
      )
  );
$$;
