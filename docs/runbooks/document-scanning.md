# Document scanning

The `scan-documents` job scans at most two pending files per minute, records
ClamAV verdicts, and leaves files pending when Storage or scanning fails.
The existing job runner records failures in Admin → Jobs. Configure and verify
alerts before enabling uploads for users.

Run the job on a QBBE-controlled Node host with ClamAV installed. Set
`CLAMAV_SOCKET` to its private Unix socket, update signatures with `freshclam`,
and configure `StreamMaxLength` to at least 25 MB. Configure ClamAV to flag
scan-limit exceedances and encrypted archives/documents; inaccessible contents
must not receive a clean verdict. Keep signatures updated automatically.

This worker requires a host that can access the Unix socket. The current
Netlify configuration does not provision ClamAV or that host. Scanner hosting,
routing the authenticated cron job to it, signature freshness monitoring, and
live clean/EICAR/encrypted-file acceptance remain release prerequisites.
The endpoint uses the existing `/api/jobs/scan-documents` cron authentication.

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
