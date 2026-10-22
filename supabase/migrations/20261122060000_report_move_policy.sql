-- Moving a report to another project or program.
--
-- The report update policy checked the right to manage the report as
-- stored (by id), so the new project or program a member writes was not
-- checked by the policy itself; only the scope trigger
-- (app.forbid_scope_move) refused a move into a project the member does not
-- manage. The policy now also checks a changed project or program against
-- the stored row, so the rule holds even where that trigger does not run.
-- Edits that leave the scope as it is are unaffected.

create or replace function app.report_scope_move_allowed(p_report uuid, p_project uuid, p_program uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.report_instance r
    where r.id = p_report
      and (p_project is not distinct from r.project_id
           or (p_project is not null and app.has_project_capability(p_project, 'manage')))
      and (p_program is not distinct from r.program_id
           or (p_program is not null and app.has_program_capability(p_program, 'manage')))
  );
$$;

revoke all on function app.report_scope_move_allowed(uuid, uuid, uuid) from public, anon;
grant execute on function app.report_scope_move_allowed(uuid, uuid, uuid) to authenticated, service_role;

drop policy if exists report_scoped_update on public.report_instance;
create policy report_scoped_update on public.report_instance
  for update to authenticated
  using (app.can_manage_report(id))
  with check (
    app.can_manage_report(id)
    and app.report_scope_move_allowed(id, project_id, program_id)
  );
