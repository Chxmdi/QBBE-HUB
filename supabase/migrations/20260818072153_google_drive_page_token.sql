-- Server-only cursor for Google Drive's durable changes feed.
alter table integration_secret
  add column if not exists google_drive_page_token text;
