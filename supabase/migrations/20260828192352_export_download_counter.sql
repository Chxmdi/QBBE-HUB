-- Counting a download atomically.
--
-- The application first did this as a read followed by a write, which loses a
-- count whenever two people download at the same moment — precisely the case
-- an audit trail exists for. One statement fixes it.
--
-- SECURITY INVOKER (the default) and granted only to `service_role`. The
-- download route already runs with the service role, because the exports
-- bucket has no policies and only that role can sign an object in it. So this
-- adds no new reachable surface: `authenticated` cannot call it, and does not
-- need to.
create or replace function public.count_export_download(p_export_id uuid)
returns int
language sql
set search_path = public
as $$
  update export_job
     set download_count = download_count + 1,
         downloaded_at = now()
   where id = p_export_id
  returning download_count;
$$;

revoke all on function public.count_export_download(uuid) from public;
revoke all on function public.count_export_download(uuid) from anon, authenticated;
grant execute on function public.count_export_download(uuid) to service_role;

comment on function public.count_export_download(uuid) is
  'Atomically records one download. Service role only — the download route is the sole caller.';
