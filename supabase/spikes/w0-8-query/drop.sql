-- Remove the W0-8 spike from the LOCAL database.
drop schema if exists wos_spike cascade;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'wos_spike_lens_runner') then
    drop role wos_spike_lens_runner;
  end if;
end $$;
