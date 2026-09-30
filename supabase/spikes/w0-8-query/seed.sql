-- W0-8 spike seed: :tasks Task objects (default 5,000) with 10 custom
-- properties each, plus :projects Project objects they relate to.
-- Needs schema.sql and the normal local seed (npm run db:seed) first.
-- Run through: node scripts/spikes/w0-8-query.mjs seed [tasks]
--
-- Deterministic (setseed), so every run produces the same data and the
-- benchmark numbers are comparable between runs.

\if :{?tasks}
\else
  \set tasks 5000
\endif
\if :{?projects}
\else
  \set projects 200
\endif

begin;

select setseed(0.42) \g /dev/null

truncate wos_spike.object_relation, wos_spike.property_value, wos_spike.object,
  wos_spike.property_definition, wos_spike.object_type;

create temp table spike_ctx on commit drop as
select
  (select id from public.organization order by created_at limit 1) as org_id,
  (select array_agg(id order by name) from public.program) as spaces,
  (select array_agg(user_id order by user_id) from public.organization_membership
    where status = 'active') as people;

insert into wos_spike.object_type (organization_id, key, name_en, name_fr)
select org_id, t.key, t.en, t.fr
from spike_ctx, (values ('task', 'Task', 'Tâche'), ('project', 'Project', 'Projet')) t(key, en, fr);

create temp table spike_types on commit drop as
select key, id from wos_spike.object_type;

-- Project properties.
insert into wos_spike.property_definition (type_id, key, name_en, name_fr, kind, options, position)
select (select id from spike_types where key = 'project'), p.key, p.en, p.fr, p.kind, p.options::jsonb, p.pos
from (values
  ('phase', 'Phase', 'Phase', 'select',
    '[{"id":"plan","en":"Plan","fr":"Planifier"},{"id":"run","en":"Run","fr":"Réaliser"},{"id":"close","en":"Close","fr":"Clore"}]', 1),
  ('budget', 'Budget', 'Budget', 'number', '[]', 2)
) p(key, en, fr, kind, options, pos);

-- The ten Task custom properties.
insert into wos_spike.property_definition (type_id, key, name_en, name_fr, kind, options, target_type_id, position)
select (select id from spike_types where key = 'task'), p.key, p.en, p.fr, p.kind, p.options::jsonb,
  case when p.kind = 'relation' then (select id from spike_types where key = 'project') end, p.pos
from (values
  ('stage', 'Stage', 'Étape', 'select',
    '[{"id":"backlog","en":"Backlog","fr":"Réserve"},{"id":"todo","en":"To do","fr":"À faire"},{"id":"doing","en":"Doing","fr":"En cours"},{"id":"review","en":"Review","fr":"Révision"},{"id":"done","en":"Done","fr":"Terminé"}]', 1),
  ('priority', 'Priority', 'Priorité', 'select',
    '[{"id":"low","en":"Low","fr":"Basse"},{"id":"medium","en":"Medium","fr":"Moyenne"},{"id":"high","en":"High","fr":"Haute"},{"id":"urgent","en":"Urgent","fr":"Urgente"}]', 2),
  ('tags', 'Tags', 'Étiquettes', 'multi_select',
    '[{"id":"finance","en":"Finance","fr":"Finances"},{"id":"events","en":"Events","fr":"Événements"},{"id":"youth","en":"Youth","fr":"Jeunesse"},{"id":"board","en":"Board","fr":"Conseil"},{"id":"grants","en":"Grants","fr":"Subventions"},{"id":"comms","en":"Comms","fr":"Communications"},{"id":"it","en":"IT","fr":"TI"},{"id":"legal","en":"Legal","fr":"Juridique"}]', 3),
  ('due', 'Due', 'Échéance', 'date', '[]', 4),
  ('estimate', 'Estimate (h)', 'Estimation (h)', 'number', '[]', 5),
  ('points', 'Points', 'Points', 'number', '[]', 6),
  ('reviewers', 'Reviewers', 'Réviseurs', 'person', '[]', 7),
  ('notes', 'Notes', 'Notes', 'text', '[]', 8),
  ('approved', 'Approved', 'Approuvé', 'checkbox', '[]', 9),
  ('project', 'Project', 'Projet', 'relation', '[]', 10)
) p(key, en, fr, kind, options, pos);

create temp table spike_props on commit drop as
select t.key as type_key, d.key, d.id from wos_spike.property_definition d
join wos_spike.object_type t on t.id = d.type_id;

-- Spaces: 45% in each of the first two programs, 10% with no space.
create function pg_temp.pick_space(r double precision, spaces uuid[]) returns uuid
language sql immutable as $$
  select case when r < 0.45 then spaces[1] when r < 0.9 then spaces[2] else null end
$$;

-- Projects.
insert into wos_spike.object (organization_id, type_id, space_id, title, owner_id, created_at, updated_at)
select c.org_id, (select id from spike_types where key = 'project'),
  pg_temp.pick_space(random(), c.spaces),
  'Project ' || lpad(g::text, 4, '0'),
  c.people[1 + floor(random() * array_length(c.people, 1))::int],
  now() - make_interval(days => (random() * 400)::int),
  now() - make_interval(days => (random() * 30)::int)
from spike_ctx c, generate_series(1, :projects) g;

insert into wos_spike.property_value (object_id, property_id, value_text)
select o.id, (select id from spike_props where type_key = 'project' and key = 'phase'),
  (array['plan', 'run', 'close'])[1 + floor(random() * 3)::int]
from wos_spike.object o where o.type_id = (select id from spike_types where key = 'project');

insert into wos_spike.property_value (object_id, property_id, value_number)
select o.id, (select id from spike_props where type_key = 'project' and key = 'budget'),
  round((random() * 50000)::numeric, 2)
from wos_spike.object o where o.type_id = (select id from spike_types where key = 'project');

-- Tasks.
insert into wos_spike.object (organization_id, type_id, space_id, title, owner_id, created_at, updated_at, archived_at)
select c.org_id, (select id from spike_types where key = 'task'),
  pg_temp.pick_space(random(), c.spaces),
  (array['Prepare', 'Review', 'Send', 'Plan', 'Draft', 'Call', 'Book', 'Update'])[1 + floor(random() * 8)::int]
    || ' ' ||
  (array['budget', 'newsletter', 'workshop', 'grant report', 'board minutes', 'volunteer list', 'venue', 'survey'])[1 + floor(random() * 8)::int]
    || ' #' || g,
  c.people[1 + floor(random() * array_length(c.people, 1))::int],
  now() - make_interval(days => (random() * 400)::int),
  now() - make_interval(hours => (random() * 24 * 60)::int),
  case when random() < 0.03 then now() end
from spike_ctx c, generate_series(1, :tasks) g;

create temp table spike_tasks on commit drop as
select id from wos_spike.object where type_id = (select id from spike_types where key = 'task');

-- Each value is missing about 15% of the time, so "is empty" has something to find.
insert into wos_spike.property_value (object_id, property_id, value_text)
select t.id, p.id, (array['backlog', 'todo', 'doing', 'review', 'done'])[1 + floor(random() * 5)::int]
from spike_tasks t, spike_props p where p.type_key = 'task' and p.key = 'stage' and random() > 0.15;

insert into wos_spike.property_value (object_id, property_id, value_text)
select t.id, p.id, (array['low', 'medium', 'high', 'urgent'])[1 + floor(random() * 4)::int]
from spike_tasks t, spike_props p where p.type_key = 'task' and p.key = 'priority' and random() > 0.15;

insert into wos_spike.property_value (object_id, property_id, value_json)
select x.id, x.pid, to_jsonb(x.tags)
from (
  select t.id, p.id as pid,
    array(select tag from unnest(array['finance', 'events', 'youth', 'board', 'grants', 'comms', 'it', 'legal']) tag
          where random() < 0.25 + 0 * length(t.id::text)) as tags
  from spike_tasks t, spike_props p where p.type_key = 'task' and p.key = 'tags'
) x where cardinality(x.tags) > 0;

insert into wos_spike.property_value (object_id, property_id, value_date)
select t.id, p.id, current_date + (floor(random() * 120) - 60)::int
from spike_tasks t, spike_props p where p.type_key = 'task' and p.key = 'due' and random() > 0.15;

insert into wos_spike.property_value (object_id, property_id, value_number)
select t.id, p.id, round((random() * 40)::numeric, 1)
from spike_tasks t, spike_props p where p.type_key = 'task' and p.key = 'estimate' and random() > 0.15;

insert into wos_spike.property_value (object_id, property_id, value_number)
select t.id, p.id, (array[1, 2, 3, 5, 8, 13])[1 + floor(random() * 6)::int]
from spike_tasks t, spike_props p where p.type_key = 'task' and p.key = 'points' and random() > 0.15;

insert into wos_spike.property_value (object_id, property_id, value_json)
select x.id, x.pid, to_jsonb(x.people)
from (
  select t.id, p.id as pid,
    array(select person from unnest(c.people) person
          where random() < 0.15 + 0 * length(t.id::text)) as people
  from spike_tasks t, spike_props p, spike_ctx c where p.type_key = 'task' and p.key = 'reviewers'
) x where cardinality(x.people) > 0;

insert into wos_spike.property_value (object_id, property_id, value_text)
select t.id, p.id,
  (array['Waiting on the venue', 'Needs French translation', 'Board asked for this', 'Low risk',
         'Check with finance first', 'Recurring every month', 'Blocked by legal review', 'Quick win'])[1 + floor(random() * 8)::int]
from spike_tasks t, spike_props p where p.type_key = 'task' and p.key = 'notes' and random() > 0.15;

insert into wos_spike.property_value (object_id, property_id, value_bool)
select t.id, p.id, random() < 0.4
from spike_tasks t, spike_props p where p.type_key = 'task' and p.key = 'approved' and random() > 0.15;

-- Each task belongs to one project (a few to none). Picking from all
-- projects means some tasks point at projects their viewer cannot see:
-- exactly the case the relation tests need.
insert into wos_spike.object_relation (from_id, property_id, to_id)
select t.id, p.id, pr.ids[1 + floor(random() * cardinality(pr.ids))::int]
from spike_tasks t, spike_props p,
  (select array_agg(id order by title) as ids from wos_spike.object
   where type_id = (select id from spike_types where key = 'project')) pr
where p.type_key = 'task' and p.key = 'project' and random() > 0.05;

commit;

analyze wos_spike.object;
analyze wos_spike.property_value;
analyze wos_spike.object_relation;

select
  (select count(*) from wos_spike.object where type_id = (select id from wos_spike.object_type where key = 'task')) as tasks,
  (select count(*) from wos_spike.object where type_id = (select id from wos_spike.object_type where key = 'project')) as projects,
  (select count(*) from wos_spike.property_value) as property_values,
  (select count(*) from wos_spike.object_relation) as relations;
