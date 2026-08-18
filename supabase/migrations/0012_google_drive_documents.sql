-- Google Drive metadata links. The Hub never copies Drive file contents or
-- OAuth tokens into the browser; documents remain governed by Drive ACLs.
alter table document
  add column if not exists integration_connection_id uuid
    references integration_connection (id) on delete cascade,
  add column if not exists external_id text,
  add column if not exists external_updated_at timestamptz;

create unique index if not exists uq_document_integration_external
  on document (integration_connection_id, external_id)
  where integration_connection_id is not null and external_id is not null;

create index if not exists idx_document_integration_connection
  on document (integration_connection_id)
  where integration_connection_id is not null;
