-- Templates that build hubs, with versions (Workspace OS wave 2, unit T1).
--
-- 1. Versions. Every template carries a version number. Inserting a template
--    makes version 1; every edit of its names, descriptions or body makes the
--    next one, and a snapshot of each version is kept in template_v2_version.
--    Publishing or unpublishing is not an edit. Snapshots are written by
--    trigger only: nobody can insert, change or delete one through the API.
--
-- 2. Origins. A page made from a template records which template and which
--    version it came from (page_template_origin), so a page made from an
--    older version keeps its own content and still says where it came from.
--
-- 3. Any block. A page template's body may hold `document`: the page as editor
--    blocks in English and in French ({"en": [...], "fr": [...]}), with any
--    block type in the editor's registry (view, task and decision blocks,
--    checklists, columns...). Text may use the four variables and date tokens
--    `{{start+N}}`, filled when the template is used. The old rows (`blocks`)
--    keep working and render first.
--
-- 4. Hubs. A page template's body may hold `hub`: milestones and tasks with
--    day offsets. Using it with a start date creates a project for the hub
--    (where the person chose, under the project insert rule), its milestones
--    and tasks with real dates, and adds a view block to the page that lists
--    exactly that project's tasks.
--
-- 5. Duplicating. public.duplicate_template_v2 copies a template the caller can
--    see into an organization where they may write templates, as a draft, and
--    leaves out every reference the copy must not carry: private pages,
--    people who are not members of the destination, objects the caller cannot
--    open there, private saved views and synced content. Template bodies hold
--    no comments; nothing else is copied.
--
-- Everything that reads or creates rows runs as the caller (security invoker):
-- row-level security decides, exactly as if the person did each step by hand.

-- ---------------------------------------------------------------------------
-- 1. Versions
-- ---------------------------------------------------------------------------

alter table public.template_v2
  add column version integer not null default 1 check (version >= 1);

create table public.template_v2_version (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.template_v2 (id) on delete cascade,
  organization_id uuid not null references public.organization (id) on delete cascade,
  version integer not null check (version >= 1),
  name_en text not null,
  name_fr text not null,
  description_en text,
  description_fr text,
  body jsonb not null,
  created_by uuid references public.user_profile (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (template_id, version)
);

comment on table public.template_v2_version is
  'One row per version of a template (T1): written by trigger on every edit, read like its template.';

insert into public.template_v2_version (template_id, organization_id, version, name_en, name_fr,
                                        description_en, description_fr, body, created_by, created_at)
select t.id, t.organization_id, 1, t.name_en, t.name_fr, t.description_en, t.description_fr, t.body,
       t.created_by, t.updated_at
from public.template_v2 t;

-- The version number is the server's: an insert is version 1, an edit of
-- what the template says is the next one, anything else keeps it.
create or replace function app.template_v2_version_bump() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
  elsif (new.scope, new.type_key, new.name_en, new.name_fr, new.description_en, new.description_fr, new.body)
        is distinct from
        (old.scope, old.type_key, old.name_en, old.name_fr, old.description_en, old.description_fr, old.body) then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end;
$$;
revoke all on function app.template_v2_version_bump() from public, anon, authenticated;

create trigger template_v2_version_bump before insert or update on public.template_v2
for each row execute function app.template_v2_version_bump();

create or replace function app.template_v2_version_record() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.version <> old.version then
    insert into public.template_v2_version (template_id, organization_id, version, name_en, name_fr,
                                            description_en, description_fr, body, created_by)
    values (new.id, new.organization_id, new.version, new.name_en, new.name_fr,
            new.description_en, new.description_fr, new.body, coalesce((select auth.uid()), new.created_by));
  end if;
  return null;
end;
$$;
revoke all on function app.template_v2_version_record() from public, anon, authenticated;

create trigger template_v2_version_record after insert or update on public.template_v2
for each row execute function app.template_v2_version_record();

alter table public.template_v2_version enable row level security;

-- A version is seen by whoever sees its template (the template's own rule).
create policy template_v2_version_read on public.template_v2_version
for select to authenticated using (
  exists (select 1 from public.template_v2 t where t.id = template_id)
);

revoke all on public.template_v2_version from anon, authenticated;
grant select on public.template_v2_version to authenticated;
grant all on public.template_v2_version to service_role;

-- ---------------------------------------------------------------------------
-- 2. Where a page came from
-- ---------------------------------------------------------------------------

create table public.page_template_origin (
  page_id uuid primary key references public.page (id) on delete cascade,
  organization_id uuid not null references public.organization (id) on delete cascade,
  template_id uuid references public.template_v2 (id) on delete set null,
  version_id uuid references public.template_v2_version (id) on delete set null,
  template_version integer not null check (template_version >= 1),
  template_name_en text not null,
  template_name_fr text not null,
  -- The project a hub template created for this page, if any.
  project_id uuid references public.project (id) on delete set null,
  created_by uuid references public.user_profile (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index page_template_origin_template_idx on public.page_template_origin (template_id, template_version);
create index page_template_origin_project_idx on public.page_template_origin (project_id) where project_id is not null;

comment on table public.page_template_origin is
  'The template and version a page was made from (T1). Written once, when the page is made.';

-- The caller names the page and the version; the rest is copied from the
-- version itself, so an origin cannot claim a name or number it does not have.
create or replace function app.page_template_origin_fill() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v public.template_v2_version%rowtype;
begin
  select * into v from public.template_v2_version tv where tv.id = new.version_id;
  if not found then
    raise exception 'Unknown template version' using errcode = '23503';
  end if;
  new.template_id := v.template_id;
  new.template_version := v.version;
  new.template_name_en := v.name_en;
  new.template_name_fr := v.name_fr;
  new.organization_id := (select p.organization_id from public.page p where p.id = new.page_id);
  new.created_at := now();
  if (select auth.uid()) is not null then
    new.created_by := (select auth.uid());
  end if;
  return new;
end;
$$;
revoke all on function app.page_template_origin_fill() from public, anon, authenticated;

create trigger page_template_origin_fill before insert on public.page_template_origin
for each row execute function app.page_template_origin_fill();

alter table public.page_template_origin enable row level security;

-- Seen by whoever can open the page.
create policy page_template_origin_read on public.page_template_origin
for select to authenticated using (
  exists (select 1 from public.page p where p.id = page_id)
);

-- Written only while public.apply_page_template_v2 makes the page, by the
-- person making it, from a version they can see, naming only a project they
-- created themselves.
create policy page_template_origin_insert on public.page_template_origin
for insert to authenticated with check (
  -- Only public.apply_page_template_v2 marks the page it is making; a
  -- request through the API cannot set this transaction-local value.
  page_id::text = current_setting('app.page_template_apply', true)
  and created_by = (select auth.uid())
  and exists (select 1 from public.page p where p.id = page_id and p.created_by = (select auth.uid()))
  and exists (select 1 from public.template_v2_version v where v.id = version_id)
  and (project_id is null
       or exists (select 1 from public.project pr where pr.id = project_id and pr.created_by = (select auth.uid())))
);

revoke all on public.page_template_origin from anon, authenticated;
grant select, insert on public.page_template_origin to authenticated;
grant all on public.page_template_origin to service_role;

-- ---------------------------------------------------------------------------
-- 3 and 4. Body checks: documents of any registry block, and hubs
-- ---------------------------------------------------------------------------

-- The editor's block types (src/features/editor/registry/registry.ts). The
-- unit test in src/features/templates-v2 reads this list from this file and
-- compares it with the registry, so the two cannot drift apart.
create or replace function app.template_v2_block_types() returns text[]
language sql immutable set search_path = '' as $$
  select array['paragraph', 'heading', 'bulletListItem', 'numberedListItem', 'checkListItem', 'toggleListItem', 'quote', 'callout', 'codeBlock', 'table', 'divider', 'image', 'file', 'video', 'audio', 'bookmark', 'embed', 'columnList', 'column', 'tableOfContents', 'task', 'decision', 'person', 'status', 'query', 'libraryFile', 'pageLink', 'syncedBlock', 'button']::text[];
$$;

-- Editor blocks: {id?, type, props?, content?, children?}, nested at most 20 deep.
create or replace function app.template_v2_blocks_ok(p jsonb, p_depth integer) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  b jsonb;
begin
  if jsonb_typeof(p) is distinct from 'array' or p_depth > 20 then return false; end if;
  for b in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(b) <> 'object'
       or exists (select 1 from jsonb_object_keys(b) k where k not in ('id', 'type', 'props', 'content', 'children'))
       or jsonb_typeof(b->'type') is distinct from 'string'
       or not ((b->>'type') = any (app.template_v2_block_types()))
       or (b ? 'id' and jsonb_typeof(b->'id') <> 'string')
       or (b ? 'props' and jsonb_typeof(b->'props') <> 'object')
       or (b ? 'content' and jsonb_typeof(b->'content') not in ('array', 'object', 'string'))
       or (b ? 'children' and not app.template_v2_blocks_ok(b->'children', p_depth + 1)) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create or replace function app.template_v2_document_problem(p jsonb) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(p) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p) k where k not in ('en', 'fr'))
     or not (p ? 'en' and p ? 'fr') then
    return 'A page document has English and French blocks';
  end if;
  if octet_length(p::text) > 1000000 then
    return 'A page document is at most 1 MB';
  end if;
  if jsonb_typeof(p->'en') <> 'array' or jsonb_typeof(p->'fr') <> 'array'
     or jsonb_array_length(p->'en') > 500 or jsonb_array_length(p->'fr') > 500 then
    return 'A page has a list of at most 500 blocks';
  end if;
  if not app.template_v2_blocks_ok(p->'en', 1) or not app.template_v2_blocks_ok(p->'fr', 1) then
    return 'Every block is one the editor knows';
  end if;
  return null;
end;
$$;

-- A hub: {milestones: [{title, offsets?}], tasks: [{title, description?, priority?, offsets?, milestone?}]}.
create or replace function app.template_v2_hub_problem(p jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare
  m jsonb;
  t jsonb;
  v_milestones integer;
begin
  if jsonb_typeof(p) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p) k where k not in ('milestones', 'tasks')) then
    return 'Unknown hub setting';
  end if;
  if jsonb_typeof(coalesce(p->'milestones', '[]')) <> 'array' or jsonb_array_length(coalesce(p->'milestones', '[]')) > 50 then
    return 'A hub has at most 50 milestones';
  end if;
  if jsonb_typeof(coalesce(p->'tasks', '[]')) <> 'array' or jsonb_array_length(coalesce(p->'tasks', '[]')) > 200 then
    return 'A hub has at most 200 tasks';
  end if;
  v_milestones := jsonb_array_length(coalesce(p->'milestones', '[]'));
  if v_milestones + jsonb_array_length(coalesce(p->'tasks', '[]')) = 0 then
    return 'A hub needs at least one task or milestone';
  end if;
  for m in select value from jsonb_array_elements(coalesce(p->'milestones', '[]')) loop
    if jsonb_typeof(m) <> 'object'
       or exists (select 1 from jsonb_object_keys(m) k where k not in ('title', 'offsets'))
       or not app.template_v2_text_ok(m->'title', 200)
       or not app.template_v2_offset_ok(m->'offsets') then
      return 'Every milestone needs an English and a French name, and dates in whole days';
    end if;
  end loop;
  for t in select value from jsonb_array_elements(coalesce(p->'tasks', '[]')) loop
    if jsonb_typeof(t) <> 'object'
       or exists (select 1 from jsonb_object_keys(t) k where k not in ('title', 'description', 'priority', 'offsets', 'milestone')) then
      return 'Unknown task setting';
    end if;
    if t ? 'milestone' and not (jsonb_typeof(t->'milestone') = 'number' and (t->>'milestone') ~ '^\d{1,2}$'
                                and (t->>'milestone')::integer < v_milestones) then
      return 'A task names one of the hub''s milestones';
    end if;
    if app.template_v2_task_problem(t - 'milestone') is not null then
      return app.template_v2_task_problem(t - 'milestone');
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function app.template_v2_block_types() from public, anon;
revoke all on function app.template_v2_blocks_ok(jsonb, integer) from public, anon;
revoke all on function app.template_v2_document_problem(jsonb) from public, anon;
revoke all on function app.template_v2_hub_problem(jsonb) from public, anon;
grant execute on function app.template_v2_block_types() to authenticated, service_role;
grant execute on function app.template_v2_blocks_ok(jsonb, integer) to authenticated, service_role;
grant execute on function app.template_v2_document_problem(jsonb) to authenticated, service_role;
grant execute on function app.template_v2_hub_problem(jsonb) to authenticated, service_role;

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
    if exists (select 1 from jsonb_object_keys(p_body) k where k not in ('title', 'blocks', 'variables', 'document', 'hub')) then
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
    if p_body ? 'document' then
      v_problem := app.template_v2_document_problem(p_body->'document');
      if v_problem is not null then return v_problem; end if;
    end if;
    if p_body ? 'hub' then
      v_problem := app.template_v2_hub_problem(p_body->'hub');
      if v_problem is not null then return v_problem; end if;
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
-- Creating a page (and its hub) from a template
-- ---------------------------------------------------------------------------

drop function public.apply_page_template_v2(uuid, uuid, text, date, jsonb);

-- As before (20261108030000), plus: the template's `document` is rendered
-- after its rows, a `hub` creates a project in p_program (null: an admin's
-- project outside any program) with its milestones and tasks dated from
-- p_start and a view block listing them, and the page records the template
-- version it came from. One transaction: a refusal anywhere leaves nothing.
create or replace function public.apply_page_template_v2(
  p_template uuid,
  p_parent uuid,
  p_title text,
  p_start date,
  p_variables jsonb default '{}'::jsonb,
  p_program uuid default null
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
  -- In a document, a date token too: {{start+N}} is the start date plus N days.
  v_doc_pattern constant text := '\{\{\s*(program|owner|period|due|start\s*\+\s*[0-9]{1,4})\s*\}\}';
  v_texts text[] := '{}';
  v_rendered text[] := '{}';
  v_text text;
  v_parts text[];
  v_names text[];
  v_dates text[];
  v_kind text;
  v_doc jsonb;
  v_value text;
  v_version_id uuid;
  v_project_id uuid;
  v_milestones uuid[] := '{}';
  v_milestone_id uuid;
  v_task_id uuid;
  v_end integer;
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

  if p_parent is not null then
    select p.visibility into v_visibility from public.page p
    where p.id = p_parent and p.deleted_at is null
      and p.organization_id = v_template.organization_id;
    if not found then
      raise exception 'The parent page is not available' using errcode = 'P0002';
    end if;
  end if;

  select coalesce(max(p.position) + 1024, 1024) into v_position
  from public.page p
  where p.organization_id = v_template.organization_id
    and p.parent_page_id is not distinct from p_parent
    and p.visibility = v_visibility
    and p.deleted_at is null;

  foreach v_name in array array['program', 'owner', 'period', 'due'] loop
    v_values := v_values || jsonb_build_object(v_name,
      btrim(regexp_replace(left(coalesce(v_vars->>v_name, ''), 500), '[[:cntrl:]]+', ' ', 'g')));
  end loop;

  v_texts := array[case when v_fr then v_template.body->'title'->>'fr' else v_template.body->'title'->>'en' end];
  for b in select value from jsonb_array_elements(v_template.body->'blocks') loop
    v_texts := v_texts || (case when v_fr then b->'text'->>'fr' else b->'text'->>'en' end);
  end loop;

  for i in 1..cardinality(v_texts) loop
    v_parts := regexp_split_to_array(v_texts[i], v_pattern);
    v_names := array(select m[1] from regexp_matches(v_texts[i], v_pattern, 'g') m);
    v_text := v_parts[1];
    for j in 1..coalesce(cardinality(v_names), 0) loop
      v_text := v_text || (v_values->>v_names[j]) || v_parts[j + 1];
    end loop;
    v_rendered := v_rendered || v_text;
  end loop;

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

  -- The document, in the chosen language: every placeholder in every string
  -- is filled in one pass over its JSON text, each value JSON-escaped, so a
  -- value can neither restructure the document nor be scanned again
  -- (renderTemplateDocument in src/features/templates-v2/template.ts).
  if v_template.body ? 'document' then
    v_text := (v_template.body->'document'->(case when v_fr then 'fr' else 'en' end))::text;
    v_parts := regexp_split_to_array(v_text, v_doc_pattern);
    v_names := array(select m[1] from regexp_matches(v_text, v_doc_pattern, 'g') m);
    v_text := v_parts[1];
    for j in 1..coalesce(cardinality(v_names), 0) loop
      if v_names[j] like 'start%' then
        v_value := to_char(p_start + regexp_replace(v_names[j], '[^0-9]', '', 'g')::integer, 'YYYY-MM-DD');
      else
        v_value := v_values->>v_names[j];
      end if;
      v_value := to_jsonb(v_value)::text;
      v_text := v_text || substr(v_value, 2, length(v_value) - 2) || v_parts[j + 1];
    end loop;
    v_doc := v_text::jsonb;
    v_blocks := v_blocks || v_doc;
    v_lines := v_lines || array(
      select t.value #>> '{}' from jsonb_path_query(v_doc, 'lax $.**.text') as t(value)
      where jsonb_typeof(t.value) = 'string');
  end if;

  v_title := left(btrim(coalesce(p_title, '')), 500);
  if v_title = '' then
    v_title := left(v_rendered[1], 500);
  end if;

  -- The hub: a project where the person chose (the project insert rule
  -- decides), its milestones, its tasks, and a view of exactly those tasks.
  if v_template.body ? 'hub' then
   begin
    select max(o) into v_end from (
      select (x.value->'offsets'->>'due')::integer as o
      from jsonb_array_elements(coalesce(v_template.body->'hub'->'milestones', '[]')
                                || coalesce(v_template.body->'hub'->'tasks', '[]')) x
    ) s;
    insert into public.project (organization_id, program_id, name, owner_id, start_date, target_date, created_by)
    values (v_template.organization_id, p_program, left(v_title, 200), v_uid, p_start,
            case when v_end is not null then p_start + v_end end, v_uid)
    returning id into v_project_id;

    for b in select value from jsonb_array_elements(coalesce(v_template.body->'hub'->'milestones', '[]')) loop
      insert into public.milestone (project_id, name, due_date, owner_id)
      values (v_project_id,
        case when v_fr then b->'title'->>'fr' else b->'title'->>'en' end,
        case when b->'offsets' ? 'due' then p_start + (b->'offsets'->>'due')::integer end,
        v_uid)
      returning id into v_milestone_id;
      v_milestones := v_milestones || v_milestone_id;
    end loop;

    for b in select value from jsonb_array_elements(coalesce(v_template.body->'hub'->'tasks', '[]')) loop
      insert into public.task (organization_id, program_id, project_id, milestone_id, title, description, priority,
                               start_at, due_at, created_by, requester_id)
      values (v_template.organization_id, p_program, v_project_id,
        case when b ? 'milestone' then v_milestones[(b->>'milestone')::integer + 1] end,
        case when v_fr then b->'title'->>'fr' else b->'title'->>'en' end,
        case when v_fr then b->'description'->>'fr' else b->'description'->>'en' end,
        coalesce(b->>'priority', 'medium')::public.task_priority,
        case when b->'offsets' ? 'start' then p_start + (b->'offsets'->>'start')::integer end,
        case when b->'offsets' ? 'due' then p_start + (b->'offsets'->>'due')::integer end,
        v_uid, v_uid)
      returning id into v_task_id;
    end loop;

    -- A view block (version 2 of the query block's props, U6) over the hub's tasks.
    v_blocks := v_blocks || jsonb_build_object(
      'id', gen_random_uuid()::text,
      'type', 'query',
      'props', jsonb_build_object(
        'preset', 'my_open',
        'spec', jsonb_build_object(
          'version', 2,
          'source', jsonb_build_object('type', 'task'),
          'layout', 'table',
          'title', case when v_fr then 'Tâches' else 'Tasks' end,
          'where', jsonb_build_array(jsonb_build_object('path', 'project', 'op', 'contains', 'value', v_project_id::text)),
          'sort', jsonb_build_array(jsonb_build_object('path', 'due', 'direction', 'asc')),
          'fields', jsonb_build_array('status', 'due', 'milestone'))::text),
      'children', '[]'::jsonb);
   exception when insufficient_privilege then
    -- Told apart from a page refusal: the app asks for a program the person manages.
    raise exception 'You cannot create the hub''s project there' using errcode = '42501', hint = 'hub';
   end;
  end if;

  insert into public.page (organization_id, parent_page_id, visibility, title, position, created_by)
  values (v_template.organization_id, p_parent, v_visibility, v_title, v_position, v_uid)
  returning id into v_page_id;

  insert into public.editor_document (object_id, object_type, organization_id, content, content_text, created_by)
  values (v_page_id, 'page', v_template.organization_id,
    jsonb_build_object('version', 1, 'blocks', v_blocks),
    left(array_to_string(v_lines, E'\n'), 500000),
    v_uid);

  select tv.id into v_version_id from public.template_v2_version tv
  where tv.template_id = v_template.id and tv.version = v_template.version;
  if v_version_id is not null then
    perform set_config('app.page_template_apply', v_page_id::text, true);
    insert into public.page_template_origin (page_id, version_id, project_id, template_version, template_name_en, template_name_fr)
    values (v_page_id, v_version_id, v_project_id, v_template.version, v_template.name_en, v_template.name_fr);
    perform set_config('app.page_template_apply', '', true);
  end if;

  return v_page_id;
end;
$$;

revoke all on function public.apply_page_template_v2(uuid, uuid, text, date, jsonb, uuid) from public, anon;
grant execute on function public.apply_page_template_v2(uuid, uuid, text, date, jsonb, uuid) to authenticated, service_role;

comment on function public.apply_page_template_v2(uuid, uuid, text, date, jsonb, uuid) is
  'Creates a page from a published page template (V1-13, T1): rows, document and hub, '
  'filling variables and dating offsets from p_start, and records the template version. '
  'Runs as the caller: the page, project, milestone and task insert rules decide.';

-- ---------------------------------------------------------------------------
-- 5. Duplicating without private data
-- ---------------------------------------------------------------------------

-- Whether an id may travel in a copy made for p_org: an active member of
-- p_org, or something in p_org the caller can open that is not private (a
-- workspace page, a task, project, program, milestone, decision, library
-- document or shared saved view). Runs as the caller, so row-level security
-- decides what "can open" means.
create or replace function public.template_v2_id_ok(p_id uuid, p_org uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.organization_membership m
                 where m.user_id = p_id and m.organization_id = p_org and m.status = 'active')
      or exists (select 1 from public.page p
                 where p.id = p_id and p.organization_id = p_org and p.visibility = 'workspace' and p.deleted_at is null)
      or exists (select 1 from public.task t where t.id = p_id and t.organization_id = p_org)
      or exists (select 1 from public.project pr where pr.id = p_id and pr.organization_id = p_org)
      or exists (select 1 from public.program pg where pg.id = p_id and pg.organization_id = p_org)
      or exists (select 1 from public.milestone mi join public.project pr on pr.id = mi.project_id
                 where mi.id = p_id and pr.organization_id = p_org)
      or exists (select 1 from public.decision d where d.id = p_id and d.organization_id = p_org)
      or exists (select 1 from public.document doc where doc.id = p_id and doc.organization_id = p_org)
      or exists (select 1 from public.lens l where l.id = p_id and l.organization_id = p_org and l.visibility = 'shared');
$$;

-- Whether every id written in a text may travel (see above).
create or replace function public.template_v2_ids_ok(p_text text, p_org uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select not exists (
    select 1 from regexp_matches(coalesce(p_text, ''),
      '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', 'g') m
    where not public.template_v2_id_ok(lower(m[1])::uuid, p_org));
$$;

-- Inline content: a link to something that may not travel becomes its text.
create or replace function public.template_v2_scrub_inline(p jsonb, p_org uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_out jsonb;
  e jsonb;
  k text;
begin
  if jsonb_typeof(p) = 'array' then
    v_out := '[]'::jsonb;
    for e in select value from jsonb_array_elements(p) loop
      if jsonb_typeof(e) = 'object' and e->>'type' = 'link' and not public.template_v2_ids_ok(e->>'href', p_org) then
        v_out := v_out || coalesce(public.template_v2_scrub_inline(e->'content', p_org), '[]'::jsonb);
      else
        v_out := v_out || jsonb_build_array(public.template_v2_scrub_inline(e, p_org));
      end if;
    end loop;
    return v_out;
  elsif jsonb_typeof(p) = 'object' then
    v_out := '{}'::jsonb;
    for k, e in select key, value from jsonb_each(p) loop
      v_out := v_out || jsonb_build_object(k, public.template_v2_scrub_inline(e, p_org));
    end loop;
    return v_out;
  end if;
  return p;
end;
$$;

-- Editor blocks for a copy: every prop naming something that may not travel
-- is emptied (the block stays, as an empty picker), a view block keeps only
-- the conditions and saved view that may travel, and links are checked.
create or replace function public.template_v2_scrub_blocks(p_blocks jsonb, p_org uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_out jsonb := '[]'::jsonb;
  b jsonb;
  v_props jsonb;
  v_spec jsonb;
  k text;
  e jsonb;
begin
  if jsonb_typeof(p_blocks) is distinct from 'array' then return '[]'::jsonb; end if;
  for b in select value from jsonb_array_elements(p_blocks) loop
    v_props := coalesce(b->'props', '{}'::jsonb);
    if b->>'type' = 'query' and not public.template_v2_ids_ok(v_props->>'spec', p_org) then
      begin
        v_spec := (v_props->>'spec')::jsonb;
      exception when others then
        v_spec := null;
      end;
      if jsonb_typeof(v_spec) = 'object' and v_spec->>'version' = '2' then
        if not public.template_v2_ids_ok((v_spec->'source')::text, p_org) then
          v_spec := jsonb_set(v_spec, '{source}', '{"type":"task"}');
        end if;
        v_spec := jsonb_set(v_spec, '{where}', coalesce((
          select jsonb_agg(c.value order by c.ordinality)
          from jsonb_array_elements(coalesce(v_spec->'where', '[]')) with ordinality c
          where public.template_v2_ids_ok(c.value::text, p_org)), '[]'::jsonb));
        if not public.template_v2_ids_ok(v_spec::text, p_org) then
          v_spec := '{"version":2,"source":{"type":"task"}}'::jsonb;
        end if;
        v_props := jsonb_set(v_props, '{spec}', to_jsonb(v_spec::text));
      else
        v_props := v_props - 'spec';
      end if;
    end if;
    for k, e in select key, value from jsonb_each(v_props) loop
      if not public.template_v2_ids_ok(e #>> '{}', p_org) then
        v_props := jsonb_set(v_props, array[k], case when b->>'type' = 'button' and k = 'args' then '"{}"'::jsonb else '""'::jsonb end);
      end if;
    end loop;
    if b ? 'props' then b := jsonb_set(b, '{props}', v_props); end if;
    if b ? 'content' then b := jsonb_set(b, '{content}', public.template_v2_scrub_inline(b->'content', p_org)); end if;
    if b ? 'children' then b := jsonb_set(b, '{children}', public.template_v2_scrub_blocks(b->'children', p_org)); end if;
    v_out := v_out || jsonb_build_array(b);
  end loop;
  return v_out;
end;
$$;

revoke all on function public.template_v2_id_ok(uuid, uuid) from public, anon;
revoke all on function public.template_v2_ids_ok(text, uuid) from public, anon;
revoke all on function public.template_v2_scrub_inline(jsonb, uuid) from public, anon;
revoke all on function public.template_v2_scrub_blocks(jsonb, uuid) from public, anon;
grant execute on function public.template_v2_id_ok(uuid, uuid) to authenticated, service_role;
grant execute on function public.template_v2_ids_ok(text, uuid) to authenticated, service_role;
grant execute on function public.template_v2_scrub_inline(jsonb, uuid) to authenticated, service_role;
grant execute on function public.template_v2_scrub_blocks(jsonb, uuid) to authenticated, service_role;

-- Copies a template the caller can see into p_organization (default: the
-- template's own) as the caller's draft, named "Copy of …". Raises for a
-- signed-out caller or a template the caller cannot see; the template insert
-- rule decides whether they may write templates in p_organization.
create or replace function public.duplicate_template_v2(p_template uuid, p_organization uuid default null)
returns uuid
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_template public.template_v2%rowtype;
  v_org uuid;
  v_body jsonb;
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to copy a template' using errcode = '42501';
  end if;
  select * into v_template from public.template_v2 tv where tv.id = p_template;
  if not found then
    raise exception 'This template is not available' using errcode = '42501';
  end if;
  v_org := coalesce(p_organization, v_template.organization_id);
  v_body := v_template.body;
  if v_template.scope = 'page' and v_body ? 'document' then
    v_body := jsonb_set(v_body, '{document}', jsonb_build_object(
      'en', public.template_v2_scrub_blocks(v_body->'document'->'en', v_org),
      'fr', public.template_v2_scrub_blocks(v_body->'document'->'fr', v_org)));
  end if;
  insert into public.template_v2 (organization_id, scope, type_key, name_en, name_fr,
                                  description_en, description_fr, body, status)
  values (v_org, v_template.scope, v_template.type_key,
    left('Copy of ' || v_template.name_en, 200), left('Copie de ' || v_template.name_fr, 200),
    v_template.description_en, v_template.description_fr, v_body, 'draft')
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.duplicate_template_v2(uuid, uuid) from public, anon;
grant execute on function public.duplicate_template_v2(uuid, uuid) to authenticated, service_role;

comment on function public.duplicate_template_v2(uuid, uuid) is
  'Copies a template the caller can see as their draft (T1), leaving out private pages, '
  'people outside the destination and anything the caller cannot open there. Runs as the caller.';

-- ---------------------------------------------------------------------------
-- Pages made from each version, as far as the caller can see them
-- ---------------------------------------------------------------------------

create or replace function public.template_v2_version_pages(p_template uuid)
returns table (version integer, pages bigint)
language sql stable security invoker set search_path = '' as $$
  select o.template_version, count(*)
  from public.page_template_origin o
  where o.template_id = p_template
  group by o.template_version;
$$;
revoke all on function public.template_v2_version_pages(uuid) from public, anon;
grant execute on function public.template_v2_version_pages(uuid) to authenticated, service_role;
