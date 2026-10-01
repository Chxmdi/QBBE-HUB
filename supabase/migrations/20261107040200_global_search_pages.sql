-- QBBE Hub — the palette's search finds pages too.
--
-- global_search feeds the "Search or jump to…" box and the classic search
-- page. It knew every record kind except the Workspace OS page, so typing a
-- page's name there found nothing. The page member below matches the title
-- or any block text (the rows the editor derives on save), links to the page
-- and leaves the trash out. Security invoker as before: page_read and
-- block_read decide every row. Find (20261107040100) gained the same.

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
  with q as (select '%' || trim(p_query) || '%' as pattern),
  hits as (
    (
      select 'task' as result_type, t.id, t.title,
             coalesce(left(t.description, 120), '') as snippet,
             '/my-work?task=' || t.id as href,
             0::bigint as sort_key
      from task t, q where t.title ilike q.pattern and t.archived_at is null
      limit p_limit
    )
    union all
    (
      select 'project', p.id, p.name, coalesce(left(p.outcome, 120), ''),
             '/projects/' || p.id, 0
      from project p, q where p.name ilike q.pattern and p.archived_at is null
      limit p_limit
    )
    union all
    (
      select 'program', pr.id, pr.name, coalesce(left(pr.description, 120), ''),
             '/programs/' || pr.id, 0
      from program pr, q where pr.name ilike q.pattern and pr.archived_at is null
      limit p_limit
    )
    union all
    (
      select 'channel', c.id, '#' || c.slug, coalesce(c.purpose, ''),
             '/channels/' || c.id, 0
      from channel c, q where (c.name ilike q.pattern or c.slug ilike q.pattern)
        and c.archived_at is null
      limit p_limit
    )
    union all
    (
      select 'message', m.id, left(m.body, 80), 'in conversation',
             case when m.channel_id is not null
               then '/channels/' || m.channel_id || '?message=' || m.id
               else '/messages/' || m.conversation_id end,
             (-extract(epoch from m.created_at))::bigint
      from message m, q
      where m.body ilike q.pattern and m.deleted_at is null
      order by 6
      limit p_limit
    )
    union all
    (
      select 'person', u.id, u.full_name, coalesce(u.title, ''),
             '/people?person=' || u.id, 0
      from user_profile u, q where u.full_name ilike q.pattern
      limit p_limit
    )
    union all
    (
      select 'meeting', mt.id, mt.title, to_char(mt.starts_at, 'YYYY-MM-DD HH24:MI'),
             '/meetings/' || mt.id, 0
      from meeting mt, q where mt.title ilike q.pattern
      limit p_limit
    )
    union all
    (
      select 'event', e.id, e.name, to_char(e.starts_at, 'YYYY-MM-DD'),
             '/events/' || e.id, 0
      from event e, q where e.name ilike q.pattern
      limit p_limit
    )
    union all
    (
      select 'agenda', a.id, a.title, coalesce(a.desired_outcome, a.kind::text),
             '/meetings/' || a.meeting_id || '?item=' || a.id, 0
      from agenda_item a, q where a.title ilike q.pattern
      limit p_limit
    )
    union all
    (
      select 'crm', co.id, co.name, co.category, '/crm/' || co.id, 0
      from crm_organization co, q where co.name ilike q.pattern
      limit p_limit
    )
    union all
    (
      select 'contact', ct.id, ct.full_name, coalesce(ct.role_title, ct.email, ''),
             '/crm/' || coalesce(ct.crm_organization_id, ct.id) || '?contact=' || ct.id, 0
      from crm_contact ct, q
      where ct.full_name ilike q.pattern or coalesce(ct.email, '') ilike q.pattern
      limit p_limit
    )
    union all
    (
      select 'risk', r.id, r.title,
             p.name || ' · ' || r.status,
             '/projects/' || r.project_id || '?tab=risks&risk=' || r.id, 0
      from risk r join project p on p.id = r.project_id, q
      where r.title ilike q.pattern
      limit p_limit
    )
    union all
    (
      select 'issue', i.id, i.title,
             p.name || ' · ' || i.status,
             '/projects/' || i.project_id || '?tab=risks&issue=' || i.id, 0
      from issue i join project p on p.id = i.project_id, q
      where i.title ilike q.pattern
      limit p_limit
    )
    union all
    (
      select 'document', d.id, d.title, coalesce(left(d.description, 120), d.kind::text),
             '/documents?document=' || d.id, 0
      from document d, q
      where (d.title ilike q.pattern or d.description ilike q.pattern)
        and d.archived_at is null
      limit p_limit
    )
    union all
    (
      select 'opportunity', o.id, o.title, o.stage::text,
             '/crm/' || o.crm_organization_id || '?opportunity=' || o.id, 0
      from opportunity o, q where o.title ilike q.pattern
      limit p_limit
    )
    union all
    (
      select 'comment', c.id, left(c.body, 80), c.parent_type,
             '/search?comment=' || c.id, 0
      from record_comment c, q
      where c.body ilike q.pattern and c.deleted_at is null
      limit p_limit
    )
    union all
    (
      -- Workspace OS pages (M4a): by title, or by a word in the blocks the
      -- editor derives on every save (M4b). page_read and block_read decide
      -- what the viewer sees; the trash is left out.
      select 'page' as result_type, pg.id, pg.title,
             coalesce(left((select string_agg(b.text, ' ' order by b.position)
                            from block b where b.object_id = pg.id and b.object_type = 'page' and b.text <> ''), 120), '') as snippet,
             '/pages/' || pg.id as href,
             0::bigint as sort_key
      from page pg, q
      where pg.archived_at is null and pg.deleted_at is null
        and (pg.title ilike q.pattern
          or exists (select 1 from block b where b.object_id = pg.id and b.object_type = 'page' and b.text ilike q.pattern))
      limit p_limit
    )
  ),
  ranked as (
    select h.*,
           row_number() over (
             partition by h.result_type order by h.sort_key, h.title, h.id
           ) as rank_in_type
    from hits h
  )
  select r.result_type, r.id, r.title, r.snippet, r.href
  from ranked r
  order by r.rank_in_type,
           case r.result_type
             when 'person' then 1 when 'task' then 2 when 'project' then 3
             when 'program' then 4 when 'channel' then 5 when 'meeting' then 6
             when 'event' then 7 when 'agenda' then 8 when 'contact' then 9
             when 'document' then 10 when 'risk' then 11 when 'issue' then 12
             when 'opportunity' then 13 when 'crm' then 14 when 'comment' then 15
             else 16
           end,
           r.sort_key
  limit p_limit;
$$;
