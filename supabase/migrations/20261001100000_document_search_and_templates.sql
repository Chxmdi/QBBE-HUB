-- ---------------------------------------------------------------------------
-- Document library, second part (#147, epic #139): search inside files, and
-- templates that generate letters, contracts and acknowledgements.
--
-- Search inside files
--
--   The words inside a file are read in the uploader's browser when the file
--   is added: the text layer of a PDF, or Tesseract OCR (the same pinned
--   engine receipts use, #175) for a photo or a scan. That text is stored
--   here, one row per document version or receipt, and indexed with Postgres
--   full-text search in English and French.
--
--   The text is supplied by the uploader's browser, so it is never trusted
--   for anything but finding the file: nothing reads it to decide access,
--   figures or anything else, and no client can read the table directly. The
--   only way out is `public.search_library`, which returns a row only when
--   the searcher may open it: `app.can_read_document` for documents (the
--   same rule the document table's read policy uses) and the receipt read
--   rule (`app.can_read_receipt`, the same three branches as the receipt
--   policies) for receipts.
--
-- Templates
--
--   Owners and admins with MFA (`app.is_org_admin`) write templates. Staff
--   generate from them; the merge is done by the server with the person's own
--   session, so a record merges only if that person can read it, and the
--   result is saved as a new document in the library through the ordinary
--   upload path (quarantine, ClamAV, immutable bytes, read policy).
-- ---------------------------------------------------------------------------

-- Stored text ----------------------------------------------------------------

create table public.document_text (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  document_id uuid unique references public.document (id) on delete cascade,
  receipt_id uuid unique references public.finance_receipt (id) on delete cascade,
  -- How the text was obtained. `generated` is written by the template merge.
  source text not null check (source in ('pdf_text', 'ocr', 'generated')),
  content text not null check (char_length(content) <= 200000),
  search_vector tsvector generated always as (
    to_tsvector('english'::regconfig, content) || to_tsvector('french'::regconfig, content)
  ) stored,
  recorded_by uuid references public.user_profile (id) on delete set null,
  recorded_at timestamptz not null default now(),
  constraint document_text_one_owner check (num_nonnulls(document_id, receipt_id) = 1)
);

create index idx_document_text_search on public.document_text using gin (search_vector);
create index idx_document_text_org on public.document_text (organization_id);

comment on table public.document_text is
  'Words read out of a document or receipt file at upload (#147), for search only. Supplied by the uploader''s browser: never trusted for anything but finding the file. Reached only through public.search_library.';

alter table public.document_text enable row level security;
-- No policies and no grants: clients never read or write this table directly.
revoke all on public.document_text from public, anon, authenticated;
grant all on public.document_text to service_role;

-- The receipt read rule, as one function, so search applies exactly what the
-- receipt policies apply (finance_receipt_read and
-- finance_receipt_accountant_read).
create or replace function app.can_read_receipt(p_receipt uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.finance_receipt r
    where r.id = p_receipt
      and (
        (r.submitted_by = (select auth.uid()) and app.is_org_staff(r.organization_id))
        or app.is_org_admin(r.organization_id)
        or app.is_ledger_accountant(r.organization_id)
      )
  );
$$;
revoke all on function app.can_read_receipt(uuid) from public, anon;
grant execute on function app.can_read_receipt(uuid) to authenticated, service_role;

-- Text is cleaned the same way for every writer: no NUL or other control
-- characters except line breaks and tabs, runs of blank space collapsed, and
-- at most 200,000 characters kept.
create or replace function app.clean_document_text(p_text text)
returns text
language sql immutable
set search_path = ''
as $$
  select left(
    btrim(
      regexp_replace(
        regexp_replace(coalesce(p_text, ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', ' ', 'g'),
        '[ \t]+', ' ', 'g'
      )
    ),
    200000
  );
$$;
revoke all on function app.clean_document_text(text) from public, anon;
grant execute on function app.clean_document_text(text) to authenticated, service_role;

-- Records the words read out of a document file. Only someone who may manage
-- the document, or who added it, may set them; `generated` is reserved for
-- the template merge, which records through the same call.
create or replace function public.set_document_text(
  p_document uuid,
  p_text text,
  p_source text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.document;
  v_text text := app.clean_document_text(p_text);
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_source is null or p_source not in ('pdf_text', 'ocr', 'generated') then
    raise exception 'Unknown text source' using errcode = '22023';
  end if;
  select * into v_doc from public.document where id = p_document;
  if not found
     or not (v_doc.created_by = auth.uid() or app.can_manage_document(v_doc.id))
     or not app.is_org_member(v_doc.organization_id) then
    raise exception 'Not allowed to record text for this document' using errcode = '42501';
  end if;
  if v_doc.kind <> 'file' then
    raise exception 'Only an uploaded file has text to search' using errcode = '23514';
  end if;

  if v_text = '' then
    delete from public.document_text where document_id = v_doc.id;
    return;
  end if;

  insert into public.document_text (organization_id, document_id, source, content, recorded_by)
  values (v_doc.organization_id, v_doc.id, p_source, v_text, auth.uid())
  on conflict (document_id) do update
    set source = excluded.source, content = excluded.content,
        recorded_by = excluded.recorded_by, recorded_at = now();
end;
$$;
revoke all on function public.set_document_text(uuid, text, text) from public, anon;
grant execute on function public.set_document_text(uuid, text, text) to authenticated;

-- Records the words read out of a receipt file: the submitter while the
-- receipt is still theirs to correct, or a finance administrator.
create or replace function public.set_receipt_text(
  p_receipt uuid,
  p_text text,
  p_source text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt public.finance_receipt;
  v_text text := app.clean_document_text(p_text);
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_source is null or p_source not in ('pdf_text', 'ocr') then
    raise exception 'Unknown text source' using errcode = '22023';
  end if;
  select * into v_receipt from public.finance_receipt where id = p_receipt;
  if not found or not (
    (v_receipt.submitted_by = auth.uid() and v_receipt.status = 'submitted'
      and app.is_org_staff(v_receipt.organization_id))
    or app.is_org_admin(v_receipt.organization_id)
  ) then
    raise exception 'Not allowed to record text for this receipt' using errcode = '42501';
  end if;

  if v_text = '' then
    delete from public.document_text where receipt_id = v_receipt.id;
    return;
  end if;

  insert into public.document_text (organization_id, receipt_id, source, content, recorded_by)
  values (v_receipt.organization_id, v_receipt.id, p_source, v_text, auth.uid())
  on conflict (receipt_id) do update
    set source = excluded.source, content = excluded.content,
        recorded_by = excluded.recorded_by, recorded_at = now();
end;
$$;
revoke all on function public.set_receipt_text(uuid, text, text) from public, anon;
grant execute on function public.set_receipt_text(uuid, text, text) to authenticated;

-- Search -----------------------------------------------------------------------
--
-- One search over the library and receipts. A document matches on its title,
-- description and tags (the existing `search_text`, as a substring) or on the
-- words inside it (full text, English and French stemming). A receipt matches
-- on who was paid, its note, or the words inside it. Nothing is returned that
-- the searcher could not open: every row passes `app.can_read_document` or
-- `app.can_read_receipt` before it leaves this function.
--
-- The snippet marks matched words with the control characters U+0002 and
-- U+0003, never with markup, so the page can highlight them without ever
-- treating stored text as HTML.
create or replace function public.search_library(
  p_query text,
  p_include_receipts boolean default true,
  p_include_archived boolean default false,
  p_limit integer default 50
)
returns table (
  kind text,
  id uuid,
  title text,
  snippet text,
  matched_inside boolean,
  version_number integer,
  is_current boolean,
  created_at timestamptz,
  receipt_date date,
  rank real
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := btrim(coalesce(p_query, ''));
  v_tsq tsquery;
  v_pattern text;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if v_query = '' then
    return;
  end if;
  v_query := left(v_query, 200);
  v_tsq := websearch_to_tsquery('english'::regconfig, v_query)
        || websearch_to_tsquery('french'::regconfig, v_query);
  v_pattern := '%' || replace(replace(replace(lower(v_query), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  with hits as (
    select 'document'::text as kind, d.id, d.title::text as title,
           t.content,
           (t.search_vector @@ v_tsq) as inside,
           d.version_number, (d.superseded_at is null) as is_current, d.created_at,
           null::date as receipt_date,
           (coalesce(ts_rank(t.search_vector, v_tsq), 0)
             + case when d.search_text like v_pattern then 1 else 0 end)::real as rank
      from public.document d
      left join public.document_text t on t.document_id = d.id
     where (p_include_archived or d.archived_at is null)
       and (d.search_text like v_pattern or t.search_vector @@ v_tsq)
       and app.can_read_document(d.id)
    union all
    select 'receipt', r.id,
           (r.vendor || ' · ' || to_char(r.document_date, 'YYYY-MM-DD'))::text,
           t.content,
           (t.search_vector @@ v_tsq),
           null::integer, true, r.created_at, r.document_date,
           (coalesce(ts_rank(t.search_vector, v_tsq), 0)
             + case when lower(r.vendor || ' ' || coalesce(r.note, '')) like v_pattern
                    then 1 else 0 end)::real
      from public.finance_receipt r
      left join public.document_text t on t.receipt_id = r.id
     where p_include_receipts
       and (lower(r.vendor || ' ' || coalesce(r.note, '')) like v_pattern
            or t.search_vector @@ v_tsq)
       and app.can_read_receipt(r.id)
  ),
  top as (
    select * from hits order by hits.rank desc, hits.created_at desc limit v_limit
  )
  select top.kind, top.id, top.title,
         case when top.inside then
           ts_headline('english'::regconfig, top.content, v_tsq,
             'StartSel=' || chr(2) || ', StopSel=' || chr(3)
             || ', MaxWords=24, MinWords=8, MaxFragments=2, FragmentDelimiter=" … "')
         end,
         top.inside, top.version_number, top.is_current, top.created_at, top.receipt_date,
         top.rank
    from top
   order by top.rank desc, top.created_at desc;
end;
$$;
revoke all on function public.search_library(text, boolean, boolean, integer) from public, anon;
grant execute on function public.search_library(text, boolean, boolean, integer) to authenticated;

-- Templates ----------------------------------------------------------------------

create table public.document_template (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  kind text not null check (kind in ('letter', 'contract', 'acknowledgement')),
  language text not null check (language in ('fr', 'en')),
  -- The kind of record the template merges: a member of the organization, a
  -- CRM contact, or a recorded gift.
  record_type text not null check (record_type in ('member', 'contact', 'gift')),
  -- Plain text with {{placeholders}}. Never markup: the output escapes every
  -- character of it as well as every merged value.
  body text not null check (char_length(btrim(body)) between 1 and 20000),
  -- Where generated documents are filed unless the person picks another.
  folder_id uuid references public.document_folder (id) on delete set null,
  created_by uuid references public.user_profile (id) on delete set null,
  updated_by uuid references public.user_profile (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create unique index document_template_name_unique
  on public.document_template (organization_id, lower(btrim(name)))
  where archived_at is null;
create index idx_document_template_org on public.document_template (organization_id, name);

comment on table public.document_template is
  'Letter, contract and acknowledgement templates (#147). Owners/admins with MFA manage them; staff generate documents from them.';

alter table public.document_template enable row level security;

create policy document_template_read on public.document_template for select to authenticated
  using (app.is_org_admin(organization_id) or app.is_org_staff(organization_id));
create policy document_template_admin_insert on public.document_template for insert to authenticated
  with check (app.is_org_admin(organization_id));
create policy document_template_admin_update on public.document_template for update to authenticated
  using (app.is_org_admin(organization_id))
  with check (app.is_org_admin(organization_id));
-- No delete policy: a template is archived, so what was generated from it
-- can still say where it came from.

revoke all on public.document_template from anon;
revoke delete, truncate on public.document_template from authenticated;
grant select, insert, update on public.document_template to authenticated;
grant all on public.document_template to service_role;

create or replace function app.prepare_document_template()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.name := btrim(new.name);
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    if new.organization_id is distinct from old.organization_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'A template stays in its organization' using errcode = '42501';
    end if;
  end if;
  new.updated_by := auth.uid();
  if new.folder_id is not null and not exists (
    select 1 from public.document_folder f
     where f.id = new.folder_id and f.organization_id = new.organization_id
       and f.archived_at is null
  ) then
    raise exception 'That folder is not available' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app.prepare_document_template() from public, anon, authenticated;
create trigger document_template_prepare before insert or update on public.document_template
  for each row execute function app.prepare_document_template();

create or replace function app.audit_document_template()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.record_material_audit(
    new.organization_id, 'documents',
    case
      when tg_op = 'INSERT' then 'document_template_created'
      when new.archived_at is not null and old.archived_at is null then 'document_template_archived'
      else 'document_template_updated'
    end,
    'document_template', new.id,
    jsonb_build_object('name', new.name, 'kind', new.kind, 'language', new.language,
      'record_type', new.record_type));
  return new;
end;
$$;
revoke all on function app.audit_document_template() from public, anon, authenticated;
create trigger document_template_audited after insert or update on public.document_template
  for each row execute function app.audit_document_template();

-- A generated document names the template it came from.
alter table public.document
  add column template_id uuid references public.document_template (id) on delete set null;

comment on column public.document.template_id is
  'The template this document was generated from (#147), if any. Informational only.';

-- Recording a generation: the template must be one the person can read, in
-- the document's organization, and the document must be theirs.
create or replace function app.check_document_template_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.template_id is not null
     and (tg_op = 'INSERT' or new.template_id is distinct from old.template_id) then
    if (current_setting('role', true) in ('authenticated', 'anon')
        or coalesce(auth.jwt()->>'role', '') in ('authenticated', 'anon'))
       and not exists (
         select 1 from public.document_template t
          where t.id = new.template_id
            and t.organization_id = new.organization_id
            and t.archived_at is null
            and (app.is_org_admin(t.organization_id) or app.is_org_staff(t.organization_id))
       ) then
      raise exception 'That template is not available' using errcode = '42501';
    end if;
    if tg_op = 'INSERT' then
      perform app.record_material_audit(
        new.organization_id, 'documents', 'document_generated', 'document', new.id,
        jsonb_build_object('template_id', new.template_id));
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app.check_document_template_link() from public, anon, authenticated;
create trigger document_template_link_checked before insert or update of template_id on public.document
  for each row execute function app.check_document_template_link();
