-- QBBE Hub — records retention rules and legal hold (issue #146).
--
-- The existing retention settings (20260828200241) answer "how soon may the
-- Hub delete operational noise". This file answers the opposite question for
-- business records: "how long MUST this be kept, and is anything stopping it
-- from being deleted at all". The two do not overlap: retention_subject governs
-- automatic clean-up of activity, notifications and the like; record_category
-- governs records the organization is legally required to keep.
--
-- Three guarantees, all enforced here rather than in the application:
--
--   1. A classified record cannot be deleted before its retention date, by
--      anybody — administrators and the service role included.
--   2. A record under legal hold, directly or through its whole category,
--      cannot be deleted or archived, and cannot be reclassified out of the
--      hold.
--   3. A record's classification cannot be changed in a way that shortens how
--      long it must be kept while that period is still running.
--
-- The design is generic on purpose. `retention_record_type` names the tables
-- whose rows can be held, and `app.assert_record_disposable` is the single
-- check. Documents are wired in now. Receipts (#142) and ledger entries (#148)
-- plug in later with one row in retention_record_type and a short trigger
-- that calls the same function; nothing here depends on those tables.
--
-- Nothing here deletes anything. The nightly job only reports records whose
-- retention period has ended.

-- ---------------------------------------------------------------------------
-- Record categories: what kinds of business record exist, and the legal floor
-- ---------------------------------------------------------------------------

create table public.record_category (
  key text primary key,
  label text not null,
  description text not null,
  -- How the retention date is counted:
  --   fiscal_year_end: N years after the end of the fiscal year the record
  --                    relates to (the CRA and Revenu Québec rule);
  --   record_date:     N years after the record's own date;
  --   permanent:       never disposable from the Hub.
  retention_basis text not null
    check (retention_basis in ('fiscal_year_end', 'record_date', 'permanent')),
  -- The floor. An organization may keep records longer, never shorter.
  minimum_years int check (minimum_years between 1 and 100),
  default_years int check (default_years between 1 and 100),
  legal_reference text not null,
  -- Who has to confirm the period before the organization relies on it.
  confirm_with text not null check (confirm_with in ('accountant', 'counsel')),
  sort_order int not null default 100,

  constraint record_category_years_match_basis check (
    (retention_basis = 'permanent' and minimum_years is null and default_years is null)
    or (retention_basis <> 'permanent' and minimum_years is not null
        and default_years is not null and default_years >= minimum_years)
  )
);

comment on table public.record_category is
  'Kinds of business record and their legal minimum retention. Changed only by migration.';

alter table public.record_category enable row level security;

create policy record_category_read on public.record_category
  for select to authenticated using (true);

-- The periods below are the common reading of the rules cited, not legal
-- advice. Every row is shown as "needs confirmation" until an administrator
-- records that the accountant or counsel has confirmed it.
insert into public.record_category
  (key, label, description, retention_basis, minimum_years, default_years,
   legal_reference, confirm_with, sort_order)
values
  ('financial_record', 'Financial records',
   'Books of account, ledgers, journals, year-end statements and the working papers behind them.',
   'fiscal_year_end', 6, 6,
   'Income Tax Act s. 230 (CRA); Tax Administration Act s. 35.2 (Revenu Québec); Excise Tax Act s. 286 (GST/HST). Six years from the end of the last tax year the records relate to.',
   'accountant', 10),
  ('receipt', 'Receipts',
   'Purchase receipts and other evidence of an expense.',
   'fiscal_year_end', 6, 6,
   'Same rules as financial records: six years from the end of the tax year the receipt relates to. GST and QST input tax claims need the receipt too.',
   'accountant', 20),
  ('bill', 'Bills and invoices',
   'Vendor bills and invoices the organization received or issued.',
   'fiscal_year_end', 6, 6,
   'Same rules as financial records: six years from the end of the tax year the invoice relates to.',
   'accountant', 30),
  ('bank_statement', 'Bank statements',
   'Bank and credit card statements, deposit records and reconciliations.',
   'fiscal_year_end', 6, 6,
   'Same rules as financial records: six years from the end of the tax year the statement relates to.',
   'accountant', 40),
  ('contract', 'Contracts',
   'Leases, service agreements, funding agreements and other contracts. Use the date the contract ended as the record date.',
   'fiscal_year_end', 6, 6,
   'Contracts that support the books follow the six-year tax rule. Civil claims in Quebec generally prescribe after 3 years (Civil Code art. 2925); counsel to confirm.',
   'counsel', 50),
  ('signed_document', 'Signed documents',
   'Consent forms, volunteer agreements, releases and other signed documents.',
   'record_date', 3, 6,
   'Civil Code of Québec art. 2925 (3-year prescription) as the floor. Documents about minors may need longer; counsel to confirm.',
   'counsel', 60),
  ('form_submission', 'Form submissions',
   'Intake, registration and incident forms submitted through the Hub.',
   'record_date', 1, 3,
   'No single statutory period. Incident reports may need longer; counsel to confirm.',
   'counsel', 70),
  ('governance_record', 'Governance records',
   'Letters patent, by-laws, board and general meeting minutes, and resolutions.',
   'permanent', null, null,
   'CRA expects these to be kept until two years after the organization is dissolved; the Hub keeps them permanently.',
   'counsel', 80);

-- ---------------------------------------------------------------------------
-- Per-organization rules and the fiscal year end they are counted from
-- ---------------------------------------------------------------------------

create table public.record_retention_rule (
  organization_id uuid not null references public.organization (id) on delete cascade,
  category_key text not null references public.record_category (key),
  -- Null only for a permanent category, where the row exists to carry the
  -- confirmation.
  retain_years int check (retain_years between 1 and 100),
  confirmed_at timestamptz,
  confirmed_by uuid references public.user_profile (id),
  confirmation_note text check (confirmation_note is null or length(confirmation_note) <= 1000),
  updated_by uuid references public.user_profile (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, category_key)
);

comment on table public.record_retention_rule is
  'How long one organization keeps one record category. Never below the category floor.';

create table public.record_retention_setting (
  organization_id uuid primary key references public.organization (id) on delete cascade,
  fiscal_year_end_month int not null check (fiscal_year_end_month between 1 and 12),
  fiscal_year_end_day int not null check (fiscal_year_end_day >= 1),
  updated_by uuid references public.user_profile (id),
  updated_at timestamptz not null default now(),
  -- February 29 is refused: a year end that only exists every fourth year
  -- makes every date calculation a special case.
  constraint record_retention_setting_real_date check (
    fiscal_year_end_day <= (array[31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])[fiscal_year_end_month]
  )
);

comment on table public.record_retention_setting is
  'The fiscal year end retention is counted from. Without it, the Hub assumes the latest possible year end.';

create or replace function app.record_retention_rule_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category public.record_category;
begin
  select * into v_category from public.record_category where key = new.category_key;
  if not found then
    raise exception 'There is no record category called "%".', new.category_key
      using errcode = 'foreign_key_violation';
  end if;

  if v_category.retention_basis = 'permanent' then
    if new.retain_years is not null then
      raise exception '% are kept permanently; they have no retention period to set.',
        v_category.label using errcode = 'check_violation';
    end if;
  elsif new.retain_years is null then
    raise exception 'Enter how many years % are kept.', lower(v_category.label)
      using errcode = 'check_violation';
  elsif new.retain_years < v_category.minimum_years then
    raise exception '% must be kept for at least % years.',
      v_category.label, v_category.minimum_years using errcode = 'check_violation';
  end if;

  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;

  -- A confirmation belongs to the period that was confirmed. Changing the
  -- period without confirming again clears it.
  if tg_op = 'UPDATE'
     and new.retain_years is distinct from old.retain_years
     and new.confirmed_at is not distinct from old.confirmed_at then
    new.confirmed_at := null;
    new.confirmed_by := null;
  end if;
  if new.confirmed_at is not null
     and (tg_op = 'INSERT' or old.confirmed_at is distinct from new.confirmed_at) then
    new.confirmed_at := now();
    new.confirmed_by := coalesce(auth.uid(), new.confirmed_by);
  end if;
  if new.confirmed_at is null then
    new.confirmed_by := null;
  end if;

  return new;
end;
$$;

revoke all on function app.record_retention_rule_guard() from public, anon, authenticated;

create trigger record_retention_rule_guard
  before insert or update on public.record_retention_rule
  for each row execute function app.record_retention_rule_guard();

create or replace function app.record_retention_setting_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

revoke all on function app.record_retention_setting_stamp() from public, anon, authenticated;

create trigger record_retention_setting_stamp
  before insert or update on public.record_retention_setting
  for each row execute function app.record_retention_setting_stamp();

alter table public.record_retention_rule enable row level security;
alter table public.record_retention_setting enable row level security;

create policy record_retention_rule_read on public.record_retention_rule
  for select to authenticated using (app.is_org_staff(organization_id));
create policy record_retention_rule_manage on public.record_retention_rule
  for all to authenticated
  using (app.is_org_admin(organization_id))
  with check (app.is_org_admin(organization_id));

create policy record_retention_setting_read on public.record_retention_setting
  for select to authenticated using (app.is_org_staff(organization_id));
create policy record_retention_setting_manage on public.record_retention_setting
  for all to authenticated
  using (app.is_org_admin(organization_id))
  with check (app.is_org_admin(organization_id));

-- ---------------------------------------------------------------------------
-- Which tables hold records that retention and holds apply to
-- ---------------------------------------------------------------------------

create table public.retention_record_type (
  -- The table name in the public schema. Used to look the record up, which is
  -- why it is a whitelist rather than free text.
  key text primary key,
  label text not null
);

alter table public.retention_record_type enable row level security;

create policy retention_record_type_read on public.retention_record_type
  for select to authenticated using (true);

insert into public.retention_record_type (key, label) values ('document', 'Document');

-- ---------------------------------------------------------------------------
-- Legal holds
-- ---------------------------------------------------------------------------

create table public.legal_hold (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  scope text not null check (scope in ('record', 'category')),
  category_key text references public.record_category (key),
  record_type text references public.retention_record_type (key),
  record_id uuid,
  reason text not null check (length(btrim(reason)) between 3 and 2000),
  placed_by uuid references public.user_profile (id),
  placed_at timestamptz not null default now(),
  released_by uuid references public.user_profile (id),
  released_at timestamptz,
  release_reason text check (release_reason is null or length(btrim(release_reason)) between 3 and 2000),

  constraint legal_hold_target check (
    (scope = 'record' and record_type is not null and record_id is not null and category_key is null)
    or (scope = 'category' and category_key is not null and record_type is null and record_id is null)
  ),
  constraint legal_hold_release_complete check (
    (released_at is null and release_reason is null)
    or (released_at is not null and release_reason is not null)
  )
);

create index idx_legal_hold_active_record on public.legal_hold (organization_id, record_type, record_id)
  where released_at is null;
create index idx_legal_hold_active_category on public.legal_hold (organization_id, category_key)
  where released_at is null;

comment on table public.legal_hold is
  'Stops deletion of a record or a whole category until released. Rows are never deleted: a released hold is history.';

-- Placing and releasing are the only two things that can happen to a hold.
-- Who and when are stamped here, not trusted from the caller.
create or replace function app.legal_hold_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record_org uuid;
begin
  if tg_op = 'INSERT' then
    if new.released_at is not null or new.released_by is not null or new.release_reason is not null then
      raise exception 'A hold is placed first and released later.' using errcode = 'check_violation';
    end if;
    new.placed_at := now();
    if auth.uid() is not null then
      new.placed_by := auth.uid();
    end if;
    if new.scope = 'record' then
      -- record_type is constrained to retention_record_type, so the table name
      -- formatted here is one this migration (or a later one) put there.
      execute format('select organization_id from public.%I where id = $1', new.record_type)
        into v_record_org using new.record_id;
      if v_record_org is null or v_record_org <> new.organization_id then
        raise exception 'That record does not exist in this organization.'
          using errcode = 'foreign_key_violation';
      end if;
    end if;
    return new;
  end if;

  -- UPDATE: only a release, only once.
  if old.released_at is not null then
    raise exception 'This hold has already been released.' using errcode = '42501';
  end if;
  if (new.organization_id, new.scope, new.category_key, new.record_type, new.record_id,
      new.reason, new.placed_by, new.placed_at)
     is distinct from
     (old.organization_id, old.scope, old.category_key, old.record_type, old.record_id,
      old.reason, old.placed_by, old.placed_at) then
    raise exception 'A hold cannot be edited, only released.' using errcode = '42501';
  end if;
  if new.release_reason is null then
    raise exception 'Say why the hold is being released.' using errcode = 'check_violation';
  end if;
  new.released_at := now();
  new.released_by := coalesce(auth.uid(), new.released_by);
  return new;
end;
$$;

revoke all on function app.legal_hold_guard() from public, anon, authenticated;

create trigger legal_hold_guard
  before insert or update on public.legal_hold
  for each row execute function app.legal_hold_guard();

create or replace function app.legal_hold_no_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- An organization being removed takes its holds with it (the cascade runs
  -- with no signed-in user). Otherwise a hold is released, never deleted.
  if auth.uid() is not null then
    raise exception 'A hold is released, never deleted.' using errcode = '42501';
  end if;
  return old;
end;
$$;

revoke all on function app.legal_hold_no_delete() from public, anon, authenticated;

create trigger legal_hold_no_delete
  before delete on public.legal_hold
  for each row execute function app.legal_hold_no_delete();

alter table public.legal_hold enable row level security;

create policy legal_hold_read on public.legal_hold
  for select to authenticated using (app.is_org_staff(organization_id));
-- is_org_admin already requires an owner or admin signed in with a verified
-- authenticator (aal2), so holds are placed and released only with MFA.
create policy legal_hold_place on public.legal_hold
  for insert to authenticated
  with check (app.is_org_admin(organization_id) and placed_by = (select auth.uid()));
create policy legal_hold_release on public.legal_hold
  for update to authenticated
  using (app.is_org_admin(organization_id))
  with check (app.is_org_admin(organization_id));

-- ---------------------------------------------------------------------------
-- The shared rules: when a record may go, and whether it is held
-- ---------------------------------------------------------------------------

-- The last day a record must be kept. Null means no retention rule applies
-- (an unclassified record); 'infinity' means it is kept permanently.
create or replace function app.record_retain_until(
  p_organization uuid,
  p_category text,
  p_record_date date
)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_category public.record_category;
  v_years int;
  v_setting public.record_retention_setting;
  v_year_end date;
begin
  if p_category is null then
    return null;
  end if;
  select * into v_category from public.record_category where key = p_category;
  if not found then
    return null;
  end if;
  if v_category.retention_basis = 'permanent' then
    return 'infinity'::date;
  end if;

  select r.retain_years into v_years
    from public.record_retention_rule r
   where r.organization_id = p_organization and r.category_key = p_category;
  v_years := greatest(coalesce(v_years, v_category.default_years), v_category.minimum_years);

  if v_category.retention_basis = 'record_date' then
    return (p_record_date + make_interval(years => v_years))::date;
  end if;

  select * into v_setting
    from public.record_retention_setting s
   where s.organization_id = p_organization;
  if not found then
    -- Unknown year end: the fiscal year the record falls in ends at the latest
    -- one year after it, so counting from there can only keep it longer.
    return (p_record_date + make_interval(years => v_years + 1))::date;
  end if;

  v_year_end := make_date(extract(year from p_record_date)::int,
                          v_setting.fiscal_year_end_month, v_setting.fiscal_year_end_day);
  if v_year_end < p_record_date then
    v_year_end := make_date(extract(year from p_record_date)::int + 1,
                            v_setting.fiscal_year_end_month, v_setting.fiscal_year_end_day);
  end if;
  return make_date(extract(year from v_year_end)::int + v_years,
                   v_setting.fiscal_year_end_month, v_setting.fiscal_year_end_day);
end;
$$;

revoke all on function app.record_retain_until(uuid, text, date) from public, anon, authenticated;

create or replace function app.record_is_held(
  p_organization uuid,
  p_record_type text,
  p_record_id uuid,
  p_category text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.legal_hold h
     where h.organization_id = p_organization
       and h.released_at is null
       and (
         (h.scope = 'record' and h.record_type = p_record_type and h.record_id = p_record_id)
         or (h.scope = 'category' and p_category is not null and h.category_key = p_category)
       )
  );
$$;

revoke all on function app.record_is_held(uuid, text, uuid, text) from public, anon, authenticated;

-- The one check every protected table calls. p_action is 'delete' or
-- 'archive': a hold stops both, a retention period stops deletion only
-- (archiving keeps the record, so it is not disposal).
create or replace function app.assert_record_disposable(
  p_organization uuid,
  p_record_type text,
  p_record_id uuid,
  p_category text,
  p_record_date date,
  p_action text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_until date;
begin
  if app.record_is_held(p_organization, p_record_type, p_record_id, p_category) then
    raise exception 'This record is under legal hold and cannot be %d until the hold is released.',
      case p_action when 'archive' then 'archive' else 'delete' end
      using errcode = '42501';
  end if;

  if p_action = 'delete' then
    v_until := app.record_retain_until(p_organization, p_category, p_record_date);
    if v_until is not null and v_until >= current_date then
      if v_until = 'infinity'::date then
        raise exception 'This record is kept permanently and cannot be deleted.'
          using errcode = '42501';
      end if;
      raise exception 'This record must be kept until % and cannot be deleted before then.',
        to_char(v_until, 'YYYY-MM-DD')
        using errcode = '42501';
    end if;
  end if;
end;
$$;

revoke all on function app.assert_record_disposable(uuid, text, uuid, text, date, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Documents: classification and the guard
-- ---------------------------------------------------------------------------

alter table public.document
  add column if not exists record_category text references public.record_category (key),
  add column if not exists record_date date;

comment on column public.document.record_category is
  'Which retention rule applies. Null means the document is not a business record.';
comment on column public.document.record_date is
  'The date the record relates to (transaction, statement or contract end). Defaults to when it was added.';

create or replace function app.document_retention_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_until date;
  v_new_until date;
begin
  if tg_op = 'DELETE' then
    perform app.assert_record_disposable(
      old.organization_id, 'document', old.id, old.record_category,
      coalesce(old.record_date, old.created_at::date), 'delete');
    return old;
  end if;

  if new.archived_at is not null and old.archived_at is null then
    perform app.assert_record_disposable(
      old.organization_id, 'document', old.id, old.record_category,
      coalesce(old.record_date, old.created_at::date), 'archive');
  end if;

  if (new.record_category, new.record_date, new.created_at, new.organization_id)
     is distinct from
     (old.record_category, old.record_date, old.created_at, old.organization_id) then
    if app.record_is_held(old.organization_id, 'document', old.id, old.record_category) then
      raise exception 'This record is under legal hold and cannot be reclassified.'
        using errcode = '42501';
    end if;
    v_old_until := app.record_retain_until(old.organization_id, old.record_category,
                     coalesce(old.record_date, old.created_at::date));
    v_new_until := app.record_retain_until(new.organization_id, new.record_category,
                     coalesce(new.record_date, new.created_at::date));
    if v_old_until is not null and v_old_until >= current_date
       and (v_new_until is null or v_new_until < v_old_until) then
      raise exception 'This change would shorten how long the record must be kept (until %).',
        case when v_old_until = 'infinity'::date then 'permanently'
             else to_char(v_old_until, 'YYYY-MM-DD') end
        using errcode = '42501';
    end if;
    if new.record_category is distinct from old.record_category
       or new.record_date is distinct from old.record_date then
      perform app.record_material_audit(
        new.organization_id, 'document.retention', 'classified', 'document', new.id,
        jsonb_build_object(
          'title', new.title,
          'from_category', old.record_category, 'to_category', new.record_category,
          'from_record_date', old.record_date, 'to_record_date', new.record_date));
    end if;
  end if;

  return new;
end;
$$;

revoke all on function app.document_retention_guard() from public, anon, authenticated;

drop trigger if exists document_retention_guard on public.document;
create trigger document_retention_guard
  before update or delete on public.document
  for each row execute function app.document_retention_guard();

-- The stored file is the record as much as the row is. While the row is
-- protected, its bytes are too — for every caller, the service role included.
create or replace function app.document_object_retention_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
begin
  if old.bucket_id = 'documents' then
    for d in
      select id, organization_id, record_category, record_date, created_at
        from public.document where storage_path = old.name
    loop
      perform app.assert_record_disposable(
        d.organization_id, 'document', d.id, d.record_category,
        coalesce(d.record_date, d.created_at::date), 'delete');
    end loop;
  end if;
  return old;
end;
$$;

revoke all on function app.document_object_retention_guard() from public, anon, authenticated;

drop trigger if exists document_object_retention_guard on storage.objects;
create trigger document_object_retention_guard
  before delete on storage.objects
  for each row execute function app.document_object_retention_guard();

-- ---------------------------------------------------------------------------
-- Audit: holds, rules and the fiscal year end
-- ---------------------------------------------------------------------------

create or replace function app.audit_legal_hold()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.record_material_audit(
    new.organization_id, 'legal_hold',
    case when tg_op = 'INSERT' then 'placed' else 'released' end,
    'legal_hold', new.id,
    jsonb_build_object(
      'scope', new.scope, 'category_key', new.category_key,
      'record_type', new.record_type, 'record_id', new.record_id,
      'reason', case when tg_op = 'INSERT' then new.reason else new.release_reason end));
  return new;
end;
$$;

revoke all on function app.audit_legal_hold() from public, anon, authenticated;

create trigger legal_hold_audited
  after insert or update on public.legal_hold
  for each row execute function app.audit_legal_hold();

create or replace function app.audit_record_retention_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.record_material_audit(
    new.organization_id, 'governance',
    case
      when tg_op = 'UPDATE' and new.confirmed_at is not null
           and old.confirmed_at is distinct from new.confirmed_at then 'record_retention_confirmed'
      else 'record_retention_rule_saved'
    end,
    'record_retention_rule', null,
    jsonb_build_object(
      'category_key', new.category_key,
      'retain_years', new.retain_years,
      'previous_years', case when tg_op = 'UPDATE' then old.retain_years end,
      'confirmed', new.confirmed_at is not null));
  return new;
end;
$$;

revoke all on function app.audit_record_retention_rule() from public, anon, authenticated;

create trigger record_retention_rule_audited
  after insert or update on public.record_retention_rule
  for each row execute function app.audit_record_retention_rule();

create or replace function app.audit_record_retention_setting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.record_material_audit(
    new.organization_id, 'governance', 'fiscal_year_end_saved',
    'record_retention_setting', null,
    jsonb_build_object(
      'month', new.fiscal_year_end_month, 'day', new.fiscal_year_end_day,
      'previous_month', case when tg_op = 'UPDATE' then old.fiscal_year_end_month end,
      'previous_day', case when tg_op = 'UPDATE' then old.fiscal_year_end_day end));
  return new;
end;
$$;

revoke all on function app.audit_record_retention_setting() from public, anon, authenticated;

create trigger record_retention_setting_audited
  after insert or update on public.record_retention_setting
  for each row execute function app.audit_record_retention_setting();

-- ---------------------------------------------------------------------------
-- The register: classified or held records, their dates and status
-- ---------------------------------------------------------------------------

create or replace function public.record_retention_register(p_organization uuid)
returns table (
  record_type text,
  record_id uuid,
  title text,
  category_key text,
  record_date date,
  retain_until date,
  held boolean,
  past_retention boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Administrators (with MFA) of this organization, or the job runner.
  if auth.uid() is not null and not app.is_org_admin(p_organization) then
    raise exception 'Only an administrator can read the records register.'
      using errcode = '42501';
  end if;

  return query
  with docs as (
    select d.id, d.title, d.record_category,
           coalesce(d.record_date, d.created_at::date) as effective_date
      from public.document d
     where d.organization_id = p_organization
       and (
         d.record_category is not null
         or exists (
           select 1 from public.legal_hold h
            where h.organization_id = p_organization and h.released_at is null
              and h.scope = 'record' and h.record_type = 'document' and h.record_id = d.id)
       )
  )
  select 'document'::text,
         docs.id,
         docs.title,
         docs.record_category,
         docs.effective_date,
         app.record_retain_until(p_organization, docs.record_category, docs.effective_date),
         app.record_is_held(p_organization, 'document', docs.id, docs.record_category),
         coalesce(
           app.record_retain_until(p_organization, docs.record_category, docs.effective_date)
             < current_date, false)
    from docs
   order by 6 nulls last, 3;
end;
$$;

revoke all on function public.record_retention_register(uuid) from public, anon;
grant execute on function public.record_retention_register(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The nightly report
-- ---------------------------------------------------------------------------

create table public.record_retention_report (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  generated_at timestamptz not null default now(),
  -- Records whose retention period has ended and are not held. Reported,
  -- never deleted: disposal is a person's decision.
  past_retention_count int not null default 0 check (past_retention_count >= 0),
  held_count int not null default 0 check (held_count >= 0),
  by_category jsonb not null default '{}'::jsonb
);

create index idx_record_retention_report_org
  on public.record_retention_report (organization_id, generated_at desc);

comment on table public.record_retention_report is
  'What the nightly pass found past retention. Written by the job runner; nothing is deleted.';

alter table public.record_retention_report enable row level security;

create policy record_retention_report_read on public.record_retention_report
  for select to authenticated using (app.is_org_admin(organization_id));
-- No insert, update or delete policy: written by the job runner through the
-- service role only.

insert into public.job_definition (name, description, schedule, queue, enabled, batch_size, max_attempts)
values
  ('report-record-retention',
   'Reports classified records whose retention period has ended. Deletes nothing.',
   '50 2 * * *', null, true, 100, 3)
on conflict (name) do update
  set description = excluded.description,
      schedule = excluded.schedule;

do $$
declare
  j record;
begin
  for j in select name, schedule from public.job_definition where name = 'report-record-retention'
  loop
    perform cron.unschedule(j.name)
      where exists (select 1 from cron.job c where c.jobname = j.name);
    perform cron.schedule(j.name, j.schedule,
      format('select app.dispatch_job(%L)', j.name));
  end loop;
end;
$$;
