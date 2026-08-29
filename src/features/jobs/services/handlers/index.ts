import type { JobHandler } from "../runner";
import { announcementNudge } from "./announcement-nudge";
import { applyRetention } from "./apply-retention";
import { dailyDigest } from "./daily-digest";
import { drainNotifications } from "./drain-notifications";
import { dueDateReminders } from "./due-date-reminders";
import { expireExports } from "./expire-exports";
import { gmailWatchRenew } from "./gmail-watch-renew";
import { googleSync } from "./google-sync";
import { purgeJobHistory } from "./purge-job-history";
import { retryFailedEmails } from "./retry-failed-emails";
import { runExports } from "./run-exports";
import { scheduledAnnouncements } from "./scheduled-announcements";
import { staleProjectSweep } from "./stale-project-sweep";
import { vmsSync } from "./vms-sync";

/**
 * The job registry.
 *
 * A name here must also exist in `job_definition` — the runner checks both, so
 * neither a stale cron entry nor an unreleased handler can run on its own. The
 * names are the URL segment the scheduler calls: /api/jobs/<name>.
 */
export const JOB_HANDLERS: Record<string, JobHandler> = {
  // Notification delivery
  "drain-notifications": drainNotifications,
  "retry-failed-emails": retryFailedEmails,
  "daily-digest": dailyDigest,

  // Sweeps over Hub data
  "announcement-nudge": announcementNudge,
  "scheduled-announcements": scheduledAnnouncements,
  "due-date-reminders": dueDateReminders,
  "stale-project-sweep": staleProjectSweep,

  // External integrations
  "google-sync": googleSync,
  "gmail-watch-renew": gmailWatchRenew,
  "vms-sync": vmsSync,

  // Data exports
  "run-exports": runExports,
  "expire-exports": expireExports,

  // Housekeeping
  "purge-job-history": purgeJobHistory,
  "apply-retention": applyRetention,
};

export const JOB_NAMES = Object.keys(JOB_HANDLERS);
