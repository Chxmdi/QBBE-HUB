-- QBBE Hub — rate limiting (W9).
--
-- Counters live in Postgres rather than in memory, because the application
-- runs as serverless functions: an in-process counter would reset on every
-- cold start and would not be shared between concurrent instances, which makes
-- it worse than no limit at all — it would look like protection without being
-- any.
--
-- Fixed windows, not a sliding log. A window boundary lets a determined caller
-- send up to 2x the limit across a boundary; that is an accepted trade for one
-- row per bucket per window instead of one row per request.
--
-- This protects the Hub's own write paths. Authentication is not covered here:
-- sign-in and sign-up go from the browser straight to Supabase Auth, which
-- applies its own limits, and interposing the app would only move the target.

create table rate_limit_counter (
  bucket text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (bucket, window_start)
);

comment on table rate_limit_counter is
  'Fixed-window request counters. Written only by the service role; trimmed by purge-job-history.';

create index idx_rate_limit_window on rate_limit_counter (window_start);

-- No policy grants any access: RLS is on and deny-by-default, so only the
-- service role (which bypasses it) can read or write these rows.
alter table rate_limit_counter enable row level security;

/**
 * Records one hit and reports whether it is allowed.
 *
 * The insert-or-increment is a single statement, so two concurrent callers
 * cannot both read `count = limit - 1` and both proceed.
 */
create or replace function app.rate_limit_hit(
  p_bucket text,
  p_limit int,
  p_window_seconds int
)
returns table (allowed boolean, used int, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_count int;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'rate limit and window must both be positive';
  end if;

  -- Truncate now() to the start of its window.
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into rate_limit_counter (bucket, window_start, count)
  values (p_bucket, v_window_start, 1)
  on conflict (bucket, window_start)
    do update set count = rate_limit_counter.count + 1
  returning rate_limit_counter.count into v_count;

  return query select
    v_count <= p_limit,
    v_count,
    v_window_start + make_interval(secs => p_window_seconds);
end;
$$;

revoke all on function app.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function app.rate_limit_hit(text, int, int) to service_role;

-- Exposed under a public name because PostgREST only routes the exposed
-- schemas; execute is still service-role only.
create or replace function public.rate_limit_hit(
  p_bucket text,
  p_limit int,
  p_window_seconds int
)
returns table (allowed boolean, used int, reset_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select * from app.rate_limit_hit(p_bucket, p_limit, p_window_seconds);
$$;

revoke all on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;
