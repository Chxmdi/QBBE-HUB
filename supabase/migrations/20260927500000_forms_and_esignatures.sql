-- Internal digital forms (#145 v1) and in-app e-signatures (#144 v1), epic #139.
--
-- Forms
--   * Owners and admins with MFA (app.is_org_admin) define a form: a title,
--     who it is for (staff, or every member), and a list of fields. Field
--     types: text, number, money (integer cents), date, choice, checkbox and
--     file. Once a form is published its fields are frozen, so every
--     submission is read against exactly the questions that were asked.
--   * People in the audience submit. The database checks every answer against
--     the field list, stamps who and when, and stores a SHA-256 of the exact
--     content. Submissions are never updated; nobody deletes them from the app.
--   * The submitter reads their own submissions; admins read all of them.
--   * Approvals (#143) attach later by referencing form_submission.id from
--     their own table. Nothing here depends on them, and the submission row
--     never needs to change for them.
--
-- E-signatures
--   * A signature is a typed name plus an explicit consent, recorded against
--     either a form submission (signed by its submitter) or an uploaded PDF
--     (signed by the people an admin named). The signer, time, consent wording
--     and SHA-256 of the signed content are all set here, never taken from the
--     request. Signatures are immutable.
--   * A PDF's SHA-256 is computed from its bytes by the scanning job (the only
--     trusted reader of a private file) and cannot change afterwards; the
--     registered bytes themselves are immutable too.
--   * Every submission and signature writes its own audit_event here, so no
--     code path can skip it.
--
-- Files follow the receipts and documents pattern: private buckets, uploads
-- into the caller's own folder, quarantined until the ClamAV job calls them
-- clean, and immutable once registered.

-- ---------------------------------------------------------------------------
-- Form definitions
-- ---------------------------------------------------------------------------

create table public.form_definition (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  audience text not null default 'members' check (audience in ('staff', 'members')),
  requires_signature boolean not null default false,
  fields jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  created_by uuid not null default auth.uid() references public.user_profile (id),
  published_by uuid references public.user_profile (id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint form_definition_publication_recorded
    check ((status = 'draft') = (published_at is null and published_by is null))
);

create index idx_form_definition_org_status
  on public.form_definition (organization_id, status, updated_at desc);

comment on table public.form_definition is
  'Internal digital forms (#145). Fields are frozen once published.';

-- The field list is checked here, not only in the app: every submission is
-- validated against it, so a malformed definition must never be stored.
create or replace function app.form_fields_problem(p_fields jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare
  f jsonb;
  v_keys text[] := '{}';
  v_key text;
  v_type text;
  v_opts jsonb;
begin
  if jsonb_typeof(p_fields) <> 'array' then return 'Fields must be a list'; end if;
  if jsonb_array_length(p_fields) > 50 then return 'A form has at most 50 fields'; end if;
  for f in select value from jsonb_array_elements(p_fields) loop
    if jsonb_typeof(f) <> 'object' then return 'Each field must be an object'; end if;
    if exists (select 1 from jsonb_object_keys(f) k
               where k not in ('key', 'label', 'type', 'required', 'options', 'help')) then
      return 'Unknown field property';
    end if;
    v_key := f->>'key';
    if jsonb_typeof(f->'key') is distinct from 'string' or v_key !~ '^[a-z][a-z0-9_]{0,39}$' then
      return 'Field keys are lower-case letters, digits and underscores';
    end if;
    if v_key = any(v_keys) then return format('Field key %s is used twice', v_key); end if;
    v_keys := v_keys || v_key;
    if jsonb_typeof(f->'label') is distinct from 'string'
       or char_length(btrim(f->>'label')) not between 1 and 200 then
      return 'Every field needs a label of up to 200 characters';
    end if;
    if f ? 'help' and (jsonb_typeof(f->'help') <> 'string' or char_length(f->>'help') > 500) then
      return 'Field help is text of up to 500 characters';
    end if;
    if jsonb_typeof(f->'required') is distinct from 'boolean' then
      return 'Every field says whether it is required';
    end if;
    v_type := f->>'type';
    if v_type is null or v_type not in ('text', 'number', 'money', 'date', 'choice', 'checkbox', 'file') then
      return 'Unknown field type';
    end if;
    v_opts := f->'options';
    if v_type = 'choice' then
      if jsonb_typeof(v_opts) is distinct from 'array'
         or jsonb_array_length(v_opts) not between 1 and 50
         or exists (select 1 from jsonb_array_elements(v_opts) o
                    where jsonb_typeof(o) <> 'string' or char_length(btrim(o #>> '{}')) not between 1 and 200)
         or (select count(distinct o #>> '{}') from jsonb_array_elements(v_opts) o) <> jsonb_array_length(v_opts) then
        return 'A choice field needs 1 to 50 different options';
      end if;
    elsif v_opts is not null then
      return 'Only choice fields have options';
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function app.form_fields_problem(jsonb) from public, anon;
grant execute on function app.form_fields_problem(jsonb) to authenticated, service_role;

create or replace function app.protect_form_definition() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_problem text;
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
    if current_setting('role', true) in ('authenticated', 'anon')
       or coalesce(auth.jwt()->>'role', '') in ('authenticated', 'anon') then
      new.created_by := auth.uid();
    end if;
    if new.status <> 'draft' then
      raise exception 'A new form starts as a draft' using errcode = '42501';
    end if;
  else
    if (new.organization_id, new.created_by, new.created_at)
       is distinct from (old.organization_id, old.created_by, old.created_at) then
      raise exception 'Form ownership is server managed' using errcode = '42501';
    end if;
    -- What was asked is fixed once anyone could have answered it.
    if old.status <> 'draft' then
      if (new.fields, new.requires_signature, new.audience, new.title)
         is distinct from (old.fields, old.requires_signature, old.audience, old.title) then
        raise exception 'A published form cannot be changed; make a new one' using errcode = '42501';
      end if;
      if new.status = 'draft' then
        raise exception 'A published form cannot go back to draft' using errcode = '42501';
      end if;
    end if;
    if new.status is distinct from old.status then
      if old.status = 'draft' and new.status = 'published' then
        if jsonb_array_length(new.fields) = 0 then
          raise exception 'Add at least one field before publishing' using errcode = '23514';
        end if;
        new.published_at := now();
        new.published_by := auth.uid();
      elsif old.status = 'draft' then
        raise exception 'Publish a draft before closing it' using errcode = '23514';
      end if;
    end if;
    if (new.published_at, new.published_by) is distinct from (old.published_at, old.published_by)
       and not (old.status = 'draft' and new.status = 'published') then
      raise exception 'Publication is recorded by the database' using errcode = '42501';
    end if;
  end if;
  if new.status = 'draft' and (new.published_at is not null or new.published_by is not null) then
    raise exception 'Publication is recorded by the database' using errcode = '42501';
  end if;
  v_problem := app.form_fields_problem(new.fields);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app.protect_form_definition() from public, anon, authenticated;
create trigger form_definition_protect before insert or update on public.form_definition
for each row execute function app.protect_form_definition();

alter table public.form_definition enable row level security;

-- ---------------------------------------------------------------------------
-- Submissions
-- ---------------------------------------------------------------------------

create table public.form_submission (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  form_id uuid not null references public.form_definition (id),
  submitted_by uuid not null default auth.uid() references public.user_profile (id),
  submitted_at timestamptz not null default now(),
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$')
);

create index idx_form_submission_form on public.form_submission (form_id, submitted_at desc);
create index idx_form_submission_submitter on public.form_submission (submitted_by, submitted_at desc);

comment on table public.form_submission is
  'Form submissions (#145). Immutable; content_sha256 covers the form, its fields, the answers, the submitter and the time.';

-- Files attached to a submission, one row per file field answered. Written
-- only by the submission trigger and the scanning job.
create table public.form_file (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  submission_id uuid not null references public.form_submission (id) on delete cascade,
  field_key text not null,
  storage_path text not null unique check (char_length(storage_path) between 1 and 500),
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text,
  size_bytes bigint,
  scan_status text not null default 'pending'
    check (scan_status in ('pending', 'clean', 'quarantined', 'rejected')),
  scan_note text,
  scan_attempted_at timestamptz,
  quarantined_at timestamptz,
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (submission_id, field_key)
);

create index idx_form_file_pending_scan on public.form_file (scan_attempted_at nulls first)
  where scan_status = 'pending';

-- The exact content a submission's hash covers. jsonb renders keys in a fixed
-- order, and the time is written in UTC, so the same row always produces the
-- same text whatever the session's settings.
create or replace function app.form_submission_content(
  p_form_id uuid, p_form_title text, p_fields jsonb, p_answers jsonb,
  p_submitted_by uuid, p_submitted_at timestamptz
) returns text
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'form_id', p_form_id,
    'form_title', p_form_title,
    'fields', p_fields,
    'answers', p_answers,
    'submitted_by', p_submitted_by,
    'submitted_at', to_char(p_submitted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  )::text;
$$;
revoke all on function app.form_submission_content(uuid, text, jsonb, jsonb, uuid, timestamptz) from public, anon;
grant execute on function app.form_submission_content(uuid, text, jsonb, jsonb, uuid, timestamptz) to authenticated, service_role;

create or replace function app.sha256_hex(p_text text) returns text
language sql immutable set search_path = '' as $$
  select encode(pg_catalog.sha256(convert_to(p_text, 'UTF8')), 'hex');
$$;
revoke all on function app.sha256_hex(text) from public, anon;
grant execute on function app.sha256_hex(text) to authenticated, service_role;

-- Checks every answer against the frozen field list and returns the answers
-- as stored: known keys only, checkboxes always true or false.
create or replace function app.form_answers_normalized(p_fields jsonb, p_answers jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  f jsonb;
  v jsonb;
  v_key text;
  v_label text;
  v_type text;
  v_required boolean;
  v_out jsonb := '{}'::jsonb;
  v_date date;
begin
  if jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception 'Answers must be an object' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_answers) k
    where not exists (select 1 from jsonb_array_elements(p_fields) x where x->>'key' = k)
  ) then
    raise exception 'An answer does not match any field on this form' using errcode = '22023';
  end if;
  for f in select value from jsonb_array_elements(p_fields) loop
    v_key := f->>'key';
    v_label := f->>'label';
    v_type := f->>'type';
    v_required := (f->>'required')::boolean;
    v := p_answers->v_key;
    if v is null or jsonb_typeof(v) = 'null'
       or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '') then
      if v_type = 'checkbox' then
        v := 'false'::jsonb;
      elsif v_required then
        raise exception 'Answer required: %', v_label using errcode = '23514';
      else
        continue;
      end if;
    end if;
    case v_type
      when 'text' then
        if jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 5000 then
          raise exception 'Answer for % must be text of up to 5,000 characters', v_label using errcode = '22023';
        end if;
        v := to_jsonb(btrim(v #>> '{}'));
      when 'number' then
        if jsonb_typeof(v) <> 'number' or abs((v #>> '{}')::numeric) > 1e12 then
          raise exception 'Answer for % must be a number', v_label using errcode = '22023';
        end if;
      when 'money' then
        -- Integer cents, never a float.
        if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]+$'
           or (v #>> '{}')::numeric > 100000000000 then
          raise exception 'Answer for % must be an amount in whole cents', v_label using errcode = '22023';
        end if;
      when 'date' then
        if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception 'Answer for % must be a date', v_label using errcode = '22023';
        end if;
        begin
          v_date := (v #>> '{}')::date;
        exception when others then
          raise exception 'Answer for % must be a date', v_label using errcode = '22023';
        end;
      when 'choice' then
        if jsonb_typeof(v) <> 'string' or not (f->'options') @> jsonb_build_array(v) then
          raise exception 'Answer for % must be one of its options', v_label using errcode = '22023';
        end if;
      when 'checkbox' then
        if jsonb_typeof(v) <> 'boolean' then
          raise exception 'Answer for % must be ticked or not', v_label using errcode = '22023';
        end if;
        if v_required and v = 'false'::jsonb then
          raise exception 'Answer required: %', v_label using errcode = '23514';
        end if;
      when 'file' then
        if jsonb_typeof(v) <> 'object'
           or jsonb_typeof(v->'path') is distinct from 'string'
           or jsonb_typeof(v->'name') is distinct from 'string'
           or char_length(v->>'path') not between 1 and 500
           or char_length(v->>'name') not between 1 and 200 then
          raise exception 'Answer for % must be an uploaded file', v_label using errcode = '22023';
        end if;
        v := jsonb_build_object('path', v->>'path', 'name', v->>'name');
      else
        raise exception 'Unknown field type' using errcode = '22023';
    end case;
    v_out := v_out || jsonb_build_object(v_key, v);
  end loop;
  return v_out;
end;
$$;
revoke all on function app.form_answers_normalized(jsonb, jsonb) from public, anon;
grant execute on function app.form_answers_normalized(jsonb, jsonb) to authenticated, service_role;

create or replace function app.protect_form_submission() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_form public.form_definition%rowtype;
  v_untrusted boolean := current_setting('role', true) in ('authenticated', 'anon')
    or coalesce(auth.jwt()->>'role', '') in ('authenticated', 'anon');
  f jsonb;
  v_path text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Form submissions are immutable' using errcode = '42501';
  end if;
  select * into v_form from public.form_definition where id = new.form_id;
  if not found then
    raise exception 'Form not found' using errcode = '23503';
  end if;
  new.organization_id := v_form.organization_id;
  new.submitted_at := now();
  if v_untrusted then
    new.submitted_by := auth.uid();
    if new.submitted_by is null then
      raise exception 'Sign in to submit a form' using errcode = '42501';
    end if;
    if v_form.status <> 'published' then
      raise exception 'This form is not open for submissions' using errcode = '42501';
    end if;
    if not (
      (v_form.audience = 'members' and app.is_org_member(v_form.organization_id))
      or (v_form.audience = 'staff' and app.is_org_staff(v_form.organization_id))
    ) then
      raise exception 'This form is not open to you' using errcode = '42501';
    end if;
  end if;
  new.answers := app.form_answers_normalized(v_form.fields, new.answers);

  -- Each attached file must be the submitter's own, unregistered upload into
  -- this organization's folder of the form-files bucket.
  for f in select value from jsonb_array_elements(v_form.fields) where value->>'type' = 'file' loop
    v_path := new.answers #>> array[f->>'key', 'path'];
    continue when v_path is null;
    if split_part(v_path, '/', 1) <> new.organization_id::text
       or split_part(v_path, '/', 2) <> new.submitted_by::text then
      raise exception 'Upload path does not match the submission' using errcode = '42501';
    end if;
    if not exists (
      select 1 from storage.objects o where o.bucket_id = 'form-files'
        and o.name = v_path and o.owner_id = new.submitted_by::text
    ) then
      raise exception 'Upload ownership required' using errcode = '42501';
    end if;
    if exists (select 1 from public.form_file ff where ff.storage_path = v_path) then
      raise exception 'That file is already attached to a submission' using errcode = '42501';
    end if;
  end loop;

  new.content_sha256 := app.sha256_hex(app.form_submission_content(
    v_form.id, v_form.title, v_form.fields, new.answers, new.submitted_by, new.submitted_at));
  return new;
end;
$$;
revoke all on function app.protect_form_submission() from public, anon, authenticated;
create trigger form_submission_protect before insert or update on public.form_submission
for each row execute function app.protect_form_submission();

-- Register attached files and write the audit trail, after the row exists.
create or replace function app.after_form_submission() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  f jsonb;
  v_path text;
  v_object record;
begin
  for f in
    select value from public.form_definition d, jsonb_array_elements(d.fields)
    where d.id = new.form_id and value->>'type' = 'file'
  loop
    v_path := new.answers #>> array[f->>'key', 'path'];
    continue when v_path is null;
    select o.metadata into v_object from storage.objects o
    where o.bucket_id = 'form-files' and o.name = v_path;
    insert into public.form_file (organization_id, submission_id, field_key, storage_path,
      file_name, mime_type, size_bytes)
    values (new.organization_id, new.id, f->>'key', v_path,
      new.answers #>> array[f->>'key', 'name'],
      v_object.metadata->>'mimetype',
      nullif(v_object.metadata->>'size', '')::bigint);
  end loop;
  insert into public.audit_event (organization_id, actor_id, event_type, action, object_type,
    object_id, metadata)
  values (new.organization_id, new.submitted_by, 'forms', 'form_submitted', 'form_submission',
    new.id, jsonb_build_object('form_id', new.form_id, 'content_sha256', new.content_sha256));
  return null;
end;
$$;
revoke all on function app.after_form_submission() from public, anon, authenticated;
create trigger form_submission_after_insert after insert on public.form_submission
for each row execute function app.after_form_submission();

alter table public.form_submission enable row level security;
alter table public.form_file enable row level security;

create policy form_submission_read on public.form_submission
for select to authenticated using (
  (submitted_by = (select auth.uid()) and app.is_org_member(organization_id))
  or app.is_org_admin(organization_id)
);

create policy form_submission_submit on public.form_submission
for insert to authenticated with check (
  submitted_by = (select auth.uid()) and app.is_org_member(organization_id)
);

create policy form_file_read on public.form_file
for select to authenticated using (
  exists (select 1 from public.form_submission s where s.id = form_file.submission_id)
);

-- Forms: admins manage; the audience reads published ones; a submitter can
-- always read the form they answered, even after it closes.
create policy form_definition_read on public.form_definition
for select to authenticated using (
  app.is_org_admin(organization_id)
  or (status = 'published' and (
        (audience = 'members' and app.is_org_member(organization_id))
        or (audience = 'staff' and app.is_org_staff(organization_id))))
  or exists (
    select 1 from public.form_submission s
    where s.form_id = form_definition.id and s.submitted_by = (select auth.uid())
  )
);

create policy form_definition_insert on public.form_definition
for insert to authenticated with check (app.is_org_admin(organization_id));

create policy form_definition_update on public.form_definition
for update to authenticated
using (app.is_org_admin(organization_id))
with check (app.is_org_admin(organization_id));

create policy form_definition_delete_draft on public.form_definition
for delete to authenticated using (app.is_org_admin(organization_id) and status = 'draft');

grant select, insert, update, delete on public.form_definition to authenticated;
grant select, insert on public.form_submission to authenticated;
grant select on public.form_file to authenticated;
grant all on public.form_definition, public.form_submission, public.form_file to service_role;

-- Recomputes a submission's hash from what is stored now and compares it with
-- the hash recorded when it was submitted. Answers only for submissions the
-- caller may read (the same rule as form_submission_read).
create or replace function public.verify_form_submission(p_submission_id uuid)
returns table (recorded_sha256 text, recomputed_sha256 text, matches boolean)
language sql stable security definer set search_path = '' as $$
  select v.recorded, v.recomputed, v.recorded = v.recomputed
  from public.form_submission s
  join public.form_definition d on d.id = s.form_id,
  lateral (select s.content_sha256 as recorded,
                  app.sha256_hex(app.form_submission_content(d.id, d.title, d.fields, s.answers,
                    s.submitted_by, s.submitted_at)) as recomputed) v
  where s.id = p_submission_id
    and ((s.submitted_by = auth.uid() and app.is_org_member(s.organization_id))
         or app.is_org_admin(s.organization_id));
$$;
revoke all on function public.verify_form_submission(uuid) from public, anon;
grant execute on function public.verify_form_submission(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Documents sent for signature
-- ---------------------------------------------------------------------------

create table public.signing_document (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  message text check (message is null or char_length(message) <= 2000),
  uploaded_by uuid not null default auth.uid() references public.user_profile (id),
  storage_path text not null unique check (char_length(storage_path) between 1 and 500),
  file_name text not null check (char_length(file_name) between 1 and 200),
  size_bytes bigint,
  scan_status text not null default 'pending'
    check (scan_status in ('pending', 'clean', 'quarantined', 'rejected')),
  scan_note text,
  scan_attempted_at timestamptz,
  quarantined_at timestamptz,
  -- SHA-256 of the PDF's bytes, computed by the scanning job.
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create index idx_signing_document_org on public.signing_document (organization_id, created_at desc);
create index idx_signing_document_pending_scan on public.signing_document (scan_attempted_at nulls first)
  where scan_status = 'pending';

create table public.signing_document_signer (
  document_id uuid not null references public.signing_document (id) on delete cascade,
  organization_id uuid not null references public.organization (id) on delete cascade,
  user_id uuid not null references public.user_profile (id),
  added_at timestamptz not null default now(),
  primary key (document_id, user_id)
);

create index idx_signing_document_signer_user on public.signing_document_signer (user_id);

create or replace function app.protect_signing_document() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('role', true) in ('authenticated', 'anon')
     or coalesce(auth.jwt()->>'role', '') in ('authenticated', 'anon') then
    if tg_op <> 'INSERT' then
      raise exception 'Documents sent for signature are server managed' using errcode = '42501';
    end if;
    new.uploaded_by := auth.uid();
    new.created_at := now();
    if new.scan_status <> 'pending' or new.scan_note is not null or new.quarantined_at is not null
       or new.scan_attempted_at is not null or new.content_sha256 is not null then
      raise exception 'Scan results and the file hash are server managed' using errcode = '42501';
    end if;
    if split_part(new.storage_path, '/', 1) <> new.organization_id::text
       or split_part(new.storage_path, '/', 2) <> auth.uid()::text then
      raise exception 'Upload path does not match the document' using errcode = '42501';
    end if;
    if not exists (
      select 1 from storage.objects o where o.bucket_id = 'signing-documents'
        and o.name = new.storage_path and o.owner_id = auth.uid()::text
    ) then
      raise exception 'Upload ownership required' using errcode = '42501';
    end if;
    select (o.metadata->>'size')::bigint into new.size_bytes from storage.objects o
    where o.bucket_id = 'signing-documents' and o.name = new.storage_path;
  elsif tg_op = 'UPDATE' then
    -- Even the scanning job cannot change what was signed.
    if (new.organization_id, new.storage_path, new.uploaded_by, new.created_at)
       is distinct from (old.organization_id, old.storage_path, old.uploaded_by, old.created_at)
       or (old.content_sha256 is not null and new.content_sha256 is distinct from old.content_sha256) then
      raise exception 'A document''s file and hash never change' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app.protect_signing_document() from public, anon, authenticated;
create trigger signing_document_protect before insert or update on public.signing_document
for each row execute function app.protect_signing_document();

create or replace function app.protect_signing_document_signer() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select d.organization_id into new.organization_id
  from public.signing_document d where d.id = new.document_id;
  new.added_at := now();
  if not exists (
    select 1 from public.organization_membership m
    where m.organization_id = new.organization_id and m.user_id = new.user_id and m.status = 'active'
  ) then
    raise exception 'Signers must be active members of the organization' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app.protect_signing_document_signer() from public, anon, authenticated;
create trigger signing_document_signer_protect before insert on public.signing_document_signer
for each row execute function app.protect_signing_document_signer();

alter table public.signing_document enable row level security;
alter table public.signing_document_signer enable row level security;

create policy signing_document_signer_read on public.signing_document_signer
for select to authenticated using (
  (user_id = (select auth.uid()) and app.is_org_member(organization_id))
  or app.is_org_admin(organization_id)
);

create policy signing_document_signer_insert on public.signing_document_signer
for insert to authenticated with check (app.is_org_admin(organization_id));

create policy signing_document_read on public.signing_document
for select to authenticated using (
  app.is_org_admin(organization_id)
  or exists (
    select 1 from public.signing_document_signer s
    where s.document_id = signing_document.id and s.user_id = (select auth.uid())
      and app.is_org_member(s.organization_id)
  )
);

create policy signing_document_insert on public.signing_document
for insert to authenticated with check (
  uploaded_by = (select auth.uid()) and app.is_org_admin(organization_id)
);

grant select, insert on public.signing_document, public.signing_document_signer to authenticated;
grant all on public.signing_document, public.signing_document_signer to service_role;

-- ---------------------------------------------------------------------------
-- Signatures
-- ---------------------------------------------------------------------------

-- The exact words a signer agrees to. The app shows this same text; the
-- database stores it with each signature so the record says what was agreed.
create or replace function app.signature_consent_statement() returns text
language sql immutable set search_path = '' as $$
  select 'I agree to sign this record electronically. Typing my name is my signature, '
    || 'and it has the same effect as signing it by hand.'::text;
$$;
revoke all on function app.signature_consent_statement() from public, anon;
grant execute on function app.signature_consent_statement() to authenticated, service_role;

create table public.signature (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  form_submission_id uuid references public.form_submission (id),
  signing_document_id uuid references public.signing_document (id),
  signer_id uuid not null default auth.uid() references public.user_profile (id),
  signer_name text not null check (char_length(btrim(signer_name)) between 1 and 200),
  signer_email text,
  consent_given boolean not null check (consent_given),
  consent_statement text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  signed_at timestamptz not null default now(),
  constraint signature_one_subject check (num_nonnulls(form_submission_id, signing_document_id) = 1),
  unique (form_submission_id, signer_id),
  unique (signing_document_id, signer_id)
);

create index idx_signature_document on public.signature (signing_document_id) where signing_document_id is not null;
create index idx_signature_submission on public.signature (form_submission_id) where form_submission_id is not null;

comment on table public.signature is
  'Electronic signatures (#144 v1): typed name + explicit consent. Signer, time, consent wording and content hash are set by the database. Immutable.';

create or replace function app.protect_signature() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_sub public.form_submission%rowtype;
  v_doc public.signing_document%rowtype;
  v_recomputed text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Signatures are immutable' using errcode = '42501';
  end if;
  if current_setting('role', true) in ('authenticated', 'anon')
     or coalesce(auth.jwt()->>'role', '') in ('authenticated', 'anon') then
    new.signer_id := auth.uid();
  end if;
  if new.signer_id is null then
    raise exception 'Sign in to sign' using errcode = '42501';
  end if;
  if new.consent_given is not true then
    raise exception 'Tick the consent box to sign' using errcode = '23514';
  end if;
  new.signer_name := btrim(new.signer_name);
  new.signed_at := now();
  new.consent_statement := app.signature_consent_statement();
  select u.email into new.signer_email from auth.users u where u.id = new.signer_id;

  if new.form_submission_id is not null then
    select * into v_sub from public.form_submission where id = new.form_submission_id;
    if not found or v_sub.submitted_by <> new.signer_id then
      raise exception 'Only the person who submitted a form can sign it' using errcode = '42501';
    end if;
    if not app.is_org_member(v_sub.organization_id) and new.signer_id = auth.uid() then
      raise exception 'Only active members can sign' using errcode = '42501';
    end if;
    select v.recomputed_sha256 into v_recomputed
    from public.form_submission s
    join public.form_definition d on d.id = s.form_id,
    lateral (select app.sha256_hex(app.form_submission_content(d.id, d.title, d.fields, s.answers,
      s.submitted_by, s.submitted_at)) as recomputed_sha256) v
    where s.id = v_sub.id;
    if v_recomputed is distinct from v_sub.content_sha256 then
      raise exception 'The submission no longer matches its recorded hash' using errcode = '23514';
    end if;
    new.organization_id := v_sub.organization_id;
    new.content_sha256 := v_sub.content_sha256;
  else
    select * into v_doc from public.signing_document where id = new.signing_document_id;
    if not found or not exists (
      select 1 from public.signing_document_signer s
      where s.document_id = v_doc.id and s.user_id = new.signer_id
    ) then
      raise exception 'You are not asked to sign this document' using errcode = '42501';
    end if;
    if not app.is_org_member(v_doc.organization_id) and new.signer_id = auth.uid() then
      raise exception 'Only active members can sign' using errcode = '42501';
    end if;
    if v_doc.scan_status <> 'clean' or v_doc.content_sha256 is null then
      raise exception 'The document can be signed once its security check has passed' using errcode = '55000';
    end if;
    new.organization_id := v_doc.organization_id;
    new.content_sha256 := v_doc.content_sha256;
  end if;
  return new;
end;
$$;
revoke all on function app.protect_signature() from public, anon, authenticated;
create trigger signature_protect before insert or update on public.signature
for each row execute function app.protect_signature();

create or replace function app.after_signature() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_event (organization_id, actor_id, event_type, action, object_type,
    object_id, metadata)
  values (new.organization_id, new.signer_id, 'signature', 'signed',
    case when new.form_submission_id is not null then 'form_submission' else 'signing_document' end,
    coalesce(new.form_submission_id, new.signing_document_id),
    jsonb_build_object('signature_id', new.id, 'content_sha256', new.content_sha256));
  return null;
end;
$$;
revoke all on function app.after_signature() from public, anon, authenticated;
create trigger signature_after_insert after insert on public.signature
for each row execute function app.after_signature();

alter table public.signature enable row level security;

-- Readable by the signer, by admins, and by whoever may read what was signed
-- (the submitter; the other people asked to sign the same document).
create policy signature_read on public.signature
for select to authenticated using (
  (signer_id = (select auth.uid()) and app.is_org_member(organization_id))
  or app.is_org_admin(organization_id)
  or (form_submission_id is not null and exists (
        select 1 from public.form_submission s where s.id = signature.form_submission_id))
  or (signing_document_id is not null and exists (
        select 1 from public.signing_document d where d.id = signature.signing_document_id))
);

create policy signature_sign on public.signature
for insert to authenticated with check (
  signer_id = (select auth.uid()) and app.is_org_member(organization_id)
);

grant select, insert on public.signature to authenticated;
grant all on public.signature to service_role;

-- Submit a form and, when the form asks for it, sign it in the same
-- transaction, so a form that needs a signature is never stored unsigned.
-- Runs as the caller: row-level security and the triggers above decide.
create or replace function public.submit_form(
  p_form_id uuid, p_answers jsonb, p_signer_name text default null, p_consent boolean default false
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
  v_requires boolean;
begin
  select d.requires_signature into v_requires from public.form_definition d where d.id = p_form_id;
  if v_requires is null then
    raise exception 'Form not found' using errcode = '23503';
  end if;
  insert into public.form_submission (form_id, organization_id, answers, content_sha256)
  select p_form_id, d.organization_id, p_answers, repeat('0', 64)
  from public.form_definition d where d.id = p_form_id
  returning id into v_id;
  if v_requires then
    if coalesce(btrim(p_signer_name), '') = '' or p_consent is not true then
      raise exception 'This form must be signed: type your name and tick the consent box' using errcode = '23514';
    end if;
    insert into public.signature (organization_id, form_submission_id, signer_name, consent_given,
      consent_statement, content_sha256)
    select s.organization_id, v_id, p_signer_name, true, '', repeat('0', 64)
    from public.form_submission s where s.id = v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.submit_form(uuid, jsonb, text, boolean) from public, anon;
grant execute on function public.submit_form(uuid, jsonb, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: two private buckets of their own, never covered by the documents
-- library's organization-wide read policy.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('form-files', 'form-files', false, 26214400,
    array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'application/pdf']),
  ('signing-documents', 'signing-documents', false, 26214400, array['application/pdf'])
on conflict (id) do nothing;

-- Paths are `<organization id>/<uploader id>/<random>/<file>`.
create policy "form files upload own folder" on storage.objects
for insert to authenticated with check (
  bucket_id = 'form-files'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and exists (
    select 1 from public.organization_membership m
    where m.user_id = (select auth.uid())
      and m.organization_id::text = (storage.foldername(name))[1]
      and app.is_org_member(m.organization_id)
  )
);

create policy "form files read clean registered" on storage.objects
for select to authenticated using (
  bucket_id = 'form-files' and exists (
    select 1 from public.form_file f
    join public.form_submission s on s.id = f.submission_id
    where f.storage_path = storage.objects.name and f.scan_status = 'clean'
      and ((s.submitted_by = (select auth.uid()) and app.is_org_member(s.organization_id))
           or app.is_org_admin(s.organization_id))
  )
);

create policy "form files delete own unregistered" on storage.objects
for delete to authenticated using (
  bucket_id = 'form-files'
  and owner_id = (select auth.uid())::text
  and not exists (select 1 from public.form_file f where f.storage_path = storage.objects.name)
);

create policy "signing documents upload admin folder" on storage.objects
for insert to authenticated with check (
  bucket_id = 'signing-documents'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and exists (
    select 1 from public.organization_membership m
    where m.user_id = (select auth.uid())
      and m.organization_id::text = (storage.foldername(name))[1]
      and app.is_org_admin(m.organization_id)
  )
);

create policy "signing documents read clean registered" on storage.objects
for select to authenticated using (
  bucket_id = 'signing-documents' and exists (
    select 1 from public.signing_document d
    where d.storage_path = storage.objects.name and d.scan_status = 'clean'
      and (app.is_org_admin(d.organization_id) or exists (
        select 1 from public.signing_document_signer s
        where s.document_id = d.id and s.user_id = (select auth.uid())
          and app.is_org_member(s.organization_id)))
  )
);

create policy "signing documents delete own unregistered" on storage.objects
for delete to authenticated using (
  bucket_id = 'signing-documents'
  and owner_id = (select auth.uid())::text
  and not exists (select 1 from public.signing_document d where d.storage_path = storage.objects.name)
);

create or replace function app.protect_forms_object() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (current_setting('role', true) in ('authenticated', 'anon')
      or coalesce(auth.jwt()->>'role', '') in ('authenticated', 'anon'))
     and ((old.bucket_id = 'form-files'
           and exists (select 1 from public.form_file f where f.storage_path = old.name))
       or (old.bucket_id = 'signing-documents'
           and exists (select 1 from public.signing_document d where d.storage_path = old.name))) then
    raise exception 'Registered files are immutable' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function app.protect_forms_object() from public, anon, authenticated;
create trigger forms_immutable_bytes before update or delete on storage.objects
for each row execute function app.protect_forms_object();

-- ---------------------------------------------------------------------------
-- Virus scanning and hashing, the same job pattern as documents.
-- ---------------------------------------------------------------------------
insert into public.job_definition(name, description, schedule, queue, enabled, batch_size, max_attempts)
values ('scan-form-files',
  'Scan form attachments and documents for signature with the private ClamAV socket, and record each file''s SHA-256.',
  '* * * * *', null, true, 2, 3)
on conflict (name) do nothing;
select cron.schedule('scan-form-files', '* * * * *',
  $$select app.dispatch_job('scan-form-files')$$);
