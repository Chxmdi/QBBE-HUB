-- W0-6 co-editing spike: LOCAL DATABASE ONLY.
--
-- This file is deliberately NOT in supabase/migrations, so `supabase db push`
-- and the deploy workflow can never apply it to a hosted project. It is
-- applied to the local stack by scripts/spikes/apply-spike-schema.sh, and a
-- `supabase db reset` removes it again.
--
-- The real design (M4c) will store the Yjs state per object behind `app.can`;
-- these policies only stand in for that.

create table if not exists public.spike_yjs_update (
  id bigint generated always as identity primary key,
  doc_id text not null check (doc_id ~ '^[a-z0-9-]{1,64}$'),
  -- base64 of one merged Yjs update. PostgREST returns bytea as hex text,
  -- which is twice the size; base64 is 4/3.
  update_b64 text not null,
  client_id bigint,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists spike_yjs_update_doc_idx on public.spike_yjs_update (doc_id, id);

alter table public.spike_yjs_update enable row level security;

grant select, insert, delete on public.spike_yjs_update to authenticated;

drop policy if exists spike_yjs_update_read on public.spike_yjs_update;
create policy spike_yjs_update_read on public.spike_yjs_update
  for select to authenticated using (true);

drop policy if exists spike_yjs_update_write on public.spike_yjs_update;
create policy spike_yjs_update_write on public.spike_yjs_update
  for insert to authenticated with check (created_by = (select auth.uid()));

drop policy if exists spike_yjs_update_compact on public.spike_yjs_update;
create policy spike_yjs_update_compact on public.spike_yjs_update
  for delete to authenticated using (true);

-- Folds rows up to p_upto into one row. Rows added meanwhile have higher ids
-- and are left alone, so compaction never loses a concurrent change.
create or replace function public.spike_yjs_compact(p_doc_id text, p_merged text, p_upto bigint)
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from public.spike_yjs_update where doc_id = p_doc_id and id <= p_upto;
  insert into public.spike_yjs_update (doc_id, update_b64) values (p_doc_id, p_merged);
$$;

grant execute on function public.spike_yjs_compact(text, text, bigint) to authenticated;

-- Private broadcast channels named yjs-spike:<doc id>. Join (select) and send
-- (insert) are both checked when the channel is joined.
drop policy if exists spike_yjs_channel_read on realtime.messages;
create policy spike_yjs_channel_read on realtime.messages
  for select to authenticated
  using (realtime.topic() like 'yjs-spike:%' and extension = 'broadcast');

drop policy if exists spike_yjs_channel_write on realtime.messages;
create policy spike_yjs_channel_write on realtime.messages
  for insert to authenticated
  with check (realtime.topic() like 'yjs-spike:%' and extension = 'broadcast');
