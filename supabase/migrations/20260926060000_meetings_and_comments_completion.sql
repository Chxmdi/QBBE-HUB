-- Epic #13 completion: the meeting and comment behaviours the schema already
-- anticipated but nothing enforced or used (#33, #34).
--
-- Agenda: an item can be combined into another, and carried forward to a later
-- meeting, without losing where it came from (P0-AGD-03, P1-AGD-06).
-- Comments: authors edit, authors or admins delete, anyone who can read the
-- thread resolves it, a deletion keeps its marker, and a comment may carry an
-- approved link or a document the author can read (P0-COM-02..05).

-- ---------------------------------------------------------------------------
-- Agenda: combine
-- ---------------------------------------------------------------------------

alter table public.agenda_item
  add column if not exists combined_into_id uuid
    references public.agenda_item (id) on delete set null;

alter table public.agenda_item
  drop constraint if exists agenda_item_status_is_known;
alter table public.agenda_item
  add constraint agenda_item_status_is_known
  check (status in ('proposed', 'accepted', 'deferred', 'declined', 'done', 'combined'));

-- A combined item names the item it went into, and only then.
alter table public.agenda_item
  drop constraint if exists agenda_item_combined_names_target;
alter table public.agenda_item
  add constraint agenda_item_combined_names_target
  check ((status = 'combined') = (combined_into_id is not null));

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

alter table public.record_comment
  add column if not exists deleted_by uuid references public.user_profile (id),
  add column if not exists link_url text,
  add column if not exists document_id uuid references public.document (id) on delete set null;

alter table public.record_comment
  drop constraint if exists record_comment_link_is_https;
alter table public.record_comment
  add constraint record_comment_link_is_https
  check (link_url is null or link_url ~ '^https://');

create index if not exists idx_record_comment_thread
  on public.record_comment (parent_comment_id)
  where parent_comment_id is not null;

-- Anyone who can read the thread may resolve it. What each person may change
-- is decided by the trigger below, not by this policy.
drop policy if exists record_comment_update on public.record_comment;
create policy record_comment_update on public.record_comment for update to authenticated
  using (public.can_read_comment_parent(parent_type, parent_id))
  with check (public.can_read_comment_parent(parent_type, parent_id));

create or replace function app.guard_record_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_is_author boolean;
  v_is_admin boolean;
  v_host text;
begin
  -- System operations (no signed-in user) are not restricted here.
  if v_actor is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A comment starts live: nobody posts one already resolved or deleted.
    new.edited_at := null;
    new.deleted_at := null;
    new.deleted_by := null;
    new.resolved_at := null;
    new.resolved_by := null;
    if new.document_id is not null and not exists (
      select 1 from public.document d where d.id = new.document_id
    ) then
      -- The author's own read policy on document decides this: a document
      -- they cannot read is invisible here and cannot be attached.
      raise exception 'That document is not available to attach.'
        using errcode = '42501';
    end if;
  else
    v_is_author := old.author_id = v_actor;
    v_is_admin := app.is_org_admin(old.organization_id);

    if old.deleted_at is not null then
      raise exception 'A deleted comment cannot be changed.'
        using errcode = '42501';
    end if;

    if new.author_id is distinct from old.author_id
       or new.parent_type is distinct from old.parent_type
       or new.parent_id is distinct from old.parent_id
       or new.parent_comment_id is distinct from old.parent_comment_id
       or new.organization_id is distinct from old.organization_id
       or new.created_at is distinct from old.created_at then
      raise exception 'Where a comment sits and who wrote it cannot change.'
        using errcode = '42501';
    end if;

    if (new.body is distinct from old.body
        or new.link_url is distinct from old.link_url
        or new.document_id is distinct from old.document_id)
       and not v_is_author then
      raise exception 'Only the author can edit a comment.'
        using errcode = '42501';
    end if;

    if new.body is distinct from old.body
       or new.link_url is distinct from old.link_url
       or new.document_id is distinct from old.document_id then
      new.edited_at := now();
    else
      new.edited_at := old.edited_at;
    end if;

    if new.deleted_at is distinct from old.deleted_at then
      if not (v_is_author or v_is_admin) then
        raise exception 'Only the author or an administrator can delete a comment.'
          using errcode = '42501';
      end if;
      new.deleted_at := now();
      new.deleted_by := v_actor;
      insert into public.audit_event (
        organization_id, actor_id, actor_type, event_type, action,
        object_type, object_id, metadata
      ) values (
        old.organization_id, v_actor, 'user', 'comment.deletion', 'deleted',
        'record_comment', old.id,
        jsonb_build_object('parent_type', old.parent_type, 'parent_id', old.parent_id)
      );
    else
      new.deleted_by := old.deleted_by;
    end if;

    if new.resolved_at is distinct from old.resolved_at then
      new.resolved_by := case when new.resolved_at is null then null else v_actor end;
    else
      new.resolved_by := old.resolved_by;
    end if;
  end if;

  -- A link must be on a host the organization approved, the same rule
  -- documents follow (P0-FIL-01).
  if new.link_url is not null
     and (tg_op = 'INSERT' or new.link_url is distinct from old.link_url) then
    v_host := app.approved_link_host(new.link_url);
    if v_host is null or not exists (
      select 1 from public.approved_document_host h
      where h.organization_id = new.organization_id and h.host = v_host
    ) then
      raise exception '% is not an approved source for links.', coalesce(v_host, 'That address')
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function app.guard_record_comment() from public, anon, authenticated;

drop trigger if exists record_comment_guard on public.record_comment;
create trigger record_comment_guard
  before insert or update on public.record_comment
  for each row execute function app.guard_record_comment();
