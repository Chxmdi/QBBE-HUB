-- Keep archive metadata and accountable edit history in the same transaction.
create function app.normalize_program_archive()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.archived_at := case when new.status = 'archived'
    then coalesce(old.archived_at, now()) else null end;
  return new;
end;
$$;
revoke all on function app.normalize_program_archive() from public, anon, authenticated;
create trigger program_archive_metadata before update on public.program
for each row execute function app.normalize_program_archive();

create function app.audit_program_edit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (new.name, new.description, new.status, new.lead_id)
      is distinct from (old.name, old.description, old.status, old.lead_id) then
    insert into public.audit_event (organization_id, actor_id, event_type, action,
      object_type, object_id, metadata)
    values (new.organization_id, auth.uid(), 'program',
      case when new.status = 'archived' and old.status <> 'archived' then 'archived'
        when old.status = 'archived' and new.status <> 'archived' then 'restored'
        else 'updated' end,
      'program', new.id, jsonb_build_object('before', jsonb_build_object(
        'name', old.name, 'description', old.description, 'status', old.status, 'lead_id', old.lead_id),
        'after', jsonb_build_object('name', new.name, 'description', new.description,
        'status', new.status, 'lead_id', new.lead_id)));
  end if;
  return new;
end;
$$;
revoke all on function app.audit_program_edit() from public, anon, authenticated;
create trigger program_edit_audited after update on public.program
for each row execute function app.audit_program_edit();
