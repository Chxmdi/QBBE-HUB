-- P1-DASH-10: a named portfolio filter can be kept private or shared with
-- the organization. Sharing the filter does not share the rows. Anyone who
-- opens it still sees only the projects their own policies allow.

alter table public.saved_view
  add column if not exists shared boolean not null default false;

drop policy if exists saved_view_own on public.saved_view;

create policy saved_view_read on public.saved_view
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      shared
      and app.is_org_member(organization_id)
    )
  );

create policy saved_view_insert on public.saved_view
  for insert to authenticated
  with check (user_id = (select auth.uid()) and app.is_org_member(organization_id));

create policy saved_view_update on public.saved_view
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and app.is_org_member(organization_id));

create policy saved_view_delete on public.saved_view
  for delete to authenticated
  using (user_id = (select auth.uid()));
