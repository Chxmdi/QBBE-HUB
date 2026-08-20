-- Saved messages are personal bookmarks, but their source message still has
-- to be visible to the caller. This closes a guessed-ID write path and keeps
-- private channels/DMs as the final authorization boundary.

drop policy if exists saved_message_all on saved_message;

create policy saved_message_read_own on saved_message
  for select using (user_id = auth.uid());

create policy saved_message_insert_own_visible on saved_message
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from message where message.id = message_id)
  );

create policy saved_message_delete_own on saved_message
  for delete using (user_id = auth.uid());
