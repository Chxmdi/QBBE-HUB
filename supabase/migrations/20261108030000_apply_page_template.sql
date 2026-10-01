-- Page templates create real pages (V1-13, wave 1 unit U8, epic #199).
--
-- Until now a page template could only be previewed: apply_template_v2 raises
-- for the page scope. public.apply_page_template_v2 fills the gap. It creates
-- one page, in the workspace or inside a chosen parent page, and writes the
-- template's blocks as the page's editor document (content version 1, editor
-- document version 1, no Yjs state yet), so app.derive_blocks fills the block
-- table in the same transaction and the page is searchable at once.
--
-- A page template may name `variables`: program, owner, period and due. The
-- person using the template types a value for each, and every `{{name}}` in
-- the template's text is replaced by it. Day offsets on a block are counted
-- from the start date and written after the text ("Share the notes · Due
-- 2027-03-02"), in the chosen language. src/features/templates-v2/template.ts
-- (renderPageBody) does the same arithmetic for the preview; the unit test
-- there and supabase/tests/apply-page-template.sql pin both to one answer.
--
-- The function runs as the caller (security invoker) and names nothing in the
-- app schema, which signed-in roles cannot reach. The page and editor_document
-- insert rules decide whether the person may create a page where they asked:
-- a template never grants a right its user does not already have. The page's
-- visibility is its parent's, else `workspace`, exactly as createPage does.

-- ---------------------------------------------------------------------------
-- Body check: a page body may list the variables it uses
-- ---------------------------------------------------------------------------

create or replace function app.template_v2_body_problem(p_scope text, p_type_key text, p_body jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare
  b jsonb;
  v_problem text;
begin
  if jsonb_typeof(p_body) is distinct from 'object' then return 'A template body must be an object'; end if;
  if p_scope = 'object' and p_type_key = 'task' then
    return app.template_v2_task_problem(p_body);
  elsif p_scope = 'object' and p_type_key = 'project' then
    return app.template_v2_project_problem(p_body);
  elsif p_scope = 'page' then
    if exists (select 1 from jsonb_object_keys(p_body) k where k not in ('title', 'blocks', 'variables')) then
      return 'Unknown page setting';
    end if;
    if not app.template_v2_text_ok(p_body->'title', 200) then
      return 'A page needs an English and a French title';
    end if;
    if jsonb_typeof(p_body->'blocks') is distinct from 'array' or jsonb_array_length(p_body->'blocks') > 500 then
      return 'A page has a list of at most 500 blocks';
    end if;
    for b in select value from jsonb_array_elements(p_body->'blocks') loop
      if jsonb_typeof(b) <> 'object'
         or coalesce(b->>'kind', '') not in ('heading', 'paragraph', 'todo')
         or exists (select 1 from jsonb_object_keys(b) k where k not in ('kind', 'text', 'offsets'))
         or not app.template_v2_text_ok(b->'text', 5000)
         or not app.template_v2_offset_ok(b->'offsets') then
        return 'Each block is a heading, paragraph or to-do with English and French text';
      end if;
    end loop;
    if p_body ? 'variables' then
      if jsonb_typeof(p_body->'variables') <> 'array'
         or jsonb_array_length(p_body->'variables') > 4
         or exists (
           select 1 from jsonb_array_elements(p_body->'variables') v
           where jsonb_typeof(v.value) <> 'string'
              or (v.value #>> '{}') not in ('program', 'owner', 'period', 'due'))
         or (select count(*) <> count(distinct value) from jsonb_array_elements(p_body->'variables')) then
        return 'Page variables are program, owner, period and due, each at most once';
      end if;
    end if;
    return null;
  elsif p_scope = 'space' then
    if exists (select 1 from jsonb_object_keys(p_body) k where k not in ('title', 'projects')) then
      return 'Unknown space setting';
    end if;
    if not app.template_v2_text_ok(p_body->'title', 200) then
      return 'A space needs an English and a French name';
    end if;
    if jsonb_typeof(p_body->'projects') is distinct from 'array'
       or jsonb_array_length(p_body->'projects') not between 1 and 50 then
      return 'A space has 1 to 50 projects';
    end if;
    for b in select value from jsonb_array_elements(p_body->'projects') loop
      v_problem := app.template_v2_project_problem(b);
      if v_problem is not null then return v_problem; end if;
    end loop;
    return null;
  end if;
  return 'Unknown template scope';
end;
$$;

-- ---------------------------------------------------------------------------
-- Creating a page from a template
-- ---------------------------------------------------------------------------

-- p_variables: {"program": text, "owner": text, "period": text, "due": text,
-- "locale": "en" | "fr-CA"}. Every key is optional; a missing variable renders
-- as empty text and an unknown {{name}} is left as written. The locale falls
-- back to the caller's profile language, then English. Returns the new page's
-- id; raises for a signed-out caller, a template that is not a published page
-- template, a parent the caller cannot see, or a place the caller may not
-- create a page (the page table's own insert rule).
create or replace function public.apply_page_template_v2(
  p_template uuid,
  p_parent uuid,
  p_title text,
  p_start date,
  p_variables jsonb default '{}'::jsonb
)
returns uuid
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_template public.template_v2%rowtype;
  v_uid uuid := (select auth.uid());
  v_locale text;
  v_fr boolean;
  v_visibility text := 'workspace';
  v_position double precision;
  v_page_id uuid;
  v_title text;
  v_blocks jsonb := '[]'::jsonb;
  v_lines text[] := '{}';
  v_vars jsonb := case when jsonb_typeof(p_variables) = 'object' then p_variables else '{}'::jsonb end;
  v_values jsonb := '{}'::jsonb;
  v_name text;
  -- The placeholder shape shared with src/features/documents/templates/merge.ts.
  v_pattern constant text := '\{\{\s*(program|owner|period|due)\s*\}\}';
  v_texts text[] := '{}';
  v_rendered text[] := '{}';
  v_text text;
  v_parts text[];
  v_names text[];
  v_dates text[];
  v_kind text;
  b jsonb;
  i integer;
  j integer;
begin
  if v_uid is null then
    raise exception 'Sign in to use a template' using errcode = '42501';
  end if;
  if p_start is null then
    raise exception 'Choose a start date' using errcode = '22023';
  end if;

  select * into v_template from public.template_v2 tv where tv.id = p_template;
  if not found then
    raise exception 'This template is not available' using errcode = '42501';
  end if;
  if v_template.scope <> 'page' then
    raise exception 'Only a page template creates a page' using errcode = '0A000';
  end if;
  if v_template.status <> 'published' then
    raise exception 'This template is not published' using errcode = '42501';
  end if;

  v_locale := v_vars->>'locale';
  if v_locale is null or v_locale not in ('en', 'fr-CA') then
    select coalesce(up.locale, 'en') into v_locale from public.user_profile up where up.id = v_uid;
    v_locale := coalesce(v_locale, 'en');
  end if;
  v_fr := v_locale = 'fr-CA';

  -- Where the page goes: inside a parent the caller can see, else the top of
  -- the workspace. The parent decides the visibility, as the page trigger does.
  if p_parent is not null then
    select p.visibility into v_visibility from public.page p
    where p.id = p_parent and p.deleted_at is null;
    if not found then
      raise exception 'The parent page is not available' using errcode = 'P0002';
    end if;
  end if;

  -- Last among its siblings (positionAtEnd in src/features/pages/tree.ts).
  select coalesce(max(p.position) + 1024, 1024) into v_position
  from public.page p
  where p.organization_id = v_template.organization_id
    and p.parent_page_id is not distinct from p_parent
    and p.visibility = v_visibility
    and p.deleted_at is null;

  -- Each value is one line of plain text, at most 500 characters.
  foreach v_name in array array['program', 'owner', 'period', 'due'] loop
    v_values := v_values || jsonb_build_object(v_name,
      btrim(regexp_replace(left(coalesce(v_vars->>v_name, ''), 500), '[[:cntrl:]]+', ' ', 'g')));
  end loop;

  -- The texts to render, in the chosen language: the title, then every block.
  v_texts := array[case when v_fr then v_template.body->'title'->>'fr' else v_template.body->'title'->>'en' end];
  for b in select value from jsonb_array_elements(v_template.body->'blocks') loop
    v_texts := v_texts || (case when v_fr then b->'text'->>'fr' else b->'text'->>'en' end);
  end loop;

  -- One pass over each text: the segments between placeholders, interleaved
  -- with the values. A value is inserted as-is and never scanned again, so a
  -- value that contains "{{owner}}" stays literal text (as renderPageText does).
  for i in 1..cardinality(v_texts) loop
    v_parts := regexp_split_to_array(v_texts[i], v_pattern);
    v_names := array(select m[1] from regexp_matches(v_texts[i], v_pattern, 'g') m);
    v_text := v_parts[1];
    for j in 1..coalesce(cardinality(v_names), 0) loop
      v_text := v_text || (v_values->>v_names[j]) || v_parts[j + 1];
    end loop;
    v_rendered := v_rendered || v_text;
  end loop;

  -- Blocks: the rendered text, dates added, in the editor's JSON (content v1).
  i := 1;
  for b in select value from jsonb_array_elements(v_template.body->'blocks') loop
    i := i + 1;
    v_text := v_rendered[i];
    v_dates := '{}';
    if b->'offsets' ? 'start' then
      v_dates := v_dates || (case when v_fr then 'Débute le ' else 'Starts ' end
        || to_char(p_start + (b->'offsets'->>'start')::integer, 'YYYY-MM-DD'));
    end if;
    if b->'offsets' ? 'due' then
      v_dates := v_dates || (case when v_fr then 'Échéance le ' else 'Due ' end
        || to_char(p_start + (b->'offsets'->>'due')::integer, 'YYYY-MM-DD'));
    end if;
    if cardinality(v_dates) > 0 then
      v_text := v_text || ' · ' || array_to_string(v_dates, ' · ');
    end if;
    v_kind := b->>'kind';
    v_blocks := v_blocks || jsonb_build_object(
      'id', gen_random_uuid()::text,
      'type', case v_kind when 'heading' then 'heading' when 'todo' then 'checkListItem' else 'paragraph' end,
      'props', case v_kind when 'heading' then '{"level": 2}'::jsonb when 'todo' then '{"checked": false}'::jsonb else '{}'::jsonb end,
      'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_text, 'styles', '{}'::jsonb)),
      'children', '[]'::jsonb);
    v_lines := v_lines || v_text;
  end loop;

  v_title := left(btrim(coalesce(p_title, '')), 500);
  if v_title = '' then
    v_title := left(v_rendered[1], 500);
  end if;

  -- The page insert rule (page_insert, app.can_write_page_row) decides here.
  insert into public.page (organization_id, parent_page_id, visibility, title, position, created_by)
  values (v_template.organization_id, p_parent, v_visibility, v_title, v_position, v_uid)
  returning id into v_page_id;

  insert into public.editor_document (object_id, object_type, organization_id, content, content_text, created_by)
  values (v_page_id, 'page', v_template.organization_id,
    jsonb_build_object('version', 1, 'blocks', v_blocks),
    left(array_to_string(v_lines, E'\n'), 500000),
    v_uid);

  return v_page_id;
end;
$$;

revoke all on function public.apply_page_template_v2(uuid, uuid, text, date, jsonb) from public, anon;
grant execute on function public.apply_page_template_v2(uuid, uuid, text, date, jsonb) to authenticated, service_role;

comment on function public.apply_page_template_v2(uuid, uuid, text, date, jsonb) is
  'Creates a page and its editor document from a published page template (V1-13), '
  'filling {{program}}, {{owner}}, {{period}} and {{due}} and dating offsets from p_start. '
  'Runs as the caller: the page insert rule decides.';

-- ---------------------------------------------------------------------------
-- Starter gallery: the "Meeting notes" page now names its variables and uses
-- them. Existing organizations get the new body; new ones get it on creation.
-- ---------------------------------------------------------------------------

-- The starter page template's body, in one place for the starter list below
-- and for the organizations that already have the old body.
create or replace function app.template_v2_meeting_notes_body() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"title":{"en":"Meeting notes","fr":"Notes de réunion"},"variables":["program","owner","period","due"],"blocks":[{"kind":"paragraph","text":{"en":"Program: {{program}} · Led by {{owner}} · Period: {{period}}","fr":"Programme : {{program}} · Animée par {{owner}} · Période : {{period}}"}},{"kind":"heading","text":{"en":"Agenda","fr":"Ordre du jour"}},{"kind":"heading","text":{"en":"Decisions","fr":"Décisions"}},{"kind":"heading","text":{"en":"Next steps","fr":"Prochaines étapes"}},{"kind":"todo","text":{"en":"Share the notes","fr":"Diffuser les notes"},"offsets":{"due":1}},{"kind":"todo","text":{"en":"Follow up on the actions by {{due}}","fr":"Faire le suivi des actions d’ici le {{due}}"}}]}'::jsonb;
$$;
revoke all on function app.template_v2_meeting_notes_body() from public, anon, authenticated;

create or replace function app.template_v2_add_starters(p_organization_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into public.template_v2 (organization_id, scope, type_key, name_en, name_fr, description_en, description_fr, status, created_by, body)
  select p_organization_id, s.scope, s.type_key, s.name_en, s.name_fr, s.description_en, s.description_fr, 'published', null, s.body::jsonb
  from (values
    ('object', 'task', 'Follow up after a meeting', 'Suivi après une réunion',
     'One task, due two days after the meeting.', 'Une tâche, due deux jours après la réunion.',
     '{"title":{"en":"Send the meeting follow-up","fr":"Envoyer le suivi de la réunion"},"priority":"medium","offsets":{"due":2}}'),
    ('object', 'project', 'Volunteer onboarding', 'Accueil des bénévoles',
     'A four-week project with the usual steps.', 'Un projet de quatre semaines avec les étapes habituelles.',
     '{"title":{"en":"Volunteer onboarding","fr":"Accueil des bénévoles"},"offsets":{"start":0,"due":28},"tasks":[{"title":{"en":"Send the welcome email","fr":"Envoyer le courriel de bienvenue"},"offsets":{"due":1}},{"title":{"en":"Check references","fr":"Vérifier les références"},"offsets":{"due":7}},{"title":{"en":"First shift with a mentor","fr":"Premier quart avec un mentor"},"offsets":{"start":14,"due":14}}]}'),
    ('page', null, 'Meeting notes', 'Notes de réunion',
     'Agenda, decisions and next steps.', 'Ordre du jour, décisions et prochaines étapes.',
     app.template_v2_meeting_notes_body()::text),
    ('space', null, 'Community event', 'Événement communautaire',
     'Planning and promotion projects for an event six weeks away.', 'Projets de planification et de promotion pour un événement dans six semaines.',
     '{"title":{"en":"Community event","fr":"Événement communautaire"},"projects":[{"title":{"en":"Event logistics","fr":"Logistique de l’événement"},"offsets":{"start":0,"due":42},"tasks":[{"title":{"en":"Book the venue","fr":"Réserver la salle"},"priority":"high","offsets":{"due":7}},{"title":{"en":"Confirm catering","fr":"Confirmer le traiteur"},"offsets":{"due":28}}]},{"title":{"en":"Promotion","fr":"Promotion"},"offsets":{"start":7,"due":42},"tasks":[{"title":{"en":"Publish the invitation","fr":"Publier l’invitation"},"offsets":{"due":14}}]}]}')
  ) as s(scope, type_key, name_en, name_fr, description_en, description_fr, body)
  where not exists (
      select 1 from public.template_v2 t
      where t.organization_id = p_organization_id and t.created_by is null and t.name_en = s.name_en);
end;
$$;
revoke all on function app.template_v2_add_starters(uuid) from public, anon, authenticated;

update public.template_v2
set body = app.template_v2_meeting_notes_body()
where scope = 'page' and created_by is null and name_en = 'Meeting notes';
