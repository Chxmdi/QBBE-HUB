-- Fix a broken deep link: global_search returned '/tasks?task=<id>' but no
-- /tasks route exists. Tasks open through the My Work drawer, which reads
-- the ?task= parameter (WORK-008, P0-UX-06).

create or replace function public.global_search(p_query text, p_limit int default 20)
returns table (
  result_type text,
  id uuid,
  title text,
  snippet text,
  href text
)
language sql stable security invoker
set search_path = public
as $$
  with q as (select '%' || trim(p_query) || '%' as pattern)
  (
    select 'task', t.id, t.title, coalesce(left(t.description, 120), ''),
           '/my-work?task=' || t.id
    from task t, q where t.title ilike q.pattern and t.archived_at is null
    limit p_limit
  )
  union all
  (
    select 'project', p.id, p.name, coalesce(left(p.outcome, 120), ''),
           '/projects/' || p.id
    from project p, q where p.name ilike q.pattern and p.archived_at is null
    limit p_limit
  )
  union all
  (
    select 'program', pr.id, pr.name, coalesce(left(pr.description, 120), ''),
           '/programs/' || pr.id
    from program pr, q where pr.name ilike q.pattern and pr.archived_at is null
    limit p_limit
  )
  union all
  (
    select 'channel', c.id, '#' || c.slug, coalesce(c.purpose, ''),
           '/channels/' || c.id
    from channel c, q where (c.name ilike q.pattern or c.slug ilike q.pattern)
      and c.archived_at is null
    limit p_limit
  )
  union all
  (
    select 'message', m.id,
           left(m.body, 80),
           'in conversation',
           case when m.channel_id is not null
             then '/channels/' || m.channel_id || '?message=' || m.id
             else '/messages/' || m.conversation_id end
    from message m, q
    where m.body ilike q.pattern and m.deleted_at is null
    order by m.created_at desc
    limit p_limit
  )
  union all
  (
    select 'person', u.id, u.full_name, coalesce(u.title, ''),
           '/people?person=' || u.id
    from user_profile u, q where u.full_name ilike q.pattern
    limit p_limit
  )
  union all
  (
    select 'meeting', mt.id, mt.title, to_char(mt.starts_at, 'YYYY-MM-DD HH24:MI'),
           '/meetings/' || mt.id
    from meeting mt, q where mt.title ilike q.pattern
    limit p_limit
  )
  union all
  (
    select 'event', e.id, e.name, to_char(e.starts_at, 'YYYY-MM-DD'),
           '/events/' || e.id
    from event e, q where e.name ilike q.pattern
    limit p_limit
  )
  union all
  (
    select 'crm', co.id, co.name, co.category, '/crm/' || co.id
    from crm_organization co, q where co.name ilike q.pattern
    limit p_limit
  )
  limit p_limit;
$$;
