# Document scanning

The `scan-documents` job scans at most two pending files per minute, records
ClamAV verdicts, and leaves files pending when Storage or scanning fails.
The existing job runner records failures in Admin → Jobs. Configure and verify
alerts before enabling uploads for users.

The job reaches clamd one of two ways:

- `CLAMAV_SOCKET`: clamd's private Unix socket, when the job route and clamd
  run on the same QBBE-controlled host.
- `CLAMAV_HOST` and `CLAMAV_PORT` (3310 by default): clamd over a private
  network. This is the form a serverless site uses: run the official
  `clamav/clamav` container (or a clamd package) on a small QBBE-controlled
  host or container service, reachable from the site's outbound network only.
  clamd's protocol has no authentication, so the port must never be open to
  the public internet; put it on a private network, a VPN or a firewall
  allowlist of the site's egress addresses.

Either way: update signatures with `freshclam` (the container does this on
its own), set `StreamMaxLength` to at least 25 MB, and configure ClamAV to
flag scan-limit exceedances and encrypted archives/documents; inaccessible
contents must not receive a clean verdict. Keep signatures updated
automatically.

Scanner hosting, signature freshness monitoring, and live
clean/EICAR/encrypted-file acceptance remain release prerequisites. The job
runs under the existing `/api/jobs/scan-documents` cron authentication; to run
it now, `npm run jobs:run -- scan-documents` with the site's `CRON_JOB_SECRET`
(see jobs.md).

Locally: `docker run --rm -p 3310:3310 clamav/clamav`, start the site with
`CLAMAV_HOST=127.0.0.1` and a `CRON_JOB_SECRET`, upload a file, then run the
job with `npm run jobs:run -- scan-documents`; the file turns clean or
quarantined within the minute.

Storage RLS blocks direct reads until a document is clean. Authenticated callers
cannot set scan results, register another user's upload, change its storage
path, or overwrite/delete registered bytes. Archive resources through the app;
trusted retention jobs handle physical deletion. Existing uploaded files default
to pending and must pass scanning before download.

Verify: upload a harmless file and confirm it becomes downloadable; use the
standard EICAR test file and confirm it remains quarantined; disconnect the
scanner and confirm files remain pending and the job records failure. Repeat
with direct Storage requests and an unauthorized account. Unit tests validate
worker failures and verdict parsing; they do not certify a running antivirus.

Protocol reference: https://docs.clamav.net/manual/Usage/ClamdProtocol.html
Storage policy reference: https://supabase.com/docs/guides/storage/security/access-control
