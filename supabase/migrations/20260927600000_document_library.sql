-- ---------------------------------------------------------------------------
-- Document library for the paperless office (#147, epic #139), first version.
--
-- What this adds to the existing `document` table rather than beside it:
--
--   * Folders. Each organization files documents under a category
--     (Governance, HR, Finance, Programs, Operations, Other) and a folder name
--     ("Bylaws", "Board minutes"). A folder is either open to every active
--     member or restricted to staff.
--   * Tags, and a normalized search text over title, description and tags.
--   * Versions. A new version is a new `document` row that names the row it
--     supersedes. Keeping each version a full document row is what keeps every
--     existing guarantee for free: each version's bytes are scanned by the same
--     ClamAV job, are immutable once registered, are opened through the same
--     short-lived signed link, and are governed by the same read policy. The
--     previous version is kept and stays openable; only the newest row of a
--     series has `superseded_at` null, and that is the current version.
--   * Required reading. A document can be marked as something every member of
--     its audience must confirm they have read. Confirmations are per version:
--     a new version of a policy asks everyone again.
--
-- Access keeps the existing model. `app.can_read_document` is redefined with
-- every branch it already had, and one gate added: a document filed in a staff
-- folder is readable only by staff (plus the owner, the creator and the
-- privileged roles that could already read everything). A folder never widens
-- access; it can only narrow it.
-- ---------------------------------------------------------------------------

-- Folders ------------------------------------------------------------------

create table public.document_folder (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  category text not null
    check (category in ('governance', 'hr', 'finance', 'programs', 'operations', 'other')),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  visibility text not null default 'organization'
    check (visibility in ('organization', 'staff')),
  created_by uuid references public.user_profile (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create unique index document_folder_name_unique
  on public.document_folder (organization_id, category, lower(btrim(name)));

comment on table public.document_folder is
  'Library folders (#147). visibility = organization: every active member; staff: staff and privileged roles only. A folder narrows who can read the documents filed in it, never widens it.';

create trigger trg_document_folder_updated_at before update on public.document_folder
  for each row execute function set_updated_at();

alter table public.document_folder enable row level security;

create policy document_folder_read on public.document_folder for select to authenticated
  using (
    app.is_org_admin(organization_id)
    or (visibility = 'organization' and app.is_org_member(organization_id))
    or (visibility = 'staff' and app.is_org_staff(organization_id))
    or exists (
      select 1 from public.organization_membership m
      where m.organization_id = document_folder.organization_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
        and m.role in ('owner', 'admin', 'leadership_viewer')
    )
  );
create policy document_folder_admin_insert on public.document_folder for insert to authenticated
  with check (app.is_org_admin(organization_id) and created_by = (select auth.uid()));
create policy document_folder_admin_update on public.document_folder for update to authenticated
  using (app.is_org_admin(organization_id))
  with check (app.is_org_admin(organization_id));
-- No delete policy: a folder is archived, not deleted, so nothing filed in it
-- loses its place.

grant select, insert, update on public.document_folder to authenticated;

-- Default folders, so a new library is organized from its first upload.
create or replace function app.seed_document_folders(p_organization uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.document_folder (organization_id, category, name, visibility)
  values
    (p_organization, 'governance', 'Bylaws', 'organization'),
    (p_organization, 'governance', 'Board minutes', 'organization'),
    (p_organization, 'governance', 'Policies', 'organization'),
    (p_organization, 'hr', 'Personnel', 'staff'),
    (p_organization, 'finance', 'Financial records', 'staff'),
    (p_organization, 'programs', 'Program materials', 'organization')
  on conflict do nothing;
$$;
revoke all on function app.seed_document_folders(uuid) from public, anon, authenticated;

create or replace function app.seed_document_folders_for_new_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.seed_document_folders(new.id);
  return new;
end;
$$;
revoke all on function app.seed_document_folders_for_new_organization() from public, anon, authenticated;

create trigger organization_seed_document_folders
  after insert on public.organization
  for each row execute function app.seed_document_folders_for_new_organization();

do $$
declare v_org uuid;
begin
  for v_org in select id from public.organization loop
    perform app.seed_document_folders(v_org);
  end loop;
end;
$$;

-- Document columns ---------------------------------------------------------

alter table public.document
  add column folder_id uuid references public.document_folder (id) on delete set null,
  add column tags text[] not null default '{}',
  add column search_text text not null default '',
  add column series_id uuid,
  add column version_number integer not null default 1 check (version_number >= 1),
  add column supersedes_id uuid references public.document (id) on delete set null,
  add column superseded_at timestamptz,
  add column requires_acknowledgement boolean not null default false;

update public.document
   set series_id = id,
       search_text = lower(title || ' ' || coalesce(description, ''));

alter table public.document alter column series_id set not null;

comment on column public.document.series_id is
  'The first version''s id; every version of one document shares it (#147).';
comment on column public.document.superseded_at is
  'Set when a newer version is added. Null on exactly one row per series: the current version.';
comment on column public.document.requires_acknowledgement is
  'Required reading (#147): members of the audience confirm they have read this version.';

-- One successor per version, so a series is a line and never a fork.
create unique index document_supersedes_unique on public.document (supersedes_id)
  where supersedes_id is not null;
create unique index document_series_version_unique on public.document (series_id, version_number);
create index idx_document_folder on public.document (folder_id) where folder_id is not null;
create index idx_document_current on public.document (organization_id, created_at desc)
  where superseded_at is null;
create index idx_document_tags on public.document using gin (tags);

-- Read access: every existing branch, plus the folder gate -----------------

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
              d.visibility = 'organization'
              and d.program_id is null
              and d.project_id is null
              and d.meeting_id is null
              and d.event_id is null
              and d.crm_organization_id is null
              and app.is_org_member(d.organization_id)
            )
          )
        )
      )
  );
$$;

-- The row-level creator policy reads the candidate row directly (it has to,
-- for INSERT ... RETURNING). It needs no folder gate: a creator can always
-- read what they created, exactly as `app.can_read_document` already says.

-- Server-managed library columns -------------------------------------------

create or replace function app.prepare_document_library_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client boolean := (current_setting('role', true) in ('authenticated', 'anon')
    or coalesce(auth.jwt()->>'role', '') in ('authenticated', 'anon'))
    -- Updates issued by this file's own triggers (superseding, folder moves)
    -- run nested; a client's statement never does.
    and pg_trigger_depth() = 1;
  v_prior public.document;
  v_folder public.document_folder;
  v_tag text;
  v_tags text[] := '{}';
begin
  if tg_op = 'INSERT' then
    new.superseded_at := null;
    if new.supersedes_id is null then
      new.series_id := new.id;
      new.version_number := 1;
    else
      select * into v_prior from public.document where id = new.supersedes_id for update;
      if not found or v_prior.organization_id <> new.organization_id then
        raise exception 'The document being replaced was not found' using errcode = '42501';
      end if;
      if v_prior.superseded_at is not null or v_prior.archived_at is not null then
        raise exception 'Only the current version of an active document can be replaced'
          using errcode = '23514';
      end if;
      if v_client and not app.can_manage_document(v_prior.id) then
        raise exception 'Not allowed to add a version to this document' using errcode = '42501';
      end if;
      -- A version belongs where its predecessor does, with the same audience.
      new.series_id := v_prior.series_id;
      new.version_number := v_prior.version_number + 1;
      new.folder_id := v_prior.folder_id;
      new.visibility := v_prior.visibility;
      new.program_id := v_prior.program_id;
      new.project_id := v_prior.project_id;
      new.channel_id := v_prior.channel_id;
      new.meeting_id := v_prior.meeting_id;
      new.event_id := v_prior.event_id;
      new.crm_organization_id := v_prior.crm_organization_id;
      new.requires_acknowledgement := v_prior.requires_acknowledgement;
      if cardinality(coalesce(new.tags, '{}')) = 0 then
        new.tags := v_prior.tags;
      end if;
    end if;
  elsif v_client then
    if (new.series_id, new.version_number, new.supersedes_id, new.superseded_at)
       is distinct from
       (old.series_id, old.version_number, old.supersedes_id, old.superseded_at) then
      raise exception 'Version history is server managed' using errcode = '42501';
    end if;
    if old.superseded_at is not null
       and (new.folder_id, new.visibility, new.requires_acknowledgement)
           is distinct from (old.folder_id, old.visibility, old.requires_acknowledgement) then
      raise exception 'Change the current version; earlier versions follow it'
        using errcode = '42501';
    end if;
  end if;

  -- Tags: trimmed, lower-case, unique, at most 12 of at most 40 characters.
  foreach v_tag in array coalesce(new.tags, '{}') loop
    v_tag := lower(btrim(v_tag));
    continue when v_tag = '';
    if char_length(v_tag) > 40 then
      raise exception 'A tag can be at most 40 characters' using errcode = '23514';
    end if;
    if not v_tag = any (v_tags) then
      v_tags := v_tags || v_tag;
    end if;
  end loop;
  if cardinality(v_tags) > 12 then
    raise exception 'A document can have at most 12 tags' using errcode = '23514';
  end if;
  new.tags := v_tags;
  new.search_text := lower(new.title || ' ' || coalesce(new.description, '') || ' '
    || array_to_string(v_tags, ' '));

  if v_client and new.folder_id is not null
     and (tg_op = 'INSERT' or new.folder_id is distinct from old.folder_id) then
    select * into v_folder from public.document_folder where id = new.folder_id;
    if not found or v_folder.organization_id <> new.organization_id
       or v_folder.archived_at is not null then
      raise exception 'That folder is not available' using errcode = '23514';
    end if;
    if v_folder.visibility = 'staff' and not app.is_org_staff(new.organization_id)
       and not app.is_org_admin(new.organization_id) then
      raise exception 'Only staff can file into a staff folder' using errcode = '42501';
    end if;
  end if;

  if new.requires_acknowledgement then
    if v_client
       and (tg_op = 'INSERT' and new.supersedes_id is null
            or tg_op = 'UPDATE' and not old.requires_acknowledgement)
       and not app.is_org_staff(new.organization_id)
       and not app.is_org_admin(new.organization_id) then
      raise exception 'Only staff can mark required reading' using errcode = '42501';
    end if;
    -- Required reading is for the library-wide audience the acknowledgement
    -- report can name. A document linked to a project, meeting or similar has
    -- an audience defined elsewhere.
    if new.visibility <> 'organization'
       or new.program_id is not null or new.project_id is not null
       or new.meeting_id is not null or new.event_id is not null
       or new.crm_organization_id is not null then
      raise exception 'Only library documents open to their folder''s audience can be required reading'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;
revoke all on function app.prepare_document_library_row() from public, anon, authenticated;

create trigger document_prepare_library_row
  before insert or update on public.document
  for each row execute function app.prepare_document_library_row();

-- After-effects: supersede the previous version, keep a series together, and
-- record what happened.
create or replace function app.after_document_library_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Removing the current version makes the one before it current again.
    if old.superseded_at is null and old.supersedes_id is not null then
      update public.document set superseded_at = null
       where id = old.supersedes_id and series_id = old.series_id;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.supersedes_id is not null then
      update public.document set superseded_at = now() where id = new.supersedes_id;
      perform app.record_material_audit(
        new.organization_id, 'documents', 'document_version_added', 'document', new.id,
        jsonb_build_object('series_id', new.series_id, 'version', new.version_number,
          'supersedes', new.supersedes_id));
    elsif new.folder_id is not null then
      perform app.record_material_audit(
        new.organization_id, 'documents', 'document_filed', 'document', new.id,
        jsonb_build_object('folder_id', new.folder_id));
    end if;
    if new.requires_acknowledgement and new.supersedes_id is null then
      perform app.record_material_audit(
        new.organization_id, 'documents', 'document_required_reading_set', 'document', new.id,
        jsonb_build_object('required', true));
    end if;
    return new;
  end if;

  -- Earlier versions follow the current one, so moving a document into a
  -- staff folder cannot leave an older version readable where it was.
  if new.superseded_at is null
     and (new.folder_id, new.visibility) is distinct from (old.folder_id, old.visibility) then
    update public.document
       set folder_id = new.folder_id, visibility = new.visibility
     where series_id = new.series_id and id <> new.id;
  end if;

  if pg_trigger_depth() = 1 then
    if new.folder_id is distinct from old.folder_id then
      perform app.record_material_audit(
        new.organization_id, 'documents', 'document_filed', 'document', new.id,
        jsonb_build_object('from_folder_id', old.folder_id, 'folder_id', new.folder_id));
    end if;
    if new.requires_acknowledgement is distinct from old.requires_acknowledgement then
      perform app.record_material_audit(
        new.organization_id, 'documents', 'document_required_reading_set', 'document', new.id,
        jsonb_build_object('required', new.requires_acknowledgement));
    end if;
    if new.tags is distinct from old.tags then
      perform app.record_material_audit(
        new.organization_id, 'documents', 'document_tagged', 'document', new.id,
        jsonb_build_object('tags', to_jsonb(new.tags)));
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app.after_document_library_change() from public, anon, authenticated;

create trigger document_after_library_change
  after insert or update or delete on public.document
  for each row execute function app.after_document_library_change();

-- A folder turning staff-only must narrow what is filed in it at once; the
-- read gate does that by itself, since it reads the folder live. Record the
-- change.
create or replace function app.audit_document_folder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.record_material_audit(
    new.organization_id, 'documents',
    case when tg_op = 'INSERT' then 'document_folder_created' else 'document_folder_updated' end,
    'document_folder', new.id,
    jsonb_build_object('category', new.category, 'name', new.name,
      'visibility', new.visibility, 'archived', new.archived_at is not null));
  return new;
end;
$$;
revoke all on function app.audit_document_folder() from public, anon, authenticated;

create trigger document_folder_audited
  after insert or update on public.document_folder
  for each row execute function app.audit_document_folder();

-- Required reading ---------------------------------------------------------

create table public.document_acknowledgement (
  document_id uuid not null references public.document (id) on delete cascade,
  user_id uuid not null references public.user_profile (id) on delete cascade,
  organization_id uuid not null references public.organization (id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  primary key (document_id, user_id)
);
create index idx_document_acknowledgement_user on public.document_acknowledgement (user_id);

alter table public.document_acknowledgement enable row level security;

create policy document_acknowledgement_read on public.document_acknowledgement
  for select to authenticated
  using (
    (user_id = (select auth.uid()) and app.is_org_member(organization_id))
    or app.is_org_admin(organization_id)
  );
-- A person confirms for themselves only, only a current, active,
-- required-reading version they can actually open. No update or delete
-- policy: a confirmation is a record, not a setting.
create policy document_acknowledgement_self_insert on public.document_acknowledgement
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and app.is_org_member(organization_id)
    and exists (
      select 1 from public.document d
      where d.id = document_id
        and d.organization_id = document_acknowledgement.organization_id
        and d.requires_acknowledgement
        and d.superseded_at is null
        and d.archived_at is null
        and app.can_read_document(d.id)
    )
  );

grant select, insert on public.document_acknowledgement to authenticated;

create or replace function app.protect_document_acknowledgement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.acknowledged_at := now();
  return new;
end;
$$;
revoke all on function app.protect_document_acknowledgement() from public, anon, authenticated;
create trigger document_acknowledgement_stamped
  before insert on public.document_acknowledgement
  for each row execute function app.protect_document_acknowledgement();

create or replace function app.audit_document_acknowledgement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.record_material_audit(
    new.organization_id, 'documents', 'document_acknowledged', 'document', new.document_id,
    '{}'::jsonb);
  return new;
end;
$$;
revoke all on function app.audit_document_acknowledgement() from public, anon, authenticated;
create trigger document_acknowledgement_audited
  after insert on public.document_acknowledgement
  for each row execute function app.audit_document_acknowledgement();

-- Who has and has not read a required document. Administrators only. The
-- audience is every active member for a document in an open folder (or no
-- folder), and staff plus privileged roles for one in a staff folder: exactly
-- the people `app.can_read_document` lets open it, given that required
-- reading is limited to unattached, organization-visible documents.
create or replace function public.document_acknowledgement_status(p_document uuid)
returns table (
  user_id uuid,
  full_name text,
  role text,
  acknowledged_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_doc public.document;
  v_staff_only boolean;
begin
  select * into v_doc from public.document where id = p_document;
  if not found or not app.is_org_admin(v_doc.organization_id) then
    raise exception 'Only administrators can see who has read a document'
      using errcode = '42501';
  end if;

  select coalesce(f.visibility = 'staff', false) into v_staff_only
    from public.document_folder f where f.id = v_doc.folder_id;

  return query
    select m.user_id, p.full_name::text, m.role::text, a.acknowledged_at
      from public.organization_membership m
      join public.user_profile p on p.id = m.user_id
      left join public.document_acknowledgement a
        on a.document_id = v_doc.id and a.user_id = m.user_id
     where m.organization_id = v_doc.organization_id
       and m.status = 'active'
       and (not coalesce(v_staff_only, false)
            or m.role in ('owner', 'admin', 'leadership_viewer', 'staff'))
     order by a.acknowledged_at is not null, p.full_name;
end;
$$;
revoke all on function public.document_acknowledgement_status(uuid) from public, anon;
grant execute on function public.document_acknowledgement_status(uuid) to authenticated;
