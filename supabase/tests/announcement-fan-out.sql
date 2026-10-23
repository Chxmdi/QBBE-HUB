-- An announcement's readers are notified once: the fan-out marks the
-- announcement and creates its notifications in one transaction, so a run
-- that crashes neither skips it nor sends it twice, and a later run does not
-- re-open notifications people have read. The fan-out writes the
-- notifications itself, once per active member, and only once the
-- announcement is published. Run after qa-users.sql and rls.sql. Rolled
-- back.
begin;

create or replace function tests.announcement_for_fan_out(p_org uuid, p_author uuid, p_publish_at timestamptz, p_released boolean)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_channel uuid;
  v_message uuid;
begin
  select c.id into v_channel from public.channel c where c.organization_id = p_org and c.type = 'announcements' limit 1;
  if p_released then
    insert into public.message (organization_id, channel_id, author_id, body)
    values (p_org, v_channel, p_author, 'Released') returning id into v_message;
  end if;
  insert into public.announcement (organization_id, title, created_by, publish_at, body, channel_id, message_id)
  values (p_org, 'Fan-out once', p_author, p_publish_at,
          case when p_released then null else 'Waiting' end,
          case when p_released then null else v_channel end, v_message)
  returning id into v_id;
  return v_id;
end;
$$;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_org uuid;
  v_ann uuid;
  v_rows jsonb;
  v_count integer;
  v_state text;
begin
  select organization_id into strict v_org from organization_membership where user_id = v_owner limit 1;
  v_ann := tests.announcement_for_fan_out(v_org, v_admin, now() - interval '1 minute', true);
  v_rows := jsonb_build_array(
    jsonb_build_object('user_id', v_staff, 'title', 'New announcement: Fan-out once'),
    jsonb_build_object('user_id', v_volunteer, 'title', 'Nouvelle annonce'));

  perform tests.ok((select fanned_out_at from public.announcement where id = v_ann) is null,
    'announcement fan-out: a new announcement is not yet fanned out');

  -- Another member cannot fan it out.
  perform tests.authenticate(v_staff, 'aal2');
  begin
    perform public.fan_out_announcement(v_ann, v_rows);
    v_state := 'sent';
  exception when insufficient_privilege then
    v_state := 'refused';
  end;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_state = 'refused', 'announcement fan-out: only the server or the author fans out');

  -- A fan-out whose notifications fail leaves the announcement unmarked, to
  -- be tried again.
  create function pg_temp.refuse_notification() returns trigger language plpgsql as
    $f$ begin raise exception 'notification store unavailable'; end; $f$;
  create trigger fan_out_test_refuse before insert on public.notification
    for each row execute function pg_temp.refuse_notification();
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  begin
    perform public.fan_out_announcement(v_ann, v_rows);
    v_state := 'sent';
  exception when others then
    v_state := sqlstate;
  end;
  drop trigger fan_out_test_refuse on public.notification;
  perform tests.ok(v_state <> 'sent' and (select fanned_out_at from public.announcement where id = v_ann) is null,
    format('announcement fan-out: a failed fan-out leaves no marker (got %s)', v_state));

  -- The rows name people and words only: duplicates, people outside the
  -- organization and anything else in a row are not sent as given.
  select public.fan_out_announcement(v_ann, v_rows
    || jsonb_build_array(
         jsonb_build_object('user_id', v_staff, 'title', 'Again', 'dedupe_key', 'spam-1'),
         jsonb_build_object('user_id', gen_random_uuid(), 'title', 'Outsider'),
         jsonb_build_object('user_id', v_volunteer, 'title', 'Spam', 'link', 'https://example.com',
                            'project_id', gen_random_uuid(), 'category', 'security'))) into v_count;
  perform tests.ok(v_count = 2
      and (select count(*) from public.notification where source_id = v_ann) = 2
      and not exists (select 1 from public.notification where source_id = v_ann
                      and (link <> '/announcements#' || v_ann or project_id is not null or category <> 'announcement'
                           or dedupe_key <> 'announcement:' || v_ann || ':' || user_id))
      and (select fanned_out_at from public.announcement where id = v_ann) is not null,
    format('announcement fan-out: one notification per member, written by the function, and the announcement marked (got %s)', v_count));

  -- Read, then a second run: nothing is sent again or re-opened.
  update public.notification set read_at = now() where source_id = v_ann;
  select public.fan_out_announcement(v_ann, v_rows) into v_count;
  perform tests.ok(v_count is null
      and not exists (select 1 from public.notification where source_id = v_ann and read_at is null)
      and (select count(*) from public.notification where source_id = v_ann) = 2,
    'announcement fan-out: a second fan-out sends nothing and re-opens nothing');
  perform set_config('request.jwt.claims', '', true);

  -- Not before it is published: not while its message waits, not before its time.
  v_ann := tests.announcement_for_fan_out(v_org, v_admin, now() + interval '3 days', false);
  perform tests.authenticate(v_admin, 'aal2');
  begin
    perform public.fan_out_announcement(v_ann, '[]'::jsonb);
    v_state := 'sent';
  exception when invalid_parameter_value then
    v_state := 'refused';
  end;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_state = 'refused' and (select fanned_out_at from public.announcement where id = v_ann) is null,
    'announcement fan-out: a scheduled announcement cannot be fanned out (or silenced) before it is published');

  -- An author who is no longer an administrator cannot fan out.
  v_ann := tests.announcement_for_fan_out(v_org, v_admin, now() - interval '1 minute', true);
  update public.organization_membership set status = 'deactivated' where user_id = v_admin and organization_id = v_org;
  perform tests.authenticate(v_admin, 'aal2');
  begin
    perform public.fan_out_announcement(v_ann, v_rows);
    v_state := 'sent';
  exception when insufficient_privilege then
    v_state := 'refused';
  end;
  perform tests.clear_auth();
  reset role;
  perform tests.ok(v_state = 'refused', 'announcement fan-out: a deactivated author cannot fan out');

  perform tests.ok(
    has_function_privilege('service_role', 'public.fan_out_announcement(uuid, jsonb)', 'execute')
      and has_function_privilege('authenticated', 'public.fan_out_announcement(uuid, jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.fan_out_announcement(uuid, jsonb)', 'execute'),
    'announcement fan-out: the job and the publishing person can fan out, nobody signed out');
end;
$$;

rollback;
