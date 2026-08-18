-- RLS decides which row a member may update. Column privileges decide which
-- fields they may change: delivery preferences and read cursors, never roles.
revoke update on table channel_member from anon, authenticated;
grant update (muted_level, last_read_at) on table channel_member to authenticated;
