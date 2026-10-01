-- Equivalence report (see equivalence-setup.sql): the trigger-kept cache
-- against a full rebuild, then every mismatch found. Fails if there is one.
-- Rolled back: the rebuild is only for the comparison.

begin;

-- The trigger-maintained cache, row for row, against a rebuild from scratch.
create temp table eq_cache_kept as select * from spike_access.access_cache;
select spike_access.rebuild();
insert into spike_access.eq_mismatch (round, user_id, object_kind, object_id, label, capability)
select '3 cache vs rebuild', coalesce(k.user_id, r.user_id), 'cache',
       coalesce(k.object_id, r.object_id),
       format('kept %s, rebuilt %s', k.caps, r.caps), 'all'
from eq_cache_kept k
full join spike_access.access_cache r using (user_id, object_id)
where k.caps is distinct from r.caps;

\echo
\echo 'Equivalence runs'
select round, sum(people) as people, sum(checks) as checks, max(ms) as slowest_shard_ms from spike_access.eq_run group by round order by round;
\echo 'Objects compared'
select kind, count(*) from spike_access.eq_object group by kind order by kind;
\echo 'Mismatches by round and capability (none is the pass condition)'
select round, object_kind, capability, count(*) from spike_access.eq_mismatch group by 1, 2, 3 order by 1, 2, 3;
\echo 'First 30 mismatches'
select round, m.user_id, coalesce(om.role::text, 'stranger') as role, aal, object_kind, label, capability, today, spike
from spike_access.eq_mismatch m
left join public.organization_membership om on om.user_id = m.user_id
order by 1, 5, 6 limit 30;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from spike_access.eq_mismatch;
  if v_count = 0 then
    raise notice 'EQUIVALENCE PASS: zero mismatches';
  else
    raise exception 'EQUIVALENCE FAIL: % mismatches', v_count;
  end if;
end
$$;

rollback;
