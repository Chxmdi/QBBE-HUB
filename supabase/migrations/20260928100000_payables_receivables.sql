-- Payables and receivables (#150 B3, epic #140), built on the general ledger
-- (#148, migration 20260927100000).
--
-- Payables: a vendor bill, typed in or taken from a captured bill (#142), is
-- drafted by staff, posted by an admin with MFA as a balanced journal entry
-- (expenses and recoverable GST/QST against accounts payable), then paid, in
-- one or several payments, each posting accounts payable against a bank
-- account.
-- Receivables: an invoice to a partner, funder or member is drafted, posted
-- (receivable against revenue and GST/QST collected) and payments received
-- post the bank against the receivable.
--
-- What the database guarantees, whoever the caller is:
--   * a bill or invoice is never paid beyond its total: payments are recorded
--     under a row lock, the paid amount is recomputed from the payments, and
--     a check constraint refuses anything above the total. Paying a bill
--     twice is refused;
--   * the same vendor invoice number, or the same captured receipt, cannot
--     be entered as two live bills;
--   * a posted bill or invoice keeps its figures; mistakes are voided, which
--     posts a reversing entry, and payments are reversed the same way;
--   * every step posts through the ledger's own posting, so the ledger's
--     rules (balance, periods, funds, chart approval) apply unchanged;
--   * aging, as at any date, adds up to the ledger balance of the payable and
--     receivable accounts used (tested in supabase/tests/payables.sql).
--
-- Who does what:
--   * active staff (and admins with MFA) see vendors, customers, bills,
--     invoices and payments, and draft bills and invoices;
--   * only owners and admins with MFA (app.is_org_admin) post, pay, receive,
--     void and reverse, as for the ledger itself;
--   * volunteers and other organizations see nothing.
--
-- Approvals (#143): when an organization sets a bill approval threshold and
-- the approvals engine is installed (public.approval_item), a bill at or above
-- the threshold posts only once an approval for that bill, for that exact
-- total, has been approved. The engine is looked up at run time, so this
-- migration does not depend on it.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create table public.finance_billing_settings (
  organization_id uuid primary key references public.organization (id) on delete cascade,
  -- Bills at or above this total need an approval before posting. Null: none.
  bill_approval_threshold_cents bigint
    check (bill_approval_threshold_cents is null or bill_approval_threshold_cents >= 0),
  -- Serializes invoice numbering: posting an invoice locks this row.
  last_invoice_number integer not null default 0 check (last_invoice_number >= 0),
  updated_at timestamptz not null default now()
);

alter table public.finance_billing_settings enable row level security;
create policy finance_billing_settings_read on public.finance_billing_settings
for select to authenticated using (app.is_org_staff(organization_id));
revoke all on public.finance_billing_settings from anon;
revoke insert, update, delete, truncate on public.finance_billing_settings from authenticated;
grant select on public.finance_billing_settings to authenticated;
grant all on public.finance_billing_settings to service_role;

-- ---------------------------------------------------------------------------
-- Vendors and customers
-- ---------------------------------------------------------------------------
create table public.finance_contact (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  is_vendor boolean not null default false,
  is_customer boolean not null default false,
  email text check (email is null or char_length(email) <= 320),
  phone text check (phone is null or char_length(phone) <= 50),
  address text check (address is null or char_length(address) <= 1000),
  -- Language invoices to this contact are written in.
  language text not null default 'fr' check (language in ('fr', 'en')),
  -- The vendor's registration numbers, needed to claim input tax credits.
  gst_number text check (gst_number is null or char_length(gst_number) <= 30),
  qst_number text check (qst_number is null or char_length(qst_number) <= 30),
  notes text check (notes is null or char_length(notes) <= 2000),
  is_active boolean not null default true,
  created_by uuid references public.user_profile (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  constraint finance_contact_has_role check (is_vendor or is_customer)
);

create index idx_finance_contact_org_name on public.finance_contact (organization_id, lower(name));

comment on table public.finance_contact is
  'Vendors and customers (partners, funders, members) for payables and receivables (#150).';

alter table public.finance_contact enable row level security;
create policy finance_contact_read on public.finance_contact
for select to authenticated using (app.is_org_staff(organization_id));
create policy finance_contact_insert on public.finance_contact
for insert to authenticated with check (app.is_org_staff(organization_id));
create policy finance_contact_update on public.finance_contact
for update to authenticated
using (app.is_org_staff(organization_id))
with check (app.is_org_staff(organization_id));
revoke all on public.finance_contact from anon;
revoke delete, truncate on public.finance_contact from authenticated;
grant select, insert, update on public.finance_contact to authenticated;
grant all on public.finance_contact to service_role;

create or replace function app.protect_finance_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(auth.uid(), new.created_by);
    perform app.record_material_audit(new.organization_id, 'finance', 'contact_created',
      'finance_contact', new.id, jsonb_build_object('name', new.name));
    return new;
  end if;
  if (new.organization_id, new.created_by, new.created_at)
     is distinct from (old.organization_id, old.created_by, old.created_at) then
    raise exception 'A contact''s organization and creator are server managed' using errcode = '42501';
  end if;
  -- A contact with bills stays a vendor; one with invoices stays a customer.
  if old.is_vendor and not new.is_vendor
     and exists (select 1 from public.finance_bill b where b.vendor_id = old.id) then
    raise exception 'This contact has bills and stays a vendor' using errcode = '23514';
  end if;
  if old.is_customer and not new.is_customer
     and exists (select 1 from public.finance_invoice i where i.customer_id = old.id) then
    raise exception 'This contact has invoices and stays a customer' using errcode = '23514';
  end if;
  perform app.record_material_audit(new.organization_id, 'finance', 'contact_updated',
    'finance_contact', new.id, jsonb_build_object('name', new.name, 'active', new.is_active));
  return new;
end;
$$;
revoke all on function app.protect_finance_contact() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Bills (payables)
-- ---------------------------------------------------------------------------
create table public.finance_bill (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  vendor_id uuid not null,
  -- The captured bill (#142) this was entered from, if any.
  receipt_id uuid references public.finance_receipt (id),
  -- The vendor's own invoice number.
  vendor_reference text check (vendor_reference is null or char_length(btrim(vendor_reference)) between 1 and 100),
  bill_date date not null,
  due_date date not null,
  memo text check (memo is null or char_length(memo) <= 500),
  -- Set by the drafter or the admin; required to post.
  fund_id uuid,
  payable_account_id uuid,
  subtotal_cents bigint not null default 0 check (subtotal_cents between 0 and 100000000000),
  gst_cents bigint not null default 0 check (gst_cents between 0 and 100000000000),
  qst_cents bigint not null default 0 check (qst_cents between 0 and 100000000000),
  total_cents bigint generated always as (subtotal_cents + gst_cents + qst_cents) stored,
  paid_cents bigint not null default 0 check (paid_cents >= 0),
  status text not null default 'draft' check (status in ('draft', 'posted', 'paid', 'void')),
  journal_entry_id uuid references public.journal_entry (id),
  void_entry_id uuid references public.journal_entry (id),
  voided_on date,
  created_by uuid references public.user_profile (id) on delete set null,
  posted_by uuid references public.user_profile (id) on delete set null,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, vendor_id) references public.finance_contact (organization_id, id),
  foreign key (organization_id, fund_id) references public.ledger_fund (organization_id, id),
  foreign key (organization_id, payable_account_id) references public.ledger_account (organization_id, id),
  constraint finance_bill_due_after_bill check (due_date >= bill_date),
  -- Never paid beyond the total: the last line of defence against paying twice.
  constraint finance_bill_paid_within_total check (paid_cents <= total_cents),
  constraint finance_bill_posting_recorded check (
    (status = 'draft') = (journal_entry_id is null)
    and (status = 'void') = (void_entry_id is not null)
    and (status = 'void') = (voided_on is not null)
    and (status = 'paid') = (status <> 'draft' and status <> 'void' and paid_cents = total_cents)
  )
);

-- The same vendor invoice or captured receipt cannot be two live bills.
create unique index uq_finance_bill_vendor_reference on public.finance_bill
  (organization_id, vendor_id, lower(btrim(vendor_reference)))
  where vendor_reference is not null and status <> 'void';
create unique index uq_finance_bill_receipt on public.finance_bill (receipt_id)
  where receipt_id is not null and status <> 'void';
create index idx_finance_bill_org_status on public.finance_bill (organization_id, status, due_date);

comment on table public.finance_bill is
  'Vendor bills (#150). Written only through the finance_* functions; posted bills keep their figures and are voided by a reversing entry.';

create table public.finance_bill_line (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  bill_id uuid not null,
  line_no integer not null check (line_no between 1 and 200),
  account_id uuid,
  program_id uuid references public.program (id),
  description text check (description is null or char_length(description) <= 500),
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  unique (bill_id, line_no),
  foreign key (organization_id, bill_id) references public.finance_bill (organization_id, id) on delete cascade,
  foreign key (organization_id, account_id) references public.ledger_account (organization_id, id)
);

create index idx_finance_bill_line_bill on public.finance_bill_line (bill_id);

-- ---------------------------------------------------------------------------
-- Invoices (receivables)
-- ---------------------------------------------------------------------------
create table public.finance_invoice (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  customer_id uuid not null,
  -- Assigned in order when posted; drafts have none.
  invoice_number integer check (invoice_number is null or invoice_number > 0),
  language text not null default 'fr' check (language in ('fr', 'en')),
  invoice_date date not null,
  due_date date not null,
  memo text check (memo is null or char_length(memo) <= 500),
  fund_id uuid,
  receivable_account_id uuid,
  subtotal_cents bigint not null default 0 check (subtotal_cents between 0 and 100000000000),
  gst_cents bigint not null default 0 check (gst_cents between 0 and 100000000000),
  qst_cents bigint not null default 0 check (qst_cents between 0 and 100000000000),
  total_cents bigint generated always as (subtotal_cents + gst_cents + qst_cents) stored,
  paid_cents bigint not null default 0 check (paid_cents >= 0),
  status text not null default 'draft' check (status in ('draft', 'posted', 'paid', 'void')),
  journal_entry_id uuid references public.journal_entry (id),
  void_entry_id uuid references public.journal_entry (id),
  voided_on date,
  created_by uuid references public.user_profile (id) on delete set null,
  posted_by uuid references public.user_profile (id) on delete set null,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, invoice_number),
  foreign key (organization_id, customer_id) references public.finance_contact (organization_id, id),
  foreign key (organization_id, fund_id) references public.ledger_fund (organization_id, id),
  foreign key (organization_id, receivable_account_id) references public.ledger_account (organization_id, id),
  constraint finance_invoice_due_after_invoice check (due_date >= invoice_date),
  constraint finance_invoice_paid_within_total check (paid_cents <= total_cents),
  constraint finance_invoice_posting_recorded check (
    (status = 'draft') = (journal_entry_id is null)
    and (status = 'draft') = (invoice_number is null)
    and (status = 'void') = (void_entry_id is not null)
    and (status = 'void') = (voided_on is not null)
    and (status = 'paid') = (status <> 'draft' and status <> 'void' and paid_cents = total_cents)
  )
);

create index idx_finance_invoice_org_status on public.finance_invoice (organization_id, status, due_date);

comment on table public.finance_invoice is
  'Invoices to partners, funders and members (#150). Written only through the finance_* functions.';

create table public.finance_invoice_line (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  invoice_id uuid not null,
  line_no integer not null check (line_no between 1 and 200),
  account_id uuid,
  program_id uuid references public.program (id),
  description text not null check (char_length(btrim(description)) between 1 and 500),
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  unique (invoice_id, line_no),
  foreign key (organization_id, invoice_id) references public.finance_invoice (organization_id, id) on delete cascade,
  foreign key (organization_id, account_id) references public.ledger_account (organization_id, id)
);

create index idx_finance_invoice_line_invoice on public.finance_invoice_line (invoice_id);

-- ---------------------------------------------------------------------------
-- Payments made (against bills) and received (against invoices)
-- ---------------------------------------------------------------------------
create table public.finance_payment (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  bill_id uuid,
  invoice_id uuid,
  paid_on date not null,
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  bank_account_id uuid not null,
  method text not null check (method in ('cheque', 'eft', 'card', 'cash', 'other')),
  reference text check (reference is null or char_length(reference) <= 100),
  journal_entry_id uuid not null references public.journal_entry (id),
  reversed_on date,
  reversal_entry_id uuid references public.journal_entry (id),
  created_by uuid references public.user_profile (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, bill_id) references public.finance_bill (organization_id, id),
  foreign key (organization_id, invoice_id) references public.finance_invoice (organization_id, id),
  foreign key (organization_id, bank_account_id) references public.ledger_account (organization_id, id),
  constraint finance_payment_one_document check ((bill_id is null) <> (invoice_id is null)),
  constraint finance_payment_reversal_recorded check ((reversed_on is null) = (reversal_entry_id is null)),
  constraint finance_payment_reversal_after check (reversed_on is null or reversed_on >= paid_on)
);

create index idx_finance_payment_bill on public.finance_payment (bill_id) where bill_id is not null;
create index idx_finance_payment_invoice on public.finance_payment (invoice_id) where invoice_id is not null;

comment on table public.finance_payment is
  'Payments made against bills and received against invoices (#150). Never edited or deleted; a mistake is reversed.';

-- ---------------------------------------------------------------------------
-- Row-level security: staff read; nobody writes directly.
-- ---------------------------------------------------------------------------
alter table public.finance_bill enable row level security;
alter table public.finance_bill_line enable row level security;
alter table public.finance_invoice enable row level security;
alter table public.finance_invoice_line enable row level security;
alter table public.finance_payment enable row level security;

create policy finance_bill_read on public.finance_bill
for select to authenticated using (app.is_org_staff(organization_id));
create policy finance_bill_line_read on public.finance_bill_line
for select to authenticated using (app.is_org_staff(organization_id));
create policy finance_invoice_read on public.finance_invoice
for select to authenticated using (app.is_org_staff(organization_id));
create policy finance_invoice_line_read on public.finance_invoice_line
for select to authenticated using (app.is_org_staff(organization_id));
create policy finance_payment_read on public.finance_payment
for select to authenticated using (app.is_org_staff(organization_id));

revoke all on public.finance_bill, public.finance_bill_line, public.finance_invoice,
  public.finance_invoice_line, public.finance_payment from anon;
revoke insert, update, delete, truncate on public.finance_bill, public.finance_bill_line,
  public.finance_invoice, public.finance_invoice_line, public.finance_payment from authenticated;
grant select on public.finance_bill, public.finance_bill_line, public.finance_invoice,
  public.finance_invoice_line, public.finance_payment to authenticated;
grant all on public.finance_bill, public.finance_bill_line, public.finance_invoice,
  public.finance_invoice_line, public.finance_payment to service_role;

create trigger finance_contact_protect before insert or update on public.finance_contact
for each row execute function app.protect_finance_contact();

-- ---------------------------------------------------------------------------
-- Immutability. These run for every role, the functions below included:
-- once posted, a document's figures and lines are part of the record, and a
-- payment is never edited or deleted.
-- ---------------------------------------------------------------------------
create or replace function app.protect_finance_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'A posted document cannot be deleted; void it instead' using errcode = '42501';
    end if;
    return old;
  end if;
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id
       or new.created_at is distinct from old.created_at then
      raise exception 'A document cannot move between organizations' using errcode = '42501';
    end if;
    if old.status = 'void' then
      raise exception 'A void document cannot change' using errcode = '42501';
    end if;
    if old.status <> 'draft' and (
      -- total_cents is generated from the amounts compared here, and is not
      -- yet computed in a BEFORE trigger's NEW row.
      (to_jsonb(new) - array['status', 'paid_cents', 'void_entry_id', 'voided_on', 'updated_at', 'total_cents'])
      is distinct from
      (to_jsonb(old) - array['status', 'paid_cents', 'void_entry_id', 'voided_on', 'updated_at', 'total_cents'])
    ) then
      raise exception 'A posted document keeps its figures; void it instead' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app.protect_finance_document() from public, anon, authenticated;
create trigger finance_bill_protect before insert or update or delete on public.finance_bill
for each row execute function app.protect_finance_document();
create trigger finance_invoice_protect before insert or update or delete on public.finance_invoice
for each row execute function app.protect_finance_document();

create or replace function app.protect_finance_document_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  if tg_table_name = 'finance_bill_line' then
    if exists (select 1 from public.finance_bill b where b.id = v_row.bill_id and b.status <> 'draft')
       or (tg_op = 'UPDATE' and exists (
         select 1 from public.finance_bill b where b.id = old.bill_id and b.status <> 'draft')) then
      raise exception 'Lines of a posted bill cannot change' using errcode = '42501';
    end if;
  else
    if exists (select 1 from public.finance_invoice i where i.id = v_row.invoice_id and i.status <> 'draft')
       or (tg_op = 'UPDATE' and exists (
         select 1 from public.finance_invoice i where i.id = old.invoice_id and i.status <> 'draft')) then
      raise exception 'Lines of a posted invoice cannot change' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function app.protect_finance_document_line() from public, anon, authenticated;
create trigger finance_bill_line_protect before insert or update or delete on public.finance_bill_line
for each row execute function app.protect_finance_document_line();
create trigger finance_invoice_line_protect before insert or update or delete on public.finance_invoice_line
for each row execute function app.protect_finance_document_line();

create or replace function app.protect_finance_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A payment cannot be deleted; reverse it instead' using errcode = '42501';
  end if;
  -- The only change a payment ever takes is being reversed, once.
  if old.reversed_on is not null
     or (to_jsonb(new) - array['reversed_on', 'reversal_entry_id'])
        is distinct from (to_jsonb(old) - array['reversed_on', 'reversal_entry_id']) then
    raise exception 'A payment cannot be changed; reverse it instead' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.protect_finance_payment() from public, anon, authenticated;
create trigger finance_payment_protect before update or delete on public.finance_payment
for each row execute function app.protect_finance_payment();

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

-- Creates and posts a journal entry through the ledger. p_lines: a JSON array
-- of objects with account_id, fund_id, program_id, description, debit_cents,
-- credit_cents. The ledger checks balance, period, chart approval and fund
-- rules when app.ledger_post runs.
create or replace function app.finance_post_journal(
  p_organization uuid, p_entry_date date, p_memo text,
  p_source_type text, p_source_id uuid, p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry uuid;
begin
  insert into public.journal_entry (organization_id, entry_date, memo, kind, source_type, source_id, created_by)
  values (p_organization, p_entry_date, left(btrim(p_memo), 500), 'standard', p_source_type, p_source_id, auth.uid())
  returning id into v_entry;

  insert into public.journal_line (organization_id, entry_id, line_no, account_id, fund_id,
    program_id, description, debit_cents, credit_cents)
  select p_organization, v_entry, x.ordinality::integer,
    (x.value->>'account_id')::uuid,
    (x.value->>'fund_id')::uuid,
    nullif(x.value->>'program_id', '')::uuid,
    nullif(left(btrim(x.value->>'description'), 500), ''),
    coalesce((x.value->>'debit_cents')::bigint, 0),
    coalesce((x.value->>'credit_cents')::bigint, 0)
  from jsonb_array_elements(p_lines) with ordinality as x(value, ordinality);

  perform app.ledger_post(v_entry);
  return v_entry;
end;
$$;
revoke all on function app.finance_post_journal(uuid, date, text, text, uuid, jsonb) from public, anon, authenticated;

-- An active account of this organization by its code, or a readable error.
create or replace function app.finance_account_by_code(p_organization uuid, p_code text, p_purpose text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select a.id into v_id from public.ledger_account a
  where a.organization_id = p_organization and a.code = p_code and a.is_active;
  if v_id is null then
    raise exception 'Add an active account % in the chart of accounts for %', p_code, p_purpose
      using errcode = '23514';
  end if;
  return v_id;
end;
$$;
revoke all on function app.finance_account_by_code(uuid, text, text) from public, anon, authenticated;

create or replace function app.finance_require_account_type(p_account uuid, p_types text[], p_label text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.ledger_account a
                 where a.id = p_account and a.account_type = any (p_types) and a.is_active) then
    raise exception 'The % must be an active % account', p_label, array_to_string(p_types, ' or ')
      using errcode = '23514';
  end if;
end;
$$;
revoke all on function app.finance_require_account_type(uuid, text[], text) from public, anon, authenticated;

create or replace function app.finance_ensure_settings(p_organization uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.finance_billing_settings (organization_id) values (p_organization)
  on conflict (organization_id) do nothing;
$$;
revoke all on function app.finance_ensure_settings(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What staff may choose from while drafting. Staff do not read the ledger, but
-- a draft needs account and fund names; nothing else of the books is shown.
-- ---------------------------------------------------------------------------
create or replace function public.finance_posting_choices(p_organization uuid)
returns table (choice text, id uuid, code text, name text, account_type text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_org_staff(p_organization) then
    raise exception 'Only staff can draft bills and invoices' using errcode = '42501';
  end if;
  return query
    select 'account'::text, a.id, a.code, a.name, a.account_type
    from public.ledger_account a
    where a.organization_id = p_organization and a.is_active
    union all
    select 'fund'::text, f.id, f.code, f.name, f.restriction
    from public.ledger_fund f
    where f.organization_id = p_organization and f.is_active
    order by 1, 3;
end;
$$;
revoke all on function public.finance_posting_choices(uuid) from public, anon;
grant execute on function public.finance_posting_choices(uuid) to authenticated, service_role;

create or replace function public.finance_set_bill_approval_threshold(p_organization uuid, p_threshold_cents bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_org_admin(p_organization) then
    raise exception 'Only an administrator with MFA changes the approval threshold' using errcode = '42501';
  end if;
  if p_threshold_cents is not null and p_threshold_cents < 0 then
    raise exception 'The threshold cannot be negative' using errcode = '22023';
  end if;
  perform app.finance_ensure_settings(p_organization);
  update public.finance_billing_settings
  set bill_approval_threshold_cents = p_threshold_cents, updated_at = now()
  where organization_id = p_organization;
  perform app.record_material_audit(p_organization, 'finance', 'bill_approval_threshold_set',
    'organization', p_organization, jsonb_build_object('threshold_cents', p_threshold_cents));
end;
$$;
revoke all on function public.finance_set_bill_approval_threshold(uuid, bigint) from public, anon;
grant execute on function public.finance_set_bill_approval_threshold(uuid, bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Drafting (staff)
-- ---------------------------------------------------------------------------

-- Saves a draft bill with all of its lines. p_bill null creates one.
-- p_header: vendor_id, receipt_id, vendor_reference, bill_date, due_date,
-- memo, fund_id, payable_account_id, gst_cents, qst_cents.
-- p_lines: array of account_id, program_id, description, amount_cents.
create or replace function public.finance_save_bill(
  p_organization uuid, p_bill uuid, p_header jsonb, p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill uuid := p_bill;
  v_existing public.finance_bill;
  v_receipt uuid := nullif(p_header->>'receipt_id', '')::uuid;
  v_vendor uuid := nullif(p_header->>'vendor_id', '')::uuid;
  v_subtotal bigint;
begin
  if not app.is_org_staff(p_organization) then
    raise exception 'Only staff can draft bills' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 200 then
    raise exception 'Lines must be a list of at most 200' using errcode = '22023';
  end if;
  if not exists (select 1 from public.finance_contact c
                 where c.id = v_vendor and c.organization_id = p_organization and c.is_vendor) then
    raise exception 'Choose a vendor of this organization' using errcode = '23514';
  end if;
  -- A captured bill is linked only by someone who may read it.
  if v_receipt is not null and not exists (
    select 1 from public.finance_receipt r
    where r.id = v_receipt and r.organization_id = p_organization and r.kind = 'bill'
      and (r.submitted_by = auth.uid() or app.is_org_admin(p_organization))
  ) then
    raise exception 'Captured bill not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) x
    left join public.program pg on pg.id = nullif(x->>'program_id', '')::uuid
    where nullif(x->>'program_id', '') is not null and pg.organization_id is distinct from p_organization
  ) then
    raise exception 'A program is not in this organization' using errcode = '23514';
  end if;

  select coalesce(sum((x->>'amount_cents')::bigint), 0) into v_subtotal
  from jsonb_array_elements(p_lines) x;

  if v_bill is null then
    insert into public.finance_bill (organization_id, vendor_id, receipt_id, vendor_reference,
      bill_date, due_date, memo, fund_id, payable_account_id, subtotal_cents, gst_cents, qst_cents, created_by)
    values (p_organization, v_vendor, v_receipt,
      nullif(btrim(p_header->>'vendor_reference'), ''),
      (p_header->>'bill_date')::date, (p_header->>'due_date')::date,
      nullif(btrim(p_header->>'memo'), ''),
      nullif(p_header->>'fund_id', '')::uuid, nullif(p_header->>'payable_account_id', '')::uuid,
      v_subtotal, coalesce((p_header->>'gst_cents')::bigint, 0), coalesce((p_header->>'qst_cents')::bigint, 0),
      auth.uid())
    returning id into v_bill;
  else
    select * into v_existing from public.finance_bill where id = v_bill for update;
    if not found or v_existing.organization_id <> p_organization then
      raise exception 'Bill not found' using errcode = 'P0002';
    end if;
    if v_existing.status <> 'draft' then
      raise exception 'A posted bill keeps its figures; void it instead' using errcode = '42501';
    end if;
    if v_existing.created_by is distinct from auth.uid() and not app.is_org_admin(p_organization) then
      raise exception 'Only the person who drafted this bill or an administrator can change it'
        using errcode = '42501';
    end if;
    update public.finance_bill set vendor_id = v_vendor, receipt_id = v_receipt,
      vendor_reference = nullif(btrim(p_header->>'vendor_reference'), ''),
      bill_date = (p_header->>'bill_date')::date, due_date = (p_header->>'due_date')::date,
      memo = nullif(btrim(p_header->>'memo'), ''),
      fund_id = nullif(p_header->>'fund_id', '')::uuid,
      payable_account_id = nullif(p_header->>'payable_account_id', '')::uuid,
      subtotal_cents = v_subtotal,
      gst_cents = coalesce((p_header->>'gst_cents')::bigint, 0),
      qst_cents = coalesce((p_header->>'qst_cents')::bigint, 0)
    where id = v_bill;
    delete from public.finance_bill_line where bill_id = v_bill;
  end if;

  insert into public.finance_bill_line (organization_id, bill_id, line_no, account_id, program_id,
    description, amount_cents)
  select p_organization, v_bill, x.ordinality::integer,
    nullif(x.value->>'account_id', '')::uuid,
    nullif(x.value->>'program_id', '')::uuid,
    nullif(btrim(x.value->>'description'), ''),
    (x.value->>'amount_cents')::bigint
  from jsonb_array_elements(p_lines) with ordinality as x(value, ordinality);

  perform app.record_material_audit(p_organization, 'finance', 'bill_draft_saved',
    'finance_bill', v_bill, jsonb_build_object('lines', jsonb_array_length(p_lines), 'subtotal_cents', v_subtotal));
  return v_bill;
end;
$$;
revoke all on function public.finance_save_bill(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.finance_save_bill(uuid, uuid, jsonb, jsonb) to authenticated, service_role;

-- Saves a draft invoice. p_header: customer_id, language, invoice_date,
-- due_date, memo, fund_id, receivable_account_id, gst_cents, qst_cents.
-- p_lines: array of account_id, program_id, description, amount_cents.
create or replace function public.finance_save_invoice(
  p_organization uuid, p_invoice uuid, p_header jsonb, p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice uuid := p_invoice;
  v_existing public.finance_invoice;
  v_customer uuid := nullif(p_header->>'customer_id', '')::uuid;
  v_subtotal bigint;
begin
  if not app.is_org_staff(p_organization) then
    raise exception 'Only staff can draft invoices' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 200 then
    raise exception 'Lines must be a list of at most 200' using errcode = '22023';
  end if;
  if not exists (select 1 from public.finance_contact c
                 where c.id = v_customer and c.organization_id = p_organization and c.is_customer) then
    raise exception 'Choose a customer of this organization' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) x
    left join public.program pg on pg.id = nullif(x->>'program_id', '')::uuid
    where nullif(x->>'program_id', '') is not null and pg.organization_id is distinct from p_organization
  ) then
    raise exception 'A program is not in this organization' using errcode = '23514';
  end if;

  select coalesce(sum((x->>'amount_cents')::bigint), 0) into v_subtotal
  from jsonb_array_elements(p_lines) x;

  if v_invoice is null then
    insert into public.finance_invoice (organization_id, customer_id, language, invoice_date, due_date,
      memo, fund_id, receivable_account_id, subtotal_cents, gst_cents, qst_cents, created_by)
    values (p_organization, v_customer, coalesce(nullif(p_header->>'language', ''), 'fr'),
      (p_header->>'invoice_date')::date, (p_header->>'due_date')::date,
      nullif(btrim(p_header->>'memo'), ''),
      nullif(p_header->>'fund_id', '')::uuid, nullif(p_header->>'receivable_account_id', '')::uuid,
      v_subtotal, coalesce((p_header->>'gst_cents')::bigint, 0), coalesce((p_header->>'qst_cents')::bigint, 0),
      auth.uid())
    returning id into v_invoice;
  else
    select * into v_existing from public.finance_invoice where id = v_invoice for update;
    if not found or v_existing.organization_id <> p_organization then
      raise exception 'Invoice not found' using errcode = 'P0002';
    end if;
    if v_existing.status <> 'draft' then
      raise exception 'A posted invoice keeps its figures; void it instead' using errcode = '42501';
    end if;
    if v_existing.created_by is distinct from auth.uid() and not app.is_org_admin(p_organization) then
      raise exception 'Only the person who drafted this invoice or an administrator can change it'
        using errcode = '42501';
    end if;
    update public.finance_invoice set customer_id = v_customer,
      language = coalesce(nullif(p_header->>'language', ''), 'fr'),
      invoice_date = (p_header->>'invoice_date')::date, due_date = (p_header->>'due_date')::date,
      memo = nullif(btrim(p_header->>'memo'), ''),
      fund_id = nullif(p_header->>'fund_id', '')::uuid,
      receivable_account_id = nullif(p_header->>'receivable_account_id', '')::uuid,
      subtotal_cents = v_subtotal,
      gst_cents = coalesce((p_header->>'gst_cents')::bigint, 0),
      qst_cents = coalesce((p_header->>'qst_cents')::bigint, 0)
    where id = v_invoice;
    delete from public.finance_invoice_line where invoice_id = v_invoice;
  end if;

  insert into public.finance_invoice_line (organization_id, invoice_id, line_no, account_id, program_id,
    description, amount_cents)
  select p_organization, v_invoice, x.ordinality::integer,
    nullif(x.value->>'account_id', '')::uuid,
    nullif(x.value->>'program_id', '')::uuid,
    btrim(x.value->>'description'),
    (x.value->>'amount_cents')::bigint
  from jsonb_array_elements(p_lines) with ordinality as x(value, ordinality);

  perform app.record_material_audit(p_organization, 'finance', 'invoice_draft_saved',
    'finance_invoice', v_invoice, jsonb_build_object('lines', jsonb_array_length(p_lines), 'subtotal_cents', v_subtotal));
  return v_invoice;
end;
$$;
revoke all on function public.finance_save_invoice(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.finance_save_invoice(uuid, uuid, jsonb, jsonb) to authenticated, service_role;

-- Deletes a draft bill or invoice (p_kind 'bill' or 'invoice').
create or replace function public.finance_delete_draft(p_kind text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_status text;
  v_creator uuid;
begin
  if p_kind = 'bill' then
    select organization_id, status, created_by into v_org, v_status, v_creator
    from public.finance_bill where id = p_id for update;
  elsif p_kind = 'invoice' then
    select organization_id, status, created_by into v_org, v_status, v_creator
    from public.finance_invoice where id = p_id for update;
  else
    raise exception 'Kind must be bill or invoice' using errcode = '22023';
  end if;
  if v_org is null or not app.is_org_staff(v_org)
     or (v_creator is distinct from auth.uid() and not app.is_org_admin(v_org)) then
    raise exception 'Only the person who drafted it or an administrator can delete it' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'A posted document cannot be deleted; void it instead' using errcode = '42501';
  end if;
  if p_kind = 'bill' then
    delete from public.finance_bill where id = p_id;
  else
    delete from public.finance_invoice where id = p_id;
  end if;
  perform app.record_material_audit(v_org, 'finance', p_kind || '_draft_deleted',
    'finance_' || p_kind, p_id, '{}'::jsonb);
end;
$$;
revoke all on function public.finance_delete_draft(text, uuid) from public, anon;
grant execute on function public.finance_delete_draft(text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Approvals hook (#143)
-- ---------------------------------------------------------------------------

-- Whether a bill needs an approval it does not yet have. Only when a
-- threshold is set, the total reaches it and the approvals engine exists.
-- The approval must be for this bill and for its current total, so changing
-- the amount after approval needs a fresh approval.
create or replace function app.finance_bill_needs_approval(p_bill public.finance_bill)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_threshold bigint;
  v_approved boolean;
begin
  select s.bill_approval_threshold_cents into v_threshold
  from public.finance_billing_settings s where s.organization_id = p_bill.organization_id;
  if v_threshold is null or p_bill.total_cents < v_threshold then
    return false;
  end if;
  if to_regclass('public.approval_item') is null then
    -- TODO(#143): the approvals engine is not installed in this database, so
    -- the threshold cannot be enforced yet. Posting stays with admins (MFA).
    return false;
  end if;
  execute 'select exists (select 1 from public.approval_item a
             where a.organization_id = $1 and a.subject_type = ''bill'' and a.subject_id = $2
               and a.status = ''approved'' and a.amount_cents = $3)'
    into v_approved using p_bill.organization_id, p_bill.id, p_bill.total_cents;
  return not v_approved;
end;
$$;
revoke all on function app.finance_bill_needs_approval(public.finance_bill) from public, anon, authenticated;

-- The latest approval for this bill at its current total: 'pending',
-- 'approved', 'rejected', 'withdrawn', or null when there is none or the
-- approvals engine is not installed.
create or replace function public.finance_bill_approval_status(p_bill uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.finance_bill;
  v_status text;
begin
  select * into b from public.finance_bill where id = p_bill;
  if not found or not app.is_org_staff(b.organization_id) then
    return null;
  end if;
  if to_regclass('public.approval_item') is null then
    return null;
  end if;
  execute 'select a.status from public.approval_item a
             where a.organization_id = $1 and a.subject_type = ''bill'' and a.subject_id = $2
               and a.amount_cents = $3
             order by a.created_at desc limit 1'
    into v_status using b.organization_id, b.id, b.total_cents;
  return v_status;
end;
$$;
revoke all on function public.finance_bill_approval_status(uuid) from public, anon;
grant execute on function public.finance_bill_approval_status(uuid) to authenticated, service_role;

-- Sends a draft bill to the approvals engine (#143). Returns the approval
-- item's id. Refused with a clear message where the engine is not installed.
create or replace function public.finance_request_bill_approval(p_bill uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.finance_bill;
  v_vendor text;
  v_program uuid;
  v_item uuid;
begin
  select * into b from public.finance_bill where id = p_bill;
  if not found or not app.is_org_staff(b.organization_id) then
    raise exception 'Bill not found' using errcode = 'P0002';
  end if;
  if b.status <> 'draft' then
    raise exception 'Only a draft bill is sent for approval' using errcode = '22023';
  end if;
  if b.total_cents <= 0 then
    raise exception 'Add the bill''s lines before asking for approval' using errcode = '22023';
  end if;
  if to_regprocedure('public.submit_approval(uuid, text, text, bigint, uuid, text, uuid)') is null then
    raise exception 'Approvals are not available yet' using errcode = '22023';
  end if;
  select c.name into v_vendor from public.finance_contact c where c.id = b.vendor_id;
  -- Route by the program when the whole bill is for one program.
  select min(l.program_id::text)::uuid into v_program from public.finance_bill_line l
  where l.bill_id = b.id having count(distinct l.program_id) = 1 and count(*) = count(l.program_id);
  execute 'select public.submit_approval($1, ''bill'', $2, $3, $4, $5, $6)'
    into v_item
    using b.organization_id,
      left('Bill from ' || v_vendor || coalesce(' #' || b.vendor_reference, ''), 200),
      b.total_cents, v_program, b.memo, b.id;
  perform app.record_material_audit(b.organization_id, 'finance', 'bill_approval_requested',
    'finance_bill', b.id, jsonb_build_object('approval_item_id', v_item, 'total_cents', b.total_cents));
  return v_item;
end;
$$;
revoke all on function public.finance_request_bill_approval(uuid) from public, anon;
grant execute on function public.finance_request_bill_approval(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Posting (admins with MFA)
-- ---------------------------------------------------------------------------

-- Posts a draft bill on its bill date: each line debits its account, GST and
-- QST debit the tax receivable accounts (1200, 1210), and the total credits
-- accounts payable (2000 unless the bill names another liability account).
-- Everything is in the bill's fund.
create or replace function public.finance_post_bill(p_bill uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.finance_bill;
  v_vendor text;
  v_payable uuid;
  v_lines jsonb;
  v_entry uuid;
begin
  select * into b from public.finance_bill where id = p_bill for update;
  if not found or not app.is_org_admin(b.organization_id) then
    raise exception 'Only an administrator with MFA posts bills' using errcode = '42501';
  end if;
  if b.status <> 'draft' then
    raise exception 'This bill is already posted' using errcode = '42501';
  end if;
  if b.fund_id is null then
    raise exception 'Choose the fund this bill is charged to' using errcode = '23514';
  end if;
  if not exists (select 1 from public.finance_bill_line l where l.bill_id = b.id) or b.total_cents <= 0 then
    raise exception 'A bill needs at least one line with an amount' using errcode = '23514';
  end if;
  if exists (select 1 from public.finance_bill_line l where l.bill_id = b.id and l.account_id is null) then
    raise exception 'Choose an account for every line' using errcode = '23514';
  end if;
  if app.finance_bill_needs_approval(b) then
    raise exception 'This bill needs an approval for its total before it can be posted' using errcode = '23514';
  end if;

  v_payable := coalesce(b.payable_account_id, app.finance_account_by_code(b.organization_id, '2000', 'accounts payable'));
  perform app.finance_require_account_type(v_payable, array['liability'], 'payable account');
  select c.name into v_vendor from public.finance_contact c where c.id = b.vendor_id;

  select jsonb_agg(x order by ord) into v_lines from (
    select l.line_no as ord, jsonb_build_object('account_id', l.account_id, 'fund_id', b.fund_id,
      'program_id', l.program_id, 'description', coalesce(l.description, v_vendor),
      'debit_cents', l.amount_cents) as x
    from public.finance_bill_line l where l.bill_id = b.id
    union all
    select 1001, jsonb_build_object('account_id', app.finance_account_by_code(b.organization_id, '1200', 'GST paid'),
      'fund_id', b.fund_id, 'description', 'GST', 'debit_cents', b.gst_cents)
    where b.gst_cents > 0
    union all
    select 1002, jsonb_build_object('account_id', app.finance_account_by_code(b.organization_id, '1210', 'QST paid'),
      'fund_id', b.fund_id, 'description', 'QST', 'debit_cents', b.qst_cents)
    where b.qst_cents > 0
    union all
    select 1003, jsonb_build_object('account_id', v_payable, 'fund_id', b.fund_id,
      'description', v_vendor, 'credit_cents', b.total_cents)
  ) s;

  v_entry := app.finance_post_journal(b.organization_id, b.bill_date,
    'Bill: ' || v_vendor || coalesce(' #' || b.vendor_reference, ''), 'finance_bill', b.id, v_lines);

  update public.finance_bill set status = 'posted', payable_account_id = v_payable,
    journal_entry_id = v_entry, posted_by = auth.uid(), posted_at = now()
  where id = b.id;
  perform app.record_material_audit(b.organization_id, 'finance', 'bill_posted', 'finance_bill', b.id,
    jsonb_build_object('journal_entry_id', v_entry, 'total_cents', b.total_cents));
  return v_entry;
end;
$$;
revoke all on function public.finance_post_bill(uuid) from public, anon;
grant execute on function public.finance_post_bill(uuid) to authenticated, service_role;

-- Posts a draft invoice on its invoice date and gives it the next number:
-- the total debits the receivable account (1100 unless the invoice names
-- another asset account, e.g. 1150 for grants), each line credits its
-- account, GST and QST credit the tax payable accounts (2200, 2210).
create or replace function public.finance_post_invoice(p_invoice uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.finance_invoice;
  v_customer text;
  v_receivable uuid;
  v_number integer;
  v_lines jsonb;
  v_entry uuid;
begin
  select * into i from public.finance_invoice where id = p_invoice for update;
  if not found or not app.is_org_admin(i.organization_id) then
    raise exception 'Only an administrator with MFA posts invoices' using errcode = '42501';
  end if;
  if i.status <> 'draft' then
    raise exception 'This invoice is already posted' using errcode = '42501';
  end if;
  if i.fund_id is null then
    raise exception 'Choose the fund this invoice belongs to' using errcode = '23514';
  end if;
  if not exists (select 1 from public.finance_invoice_line l where l.invoice_id = i.id) or i.total_cents <= 0 then
    raise exception 'An invoice needs at least one line with an amount' using errcode = '23514';
  end if;
  if exists (select 1 from public.finance_invoice_line l where l.invoice_id = i.id and l.account_id is null) then
    raise exception 'Choose an account for every line' using errcode = '23514';
  end if;

  v_receivable := coalesce(i.receivable_account_id,
    app.finance_account_by_code(i.organization_id, '1100', 'accounts receivable'));
  perform app.finance_require_account_type(v_receivable, array['asset'], 'receivable account');
  select c.name into v_customer from public.finance_contact c where c.id = i.customer_id;

  perform app.finance_ensure_settings(i.organization_id);
  update public.finance_billing_settings set last_invoice_number = last_invoice_number + 1, updated_at = now()
  where organization_id = i.organization_id
  returning last_invoice_number into v_number;

  select jsonb_agg(x order by ord) into v_lines from (
    select 0 as ord, jsonb_build_object('account_id', v_receivable, 'fund_id', i.fund_id,
      'description', v_customer, 'debit_cents', i.total_cents) as x
    union all
    select l.line_no, jsonb_build_object('account_id', l.account_id, 'fund_id', i.fund_id,
      'program_id', l.program_id, 'description', l.description, 'credit_cents', l.amount_cents)
    from public.finance_invoice_line l where l.invoice_id = i.id
    union all
    select 1001, jsonb_build_object('account_id', app.finance_account_by_code(i.organization_id, '2200', 'GST collected'),
      'fund_id', i.fund_id, 'description', 'GST', 'credit_cents', i.gst_cents)
    where i.gst_cents > 0
    union all
    select 1002, jsonb_build_object('account_id', app.finance_account_by_code(i.organization_id, '2210', 'QST collected'),
      'fund_id', i.fund_id, 'description', 'QST', 'credit_cents', i.qst_cents)
    where i.qst_cents > 0
  ) s;

  v_entry := app.finance_post_journal(i.organization_id, i.invoice_date,
    'Invoice ' || v_number || ': ' || v_customer, 'finance_invoice', i.id, v_lines);

  update public.finance_invoice set status = 'posted', invoice_number = v_number,
    receivable_account_id = v_receivable, journal_entry_id = v_entry,
    posted_by = auth.uid(), posted_at = now()
  where id = i.id;
  perform app.record_material_audit(i.organization_id, 'finance', 'invoice_posted', 'finance_invoice', i.id,
    jsonb_build_object('journal_entry_id', v_entry, 'invoice_number', v_number, 'total_cents', i.total_cents));
  return v_entry;
end;
$$;
revoke all on function public.finance_post_invoice(uuid) from public, anon;
grant execute on function public.finance_post_invoice(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Payments (admins with MFA)
-- ---------------------------------------------------------------------------

-- Recomputes what has been paid on a document from its live payments and
-- sets its status. The check constraint refuses anything above the total.
create or replace function app.finance_refresh_paid(p_kind text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind = 'bill' then
    update public.finance_bill b set
      paid_cents = x.paid,
      status = case when x.paid = b.total_cents then 'paid' else 'posted' end
    from (select coalesce(sum(p.amount_cents), 0)::bigint as paid from public.finance_payment p
          where p.bill_id = p_id and p.reversed_on is null) x
    where b.id = p_id;
  else
    update public.finance_invoice i set
      paid_cents = x.paid,
      status = case when x.paid = i.total_cents then 'paid' else 'posted' end
    from (select coalesce(sum(p.amount_cents), 0)::bigint as paid from public.finance_payment p
          where p.invoice_id = p_id and p.reversed_on is null) x
    where i.id = p_id;
  end if;
end;
$$;
revoke all on function app.finance_refresh_paid(text, uuid) from public, anon, authenticated;

-- Records a payment against a posted bill (p_kind 'bill': debit payable,
-- credit bank) or a posted invoice (p_kind 'invoice': debit bank, credit
-- receivable). The document row is locked, so two payments at the same
-- moment are taken one after the other and the second sees the first.
create or replace function public.finance_record_payment(
  p_kind text, p_document uuid, p_paid_on date, p_amount_cents bigint,
  p_bank_account uuid, p_method text, p_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_status text;
  v_total bigint;
  v_paid bigint;
  v_doc_date date;
  v_fund uuid;
  v_control uuid;
  v_label text;
  v_payment uuid := gen_random_uuid();
  v_entry uuid;
begin
  if p_kind = 'bill' then
    select b.organization_id, b.status, b.total_cents, b.paid_cents, b.bill_date, b.fund_id, b.payable_account_id,
      'Payment to ' || c.name || coalesce(' for #' || b.vendor_reference, '')
      into v_org, v_status, v_total, v_paid, v_doc_date, v_fund, v_control, v_label
    from public.finance_bill b join public.finance_contact c on c.id = b.vendor_id
    where b.id = p_document for update of b;
  elsif p_kind = 'invoice' then
    select i.organization_id, i.status, i.total_cents, i.paid_cents, i.invoice_date, i.fund_id, i.receivable_account_id,
      'Payment from ' || c.name || ' for invoice ' || coalesce(i.invoice_number::text, '')
      into v_org, v_status, v_total, v_paid, v_doc_date, v_fund, v_control, v_label
    from public.finance_invoice i join public.finance_contact c on c.id = i.customer_id
    where i.id = p_document for update of i;
  else
    raise exception 'Kind must be bill or invoice' using errcode = '22023';
  end if;

  if v_org is null or not app.is_org_admin(v_org) then
    raise exception 'Only an administrator with MFA records payments' using errcode = '42501';
  end if;
  if v_status = 'paid' then
    raise exception 'This % is already paid in full', p_kind using errcode = '23514';
  end if;
  if v_status <> 'posted' then
    raise exception 'Only a posted % can be paid', p_kind using errcode = '23514';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Enter an amount above zero' using errcode = '22023';
  end if;
  if p_amount_cents > v_total - v_paid then
    raise exception 'The payment is more than the % still owing (% cents)', p_kind, v_total - v_paid
      using errcode = '23514';
  end if;
  if p_paid_on is null or p_paid_on < v_doc_date then
    raise exception 'A payment is dated on or after the % date', p_kind using errcode = '22023';
  end if;
  if p_method is null or p_method not in ('cheque', 'eft', 'card', 'cash', 'other') then
    raise exception 'Choose how it was paid' using errcode = '22023';
  end if;
  if not exists (select 1 from public.ledger_account a where a.id = p_bank_account and a.organization_id = v_org) then
    raise exception 'Choose the bank account' using errcode = '23514';
  end if;
  perform app.finance_require_account_type(p_bank_account, array['asset'], 'bank account');

  v_entry := app.finance_post_journal(v_org, p_paid_on,
    v_label || coalesce(' (' || nullif(btrim(p_reference), '') || ')', ''), 'finance_payment', v_payment,
    case when p_kind = 'bill' then jsonb_build_array(
      jsonb_build_object('account_id', v_control, 'fund_id', v_fund, 'description', v_label, 'debit_cents', p_amount_cents),
      jsonb_build_object('account_id', p_bank_account, 'fund_id', v_fund, 'description', v_label, 'credit_cents', p_amount_cents))
    else jsonb_build_array(
      jsonb_build_object('account_id', p_bank_account, 'fund_id', v_fund, 'description', v_label, 'debit_cents', p_amount_cents),
      jsonb_build_object('account_id', v_control, 'fund_id', v_fund, 'description', v_label, 'credit_cents', p_amount_cents))
    end);

  insert into public.finance_payment (id, organization_id, bill_id, invoice_id, paid_on, amount_cents,
    bank_account_id, method, reference, journal_entry_id, created_by)
  values (v_payment, v_org,
    case when p_kind = 'bill' then p_document end,
    case when p_kind = 'invoice' then p_document end,
    p_paid_on, p_amount_cents, p_bank_account, p_method, nullif(btrim(p_reference), ''), v_entry, auth.uid());

  perform app.finance_refresh_paid(p_kind, p_document);
  perform app.record_material_audit(v_org, 'finance', p_kind || '_payment_recorded', 'finance_payment', v_payment,
    jsonb_build_object('document_id', p_document, 'amount_cents', p_amount_cents, 'journal_entry_id', v_entry));
  return v_payment;
end;
$$;
revoke all on function public.finance_record_payment(text, uuid, date, bigint, uuid, text, text) from public, anon;
grant execute on function public.finance_record_payment(text, uuid, date, bigint, uuid, text, text) to authenticated, service_role;

-- Reverses a payment recorded by mistake (or a bounced cheque) on p_date.
create or replace function public.finance_reverse_payment(p_payment uuid, p_date date, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.finance_payment;
  v_kind text;
  v_reversal uuid;
begin
  select * into p from public.finance_payment where id = p_payment;
  if not found or not app.is_org_admin(p.organization_id) then
    raise exception 'Only an administrator with MFA reverses payments' using errcode = '42501';
  end if;
  v_kind := case when p.bill_id is not null then 'bill' else 'invoice' end;
  -- Lock the document first, as recording a payment does, then the payment.
  if v_kind = 'bill' then
    perform 1 from public.finance_bill where id = p.bill_id for update;
  else
    perform 1 from public.finance_invoice where id = p.invoice_id for update;
  end if;
  select * into p from public.finance_payment where id = p_payment for update;
  if p.reversed_on is not null then
    raise exception 'This payment has already been reversed' using errcode = '23505';
  end if;
  if p_date is null or p_date < p.paid_on then
    raise exception 'A reversal is dated on or after the payment' using errcode = '22023';
  end if;
  v_reversal := public.ledger_reverse_entry(p.journal_entry_id, p_date,
    left('Payment reversed' || coalesce(': ' || nullif(btrim(p_reason), ''), ''), 500));
  update public.finance_payment set reversed_on = p_date, reversal_entry_id = v_reversal where id = p.id;
  perform app.finance_refresh_paid(v_kind, coalesce(p.bill_id, p.invoice_id));
  perform app.record_material_audit(p.organization_id, 'finance', v_kind || '_payment_reversed',
    'finance_payment', p.id, jsonb_build_object('reversal_entry_id', v_reversal, 'reason', p_reason));
  return v_reversal;
end;
$$;
revoke all on function public.finance_reverse_payment(uuid, date, text) from public, anon;
grant execute on function public.finance_reverse_payment(uuid, date, text) to authenticated, service_role;

-- Voids a posted bill or invoice with no live payments by posting the
-- reversal of its entry on p_date. The document stays on file as void.
create or replace function public.finance_void_document(p_kind text, p_id uuid, p_date date, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_status text;
  v_paid bigint;
  v_date date;
  v_entry uuid;
  v_reversal uuid;
begin
  if p_kind = 'bill' then
    select organization_id, status, paid_cents, bill_date, journal_entry_id
      into v_org, v_status, v_paid, v_date, v_entry
    from public.finance_bill where id = p_id for update;
  elsif p_kind = 'invoice' then
    select organization_id, status, paid_cents, invoice_date, journal_entry_id
      into v_org, v_status, v_paid, v_date, v_entry
    from public.finance_invoice where id = p_id for update;
  else
    raise exception 'Kind must be bill or invoice' using errcode = '22023';
  end if;
  if v_org is null or not app.is_org_admin(v_org) then
    raise exception 'Only an administrator with MFA voids bills and invoices' using errcode = '42501';
  end if;
  if v_status = 'draft' then
    raise exception 'A draft is deleted, not voided' using errcode = '22023';
  end if;
  if v_status = 'void' then
    raise exception 'This % is already void', p_kind using errcode = '23505';
  end if;
  if v_paid > 0 then
    raise exception 'Reverse the payments on this % before voiding it', p_kind using errcode = '23514';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why it is being voided' using errcode = '22023';
  end if;
  if p_date is null or p_date < v_date then
    raise exception 'A void is dated on or after the % date', p_kind using errcode = '22023';
  end if;
  v_reversal := public.ledger_reverse_entry(v_entry, p_date, left('Void: ' || btrim(p_reason), 500));
  if p_kind = 'bill' then
    update public.finance_bill set status = 'void', void_entry_id = v_reversal, voided_on = p_date where id = p_id;
  else
    update public.finance_invoice set status = 'void', void_entry_id = v_reversal, voided_on = p_date where id = p_id;
  end if;
  perform app.record_material_audit(v_org, 'finance', p_kind || '_voided', 'finance_' || p_kind, p_id,
    jsonb_build_object('reversal_entry_id', v_reversal, 'reason', btrim(p_reason)));
  return v_reversal;
end;
$$;
revoke all on function public.finance_void_document(text, uuid, date, text) from public, anon;
grant execute on function public.finance_void_document(text, uuid, date, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Aging. Security invoker: row-level security decides what is seen.
-- ---------------------------------------------------------------------------

-- Every bill (p_kind 'bill') or invoice ('invoice') open on p_as_of with what
-- was still owing that day, days past due and its bucket: current (not yet
-- due), 1-30, 31-60, 61-90 or 90+ days past due. Built from the same dates the
-- journal entries carry (document date, payment date, reversal and void
-- dates), so its total equals the ledger balance of the control accounts.
create or replace function public.finance_aging(p_organization uuid, p_kind text, p_as_of date)
returns table (
  document_id uuid,
  contact_id uuid,
  contact_name text,
  reference text,
  document_date date,
  due_date date,
  control_account_id uuid,
  total_cents bigint,
  open_cents bigint,
  days_past_due integer,
  bucket text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with docs as (
    select b.id, b.vendor_id as contact_id, b.vendor_reference as reference, b.bill_date as document_date,
      b.due_date, b.payable_account_id as control_account_id, b.total_cents, b.voided_on
    from public.finance_bill b
    where p_kind = 'bill' and b.organization_id = p_organization and b.status <> 'draft'
    union all
    select i.id, i.customer_id, i.invoice_number::text, i.invoice_date, i.due_date,
      i.receivable_account_id, i.total_cents, i.voided_on
    from public.finance_invoice i
    where p_kind = 'invoice' and i.organization_id = p_organization and i.status <> 'draft'
  ),
  open_docs as (
    select d.*, (d.total_cents - coalesce((
      select sum(p.amount_cents) from public.finance_payment p
      where (p.bill_id = d.id or p.invoice_id = d.id)
        and p.paid_on <= p_as_of
        and (p.reversed_on is null or p.reversed_on > p_as_of)
    ), 0))::bigint as open_cents
    from docs d
    where d.document_date <= p_as_of and (d.voided_on is null or d.voided_on > p_as_of)
  )
  select o.id, o.contact_id, c.name, o.reference, o.document_date, o.due_date, o.control_account_id,
    o.total_cents, o.open_cents, greatest(p_as_of - o.due_date, 0),
    case
      when p_as_of <= o.due_date then 'current'
      when p_as_of - o.due_date <= 30 then '1-30'
      when p_as_of - o.due_date <= 60 then '31-60'
      when p_as_of - o.due_date <= 90 then '61-90'
      else '90+'
    end
  from open_docs o
  join public.finance_contact c on c.id = o.contact_id
  where o.open_cents <> 0
  order by c.name, o.due_date, o.document_date;
$$;
revoke all on function public.finance_aging(uuid, text, date) from public, anon;
grant execute on function public.finance_aging(uuid, text, date) to authenticated, service_role;
