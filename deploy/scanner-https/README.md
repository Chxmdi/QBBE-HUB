# HTTPS scan service

Deployment candidate, not a provisioned service. Run outside Sites on an approved
container host with sufficient memory for ClamAV (start with at least 4 GB total
and measure). Sites uses HTTPS; clamd stays inside the Compose network with no
published TCP port. Files are held in memory and are not intentionally persisted.

## Setup by the infrastructure owner

1. Approve the provider, region, data-processing terms and monthly cost. Provision
   the host and scanner hostname; DNS/firewall changes require owner approval.
2. Install Docker/Compose using the provider's supported instructions. Copy this
   directory only; it does not modify the existing `deploy/server` deployment.
3. Supply `SCANNER_DOMAIN`, `SCANNER_HTTPS_TOKEN` (random, at least 32 characters),
   and an approved pinned `CLAMAV_IMAGE` through the host's secret/configuration
   mechanism. Never commit the token. Pin Node/Caddy image digests before a
   production release as part of image review.
4. Run `docker compose up -d --build`. Allow initial signature download to finish.
   Only Caddy exposes ports 80/443. Keep host administration restricted.
5. Verify authenticated `GET https://<hostname>/health` returns 200/ready. It
   requires `Authorization: Bearer <token>` and checks a real empty scan plus
   the local daily database modification time (maximum age 72 hours).
6. Exercise clean, EICAR test, timeout, outage and maximum-size cases on the real
   service. No production file is needed. Record image versions and results.
7. In Sites settings set `SCANNER_HTTPS_URL=https://<hostname>/v1/scan` and the same
   `SCANNER_HTTPS_TOKEN`, marked secret. Redeploy the selected saved app version.
8. Activate scan jobs only after the scheduler rollout review. Confirm all three
   upload types move through pending to their correct final status.

## Contract and operations

POST `/v1/scan`, octet-stream body, Bearer authorization and lowercase
`X-Content-SHA256`. Successful JSON is `{version:1,sha256,verdict}` with verdict
`clean` or `quarantined`. Maximum file size is 25 MiB. Non-success, malformed,
digest-mismatched or timed-out responses are retryable errors to the application;
they never mean clean. The service processes up to two simultaneous upload scans.
The app waits at most 15 seconds; the clamd scan times out after 12 seconds.

Watch signature updates, authenticated health, rejected requests and scan latency.
Do not enable body/authorization logging. Review proxy logging before changing it.
The 72-hour signature-age check is an operational policy based on file mtime,
not proof of upstream signature currency; independently monitor FreshClam updates.
Use a new token on both sides for rotation and recheck health. During mismatch or
outage uploads remain pending. Never temporarily mark them clean to clear a queue.

`node --test deploy/scanner-https/server.test.mjs` runs local contract tests with a
stub scanner. These do not replace real ClamAV/image/TLS/host tests. The deployment
has not been run against a purchased or provisioned host by this change.
