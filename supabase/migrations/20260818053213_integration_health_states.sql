-- Keep health states finite and consistently actionable across providers.
-- `error` remains temporarily valid for rows written by earlier releases.
alter table integration_connection
  add constraint integration_connection_status_check
  check (status in (
    'connected',
    'disconnected',
    'degraded',
    'authentication_expired',
    'synchronization_delayed',
    'configuration_required',
    'error'
  ));
