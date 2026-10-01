// Run one background job against a running site, the way pg_cron does.
//
//   CRON_JOB_SECRET=<secret> npm run jobs:run -- scan-documents
//   CRON_JOB_SECRET=<secret> NEXT_PUBLIC_APP_URL=https://staging.example npm run jobs:run -- drain-notifications
//
// Posts to /api/jobs/<name> with the shared secret and prints the recorded
// outcome. Local development needs it because the database container cannot
// reach a server on the developer's loopback address, so cron never fires
// there; on a hosted site it is a way to run a job now instead of waiting for
// its schedule (uploads awaiting their security check, say). The secret comes
// from the environment only, never from an argument, so it does not land in a
// shell history.

const job = process.argv[2];
if (!job || !/^[a-z0-9-]+$/.test(job)) {
  console.error("Usage: npm run jobs:run -- <job-name>   (e.g. scan-documents)");
  process.exit(2);
}
const secret = process.env.CRON_JOB_SECRET;
if (!secret) {
  console.error("CRON_JOB_SECRET is not set; it must match the site's own value.");
  process.exit(2);
}
const origin = (process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

const response = await fetch(`${origin}/api/jobs/${job}`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-job-secret": secret },
  body: JSON.stringify({ job, trigger: "manual" }),
});
const text = await response.text();
let body;
try { body = JSON.parse(text); } catch { body = text; }
console.log(`${job}: HTTP ${response.status}`);
console.log(typeof body === "string" ? body : JSON.stringify(body, null, 2));
process.exit(response.ok && body && body.status !== "failed" ? 0 : 1);
