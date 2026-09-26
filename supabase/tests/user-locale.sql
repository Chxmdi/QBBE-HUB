-- #141: the per-person interface language.
--
-- A person can set and clear their own language, cannot store a language no
-- catalogue exists for, and cannot change anybody else's.
--
-- Transactional; fixtures are rolled back.
begin;
do $$
declare
  owner_u uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v text;
  n int;
begin
  perform tests.authenticate(staff, 'aal1');

  update public.user_profile set locale = 'fr-CA' where id = staff;
  select locale into v from public.user_profile where id = staff;
  perform tests.ok(v = 'fr-CA', 'a person can choose French for themselves');

  update public.user_profile set locale = null where id = staff;
  select locale into v from public.user_profile where id = staff;
  perform tests.ok(v is null, 'a person can go back to following the browser');

  begin
    update public.user_profile set locale = 'de' where id = staff;
    perform tests.ok(false, 'an unsupported language is refused');
  exception when check_violation then
    perform tests.ok(true, 'an unsupported language is refused');
  end;

  update public.user_profile set locale = 'fr-CA' where id = owner_u;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'a person cannot change someone else''s language');

  perform tests.clear_auth();
  select locale into v from public.user_profile where id = owner_u;
  perform tests.ok(v is distinct from 'fr-CA', 'the other person''s language is unchanged');
end $$;
rollback;
