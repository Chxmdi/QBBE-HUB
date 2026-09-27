-- Gifts, grants and thank-you acknowledgements (#156, epic #140).
--
-- QBBE is a registered nonprofit, NOT a registered charity. It must never
-- issue official donation receipts for income tax purposes. So:
--   * nothing here stores or produces a receipt number, a charity
--     registration number or an "eligible amount";
--   * every acknowledgement and annual statement stored here must carry, in
--     English and in French, the sentence that it is not an official receipt
--     for income tax purposes (checked by the database, not only the app);
--   * an acknowledgement's subject line may not call itself a receipt.
--
-- What the database guarantees, whoever the caller is:
--   * a gift names exactly one donor from the CRM (a contact or an
--     organization); donors are not duplicated here;
--   * a monetary gift, or an in-kind gift the donor put a value on, posts one
--     balanced entry to the ledger through the ledger's own functions
--     (so the ledger's rules, closed periods and MFA check all apply), linked
--     both ways (gift.journal_entry_id and journal_entry.source_type 'gift');
--   * an in-kind gift has a description and carries a dollar value only when
--     the donor supplied one;
--   * a gift is never edited or deleted; a mistake is voided, which reverses
--     its ledger entry;
--   * a stored acknowledgement never changes, apart from its email delivery
--     status.
--
-- Who does what:
--   * owners and admins with MFA (app.is_org_admin) record gifts and grants,
--     void gifts and issue acknowledgements;
--   * people who may read the ledger (app.can_read_ledger: admins with MFA and
--     staff named as ledger readers) see gifts, grants and acknowledgements;
--   * nobody else sees donors' gifts (Quebec Law 25: least privilege).
-- Donor lists, annual statements and exports are read through functions that
-- write an audit record of each read.

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
create table public.grant_award (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  funder_crm_organization_id uuid not null references public.crm_organization (id) on delete restrict,
  funder_contact_id uuid references public.crm_contact (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  funder_reference text check (funder_reference is null or char_length(btrim(funder_reference)) between 1 and 100),
  amount_awarded_cents bigint not null check (amount_awarded_cents between 1 and 10000000000000),
  awarded_on date,
  starts_on date,
  ends_on date,
  fund_id uuid not null,
  program_id uuid references public.program (id) on delete set null,
  restrictions text check (restrictions is null or char_length(restrictions) <= 2000),
  responsible_user_id uuid references public.user_profile (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'closed')),
  created_by uuid references public.user_profile (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  constraint grant_award_dates_ordered check (starts_on is null or ends_on is null or starts_on <= ends_on),
  foreign key (organization_id, fund_id) references public.ledger_fund (organization_id, id)
);

comment on table public.grant_award is
  'Grants awarded to QBBE (#156): funder (CRM organization), amount, restrictions and the fund that tracks the money.';

create index idx_grant_award_org on public.grant_award (organization_id, status, ends_on);

create table public.grant_report (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  grant_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  due_on date not null,
  submitted_on date,
  notes text check (notes is null or char_length(notes) <= 2000),
  -- Last reminder sent, so the daily job reminds once per threshold.
  last_reminder_kind text check (last_reminder_kind is null or last_reminder_kind in ('upcoming', 'due', 'overdue')),
  last_reminded_at timestamptz,
  created_by uuid references public.user_profile (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, grant_id) references public.grant_award (organization_id, id) on delete cascade
);

comment on table public.grant_report is
  'Reports owed to a grant funder and their due dates. A daily job reminds the grant''s responsible person (or the admins) before and on the due date.';

create index idx_grant_report_due on public.grant_report (organization_id, due_on) where submitted_on is null;
create index idx_grant_report_grant on public.grant_report (grant_id);

-- ---------------------------------------------------------------------------
-- Gifts
-- ---------------------------------------------------------------------------
create table public.gift (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  -- Per-organization reference shown to people ("Gift 12"). Not a receipt number.
  gift_number integer not null check (gift_number > 0),
  gift_type text not null check (gift_type in ('donation', 'grant_payment', 'in_kind')),
  crm_contact_id uuid references public.crm_contact (id) on delete restrict,
  crm_organization_id uuid references public.crm_organization (id) on delete restrict,
  received_on date not null,
  amount_cents bigint check (amount_cents is null or amount_cents between 1 and 10000000000000),
  in_kind_description text check (in_kind_description is null or char_length(btrim(in_kind_description)) between 1 and 1000),
  -- True only when the donor, not QBBE, put a dollar value on an in-kind gift.
  value_supplied_by_donor boolean not null default false,
  fund_id uuid not null,
  program_id uuid references public.program (id) on delete restrict,
  -- The donor's own words about how the gift may be used, when restricted.
  donor_restriction text check (donor_restriction is null or char_length(donor_restriction) <= 1000),
  grant_id uuid,
  debit_account_id uuid,
  credit_account_id uuid,
  journal_entry_id uuid,
  note text check (note is null or char_length(note) <= 1000),
  status text not null default 'recorded' check (status in ('recorded', 'voided')),
  void_reason text check (void_reason is null or char_length(btrim(void_reason)) between 1 and 500),
  voided_by uuid references public.user_profile (id) on delete set null,
  voided_at timestamptz,
  void_entry_id uuid,
  created_by uuid references public.user_profile (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, gift_number),
  constraint gift_one_donor check (num_nonnulls(crm_contact_id, crm_organization_id) = 1),
  constraint gift_grant_shape check ((gift_type = 'grant_payment') = (grant_id is not null)),
  constraint gift_amount_shape check (
    case gift_type
      when 'in_kind' then in_kind_description is not null
        and (amount_cents is null or value_supplied_by_donor)
      else amount_cents is not null and in_kind_description is null and not value_supplied_by_donor
    end
  ),
  constraint gift_posting_shape check (
    (journal_entry_id is null) = (debit_account_id is null)
    and (journal_entry_id is null) = (credit_account_id is null)
    and (journal_entry_id is null or amount_cents is not null)
  ),
  constraint gift_void_recorded check (
    (status = 'voided') = (voided_at is not null)
    and (status = 'voided') = (void_reason is not null)
    and (void_entry_id is null or status = 'voided')
  ),
  foreign key (organization_id, fund_id) references public.ledger_fund (organization_id, id),
  foreign key (organization_id, grant_id) references public.grant_award (organization_id, id),
  foreign key (organization_id, debit_account_id) references public.ledger_account (organization_id, id),
  foreign key (organization_id, credit_account_id) references public.ledger_account (organization_id, id),
  foreign key (organization_id, journal_entry_id) references public.journal_entry (organization_id, id),
  foreign key (organization_id, void_entry_id) references public.journal_entry (organization_id, id)
);

comment on table public.gift is
  'Gifts and grant payments received (#156). Not tax receipts: QBBE is not a registered charity. Each monetary gift is linked to its posted ledger entry.';

create index idx_gift_org_date on public.gift (organization_id, received_on desc);
create index idx_gift_contact on public.gift (crm_contact_id) where crm_contact_id is not null;
create index idx_gift_crm_org on public.gift (crm_organization_id) where crm_organization_id is not null;
create index idx_gift_grant on public.gift (grant_id) where grant_id is not null;

-- ---------------------------------------------------------------------------
-- Acknowledgements (thank-you letters and annual statements)
-- ---------------------------------------------------------------------------
create table public.gift_acknowledgement (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  kind text not null check (kind in ('gift', 'annual_statement')),
  gift_id uuid,
  statement_year integer check (statement_year is null or statement_year between 2000 and 2100),
  crm_contact_id uuid references public.crm_contact (id) on delete restrict,
  crm_organization_id uuid references public.crm_organization (id) on delete restrict,
  language text not null check (language in ('en', 'fr')),
  channel text not null check (channel in ('print', 'email')),
  recipient_name text not null check (char_length(btrim(recipient_name)) between 1 and 200),
  recipient_email text check (recipient_email is null or recipient_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  subject text not null check (char_length(btrim(subject)) between 1 and 200),
  -- The full text as issued, kept as a record of exactly what the donor got.
  body_text text not null check (char_length(body_text) between 1 and 60000),
  email_status text check (email_status is null or email_status in ('queued', 'sent', 'failed', 'blocked')),
  email_error text check (email_error is null or char_length(email_error) <= 500),
  sent_at timestamptz,
  created_by uuid references public.user_profile (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  constraint gift_ack_one_donor check (num_nonnulls(crm_contact_id, crm_organization_id) = 1),
  constraint gift_ack_kind_shape check (
    (kind = 'gift' and gift_id is not null and statement_year is null)
    or (kind = 'annual_statement' and gift_id is null and statement_year is not null)
  ),
  constraint gift_ack_email_shape check (
    (channel = 'email') = (recipient_email is not null)
    and (channel = 'email' or email_status is null)
  ),
  -- The legal point of this whole feature: never anything that reads as an
  -- official receipt for income tax purposes. Both sentences, every time.
  constraint gift_ack_not_a_tax_receipt check (
    position('This is not an official donation receipt for income tax purposes.' in body_text) > 0
    and position('Ceci n''est pas un reçu officiel de don aux fins de l''impôt.' in body_text) > 0
  ),
  constraint gift_ack_subject_not_receipt check (subject !~* '(receipt|re[çc]u)'),
  foreign key (organization_id, gift_id) references public.gift (organization_id, id)
);

comment on table public.gift_acknowledgement is
  'Thank-you acknowledgements and annual donor statements as issued (#156). Never official tax receipts; the bilingual disclaimer is enforced by a check constraint.';

create index idx_gift_ack_gift on public.gift_acknowledgement (gift_id) where gift_id is not null;
create index idx_gift_ack_org on public.gift_acknowledgement (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.grant_award enable row level security;
create policy grant_award_read on public.grant_award
for select to authenticated using (app.can_read_ledger(organization_id));
create policy grant_award_insert on public.grant_award
for insert to authenticated with check (app.is_org_admin(organization_id));
create policy grant_award_update on public.grant_award
for update to authenticated
using (app.is_org_admin(organization_id))
with check (app.is_org_admin(organization_id));
revoke all on public.grant_award from anon;
revoke delete, truncate on public.grant_award from authenticated;
grant select, insert, update on public.grant_award to authenticated;
grant all on public.grant_award to service_role;

alter table public.grant_report enable row level security;
create policy grant_report_read on public.grant_report
for select to authenticated using (app.can_read_ledger(organization_id));
create policy grant_report_insert on public.grant_report
for insert to authenticated with check (app.is_org_admin(organization_id));
create policy grant_report_update on public.grant_report
for update to authenticated
using (app.is_org_admin(organization_id))
with check (app.is_org_admin(organization_id));
create policy grant_report_delete on public.grant_report
for delete to authenticated using (app.is_org_admin(organization_id) and submitted_on is null);
revoke all on public.grant_report from anon;
revoke truncate on public.grant_report from authenticated;
grant select, insert, update, delete on public.grant_report to authenticated;
grant all on public.grant_report to service_role;

-- Gifts are written only by the functions below.
alter table public.gift enable row level security;
create policy gift_read on public.gift
for select to authenticated using (app.can_read_ledger(organization_id));
revoke all on public.gift from anon;
revoke insert, update, delete, truncate on public.gift from authenticated;
grant select on public.gift to authenticated;
grant all on public.gift to service_role;

alter table public.gift_acknowledgement enable row level security;
create policy gift_ack_read on public.gift_acknowledgement
for select to authenticated using (app.can_read_ledger(organization_id));
create policy gift_ack_insert on public.gift_acknowledgement
for insert to authenticated with check (app.is_org_admin(organization_id));
create policy gift_ack_update on public.gift_acknowledgement
for update to authenticated
using (app.is_org_admin(organization_id))
with check (app.is_org_admin(organization_id));
revoke all on public.gift_acknowledgement from anon;
revoke delete, truncate on public.gift_acknowledgement from authenticated;
grant select, insert, update on public.gift_acknowledgement to authenticated;
grant all on public.gift_acknowledgement to service_role;

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------

-- A CRM record, program or user named on a grant belongs to its organization.
create or replace function app.protect_grant_award()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id then
    raise exception 'A grant cannot move between organizations' using errcode = '42501';
  end if;
  if not exists (select 1 from public.crm_organization o
                 where o.id = new.funder_crm_organization_id and o.organization_id = new.organization_id) then
    raise exception 'The funder is not in this organization''s CRM' using errcode = '23514';
  end if;
  if new.funder_contact_id is not null and not exists (
    select 1 from public.crm_contact c
    where c.id = new.funder_contact_id and c.organization_id = new.organization_id) then
    raise exception 'The funder contact is not in this organization''s CRM' using errcode = '23514';
  end if;
  if new.program_id is not null and not exists (
    select 1 from public.program p where p.id = new.program_id and p.organization_id = new.organization_id) then
    raise exception 'Program is not in this organization' using errcode = '23514';
  end if;
  if new.responsible_user_id is not null and not exists (
    select 1 from public.organization_membership m
    where m.organization_id = new.organization_id and m.user_id = new.responsible_user_id
      and m.status = 'active' and m.role in ('owner', 'admin', 'staff')) then
    raise exception 'The responsible person must be active staff of this organization' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  perform app.record_material_audit(new.organization_id, 'gifts',
    case when tg_op = 'INSERT' then 'grant_created' else 'grant_updated' end,
    'grant_award', new.id,
    jsonb_build_object('amount_awarded_cents', new.amount_awarded_cents, 'status', new.status));
  return new;
end;
$$;
revoke all on function app.protect_grant_award() from public, anon, authenticated;
create trigger grant_award_protect before insert or update on public.grant_award
for each row execute function app.protect_grant_award();

create or replace function app.protect_grant_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app.record_material_audit(old.organization_id, 'gifts', 'grant_report_deleted',
      'grant_report', old.id, jsonb_build_object('grant_id', old.grant_id, 'due_on', old.due_on));
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if (new.organization_id, new.grant_id) is distinct from (old.organization_id, old.grant_id) then
      raise exception 'A report stays with its grant' using errcode = '42501';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    -- A new due date starts the reminders again.
    if new.due_on is distinct from old.due_on then
      new.last_reminder_kind := null;
      new.last_reminded_at := null;
    end if;
  else
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    new.last_reminder_kind := null;
    new.last_reminded_at := null;
  end if;
  new.updated_at := now();
  if tg_op = 'INSERT' or new.due_on is distinct from old.due_on
     or new.submitted_on is distinct from old.submitted_on or new.title is distinct from old.title then
    perform app.record_material_audit(new.organization_id, 'gifts',
      case when tg_op = 'INSERT' then 'grant_report_added'
           when new.submitted_on is not null and old.submitted_on is null then 'grant_report_submitted'
           else 'grant_report_updated' end,
      'grant_report', new.id,
      jsonb_build_object('grant_id', new.grant_id, 'due_on', new.due_on, 'submitted_on', new.submitted_on));
  end if;
  return new;
end;
$$;
revoke all on function app.protect_grant_report() from public, anon, authenticated;
create trigger grant_report_protect before insert or update or delete on public.grant_report
for each row execute function app.protect_grant_report();

-- A gift row is final once written: only the void columns may be filled, once.
create or replace function app.protect_gift()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A gift cannot be deleted; void it instead' using errcode = '42501';
  end if;
  if old.status = 'voided' then
    raise exception 'A voided gift cannot change' using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['status', 'void_reason', 'voided_by', 'voided_at', 'void_entry_id',
                             'journal_entry_id', 'debit_account_id', 'credit_account_id'])
     is distinct from (to_jsonb(old) - array['status', 'void_reason', 'voided_by', 'voided_at', 'void_entry_id',
                             'journal_entry_id', 'debit_account_id', 'credit_account_id']) then
    raise exception 'A recorded gift cannot be changed; void it and record it again' using errcode = '42501';
  end if;
  -- The ledger link (entry and its two accounts) is written once, by
  -- gift_record, in the same transaction that inserted the gift.
  if (new.journal_entry_id, new.debit_account_id, new.credit_account_id)
     is distinct from (old.journal_entry_id, old.debit_account_id, old.credit_account_id)
     and (old.journal_entry_id is not null or new.status <> 'recorded') then
    raise exception 'A gift keeps its ledger entry' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.protect_gift() from public, anon, authenticated;
create trigger gift_protect before update or delete on public.gift
for each row execute function app.protect_gift();

-- An acknowledgement is a record of what was sent: only delivery status moves.
create or replace function app.protect_gift_acknowledgement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gift public.gift;
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - array['email_status', 'email_error', 'sent_at'])
       is distinct from (to_jsonb(old) - array['email_status', 'email_error', 'sent_at']) then
      raise exception 'An issued acknowledgement cannot be changed; issue a new one' using errcode = '42501';
    end if;
    return new;
  end if;

  new.created_by := coalesce(auth.uid(), new.created_by);
  new.created_at := now();
  new.sent_at := null;
  new.email_status := case when new.channel = 'email' then 'queued' end;
  new.email_error := null;

  if new.kind = 'gift' then
    select * into v_gift from public.gift g where g.id = new.gift_id;
    if not found or v_gift.organization_id <> new.organization_id then
      raise exception 'Gift not found' using errcode = 'P0002';
    end if;
    if v_gift.status <> 'recorded' then
      raise exception 'A voided gift is not acknowledged' using errcode = '23514';
    end if;
    -- The letter goes to the gift's own donor.
    if (new.crm_contact_id, new.crm_organization_id)
       is distinct from (v_gift.crm_contact_id, v_gift.crm_organization_id) then
      raise exception 'The acknowledgement must go to the gift''s donor' using errcode = '23514';
    end if;
  else
    if new.crm_contact_id is not null and not exists (
      select 1 from public.crm_contact c where c.id = new.crm_contact_id and c.organization_id = new.organization_id) then
      raise exception 'Donor not found' using errcode = 'P0002';
    end if;
    if new.crm_organization_id is not null and not exists (
      select 1 from public.crm_organization o where o.id = new.crm_organization_id and o.organization_id = new.organization_id) then
      raise exception 'Donor not found' using errcode = 'P0002';
    end if;
  end if;

  perform app.record_material_audit(new.organization_id, 'gifts',
    case when new.kind = 'gift' then 'acknowledgement_issued' else 'statement_issued' end,
    'gift_acknowledgement', new.id,
    jsonb_build_object('gift_id', new.gift_id, 'statement_year', new.statement_year,
      'language', new.language, 'channel', new.channel));
  return new;
end;
$$;
revoke all on function app.protect_gift_acknowledgement() from public, anon, authenticated;
create trigger gift_acknowledgement_protect before insert or update on public.gift_acknowledgement
for each row execute function app.protect_gift_acknowledgement();

-- ---------------------------------------------------------------------------
-- Recording and voiding gifts. Each checks the caller itself, then posts
-- through the ledger's own functions, which check the caller again.
-- ---------------------------------------------------------------------------

-- p_gift is a JSON object:
--   gift_type        'donation' | 'grant_payment' | 'in_kind'
--   crm_contact_id | crm_organization_id   (exactly one)
--   received_on      YYYY-MM-DD
--   amount_cents     integer (required unless in-kind without a donor value)
--   in_kind_description, value_supplied_by_donor (in-kind only)
--   fund_id, program_id, donor_restriction, grant_id, note
--   debit_account_id, credit_account_id   (required whenever there is an amount)
-- Returns the new gift's id. Everything happens in one transaction: if the
-- ledger refuses the entry, no gift is recorded either.
create or replace function public.gift_record(p_organization uuid, p_gift jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text := p_gift->>'gift_type';
  v_contact uuid := nullif(p_gift->>'crm_contact_id', '')::uuid;
  v_crm_org uuid := nullif(p_gift->>'crm_organization_id', '')::uuid;
  v_amount bigint := nullif(p_gift->>'amount_cents', '')::bigint;
  v_fund uuid := nullif(p_gift->>'fund_id', '')::uuid;
  v_program uuid := nullif(p_gift->>'program_id', '')::uuid;
  v_grant uuid := nullif(p_gift->>'grant_id', '')::uuid;
  v_debit uuid := nullif(p_gift->>'debit_account_id', '')::uuid;
  v_credit uuid := nullif(p_gift->>'credit_account_id', '')::uuid;
  v_received date := (p_gift->>'received_on')::date;
  v_grant_row public.grant_award;
  v_debit_type text;
  v_credit_type text;
  v_number integer;
  v_gift uuid;
  v_entry uuid;
  v_memo text;
begin
  if not app.is_org_admin(p_organization) then
    raise exception 'Only an administrator with MFA records gifts' using errcode = '42501';
  end if;
  if v_type is null or v_type not in ('donation', 'grant_payment', 'in_kind') then
    raise exception 'Choose the kind of gift' using errcode = '22023';
  end if;
  if v_received is null or v_received > (now() at time zone 'America/Toronto')::date + 1 then
    raise exception 'The date received is required and cannot be in the future' using errcode = '22023';
  end if;
  if num_nonnulls(v_contact, v_crm_org) <> 1 then
    raise exception 'Choose one donor from the CRM' using errcode = '22023';
  end if;
  if v_contact is not null and not exists (
    select 1 from public.crm_contact c where c.id = v_contact and c.organization_id = p_organization) then
    raise exception 'Donor not found in the CRM' using errcode = 'P0002';
  end if;
  if v_crm_org is not null and not exists (
    select 1 from public.crm_organization o where o.id = v_crm_org and o.organization_id = p_organization) then
    raise exception 'Donor not found in the CRM' using errcode = 'P0002';
  end if;

  if v_type = 'grant_payment' then
    select * into v_grant_row from public.grant_award g
    where g.id = v_grant and g.organization_id = p_organization;
    if not found then
      raise exception 'Grant not found' using errcode = 'P0002';
    end if;
    -- A grant payment comes from the grant's funder and lands in its fund.
    if v_contact is not null or v_crm_org <> v_grant_row.funder_crm_organization_id then
      raise exception 'A grant payment comes from the grant''s funder' using errcode = '23514';
    end if;
    v_fund := coalesce(v_fund, v_grant_row.fund_id);
    if v_fund <> v_grant_row.fund_id then
      raise exception 'A grant payment goes to the grant''s fund' using errcode = '23514';
    end if;
    v_program := coalesce(v_program, v_grant_row.program_id);
  elsif v_grant is not null then
    raise exception 'Only a grant payment names a grant' using errcode = '22023';
  end if;

  if v_fund is null or not exists (
    select 1 from public.ledger_fund f where f.id = v_fund and f.organization_id = p_organization) then
    raise exception 'Choose the fund the gift belongs to' using errcode = '22023';
  end if;
  if v_program is not null and not exists (
    select 1 from public.program p where p.id = v_program and p.organization_id = p_organization) then
    raise exception 'Program is not in this organization' using errcode = '23514';
  end if;

  if v_type <> 'in_kind' and v_amount is null then
    raise exception 'Enter the amount received' using errcode = '22023';
  end if;
  if v_type = 'in_kind' and v_amount is not null
     and coalesce((p_gift->>'value_supplied_by_donor')::boolean, false) is not true then
    raise exception 'An in-kind gift carries a dollar value only when the donor supplied one' using errcode = '22023';
  end if;

  -- An amount goes to the ledger; accounts are required for it.
  if v_amount is not null then
    select a.account_type into v_debit_type from public.ledger_account a
    where a.id = v_debit and a.organization_id = p_organization;
    select a.account_type into v_credit_type from public.ledger_account a
    where a.id = v_credit and a.organization_id = p_organization;
    if v_debit_type is null or v_credit_type is null then
      raise exception 'Choose the accounts to post the gift to' using errcode = '22023';
    end if;
    if v_debit_type not in ('asset', 'expense') then
      raise exception 'The gift is debited to an asset (bank) or, for goods used at once, an expense account'
        using errcode = '23514';
    end if;
    if v_credit_type not in ('revenue', 'liability') then
      raise exception 'The gift is credited to a revenue or deferred contributions account' using errcode = '23514';
    end if;
  elsif v_debit is not null or v_credit is not null then
    raise exception 'An in-kind gift without a value is not posted to the ledger' using errcode = '22023';
  end if;

  -- Number gifts in order, one writer at a time per organization.
  perform pg_advisory_xact_lock(hashtextextended('gift:' || p_organization::text, 0));
  select coalesce(max(g.gift_number), 0) + 1 into v_number
  from public.gift g where g.organization_id = p_organization;

  insert into public.gift (
    organization_id, gift_number, gift_type, crm_contact_id, crm_organization_id, received_on,
    amount_cents, in_kind_description, value_supplied_by_donor, fund_id, program_id,
    donor_restriction, grant_id, debit_account_id, credit_account_id, note, created_by
  ) values (
    p_organization, v_number, v_type, v_contact, v_crm_org, v_received,
    v_amount,
    case when v_type = 'in_kind' then nullif(btrim(p_gift->>'in_kind_description'), '') end,
    v_type = 'in_kind' and v_amount is not null,
    v_fund, v_program,
    nullif(btrim(p_gift->>'donor_restriction'), ''),
    case when v_type = 'grant_payment' then v_grant end,
    null, null,
    nullif(btrim(p_gift->>'note'), ''),
    auth.uid()
  ) returning id into v_gift;

  if v_amount is not null then
    v_memo := case v_type
      when 'grant_payment' then 'Grant payment received (gift ' || v_number || ')'
      when 'in_kind' then 'In-kind gift received (gift ' || v_number || ')'
      else 'Donation received (gift ' || v_number || ')'
    end;
    v_entry := public.ledger_save_draft(p_organization, null, v_received, v_memo, 'standard',
      jsonb_build_array(
        jsonb_build_object('account_id', v_debit, 'fund_id', v_fund, 'program_id', v_program,
          'description', 'Gift ' || v_number, 'debit_cents', v_amount, 'credit_cents', 0),
        jsonb_build_object('account_id', v_credit, 'fund_id', v_fund, 'program_id', v_program,
          'description', 'Gift ' || v_number, 'debit_cents', 0, 'credit_cents', v_amount)
      ));
    update public.journal_entry set source_type = 'gift', source_id = v_gift where id = v_entry;
    perform public.ledger_post_entry(v_entry);
    update public.gift set journal_entry_id = v_entry, debit_account_id = v_debit, credit_account_id = v_credit
    where id = v_gift;
  end if;

  perform app.record_material_audit(p_organization, 'gifts', 'gift_recorded', 'gift', v_gift,
    jsonb_build_object('gift_number', v_number, 'gift_type', v_type, 'amount_cents', v_amount,
      'journal_entry_id', v_entry));
  return v_gift;
end;
$$;
revoke all on function public.gift_record(uuid, jsonb) from public, anon;
grant execute on function public.gift_record(uuid, jsonb) to authenticated, service_role;

-- Voids a gift recorded by mistake. Its ledger entry is reversed on p_date;
-- the gift and the original entry stay on record.
create or replace function public.gift_void(p_gift uuid, p_date date, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gift public.gift;
  v_reversal uuid;
begin
  select * into v_gift from public.gift where id = p_gift for update;
  if not found or not app.is_org_admin(v_gift.organization_id) then
    raise exception 'Only an administrator with MFA voids gifts' using errcode = '42501';
  end if;
  if v_gift.status = 'voided' then
    raise exception 'This gift is already voided' using errcode = '23505';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Give the reason for voiding the gift' using errcode = '22023';
  end if;
  if v_gift.journal_entry_id is not null then
    v_reversal := public.ledger_reverse_entry(v_gift.journal_entry_id, p_date,
      left('Void of gift ' || v_gift.gift_number || ': ' || btrim(p_reason), 500));
  end if;
  update public.gift set status = 'voided', void_reason = left(btrim(p_reason), 500),
    voided_by = auth.uid(), voided_at = now(), void_entry_id = v_reversal
  where id = p_gift;
  perform app.record_material_audit(v_gift.organization_id, 'gifts', 'gift_voided', 'gift', p_gift,
    jsonb_build_object('gift_number', v_gift.gift_number, 'reversal_id', v_reversal));
end;
$$;
revoke all on function public.gift_void(uuid, date, text) from public, anon;
grant execute on function public.gift_void(uuid, date, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Audited reads of donor data
-- ---------------------------------------------------------------------------

-- Every donor with gifts received between two dates, with their totals. Each
-- call is written to the audit log with its purpose (viewing the donor list
-- on screen, or exporting it).
create or replace function public.gift_donor_list(
  p_organization uuid, p_from date, p_to date, p_purpose text default 'view'
)
returns table (
  donor_kind text,
  donor_id uuid,
  donor_name text,
  donor_email text,
  gift_count bigint,
  total_cents bigint,
  in_kind_count bigint,
  first_gift_on date,
  last_gift_on date
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not app.can_read_ledger(p_organization) then
    raise exception 'You do not have access to donor records' using errcode = '42501';
  end if;
  if p_purpose not in ('view', 'export') then
    raise exception 'Purpose must be view or export' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a date range' using errcode = '22023';
  end if;
  perform app.record_material_audit(p_organization, 'gifts',
    case when p_purpose = 'export' then 'donor_list_exported' else 'donor_list_viewed' end,
    'organization', p_organization, jsonb_build_object('from', p_from, 'to', p_to));

  return query
  select
    case when g.crm_contact_id is not null then 'contact' else 'organization' end,
    coalesce(g.crm_contact_id, g.crm_organization_id),
    coalesce(max(c.full_name), max(o.name)),
    max(c.email),
    count(*),
    -- Money received; a value a donor put on an in-kind gift is not money.
    coalesce(sum(g.amount_cents) filter (where g.gift_type <> 'in_kind'), 0)::bigint,
    count(*) filter (where g.gift_type = 'in_kind'),
    min(g.received_on),
    max(g.received_on)
  from public.gift g
  left join public.crm_contact c on c.id = g.crm_contact_id
  left join public.crm_organization o on o.id = g.crm_organization_id
  where g.organization_id = p_organization
    and g.status = 'recorded'
    and g.received_on between p_from and p_to
  group by 1, 2
  order by 3;
end;
$$;
revoke all on function public.gift_donor_list(uuid, date, date, text) from public, anon;
grant execute on function public.gift_donor_list(uuid, date, date, text) to authenticated, service_role;

-- One donor's gifts in a calendar year, for their annual statement. Audited.
create or replace function public.gift_donor_statement(
  p_organization uuid, p_contact uuid, p_crm_organization uuid, p_year integer
)
returns table (
  gift_id uuid,
  gift_number integer,
  gift_type text,
  received_on date,
  amount_cents bigint,
  in_kind_description text,
  value_supplied_by_donor boolean,
  fund_name text,
  fund_restriction text,
  program_name text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not app.can_read_ledger(p_organization) then
    raise exception 'You do not have access to donor records' using errcode = '42501';
  end if;
  if num_nonnulls(p_contact, p_crm_organization) <> 1 then
    raise exception 'Choose one donor' using errcode = '22023';
  end if;
  if p_year is null or p_year not between 2000 and 2100 then
    raise exception 'Choose a year' using errcode = '22023';
  end if;
  perform app.record_material_audit(p_organization, 'gifts', 'donor_statement_viewed',
    case when p_contact is not null then 'crm_contact' else 'crm_organization' end,
    coalesce(p_contact, p_crm_organization), jsonb_build_object('year', p_year));

  return query
  select g.id, g.gift_number, g.gift_type, g.received_on, g.amount_cents, g.in_kind_description,
    g.value_supplied_by_donor, f.name, f.restriction, p.name
  from public.gift g
  join public.ledger_fund f on f.id = g.fund_id
  left join public.program p on p.id = g.program_id
  where g.organization_id = p_organization
    and g.status = 'recorded'
    and g.crm_contact_id is not distinct from p_contact
    and g.crm_organization_id is not distinct from p_crm_organization
    and g.received_on between make_date(p_year, 1, 1) and make_date(p_year, 12, 31)
  order by g.received_on, g.gift_number;
end;
$$;
revoke all on function public.gift_donor_statement(uuid, uuid, uuid, integer) from public, anon;
grant execute on function public.gift_donor_statement(uuid, uuid, uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Grant report reminders: a daily job notifies the grant's responsible person
-- (or, when none is named, the organization's owners and admins) 14 days and
-- 3 days before a report is due, on the due date, and while it is overdue.
-- ---------------------------------------------------------------------------
insert into public.job_definition(name, description, schedule, queue, enabled, batch_size, max_attempts)
values ('grant-report-reminders',
  'Remind the people responsible for grant reports before, on and after the due date.',
  '10 12 * * *', null, true, 200, 3)
on conflict (name) do nothing;
select cron.schedule('grant-report-reminders', '10 12 * * *',
  $$select app.dispatch_job('grant-report-reminders')$$);
