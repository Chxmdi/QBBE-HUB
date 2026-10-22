-- Correcting and erasing CRM contacts.
--
-- A donor's or partner's contact could not be corrected (no edit command)
-- or erased in the Hub, and the Zeffy sync re-created contacts deleted by
-- hand and overwrote local corrections of Zeffy-created contacts. When
-- Zeffy reported a contact deleted, only the link was cleared, so the
-- person's name, email and phone stayed.
--
-- Now:
-- - crm_contact.details_edited_at marks a contact whose details someone
--   corrected in the Hub; the sync no longer overwrites those.
-- - public.zeffy_suppressed_contact lists Zeffy identities that must not
--   be imported again.
-- - public.erase_crm_contact (administrators with MFA, and the service role
--   for Zeffy deletions) blanks the contact's identity, deletes its
--   sensitive note, redacts interaction, follow-up and agreement text, the contact's own history and the Zeffy match queue, suppresses
--   its Zeffy identity and email (hashed) and writes an audit entry. Gift and
--   payment amounts stay, attached to the anonymous contact, for the tax
--   record period; issued tax receipts are kept as issued.

alter table public.crm_contact add column if not exists details_edited_at timestamptz;

comment on column public.crm_contact.details_edited_at is
  'When someone last corrected the contact''s details in the Hub. The Zeffy sync does not overwrite a corrected contact.';

create table if not exists public.zeffy_suppressed_contact (
  organization_id uuid not null references public.organization (id) on delete cascade,
  zeffy_contact_id text not null check (char_length(zeffy_contact_id) between 1 and 200),
  -- The erased person's email, hashed (sha-256 of the lowercased address),
  -- so a new Zeffy identity with the same email is not imported either,
  -- without keeping the address itself.
  email_sha256 text check (email_sha256 is null or email_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid references public.user_profile (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id, zeffy_contact_id)
);

create index if not exists zeffy_suppressed_contact_email
  on public.zeffy_suppressed_contact (organization_id, email_sha256) where email_sha256 is not null;

comment on table public.zeffy_suppressed_contact is
  'Zeffy identities erased from the CRM; the Zeffy sync never imports or links them again.';

alter table public.zeffy_suppressed_contact enable row level security;

revoke all on table public.zeffy_suppressed_contact from public, anon, authenticated;
grant select on table public.zeffy_suppressed_contact to authenticated;
grant select, insert, update, delete on table public.zeffy_suppressed_contact to service_role;

create policy zeffy_suppressed_contact_admin_read on public.zeffy_suppressed_contact
  for select to authenticated
  using (app.is_org_admin(organization_id));

create or replace function public.erase_crm_contact(p_contact uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact public.crm_contact;
begin
  select * into v_contact from public.crm_contact where id = p_contact for update;
  if not found then
    raise exception 'That contact is not available.' using errcode = 'no_data_found';
  end if;
  -- is_org_admin is also true for the service role (Zeffy deletions).
  if not app.is_org_admin(v_contact.organization_id) then
    raise exception 'Only an administrator with MFA can erase a contact.' using errcode = '42501';
  end if;

  if v_contact.zeffy_contact_id is not null or v_contact.email is not null then
    insert into public.zeffy_suppressed_contact (organization_id, zeffy_contact_id, email_sha256, created_by)
    values (v_contact.organization_id,
            coalesce(v_contact.zeffy_contact_id, 'hub:' || v_contact.id::text),
            case when v_contact.email is null then null
                 else encode(extensions.digest(lower(btrim(v_contact.email)), 'sha256'), 'hex') end,
            (select auth.uid()))
    on conflict (organization_id, zeffy_contact_id) do update
      set email_sha256 = coalesce(excluded.email_sha256, public.zeffy_suppressed_contact.email_sha256);
  end if;
  if v_contact.zeffy_contact_id is not null then
    delete from public.zeffy_contact_match
    where organization_id = v_contact.organization_id and zeffy_contact_id = v_contact.zeffy_contact_id;
    update public.zeffy_payment
    set company_name = null, receipt_url = null
    where organization_id = v_contact.organization_id and zeffy_contact_id = v_contact.zeffy_contact_id;
  end if;
  -- Any match still offering this contact as a candidate.
  update public.zeffy_contact_match
  set candidate_ids = array_remove(candidate_ids, p_contact)
  where organization_id = v_contact.organization_id and p_contact = any (candidate_ids);

  delete from public.crm_sensitive_note where crm_contact_id = p_contact;
  update public.crm_interaction
  set summary = '[erased]', next_steps = null
  where contact_id = p_contact;
  update public.crm_follow_up set title = '[erased]' where contact_id = p_contact;
  update public.crm_agreement set notes = null where contact_id = p_contact;

  perform set_config('app.zeffy_link', 'on', true);
  update public.crm_contact
  set full_name = 'Erased contact',
      role_title = null,
      email = null,
      phone = null,
      preferred_channel = null,
      notes = null,
      communication_notes = null,
      status = 'inactive',
      next_action_at = null,
      zeffy_contact_id = null,
      zeffy_kinds = '{}',
      zeffy_last_activity_at = null,
      details_edited_at = now()
  where id = p_contact;
  perform set_config('app.zeffy_link', '', true);

  -- The contact's history named them (every rename and the erasure itself
  -- are recorded with the old name); it keeps that something changed, not
  -- what it said.
  update public.object_event
  set changes = coalesce((
    select jsonb_agg(jsonb_build_object('property', e->'property', 'before', null, 'after', null, 'erased', true))
    from jsonb_array_elements(changes) e), '[]'::jsonb)
  where object_id = p_contact;
  update public.activity_entry
  set subject = null, details = jsonb_build_object('erased', true)
  where object_id = p_contact;

  insert into public.audit_event (organization_id, actor_id, actor_type, event_type, action, object_type, object_id, metadata)
  values (v_contact.organization_id, (select auth.uid()),
          case when (select auth.uid()) is null then 'system' else 'user' end,
          'privacy', 'crm_contact_erased', 'crm_contact', p_contact,
          jsonb_build_object('zeffy_suppressed', v_contact.zeffy_contact_id is not null));
end;
$$;

revoke all on function public.erase_crm_contact(uuid) from public, anon;
grant execute on function public.erase_crm_contact(uuid) to authenticated, service_role;
