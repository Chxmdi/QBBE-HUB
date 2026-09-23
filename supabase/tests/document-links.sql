-- P0-FIL-01: an external resource link must point at an approved source.
--
-- These assertions live at the database rather than beside the form, because
-- the form is not where the guarantee is. `createDocumentLink` checks the host
-- so it can name the sources that would work, but PostgREST is reachable
-- without the form at all, and the trigger is what makes the answer the same
-- either way.
--
-- Transactional; fixtures are rolled back.
begin;
do $$
declare
  u uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  org uuid;
  other_org uuid;
  doc uuid;
  n int;
begin
  select organization_id into strict org
    from public.organization_membership where user_id = u limit 1;

  -- The seed every organization starts with, so the dialog's long-standing
  -- suggestion of Google Drive is now something the database agrees with.
  select count(*) into n
    from public.approved_document_host
   where organization_id = org and host = 'drive.google.com';
  perform tests.ok(n = 1, 'Google Drive is an approved source out of the box');

  perform tests.authenticate(u);

  -- Allowed.
  insert into public.document(organization_id, title, kind, url, owner_id, created_by)
    values(org, 'Approved link', 'link', 'https://drive.google.com/file/d/abc/view', u, u)
    returning id into doc;
  perform tests.ok(doc is not null, 'a link to an approved source is accepted');

  -- A subdomain of an approved host is not the approved host. Exact matching is
  -- the point: `drive.google.com.evil.example` ends with the approved string
  -- and is a different site entirely.
  begin
    insert into public.document(organization_id, title, kind, url, owner_id, created_by)
      values(org, 'Lookalike', 'link', 'https://drive.google.com.evil.example/x', u, u);
    raise exception 'FAIL: a lookalike host was accepted';
  exception when check_violation then null; end;
  perform tests.ok(true, 'a host that merely contains an approved name is refused');

  -- The plain third-party case the row is actually about.
  begin
    insert into public.document(organization_id, title, kind, url, owner_id, created_by)
      values(org, 'Somewhere else', 'link', 'https://example.com/plan.pdf', u, u);
    raise exception 'FAIL: an unapproved host was accepted';
  exception when check_violation then null; end;
  perform tests.ok(true, 'a link to an unapproved source is refused');

  -- `javascript:` and `data:` are both valid URLs to a parser, and a link
  -- document's stored URL is what `window.open` is later handed. Neither has a
  -- host to compare, so requiring https is what actually excludes them.
  begin
    insert into public.document(organization_id, title, kind, url, owner_id, created_by)
      values(org, 'Script link', 'link', 'javascript:alert(1)', u, u);
    raise exception 'FAIL: a javascript: URL was accepted';
  exception when check_violation then null; end;
  perform tests.ok(true, 'a javascript: URL is refused');

  begin
    insert into public.document(organization_id, title, kind, url, owner_id, created_by)
      values(org, 'Data link', 'link', 'data:text/html,<script>alert(1)</script>', u, u);
    raise exception 'FAIL: a data: URL was accepted';
  exception when check_violation then null; end;
  perform tests.ok(true, 'a data: URL is refused');

  -- http is not https. The library hands these links to other people's
  -- browsers, so the transport is part of what "approved source" means.
  begin
    insert into public.document(organization_id, title, kind, url, owner_id, created_by)
      values(org, 'Insecure', 'link', 'http://drive.google.com/x', u, u);
    raise exception 'FAIL: an http URL was accepted';
  exception when check_violation then null; end;
  perform tests.ok(true, 'an http link to an otherwise approved host is refused');

  -- An approved link cannot be edited into an unapproved one afterwards. The
  -- trigger fires on update of `url` for exactly this reason: a check that only
  -- ran at insert would be a formality.
  begin
    update public.document set url = 'https://example.com/moved' where id = doc;
    raise exception 'FAIL: an approved link was edited to an unapproved host';
  exception when check_violation then null; end;
  perform tests.ok(true, 'an approved link cannot be edited into an unapproved one');

  -- A file document has no URL to approve and must be unaffected, or the guard
  -- would have broken uploads to fix links.
  insert into storage.objects(bucket_id, name, owner_id)
    values ('documents', 'link-guard/file.txt', u::text);
  insert into public.document(organization_id, title, kind, storage_path, owner_id, created_by)
    values(org, 'Untouched upload', 'file', 'link-guard/file.txt', u, u);
  perform tests.ok(true, 'an uploaded file is unaffected by the link guard');

  -- Approval is per organization, not global. Another organization's allowlist
  -- says nothing about this one's.
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  insert into public.organization(name, slug) values ('Other org', 'other-org-link-test')
    returning id into other_org;
  insert into public.approved_document_host(organization_id, host, label)
    values (other_org, 'files.other-org.example', 'Other org files');
  perform tests.authenticate(u);
  begin
    insert into public.document(organization_id, title, kind, url, owner_id, created_by)
      values(org, 'Borrowed approval', 'link', 'https://files.other-org.example/x', u, u);
    raise exception 'FAIL: one organization used another organization''s allowlist';
  exception when check_violation then null; end;
  perform tests.ok(true, 'a host approved by another organization is not approved here');

  -- Who may change the policy. Everyone who can use the library can see what
  -- it accepts, because the form has to be able to say so; only an
  -- administrator can widen it.
  --
  -- Both non-admin roles are checked by name. An earlier version of this file
  -- called `…aaa2` a volunteer and described it as a read-only member. It is
  -- `qa-staff`, so the assertion was true about a person it had misnamed, and
  -- the role the wording claimed to cover was never exercised at all.
  perform tests.authenticate(staff);
  select count(*) into n from public.approved_document_host where organization_id = org;
  perform tests.ok(n > 0, 'a staff member can see the approved sources');
  begin
    insert into public.approved_document_host(organization_id, host, label)
      values (org, 'dropbox.example', 'Personal');
    raise exception 'FAIL: a staff member added an approved source';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'a staff member cannot add an approved source');

  perform tests.authenticate(volunteer);
  select count(*) into n from public.approved_document_host where organization_id = org;
  perform tests.ok(n > 0, 'a read-only member can see the approved sources');
  begin
    insert into public.approved_document_host(organization_id, host, label)
      values (org, 'personal-drive.example', 'Personal');
    raise exception 'FAIL: a volunteer added an approved source';
  exception when insufficient_privilege then null; end;
  perform tests.ok(true, 'a read-only member cannot add an approved source');

  reset role;
  perform set_config('request.jwt.claims', '{}', true);
end;
$$;
rollback;
