-- "Staff and admins only" documents.
--
-- app.can_read_document only looked at a document's own visibility on the
-- unscoped route. A staff-only document attached to a project, program,
-- meeting, event, CRM record or page was readable by everyone who could read
-- that project (volunteers and guests included), while an unscoped staff-only
-- document was readable by no staff member but its creator. The owner and
-- administrator shortcut also skipped the MFA requirement every other admin
-- check applies, and a creator kept staff-only access after losing the staff
-- role. Downloads (the storage policy) and search (search_library) use this
-- function, so they followed the same rules.
--
-- Now a staff-only document, or one in a staff folder, is readable only by
-- staff, by owners and administrators with a completed MFA sign-in, and by
-- leadership viewers (unchanged, pending the owner's decision on board
-- access), on every route. A private document (Drive imports) is readable by
-- its owner and creator, administrators and leadership viewers only.

create or replace function app.can_read_document(p_document uuid)
returns boolean
language sql
stable
security definer
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
        mem.role = 'leadership_viewer'
        or (mem.role in ('owner', 'admin') and app.is_org_admin(d.organization_id))
        or (
          -- Staff-only, by the document's own setting or by its folder,
          -- narrows every route below to staff, the creator included.
          (d.visibility <> 'staff' or app.is_org_staff(d.organization_id))
          and (f.id is null or f.visibility = 'organization'
            or app.is_org_staff(d.organization_id))
          and (
            d.owner_id = (select auth.uid())
            or d.created_by = (select auth.uid())
            or (
              d.visibility in ('organization', 'staff')
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
                  d.program_id is null
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
        )
      )
  );
$$;

revoke all on function app.can_read_document(uuid) from public, anon;
grant execute on function app.can_read_document(uuid) to authenticated, service_role;

-- Form answer files used 'staff' to mean "only the uploader and the
-- response's readers", which was true only while staff-only library
-- documents were unreadable by staff. They are 'private' from now on, and
-- existing ones are converted: files given as an answer, and unscoped
-- staff-only files uploaded by someone who is not an owner or admin (under
-- the old insert rules nobody else could file one, so those are narrowed
-- form uploads).
create or replace function public.form_v2_keep_file_private(p_document_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.document d
  set visibility = 'private'
  where d.id = p_document_id
    and d.created_by = (select auth.uid())
    and d.kind = 'file'
    and d.project_id is null and d.program_id is null and d.meeting_id is null
    and d.event_id is null and d.crm_organization_id is null;
  if not found then
    raise exception 'Only the uploader can keep a form file private' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.form_v2_keep_file_private(uuid) from public, anon;
grant execute on function public.form_v2_keep_file_private(uuid) to authenticated, service_role;

update public.document d
set visibility = 'private'
where d.visibility = 'staff'
  and d.kind = 'file'
  and d.project_id is null and d.program_id is null and d.meeting_id is null
  and d.event_id is null and d.crm_organization_id is null and d.editor_object_id is null
  and (
    exists (
      select 1
      from public.form_v2_response r
      join public.form_v2 f on f.id = r.form_id
      cross join lateral jsonb_array_elements(f.properties) prop
      where r.organization_id = d.organization_id
        and prop->>'kind' = 'file'
        and r.answers->>(prop->>'key') = d.id::text
    )
    or (
      d.folder_id is null
      and d.template_id is null
      and not exists (
        select 1 from public.organization_membership m
        where m.organization_id = d.organization_id
          and m.user_id = d.created_by
          and m.role in ('owner', 'admin')
      )
    )
  );

-- Only the three values the rules above understand. Any other stored value
-- (none is written by the app) becomes the narrow shared setting, 'staff',
-- before the constraint is validated.
alter table public.document
  add constraint document_visibility_check
  check (visibility in ('organization', 'staff', 'private')) not valid;

update public.document
set visibility = 'staff'
where visibility not in ('organization', 'staff', 'private');

alter table public.document validate constraint document_visibility_check;

-- Is this folder staff-only? Definer so the answer does not depend on which
-- folders the caller may list.
create or replace function app.is_staff_folder(p_folder uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.document_folder f
    where f.id = p_folder and f.visibility = 'staff'
  );
$$;

revoke all on function app.is_staff_folder(uuid) from public, anon;
grant execute on function app.is_staff_folder(uuid) to authenticated, service_role;

-- The creator's own read rule (it lets an insert read back its new row) keeps
-- the staff-only narrowing too, so a creator who stops being staff loses
-- staff-only documents like everyone else.
drop policy if exists document_creator_read on public.document;
create policy document_creator_read on public.document
  for select to authenticated
  using (
    app.is_org_member(organization_id)
    and (owner_id = (select auth.uid()) or created_by = (select auth.uid()))
    and (
      (visibility <> 'staff' and (folder_id is null or not app.is_staff_folder(folder_id)))
      or app.is_org_staff(organization_id)
      or app.is_org_admin(organization_id)
    )
  );

-- Staff may file a staff-only document in the library (generated letters do);
-- only staff and MFA-verified administrators may file one anywhere.
drop policy if exists document_member_insert on public.document;
create policy document_member_insert on public.document
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and app.is_org_member(organization_id)
    and (visibility <> 'staff' or app.is_org_staff(organization_id) or app.is_org_admin(organization_id))
    and (
      app.is_org_admin(organization_id)
      or (project_id is not null and app.has_project_capability(project_id, 'collaborate'))
      or (program_id is not null and app.has_program_capability(program_id, 'collaborate'))
      or (meeting_id is not null and app.can_manage_meeting(meeting_id))
      or (crm_organization_id is not null and app.can_access_crm(organization_id))
      or (
        program_id is null and project_id is null and meeting_id is null
        and crm_organization_id is null and editor_object_id is null
        and (visibility = 'organization'
             or (visibility = 'staff' and app.is_org_staff(organization_id)))
      )
      or (
        program_id is null and project_id is null and meeting_id is null
        and crm_organization_id is null and editor_object_id is not null
        and app.can_editor_object(editor_object_type, editor_object_id, 'edit_content')
      )
    )
  );

-- Widening a staff-only document (changing its visibility, or moving it out
-- of a staff folder) is for staff and MFA-verified administrators only, so a
-- creator who has lost the staff role cannot reopen it through their own
-- edit rights. Applies to requests made with a member's session.
create or replace function app.guard_document_staff_widening()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt()->>'role', '') = 'authenticated'
     and (
       (old.visibility = 'staff' and new.visibility is distinct from old.visibility)
       or (old.folder_id is not null and new.folder_id is distinct from old.folder_id
           and app.is_staff_folder(old.folder_id))
     )
     and not app.is_org_staff(old.organization_id)
     and not app.is_org_admin(old.organization_id) then
    raise exception 'Only staff can change who may open a staff-only document'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app.guard_document_staff_widening() from public, anon, authenticated;

drop trigger if exists document_guard_staff_widening on public.document;
create trigger document_guard_staff_widening
  before update of visibility, folder_id on public.document
  for each row execute function app.guard_document_staff_widening();
