-- Page templates create real pages (V1-13, unit U8, migration
-- 20261108030000): public.apply_page_template_v2 creates the page and its
-- editor document, places it last among its siblings, fills the variables,
-- dates the offsets from the start, writes the chosen language, and refuses
-- everything the page insert rule refuses. Run after qa-users.sql and
-- rls.sql. All mutations roll back.
--
-- Fixture people: owner a1, staff a2, volunteer a3, admin a4, guest a5; a9 is
-- made a leadership viewer inside this transaction.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_viewer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9';
  v_org uuid;
  v_meeting uuid;
  v_space uuid;
  v_draft uuid;
  v_parent uuid;
  v_private uuid;
  v_page uuid;
  v_second uuid;
  v_ok boolean;
  v_n integer;
  v_text text;
  v_vars jsonb := '{"program":"Youth program","owner":"Jane Doe","period":"Fall 2027","due":"2027-03-15","locale":"en"}';
  r record;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id in (v_staff, v_volunteer, v_admin, v_guest, v_viewer);
  update public.organization_membership set role = 'leadership_viewer'
  where organization_id = v_org and user_id = v_viewer;

  select id into strict v_meeting from public.template_v2
  where organization_id = v_org and scope = 'page' and created_by is null and name_en = 'Meeting notes';
  select id into strict v_space from public.template_v2
  where organization_id = v_org and scope = 'space' and created_by is null;
  perform tests.ok(
    (select body->'variables' from public.template_v2 where id = v_meeting) = '["program","owner","period","due"]'::jsonb,
    'page templates: the Meeting notes starter names its variables');

  -- A body may only name the four known variables, once each.
  begin
    update public.template_v2 set body = body || '{"variables":["program","budget"]}' where id = v_meeting;
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'page templates: an unknown variable is refused');

  -- A shared parent page and a staff draft page template, for the cases below.
  insert into public.page (organization_id, visibility, created_by, title)
  values (v_org, 'workspace', v_owner, 'Team space') returning id into v_parent;
  insert into public.page (organization_id, visibility, created_by, title)
  values (v_org, 'private', v_volunteer, 'Volunteer notes') returning id into v_private;
  perform tests.authenticate(v_staff);
  insert into public.template_v2 (organization_id, scope, type_key, name_en, name_fr, status, body)
  values (v_org, 'page', null, 'Draft page', 'Page brouillon', 'draft',
    '{"title":{"en":"Draft","fr":"Brouillon"},"blocks":[{"kind":"paragraph","text":{"en":"x","fr":"x"}}]}')
  returning id into v_draft;
  reset role;

  -- ---------------------------------------------------------- creating
  perform tests.authenticate(v_staff);
  v_page := public.apply_page_template_v2(v_meeting, v_parent, '', date '2027-03-01', v_vars);
  select title || '|' || visibility || '|' || position::text || '|' || parent_page_id::text || '|' || created_by::text into v_text
  from public.page where id = v_page;
  perform tests.ok(v_text = 'Meeting notes|workspace|1024|' || v_parent::text || '|' || v_staff::text,
    'page templates: staff create a page inside the chosen parent, first among its siblings, in their name');
  select version || '|' || (yjs_state is null)::text || '|' || (content->>'version') || '|' || jsonb_array_length(content->'blocks')::text into v_text
  from public.editor_document where object_id = v_page;
  perform tests.ok(v_text = '1|true|1|6', 'page templates: the editor document is version 1, content v1, no Yjs state, one block per template block');
  select content_text into v_text from public.editor_document where object_id = v_page;
  perform tests.ok(v_text = E'Program: Youth program · Led by Jane Doe · Period: Fall 2027\nAgenda\nDecisions\nNext steps\nShare the notes · Due 2027-03-02\nFollow up on the actions by 2027-03-15',
    'page templates: variables are filled and offsets dated from the start, matching renderPageBody');
  select string_agg(b.type || ':' || b.text, '|' order by b.position) into v_text
  from public.block b where b.object_id = v_page;
  perform tests.ok(v_text like 'paragraph:Program: Youth program%|heading:Agenda|heading:Decisions|heading:Next steps|checkListItem:Share the notes · Due 2027-03-02|checkListItem:%2027-03-15',
    'page templates: app.derive_blocks fills the block table in the same transaction');

  v_second := public.apply_page_template_v2(v_meeting, v_parent, '  Board meeting  ', date '2027-03-01', v_vars);
  select title || '|' || position::text into v_text from public.page where id = v_second;
  perform tests.ok(v_text = 'Board meeting|2048', 'page templates: a given title is used and the next page goes after the first');

  v_page := public.apply_page_template_v2(v_meeting, null, '', date '2027-03-01',
    '{"program":"Jeunesse","owner":"Marie","period":"Automne","due":"2027-03-15","locale":"fr-CA"}');
  select title || '|' || visibility || '|' || (parent_page_id is null)::text into v_text from public.page where id = v_page;
  perform tests.ok(v_text = 'Notes de réunion|workspace|true', 'page templates: no parent means the top of the workspace, in French when asked');
  select content_text into v_text from public.editor_document where object_id = v_page;
  perform tests.ok(v_text like 'Programme : Jeunesse · Animée par Marie · Période : Automne%Diffuser les notes · Échéance le 2027-03-02%',
    'page templates: French text, French date labels');

  -- A value is one line of plain text and is never scanned for placeholders.
  v_page := public.apply_page_template_v2(v_meeting, null, '', date '2027-03-01',
    '{"program":"A\nB","owner":"{{period}}","period":"C\\1","locale":"en"}');
  select split_part(content_text, E'\n', 1) into v_text from public.editor_document where object_id = v_page;
  perform tests.ok(v_text = 'Program: A B · Led by {{period}} · Period: C\1',
    'page templates: a value cannot add lines, placeholders or regex references');

  begin
    perform public.apply_page_template_v2(v_space, null, '', date '2027-03-01', '{}');
    v_ok := false;
  exception when feature_not_supported then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'page templates: a space template does not make a page');
  begin
    perform public.apply_page_template_v2(v_draft, null, '', date '2027-03-01', '{}');
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'page templates: a draft (even one''s own) cannot be used');
  begin
    perform public.apply_page_template_v2(v_meeting, null, '', null, '{}');
    v_ok := false;
  exception when invalid_parameter_value then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'page templates: a start date is required');
  begin
    perform public.apply_page_template_v2(v_meeting, v_private, '', date '2027-03-01', '{}');
    v_ok := false;
  exception when no_data_found then
    v_ok := true;
  end;
  perform tests.ok(v_ok, 'page templates: a parent the caller cannot see is reported missing, not written into');
  reset role;

  -- ---------------------------------------------------------- refusals
  -- Whoever may not create a workspace page by hand may not do it through a
  -- template either: the page insert rule decides.
  for r in select * from (values (v_viewer, 'a leadership viewer'), (v_volunteer, 'a volunteer'), (v_guest, 'a guest')) as t(uid, who) loop
    perform tests.authenticate(r.uid);
    begin
      perform public.apply_page_template_v2(v_meeting, null, '', date '2027-03-01', v_vars);
      v_ok := false;
    exception when insufficient_privilege then
      v_ok := true;
    end;
    reset role;
    perform tests.ok(v_ok, format('page templates: %s cannot create a workspace page from a template', r.who));
  end loop;

  perform tests.authenticate(v_owner, 'aal1');
  begin
    perform public.apply_page_template_v2(v_meeting, v_parent, '', date '2027-03-01', v_vars);
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  reset role;
  perform tests.ok(v_ok, 'page templates: an owner without two-step sign-in cannot create a workspace page');

  -- A volunteer may use a template inside their own private page.
  perform tests.authenticate(v_volunteer);
  v_page := public.apply_page_template_v2(v_meeting, v_private, 'My notes', date '2027-03-01', v_vars);
  select visibility || '|' || created_by::text into v_text from public.page where id = v_page;
  reset role;
  perform tests.ok(v_text = 'private|' || v_volunteer::text, 'page templates: a volunteer creates a private page inside their own');
  select count(*) into v_n from public.block where object_id = v_page;
  perform tests.ok(v_n = 6, 'page templates: the private page has its blocks too');

  -- Nothing is left half-made: a refusal creates neither page nor document.
  select count(*) into v_n from public.page where organization_id = v_org and created_by in (v_viewer, v_guest);
  perform tests.ok(v_n = 0, 'page templates: a refused call leaves no page behind');

  -- ---------------------------------------------------------- signed out
  perform tests.clear_auth();
  begin
    perform public.apply_page_template_v2(v_meeting, null, '', date '2027-03-01', '{}');
    v_ok := false;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  reset role;
  perform tests.ok(v_ok, 'page templates: a signed-out visitor cannot use one');
end;
$$;

rollback;
