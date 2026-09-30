import { scanDocuments } from "./scan-documents";
import { scanReceipts } from "./scan-receipts";
import { scanFormFiles } from "./scan-form-files";
import type { JobHandler } from "../runner";
import { announcementNudge } from "./announcement-nudge";
import { applyRetention } from "./apply-retention";
import { dailyDigest } from "./daily-digest";
import { drainNotifications } from "./drain-notifications";
import { dueDateReminders } from "./due-date-reminders";
import { expireExports } from "./expire-exports";
import { gmailPushSync } from "./gmail-push-sync";
import { gmailWatchRenew } from "./gmail-watch-renew";
import { googleSync } from "./google-sync";
import { grantReportReminders } from "./grant-report-reminders";
import { purgeJobHistory } from "./purge-job-history";
import { reportRecordRetention } from "./report-record-retention";
import { retryFailedEmails } from "./retry-failed-emails";
import { retryWorkflowExecutions } from "./retry-workflow-executions";
import { runExports } from "./run-exports";
import { scheduledAnnouncements } from "./scheduled-announcements";
import { staleProjectSweep } from "./stale-project-sweep";
import { teamSignalDigest, teamSignalReminders } from "./team-signals";
import { vmsSync } from "./vms-sync";
import { workflowEvents } from "@/features/workflows/services/event-runner";
import { decisionRevisitReminders } from "@/features/decisions/jobs/revisit-reminders";
import { workflowResume } from "@/features/workflows/services/resume-runner";
import { followFanout } from "@/features/following/fanout";

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
  "retry-workflow-executions": retryWorkflowExecutions,
  // Step-graph workflows (Workspace OS S6, behind wos_workflows_v2)
  "workflow-events": workflowEvents,
  "workflow-resume": workflowResume,
  // Following (Workspace OS S6b, behind wos_objects)
  "follow-events": followFanout,
  "daily-digest": dailyDigest,

  // Sweeps over Hub data
  "announcement-nudge": announcementNudge,
  "scheduled-announcements": scheduledAnnouncements,
  "due-date-reminders": dueDateReminders,
  "grant-report-reminders": grantReportReminders,
  "stale-project-sweep": staleProjectSweep,
  "team-signal-reminders": teamSignalReminders,
  "team-signal-digest": teamSignalDigest,
  // Workspace OS V1-10; silent while wos_decisions_v2 is off.
  "decision-revisit-reminders": decisionRevisitReminders,

  // External integrations
  "google-sync": googleSync,
  "gmail-push-sync": gmailPushSync,
  "gmail-watch-renew": gmailWatchRenew,
  "vms-sync": vmsSync,

  // Data exports
  "run-exports": runExports,
  "expire-exports": expireExports,

  "scan-documents": scanDocuments,
  "scan-receipts": scanReceipts,
  "scan-form-files": scanFormFiles,

  // Housekeeping
  "purge-job-history": purgeJobHistory,
  "apply-retention": applyRetention,
  "report-record-retention": reportRecordRetention,
};

export const JOB_NAMES = Object.keys(JOB_HANDLERS);
