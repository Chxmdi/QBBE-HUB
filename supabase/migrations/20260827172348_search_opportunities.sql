-- QBBE Hub — teach global search about the funding pipeline.
--
-- An opportunity is the record somebody looks for by the funder's name months
-- after the conversation started, so it belongs in search for exactly the same
-- reason risks and documents did. It also matches on the body, because the
-- title is usually the programme and the funder's name is in the description.
--
-- Live bids rank above decided ones, and within each group the larger request
-- first: if the limit cuts the list, the bid worth the most attention survives.
--
-- Everything else is unchanged from the previous definition, restated in full
-- because a function is replaced whole. Still SECURITY INVOKER, so the CRM
-- policy decides who sees any of it — a volunteer searching a funder's name
-- finds nothing, which is the correct answer.

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
      -- Newest first, here and for documents: recency is the only relevance
      -- signal these two have.
      select 'message', m.id,
             left(m.body, 80),
             'in conversation',
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
      select 'crm', co.id, co.name, co.category, '/crm/' || co.id, 0
      from crm_organization co, q where co.name ilike q.pattern
      limit p_limit
    )
    union all
    (
      -- Worst first, and live risks ahead of settled ones: if the limit cuts
      -- the list short, it should cut the ones nobody is worried about.
      select 'risk', r.id, r.title,
             p.name || ' · ' || r.status || ' · ' || r.likelihood || '/' || r.impact,
             '/projects/' || r.project_id || '?tab=risks&risk=' || r.id,
             (case when r.status in ('accepted', 'closed') then 10 else 0 end) - r.score
      from risk r
        join project p on p.id = r.project_id, q
      where r.title ilike q.pattern or r.description ilike q.pattern
      order by 6
      limit p_limit
    )
    union all
    (
      select 'issue', i.id, i.title,
             p.name || ' · ' || i.status || ' · ' || i.severity,
             '/projects/' || i.project_id || '?tab=risks&issue=' || i.id,
             (case when i.status in ('resolved', 'closed') then 10 else 0 end)
               - (case i.severity
                    when 'critical' then 4 when 'high' then 3
                    when 'medium' then 2 else 1 end)
      from issue i
        join project p on p.id = i.project_id, q
      where i.title ilike q.pattern or i.description ilike q.pattern
      order by 6
      limit p_limit
    )
    union all
    (
      select 'document', d.id, d.title,
             coalesce(
               left(d.description, 120),
               case when d.kind = 'file' then 'File' else 'Link' end),
             '/documents?document=' || d.id,
             (-extract(epoch from d.created_at))::bigint
      from document d, q
      where (d.title ilike q.pattern or d.description ilike q.pattern)
        and d.archived_at is null
      order by 6
      limit p_limit
    )
    union all
    (
      -- Funding conversations, live ones first and largest first within that:
      -- if the limit bites, it should keep the bid worth the most attention.
      select 'opportunity', o.id, o.title,
             c.name || ' · ' || o.stage
               || coalesce(' · ' || o.currency || ' ' ||
                           to_char(coalesce(o.amount_awarded, o.amount_requested),
                                   'FM999,999,999'), ''),
             '/crm/' || o.crm_organization_id || '?opportunity=' || o.id,
             (case when o.is_open then 0 else 1000000000 end)
               - coalesce(o.amount_requested, 0)::bigint
      from opportunity o
        join crm_organization c on c.id = o.crm_organization_id, q
      where o.title ilike q.pattern or o.description ilike q.pattern
      order by 6
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
  -- Round-robin: the best of each type, then the second of each, and so on.
  -- Within one round the order is a deliberate priority, not alphabetical:
  -- a two-character query is far more often a person or a task than a phrase
  -- buried in a message body, so message matches go last.
  order by r.rank_in_type,
           case r.result_type
             when 'person' then 1 when 'task' then 2 when 'project' then 3
             when 'program' then 4 when 'channel' then 5 when 'meeting' then 6
             when 'event' then 7 when 'document' then 8 when 'risk' then 9
             when 'issue' then 10 when 'opportunity' then 11 when 'crm' then 12
             else 13
           end,
           r.sort_key
  limit p_limit;
$$;

comment on function public.global_search(text, int) is
  'Permission-safe cross-entity search. SECURITY INVOKER, so RLS decides what each caller sees. Results are round-robined across types so no type is starved by the limit.';
