-- Requests are client-writable; execution metadata is exclusively server-owned.
revoke insert on public.export_job from public, anon, authenticated;
grant insert (organization_id, kind, requested_by, subject_user_id)
  on public.export_job to authenticated;
grant select on public.export_job to authenticated;

drop policy export_job_request on public.export_job;
create policy export_job_request on public.export_job for insert to authenticated
with check (
  requested_by = auth.uid()
  and status = 'queued' and storage_path is null
  and started_at is null and completed_at is null
  and download_count = 0 and downloaded_at is null
  and (
    (app.is_org_staff(organization_id) and kind in ('crm_contacts', 'task_history', 'report_bundle'))
    or app.is_org_admin(organization_id)
  )
  and (
    (kind <> 'person_data' and subject_user_id is null)
    or (kind = 'person_data' and exists (
      select 1 from public.organization_membership m
      where m.organization_id = export_job.organization_id
        and m.user_id = export_job.subject_user_id
    ))
  )
);

drop policy export_job_read on public.export_job;
create policy export_job_read on public.export_job for select to authenticated
using (
  app.is_org_member(organization_id)
  and (requested_by = auth.uid() or subject_user_id = auth.uid()
       or app.is_org_admin(organization_id))
);

create or replace function app.audit_export_request()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.audit_event (
    organization_id, actor_id, event_type, action, object_type, object_id, metadata
  ) values (
    new.organization_id, new.requested_by, 'data_export', 'export_requested',
    'export_job', new.id,
    jsonb_build_object('kind', new.kind, 'subject_user_id', new.subject_user_id)
  );
  return new;
end;
$$;
revoke all on function app.audit_export_request() from public, anon, authenticated;
create trigger export_request_audited after insert on public.export_job
for each row execute function app.audit_export_request();
