-- Mention metadata has the same confidentiality boundary as its source
-- message. A recipient may always read their own mention; other users need
-- message visibility (which enforces channel/conversation membership).
drop policy if exists mention_read on message_mention;

create policy mention_read on message_mention
  for select to authenticated
  using (
    mentioned_user_id = (select auth.uid())
    or exists (
      select 1
      from message m
      where m.id = message_id
    )
  );
