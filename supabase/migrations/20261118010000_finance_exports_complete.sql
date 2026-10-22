-- QBBE Hub — finance figures that do not stop at 1,000 rows (DATA-003).
--
-- The problem: the API (PostgREST) returns at most 1,000 rows per request
-- (supabase/config.toml max_rows) and gives no sign that it stopped. Two
-- gift screens relied on a single request:
--   * The donor list and its CSV export read public.gift_donor_list, which
--     writes an audit record each time it is called. Past 1,000 donors the
--     list and the export were silently cut short. Reading it page by page
--     would write one audit record per page, so paging is not the answer.
--   * The gifts page summed the year's total from the first 1,000 gifts it
--     displayed, so past 1,000 gifts a year the total was understated.
--
-- The fix:
--   * gift_donor_list_all returns the whole donor list as one JSON array, in
--     the same name order and with the same figures, in a single call. It
--     calls gift_donor_list once, so it keeps that function's access check
--     (ledger readers only) and writes exactly one audit record per view or
--     export. A single JSON value is not subject to the row cap.
--   * gift_year_total counts the year's recorded gifts and sums the money
--     received (in-kind gifts excluded, as on the page) in SQL. It refuses
--     anyone who may not read the ledger, which is exactly the rule of
--     public.gift's read policy (gift_read: app.can_read_ledger), and sums only
--     that organization's gifts, so it returns what the caller could read
--     themselves. It runs with its owner's rights, like gift_donor_list,
--     because signed-in users may not look up functions in the app schema by
--     name. Totals name no donor, so it is not audited; the page's own audit
--     record of the list is unchanged.

-- ---------------------------------------------------------------------------
-- The whole donor list in one call, audited once.
-- ---------------------------------------------------------------------------
create or replace function public.gift_donor_list_all(
  p_organization uuid, p_from date, p_to date, p_purpose text default 'view'
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  -- gift_donor_list checks access, validates the purpose and dates, and
  -- writes the audit record; it is called once here.
  select coalesce(jsonb_agg(to_jsonb(d) - 'position' order by d.position), '[]'::jsonb)
  from public.gift_donor_list(p_organization, p_from, p_to, p_purpose)
    with ordinality as d(donor_kind, donor_id, donor_name, donor_email, gift_count, total_cents,
      in_kind_count, first_gift_on, last_gift_on, position);
$$;
revoke all on function public.gift_donor_list_all(uuid, date, date, text) from public, anon;
grant execute on function public.gift_donor_list_all(uuid, date, date, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The year's gift count and money received, summed in SQL.
-- ---------------------------------------------------------------------------
create or replace function public.gift_year_total(p_organization uuid, p_year integer)
returns table (gift_count bigint, total_cents bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- The same rule as public.gift's read policy.
  if not app.can_read_ledger(p_organization) then
    raise exception 'You do not have access to donor records' using errcode = '42501';
  end if;
  if p_year is null or p_year not between 2000 and 2100 then
    raise exception 'Choose a year' using errcode = '22023';
  end if;
  return query
  select count(*)::bigint,
    -- Money received; a value a donor put on an in-kind gift is not money.
    coalesce(sum(g.amount_cents) filter (where g.gift_type <> 'in_kind'), 0)::bigint
  from public.gift g
  where g.organization_id = p_organization
    and g.status = 'recorded'
    and g.received_on between make_date(p_year, 1, 1) and make_date(p_year, 12, 31);
end;
$$;
revoke all on function public.gift_year_total(uuid, integer) from public, anon;
grant execute on function public.gift_year_total(uuid, integer) to authenticated, service_role;
