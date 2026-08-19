import type { JobHandler } from "../runner";
import { announcementNudge } from "./announcement-nudge";
import { dailyDigest } from "./daily-digest";
import { drainNotifications } from "./drain-notifications";
import { dueDateReminders } from "./due-date-reminders";
import { purgeJobHistory } from "./purge-job-history";
import { retryFailedEmails } from "./retry-failed-emails";
import { staleProjectSweep } from "./stale-project-sweep";

/**
 * The job registry.
 *
 * A name here must also exist in `job_definition` — the runner checks both, so
 * neither a stale cron entry nor an unreleased handler can run on its own. The
 * names are the URL segment the scheduler calls: /api/jobs/<name>.
 */
export const JOB_HANDLERS: Record<string, JobHandler> = {
  "drain-notifications": drainNotifications,
  "retry-failed-emails": retryFailedEmails,
  "daily-digest": dailyDigest,
  "announcement-nudge": announcementNudge,
  "due-date-reminders": dueDateReminders,
  "stale-project-sweep": staleProjectSweep,
  "purge-job-history": purgeJobHistory,
};

export const JOB_NAMES = Object.keys(JOB_HANDLERS);
