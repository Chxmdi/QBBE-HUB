-- Workspace OS public pages (V1-18): only owners and admins ask, a different
-- owner or admin approves, only the approved copy of chosen fields is public,
-- private properties never are, unpublishing is immediate, and the switch
-- closes it all. Every role: owner, admin, staff, leadership viewer,
-- volunteer, guest, accountant, signed-out. Rolled back.
begin;

create function tests.pp_raises(p_sql text, p_pattern text, p_msg text)
returns void
language plpgsql
set search_path = tests, public
as $$
declare
  v_error text;
begin
  begin
    execute p_sql;
    v_error := null;
  exception when others then
    v_error := sqlerrm;
  end;
  perform tests.ok(v_error is not null and v_error ilike '%' || p_pattern || '%',
    format('%s (%s)', p_msg, coalesce(v_error, 'no error')));
end;
$$;
grant execute on function tests.pp_raises(text, text, text) to authenticated, anon;

-- S1's registry and properties may not be on this branch: stand in for the
-- columns public pages read, inside this transaction only.
do $$
begin
  if to_regclass('public.object') is null then
    create table public.object_type (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null, key text not null,
      name_en text not null, name_fr text not null, kind text not null);
    create table public.object (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null, type_id uuid not null,
      space_id uuid, parent_object_id uuid references public.object (id), title text not null default '',
      owner_id uuid, deleted_at timestamptz);
    perform app.access_attach_object_registry();
  end if;
  if to_regclass('public.property_definition') is null then
    create table public.property_definition (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null, type_id uuid not null,
      key text not null, name_en text not null, name_fr text not null, kind text not null,
      system_column text, visible_to_roles public.org_role[], archived_at timestamptz);
    create table public.property_value (
      object_id uuid not null, property_id uuid not null, organization_id uuid not null,
      value_text text, value_number numeric, value_date date, value_date_end date, value_bool boolean,
      primary key (object_id, property_id));
  end if;
end;
$$;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_viewer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9';
  v_org uuid;
  v_custom uuid;
  v_workspace uuid;
  v_owner_private uuid;
  v_type uuid;
  v_page uuid;
  v_pub uuid;
  v_page_pub uuid;
  v_copy record;
  v_rows integer;
  v_who uuid;
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;
  update public.organization_membership set role = 'leadership_viewer' where organization_id = v_org and user_id = v_viewer;
  insert into public.ledger_accountant_grant (organization_id, user_id, expires_at, granted_by)
  values (v_org, v_guest, now() + interval '1 day', v_admin);
  select id into strict v_workspace from public.space where organization_id = v_org and kind = 'workspace';
  select id into strict v_owner_private from public.space where organization_id = v_org and kind = 'private' and owner_id = v_owner;
  insert into public.space (organization_id, kind, name_en, name_fr, description)
  values (v_org, 'custom', 'Annual conference', 'Congrès annuel', 'Join us in May.') returning id into v_custom;

  -- A page with one public and one private property.
  insert into public.object_type (organization_id, key, name_en, name_fr, kind)
  values (v_org, 'pp_event_page', 'Event page', 'Page d''événement', 'custom') returning id into v_type;
  insert into public.object (organization_id, type_id, space_id, title)
  values (v_org, v_type, v_workspace, 'Gala 2026') returning id into v_page;
  insert into public.property_definition (organization_id, type_id, key, name_en, name_fr, kind, visible_to_roles)
  values (v_org, v_type, 'venue', 'Venue', 'Lieu', 'text', null),
         (v_org, v_type, 'budget', 'Budget', 'Budget', 'currency', array['owner', 'admin']::public.org_role[]);
  insert into public.property_value (object_id, property_id, organization_id, value_text, value_number)
  select v_page, d.id, v_org, case when d.key = 'venue' then 'Montréal' end, case when d.key = 'budget' then 90000 end
  from public.property_definition d where d.type_id = v_type;

  -- Switch off: nothing can be asked for.
  update public.feature_flag set enabled = false where key = 'wos_public_pages' and organization_id is null;
  perform tests.authenticate(v_owner);
  perform tests.pp_raises(format('select public.publication_request(%L, ''conference-2026'', array[''title''])', v_custom),
    'turned off', 'with the switch off, nothing can be published, even by the owner');
  reset role;
  update public.feature_flag set enabled = true where key = 'wos_public_pages' and organization_id is null;

  -- Who may ask.
  foreach v_who in array array[v_staff, v_viewer, v_volunteer, v_guest] loop
    perform tests.authenticate(v_who);
    perform tests.pp_raises(format('select public.publication_request(%L, ''conference-2026'', array[''title''])', v_custom),
      'owner or administrator', format('%s cannot ask to publish',
        case v_who when v_staff then 'staff' when v_viewer then 'a leadership viewer'
          when v_volunteer then 'a volunteer' else 'a guest or accountant' end));
    select count(*) into v_rows from public.publication;
    perform tests.ok(v_rows = 0, 'and cannot read publications');
    reset role;
  end loop;
  perform tests.authenticate(v_owner, 'aal1');
  perform tests.pp_raises(format('select public.publication_request(%L, ''conference-2026'', array[''title''])', v_custom),
    'two-step', 'an owner without two-step sign-in cannot ask to publish');
  reset role;

  -- Private things are never publishable.
  perform tests.authenticate(v_owner);
  perform tests.pp_raises(format('select public.publication_request(%L, ''my-notes'', array[''title''])', v_owner_private),
    'cannot be published', 'a private space cannot be published');
  perform tests.ok(
    not exists (select 1 from jsonb_array_elements(public.publication_candidates(v_page)) c where c ->> 'key' = 'property:budget')
      and exists (select 1 from jsonb_array_elements(public.publication_candidates(v_page)) c where c ->> 'key' = 'property:venue'),
    'a private property is never offered; a public one is');
  perform tests.pp_raises(format('select public.publication_request(%L, ''gala'', array[''title'', ''property:budget''])', v_page),
    'private properties never', 'asking to publish a private property is refused');

  -- The owner asks; the copy is not public yet.
  v_pub := public.publication_request(v_custom, 'Conference-2026', array['title', 'description']);
  v_page_pub := public.publication_request(v_page, 'gala-2026', array['title', 'property:venue']);
  perform tests.ok((select status from public.publication where id = v_pub) = 'in_review',
    'an owner asks to publish chosen fields; it waits for review');
  perform tests.ok(
    public.publication_preview(v_pub) ->> 'title_fr' = 'Congrès annuel'
      and public.publication_preview(v_pub) -> 'fields' -> 0 ->> 'value' = 'Join us in May.',
    'the review step shows exactly what would be published');
  perform tests.pp_raises(format('select public.publication_review(%L, true)', v_pub),
    'Another owner', 'nobody approves their own request');
  reset role;

  perform tests.clear_auth();
  select count(*) into v_rows from public.published_page;
  perform tests.ok(v_rows = 0, 'before approval a visitor sees nothing');
  reset role;

  -- A different admin approves: only then is the copy written.
  perform tests.authenticate(v_admin);
  perform public.publication_review(v_pub, true, 'Checked with the events team.');
  perform public.publication_review(v_page_pub, true);
  reset role;

  perform tests.clear_auth();
  select * into v_copy from public.published_page where slug = 'conference-2026';
  perform tests.ok(v_copy.title_en = 'Annual conference' and v_copy.title_fr = 'Congrès annuel'
      and jsonb_array_length(v_copy.fields) = 1,
    'after approval a signed-out visitor reads the copy: the title and the chosen field');
  perform tests.ok(
    (select fields::text from public.published_page where slug = 'gala-2026') like '%Montréal%'
      and (select fields::text from public.published_page where slug = 'gala-2026') not like '%90000%',
    'the copy of the page holds the public property and never the private one');
  perform tests.pp_raises('select count(*) from public.publication', 'permission denied',
    'a visitor cannot read the publication records');
  perform tests.pp_raises(format('insert into public.published_page (publication_id, slug, title_en, title_fr, fields) values (%L, ''x-x-x'', ''x'', ''x'', ''[]'')', gen_random_uuid()),
    'permission denied', 'a visitor cannot write a public page');
  reset role;

  -- It is a copy: changing the source does not change what is public.
  update public.space set description = 'Secret draft' where id = v_custom;
  perform tests.clear_auth();
  perform tests.ok((select fields::text from public.published_page where slug = 'conference-2026') not like '%Secret draft%',
    'editing the source does not change the published copy');
  reset role;

  perform tests.authenticate(v_staff);
  perform tests.pp_raises(format('insert into public.published_page (publication_id, slug, title_en, title_fr, fields) values (%L, ''y-y-y'', ''x'', ''x'', ''[]'')', v_pub),
    'permission denied', 'a member cannot write a public page directly');
  perform tests.pp_raises(format('select public.publication_unpublish(%L)', v_pub),
    'owner or administrator', 'staff cannot unpublish');
  perform tests.ok(v_custom in (select public.published_object_ids()) is false,
    'staff who cannot see the space do not learn it is public');
  reset role;
  perform tests.authenticate(v_owner);
  perform tests.ok(v_custom in (select public.published_object_ids()), 'members who can see it see that it is public');
  reset role;

  -- The switch closes the copies too.
  update public.feature_flag set enabled = false where key = 'wos_public_pages' and organization_id is null;
  perform tests.clear_auth();
  select count(*) into v_rows from public.published_page;
  perform tests.ok(v_rows = 0, 'with the switch off, visitors read nothing');
  reset role;
  update public.feature_flag set enabled = true where key = 'wos_public_pages' and organization_id is null;

  -- Unpublishing is immediate.
  perform tests.authenticate(v_owner);
  perform public.publication_unpublish(v_pub);
  reset role;
  perform tests.clear_auth();
  select count(*) into v_rows from public.published_page where slug = 'conference-2026';
  perform tests.ok(v_rows = 0, 'unpublishing removes the public copy at once');
  reset role;

  -- Deleting the source takes its publication and copy with it.
  delete from public.object where id = v_page;
  perform tests.ok(not exists (select 1 from public.published_page where slug = 'gala-2026')
      and not exists (select 1 from public.publication where id = v_page_pub),
    'deleting the source removes its publication and public copy');
  delete from public.space where id = v_custom;
  perform tests.ok(not exists (select 1 from public.publication where id = v_pub),
    'deleting a space removes its publications');
end;
$$;

rollback;
