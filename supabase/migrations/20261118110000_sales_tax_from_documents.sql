-- GST and QST on posted bills and invoices reach the tax return.
--
-- The sales tax design said bills and invoices write their own tax lines; they
-- never did. Posting a bill debited 1200/1210 and posting an invoice credited
-- 2200/2210, but the worksheet and the period close read only tax lines, so a
-- return under-reported tax collected, missed input tax credits, and closing a
-- period left those accounts uncleared. Invoice tax was also typed by hand and
-- never checked, even while the organization was not registered.
--
-- Now, whoever posts:
--   * posting an invoice refuses GST or QST the organization is not
--     registered for, and more tax than the rate gives on the amount before
--     tax (QST on the amount before GST), with a cent of rounding. Less is
--     allowed: some or all of the invoice may be exempt or out of scope;
--   * posting writes one sales_tax_line per document (source finance_invoice
--     or finance_bill): a sale with the tax collected, or a purchase with the
--     tax paid and the claimable share, as receipts are imported. A document
--     dated in a closed tax period is reported in the next return that is
--     still open, never in a filed one;
--   * a bill whose receipt was already imported takes that line over, so the
--     purchase is counted once and follows the bill;
--   * voiding a document removes its line while its tax period is open. Once
--     the return is closed the line stays with it, and the void's ledger
--     reversal is not on any return: correcting a filed return is the
--     accountant's call;
--   * importing receipts skips a receipt attached to a bill (even a void
--     one), so it is not counted twice.
-- Documents posted before this migration have no lines; whether to add them
-- is the accountant's decision.
-- finance_tax_registration gives staff the registration numbers and rates an
-- invoice prints and the form uses.

-- The day a document's tax is reported: its own date, or the first day after
-- the closed tax periods that cover it.
create or replace function app.sales_tax_reporting_date(p_organization uuid, p_date date)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_date date := p_date;
  v_end date;
begin
  loop
    select p.ends_on into v_end from public.sales_tax_period p
    where p.organization_id = p_organization and p.status = 'closed'
      and v_date between p.starts_on and p.ends_on;
    exit when v_end is null;
    v_date := v_end + 1;
    v_end := null;
  end loop;
  return v_date;
end;
$$;
revoke all on function app.sales_tax_reporting_date(uuid, date) from public, anon, authenticated;

create or replace function app.sales_tax_cents_text(p_cents bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p_cents / 100.0, 'FM999999999990.00');
$$;
revoke all on function app.sales_tax_cents_text(bigint) from public, anon, authenticated;

-- Before an invoice is posted: its tax must be one the organization collects,
-- at the rate.
create or replace function app.sales_tax_check_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.sales_tax_settings;
  v_expected bigint;
begin
  if new.gst_cents = 0 and new.qst_cents = 0 then
    return new;
  end if;
  select * into v_settings from public.sales_tax_settings where organization_id = new.organization_id;
  if new.gst_cents > 0 and not coalesce(v_settings.gst_registered, false) then
    raise exception 'This organization is not registered for GST; remove the GST or record the registration under GST and QST'
      using errcode = '23514', hint = 'invoice_tax:gstNotRegistered';
  end if;
  if new.qst_cents > 0 and not coalesce(v_settings.qst_registered, false) then
    raise exception 'This organization is not registered for QST; remove the QST or record the registration under GST and QST'
      using errcode = '23514', hint = 'invoice_tax:qstNotRegistered';
  end if;
  if new.gst_cents > 0 then
    v_expected := app.sales_tax_amount(new.subtotal_cents, app.sales_tax_rate_on('gst', new.invoice_date));
    if new.gst_cents > v_expected + 1 then
      raise exception 'GST on this invoice can be at most % (on % before tax)',
        app.sales_tax_cents_text(v_expected), app.sales_tax_cents_text(new.subtotal_cents)
        using errcode = '23514', hint = 'invoice_tax:gstMismatch:' || v_expected;
    end if;
  end if;
  if new.qst_cents > 0 then
    v_expected := app.sales_tax_amount(new.subtotal_cents, app.sales_tax_rate_on('qst', new.invoice_date));
    if new.qst_cents > v_expected + 1 then
      raise exception 'QST on this invoice can be at most % (on % before tax)',
        app.sales_tax_cents_text(v_expected), app.sales_tax_cents_text(new.subtotal_cents)
        using errcode = '23514', hint = 'invoice_tax:qstMismatch:' || v_expected;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app.sales_tax_check_invoice() from public, anon, authenticated;
create trigger finance_invoice_tax_check
before update of status on public.finance_invoice
for each row when (old.status = 'draft' and new.status = 'posted')
execute function app.sales_tax_check_invoice();

-- After a bill or invoice is posted or voided: its tax line follows.
create or replace function app.sales_tax_document_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := tg_table_name; -- finance_bill or finance_invoice
  v_settings public.sales_tax_settings;
  v_counterparty text;
  v_reference text;
  v_date date;
  v_doc_date date;
  v_contact uuid;
  v_amount bigint;
  v_rate numeric;
  v_receipt_line uuid;
begin
  if new.status = 'void' and old.status <> 'void' then
    delete from public.sales_tax_line l
    where l.organization_id = new.organization_id and l.source_type = v_kind and l.source_id = new.id
      and not exists (select 1 from public.sales_tax_period p
                      where p.organization_id = l.organization_id and p.status = 'closed'
                        and l.transaction_date between p.starts_on and p.ends_on);
    return null;
  end if;

  if not (old.status = 'draft' and new.status = 'posted') or (new.gst_cents = 0 and new.qst_cents = 0) then
    return null;
  end if;

  if v_kind = 'finance_bill' then
    v_doc_date := new.bill_date;
    v_contact := new.vendor_id;
    v_reference := left(new.vendor_reference, 100);
  else
    v_doc_date := new.invoice_date;
    v_contact := new.customer_id;
    v_reference := 'INV-' || lpad(new.invoice_number::text, 4, '0');
  end if;

  perform app.sales_tax_seed_organization(new.organization_id);
  select * into v_settings from public.sales_tax_settings where organization_id = new.organization_id;
  select left(btrim(c.name), 200) into v_counterparty from public.finance_contact c where c.id = v_contact;
  v_date := app.sales_tax_reporting_date(new.organization_id, v_doc_date);

  -- The amount taxed. A sale taxed below the full rate is partly exempt or
  -- out of scope; the taxed part is what the tax implies.
  v_amount := new.subtotal_cents;
  if v_kind = 'finance_invoice' then
    if new.gst_cents > 0 then
      v_rate := app.sales_tax_rate_on('gst', v_doc_date);
      if new.gst_cents + 1 < app.sales_tax_amount(new.subtotal_cents, v_rate) then
        v_amount := least(new.subtotal_cents, round(new.gst_cents * 100 / v_rate)::bigint);
      end if;
    else
      v_rate := app.sales_tax_rate_on('qst', v_doc_date);
      if new.qst_cents + 1 < app.sales_tax_amount(new.subtotal_cents, v_rate) then
        v_amount := least(new.subtotal_cents, round(new.qst_cents * 100 / v_rate)::bigint);
      end if;
    end if;
  end if;

  -- A receipt imported before it was attached to this bill: the bill takes
  -- its line over, so the purchase is counted once and a void of the bill
  -- removes it. A receipt line already on a filed return stays as it is.
  -- (Nested: an invoice row has no receipt_id to read.)
  if v_kind = 'finance_bill' then
    select l.id into v_receipt_line from public.sales_tax_line l
    where l.organization_id = new.organization_id and l.source_type = 'finance_receipt'
      and l.source_id = (to_jsonb(new)->>'receipt_id')::uuid;
    if v_receipt_line is not null then
      if exists (select 1 from public.sales_tax_period p
                 join public.sales_tax_line l on l.id = v_receipt_line
                 where p.organization_id = new.organization_id and p.status = 'closed'
                   and l.transaction_date between p.starts_on and p.ends_on) then
        return null;
      end if;
      delete from public.sales_tax_line where id = v_receipt_line;
    end if;
  end if;

  insert into public.sales_tax_line (organization_id, direction, tax_code, transaction_date,
    counterparty, reference, description, amount_cents, gst_cents, qst_cents, itc_cents, itr_cents,
    source_type, source_id, created_by)
  values (new.organization_id,
    case when v_kind = 'finance_bill' then 'purchase' else 'sale' end,
    'standard', v_date, coalesce(v_counterparty, '—'), v_reference,
    left(concat_ws(' ', nullif(new.memo, ''),
      case when v_date <> v_doc_date then '(dated ' || v_doc_date || ')' end), 500),
    v_amount, new.gst_cents, new.qst_cents,
    case when v_kind = 'finance_bill' and v_settings.gst_registered
      then round(new.gst_cents::numeric * v_settings.itc_claim_bp / 10000)::bigint else 0 end,
    case when v_kind = 'finance_bill' and v_settings.qst_registered
      then round(new.qst_cents::numeric * v_settings.itc_claim_bp / 10000)::bigint else 0 end,
    v_kind, new.id, auth.uid())
  on conflict (organization_id, source_type, source_id) where source_type is not null do nothing;
  return null;
end;
$$;
revoke all on function app.sales_tax_document_line() from public, anon, authenticated;
create trigger finance_bill_tax_line
after update of status on public.finance_bill
for each row when (old.status is distinct from new.status)
execute function app.sales_tax_document_line();
create trigger finance_invoice_tax_line
after update of status on public.finance_invoice
for each row when (old.status is distinct from new.status)
execute function app.sales_tax_document_line();

create or replace function public.sales_tax_import_receipts(p_organization uuid, p_from date, p_to date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.sales_tax_settings;
  v_count integer;
begin
  if not app.is_org_admin(p_organization) then
    raise exception 'Only an administrator with MFA keeps the tax records' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a date range' using errcode = '22023';
  end if;
  perform app.sales_tax_seed_organization(p_organization);
  select * into v_settings from public.sales_tax_settings where organization_id = p_organization;

  insert into public.sales_tax_line (organization_id, direction, tax_code, transaction_date,
    counterparty, description, amount_cents, gst_cents, qst_cents, itc_cents, itr_cents,
    source_type, source_id, created_by)
  select r.organization_id, 'purchase', 'standard', r.document_date, r.vendor,
    left(r.note, 500), r.total_cents - r.gst_cents - r.qst_cents, r.gst_cents, r.qst_cents,
    case when v_settings.gst_registered then round(r.gst_cents::numeric * v_settings.itc_claim_bp / 10000)::bigint else 0 end,
    case when v_settings.qst_registered then round(r.qst_cents::numeric * v_settings.itc_claim_bp / 10000)::bigint else 0 end,
    'finance_receipt', r.id, auth.uid()
  from public.finance_receipt r
  where r.organization_id = p_organization
    and r.status = 'reviewed'
    and r.document_date between p_from and p_to
    and (r.gst_cents > 0 or r.qst_cents > 0)
    -- A receipt attached to a bill is counted through the bill, which writes
    -- its own line when it is posted (and removes it when voided).
    and not exists (select 1 from public.finance_bill b where b.receipt_id = r.id)
    -- Receipts in a closed tax period stay out; the line trigger would refuse them.
    and not exists (select 1 from public.sales_tax_period p
                    where p.organization_id = p_organization and p.status = 'closed'
                      and r.document_date between p.starts_on and p.ends_on)
  on conflict (organization_id, source_type, source_id) where source_type is not null do nothing;
  get diagnostics v_count = row_count;

  perform app.record_material_audit(p_organization, 'sales_tax', 'receipts_imported',
    'organization', p_organization, jsonb_build_object('from', p_from, 'to', p_to, 'imported', v_count));
  return v_count;
end;
$$;
revoke all on function public.sales_tax_import_receipts(uuid, date, date) from public, anon;
grant execute on function public.sales_tax_import_receipts(uuid, date, date) to authenticated, service_role;

-- Registration numbers and rates for an invoice: printed on the invoice sheet
-- and used by the form to work the tax out. Any staff member of the
-- organization may read them; they are printed on every invoice anyway.
create or replace function public.finance_tax_registration(p_organization uuid, p_date date)
returns table (
  gst_registered boolean,
  gst_number text,
  qst_registered boolean,
  qst_number text,
  gst_rate numeric,
  qst_rate numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_org_staff(p_organization) then
    raise exception 'You are not on the staff of this organization' using errcode = '42501';
  end if;
  return query
  select coalesce(s.gst_registered, false), s.gst_number, coalesce(s.qst_registered, false), s.qst_number,
    app.sales_tax_rate_on('gst', coalesce(p_date, current_date)),
    app.sales_tax_rate_on('qst', coalesce(p_date, current_date))
  from (select 1) one
  left join public.sales_tax_settings s on s.organization_id = p_organization;
end;
$$;
revoke all on function public.finance_tax_registration(uuid, date) from public, anon;
grant execute on function public.finance_tax_registration(uuid, date) to authenticated, service_role;
