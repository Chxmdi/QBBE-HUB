/**
 * English text for ops screens (#141). Mounted at the top level of the
 * catalogue; this file owns only these namespaces: jobs, retention, records.
 */
export const opsEn = {
  jobs: {
    runner: {
      command: "select app.configure_job_runner('<this site's address>', '<CRON_JOB_SECRET>');",
      title: "Background jobs are not running",
      fix: {
        not_configured: "Background jobs are not connected to this site, so uploads never pass their security check and no notification email is sent. In the Supabase SQL editor run:",
        other_site: "Background jobs are connected to a different site address than this one. Run app.configure_job_runner again with this site's address.",
        secret_mismatch: "The job secret stored in the database does not match this site's CRON_JOB_SECRET, so every job call is refused. Run app.configure_job_runner again with the site's current secret.",
        app_secret_missing: "This site has no CRON_JOB_SECRET set, so it refuses every job call. Add it in the hosting settings (at least 32 characters) and redeploy.",
        unknown: "The job runner's status could not be read. Check that SUPABASE_SERVICE_ROLE_KEY is set for this site.",
      },
    },
    title: "Jobs",
    unconfiguredLead: "No job has run yet.",
    unconfiguredBefore: "The scheduler reaches this deployment only after an administrator runs",
    unconfiguredAfter: "against the database. See docs/runbooks/jobs.md.",
    failuresHeading: "Recent failures",
    failuresEmpty:
      "No run has dropped work. Failures appear here with the error that caused them.",
    queuesHeading: "Queues",
    queueError: "Queue metrics could not be read: {error}",
    noQueuesTitle: "No queues",
    noQueuesDescription:
      "Queues are created by migration 0008. If none appear, migrations have not been applied to this database.",
    columns: {
      queue: "Queue",
      pending: "Pending",
      readyNow: "Ready now",
      oldest: "Oldest",
      deadLetters: "Dead letters",
      job: "Job",
      schedule: "Schedule",
      lastRun: "Last run",
      nextRun: "Next run",
      failures24h: "Failures (24h)",
    },
    deadLettered: "Dead-lettered messages ({count})",
    attemptsOne: "{count} attempts",
    attemptsOther: "{count} attempts",
    archived: "archived {when}",
    scheduleHeading: "Scheduled jobs",
    disabled: "disabled",
    processed: "{count} processed",
    failedSuffix: ", {count} failed",
    utcNote: "Schedules and next-run times are UTC, matching pg_cron.",
    units: {
      ms: "{n} ms",
      s: "{n} s",
      ageSeconds: "{n}s",
      ageMinutes: "{n}m",
      ageHours: "{n}h",
    },
    run: {
      never: "Never run",
      running: "Running",
      succeeded: "Succeeded",
      failed: "Failed",
      partial: "{count} failed",
    },
    schedule: {
      everyMinute: "Every minute",
      everyNMinutes: "Every {n} minutes",
      hourly: "Hourly",
      daily: "Daily at {times} UTC",
      onDays: "{days} at {times} UTC",
      weekdays: "Weekdays",
      time: "{h}:{m}",
      days: {
        "0": "Sunday",
        "1": "Monday",
        "2": "Tuesday",
        "3": "Wednesday",
        "4": "Thursday",
        "5": "Friday",
        "6": "Saturday",
      },
    },
    /** Keyed by job name; the text matches the seeded `job_definition` rows. */
    descriptions: {
      "team-signal-reminders":
        "Gently reminds staff of work that needs attention, once per signal, where reminders are switched on.",
      "team-signal-digest":
        "Emails owners and admins a weekly list of people with open work signals, where the digest is switched on.",
      "drain-notifications": "Delivers queued notification email and records every attempt.",
      "retry-failed-emails":
        "Recovers deliveries left in flight by a crashed run and retries transient failures with backoff.",
      "daily-digest":
        "Builds and queues each person's digest of unread notifications at their own local digest hour.",
      "announcement-nudge": "Reminds people who have not acknowledged a required announcement.",
      "due-date-reminders": "Notifies assignees of tasks due today, due tomorrow, or overdue.",
      "stale-project-sweep": "Flags active projects with no activity in fourteen days to their lead.",
      "purge-job-history": "Trims job_run history and archived queue messages past retention.",
      "scheduled-announcements":
        "Fans out notifications for announcements whose publish time has arrived.",
      "google-sync":
        "Pulls Gmail metadata, Calendar overlay and Drive links for every connected account.",
      "gmail-watch-renew": "Renews Gmail push subscriptions a day before they lapse.",
      "vms-sync": "Refreshes volunteer availability from the Volunteer Management System.",
      "run-exports":
        "Builds queued data exports and writes them to the private exports bucket.",
      "expire-exports": "Expires exports past their date and deletes the files behind them.",
      "apply-retention": "Applies enabled retention policies and records what each one removed.",
      "scan-documents": "Scan quarantined uploads using the private ClamAV socket.",
      "gmail-push-sync":
        "Reconciles Gmail history immediately after authenticated Pub/Sub push notifications.",
      "retry-workflow-executions":
        "Retries workflow notifications that failed to record, without sending a second copy of one that succeeded.",
      "scan-receipts": "Scan quarantined receipt uploads using the private ClamAV socket.",
      "report-record-retention":
        "Reports classified records whose retention period has ended. Deletes nothing.",
      "scan-form-files":
        "Scan form attachments and documents for signature with the private ClamAV socket, and record each file's SHA-256.",
      "grant-report-reminders":
        "Remind the people responsible for grant reports before, on and after the due date.",
    },
    /** Email the jobs send; the templates themselves live with notifications. */
    email: {
      /** Stands in for a missing name in the template's "Hello {name}," greeting. */
      fallbackName: "there",
    },
    /** Notifications the scheduled jobs write to people. */
    notify: {
      labelled: "{label}: {title}",
      overdue: "Overdue",
      dueToday: "Due today",
      dueTomorrow: "Due tomorrow",
      comingUp: "Coming up",
      taskOverdueBody: "This was due {date}. Update the due date or move it forward.",
      dueBody: "Due {date}.",
      followUpOverdue: "Overdue follow-up",
      followUpDue: "Follow-up due",
      grantTitle: "{label}: {report} for {grant}",
      aGrant: "a grant",
      grantOverdueBody:
        "This grant report was due {date}. Submit it to the funder, then mark it submitted.",
      grantDueBody: "Grant report due {date}.",
      ackTitle: "Still needs your acknowledgement: {title}",
      ackBy: "Acknowledge by {date}.",
      ackOpen: "Open the announcement and acknowledge it.",
      announcementTitle: "Announcement: {title}",
      staleTitle: "Status update due: {name}",
      staleBody:
        "This project reports {cadence}. The last status update is older than {days} days.",
      cadenceWeekly: "weekly",
      cadenceMonthly: "monthly",
      teamSignalTitle: "Some of your work may need a look",
      teamSignalBody:
        "{reasons}. Your work summary shows the details. This reminder is sent once and does not repeat while things stay as they are.",
    },
    teamDigest: {
      subjectOne: "Team signals: 1 person has work that needs attention",
      subjectOther: "Team signals: {count} people have work that needs attention",
      intro:
        "These people have at least one open work signal this week. Each line is a fact from their work records, not a judgement.",
      openSummary: "Open work summary",
      openOverview: "Open the team overview",
      footer:
        "You receive this because you are an owner or admin of {organization} and the weekly team digest is switched on in Admin, Team signals.",
    },
  },
  retention: {
    title: "Retention",
    eyebrow: "Administration",
    description:
      "How long each kind of record is kept. Policies are off until you switch them on, and each one shows what it would remove before it removes anything.",
    enabledBadge: "{duration}, then {outcome}",
    outcomeDeleted: "deleted",
    outcomeRedacted: "redacted",
    setNotOn: "Set but not switched on",
    keptIndefinitely: "Kept indefinitely",
    floor: "Floor: {duration}",
    or: " or ",
    wouldAffect: "{count} records are already older than {duration}.",
    nothingOlder: "Nothing is older than {duration} yet.",
    lastRun: "Last run {when}",
    lastAffected: ", {count} affected",
    runsHeading: "What has been removed",
    runsEmpty:
      "Nothing yet. Every pass is recorded here, including the ones that removed nothing — deletion without a record of it is indistinguishable from data loss.",
    runFailed: "Failed",
    runAffected: "{count} affected",
    runCutoff: "Everything before {date}, by {method}.",
    methodDeletion: "deletion",
    methodRedaction: "redaction",
    footer:
      "Only the record types listed above can be governed at all. Adding another is a schema change, deliberately — a retention system that can be pointed at any table is a compliance hole waiting for a well-meaning administrator.",
    actions: {
      delete: "Delete the records",
      anonymise: "Keep the record, remove the content",
    },
    duration: {
      dayOne: "{n} days",
      dayOther: "{n} days",
      monthOne: "{n} month",
      monthOther: "{n} months",
      yearOne: "{n} year",
      yearOther: "{n} years",
    },
    errors: {
      mustKeep: "{label} must be kept for at least {duration}.",
      cannotAnonymise: "{label} cannot be anonymised.",
      cannotDelete: "{label} cannot be deleted.",
      enterDays: "Enter a number of days.",
      wholeDays: "Enter a whole number of days.",
      atLeastDay: "Retention has to be at least a day.",
      notGovernable: "That record type cannot be governed by a policy.",
      invalidInput: "Invalid input.",
      generic: "That didn't work. Try again.",
    },
    editor: {
      change: "Change",
      setPolicy: "Set a policy",
      confirm:
        "Switching this on will {verb} {count} {label} records on the next nightly run, and more as they age past {duration}. Continue?",
      verbDelete: "permanently delete",
      verbRedact: "redact",
      keepForDays: "Keep for (days)",
      atLeast: "At least {duration}.",
      thatIs: " That is {duration}.",
      whatHappens: "What happens",
      why: "Why (optional)",
      applyNightly: "Apply this every night",
      save: "Save",
      cancel: "Cancel",
    },
    /** Keyed by `retention_subject.key`; the text matches the seeded rows. */
    subjects: {
      activity_event: {
        label: "Activity feed",
        description:
          "Who did what, shown on project and program timelines. Operational noise once it is old.",
        caution: "Project timelines lose their older entries. Nothing else depends on them.",
      },
      notification: {
        label: "Notifications",
        description: "In-app alerts. Once read and old, they are of no use to anyone.",
        caution: "Only affects the bell menu and its history.",
      },
      crm_interaction: {
        label: "CRM interaction notes",
        description: "Meetings, calls and notes recorded against a funder or partner.",
        caution:
          "Relationship continuity depends on these. Anonymising keeps the fact of contact and removes what was said.",
      },
      export_job: {
        label: "Export records",
        description:
          "The log of who exported what. The files are deleted after seven days regardless; this is the record.",
        caution:
          'This is the answer to "who took a copy". Keep it longer than you think you need.',
      },
      audit_event: {
        label: "Audit trail",
        description: "Administrative actions: role changes, approvals, exports, sign-ins.",
        caution:
          "Six years is the floor here on purpose. Charity records are commonly required for that long, and an audit trail is the first thing an investigation asks for.",
      },
    },
  },
  records: {
    title: "Records & holds",
    eyebrow: "Administration",
    description:
      "How long each kind of business record is kept, and legal holds that stop deletion. Classified records cannot be deleted before their retention date or while held — by anyone.",
    notClassified: "Not classified",
    aDocument: "A document",
    yearEndHeading: "Fiscal year end",
    yearEndSet: "Financial records are counted from {month} {day}.",
    yearEndUnset:
      "Not set. Until it is, the Hub counts from one year after each record's date, which can only keep records longer.",
    rulesHeading: "Retention rules",
    confirmedBy: "Confirmed by the {who}",
    needsConfirmation: "Needs {who} confirmation",
    who: {
      accountant: "accountant",
      counsel: "counsel",
    },
    note: "Note: {note}",
    holdsHeading: "Legal holds",
    noHolds: "No active holds.",
    wholeCategory: "All {category}",
    placed: "Placed {when}",
    classifyHeading: "Classify a document",
    classifyHelp:
      "The record date is the date the record relates to — the purchase, the statement, or the day a contract ended. Left blank, the date the document was added is used. A classification cannot be changed in a way that shortens how long a record must be kept.",
    registerHeading: "Records register",
    lastCheck: "Last nightly check {when}: {past} past retention, {held} held.",
    notRunYet: "The nightly check has not run yet.",
    pastOne:
      "{count} record has reached the end of retention and may now be disposed of. Nothing is deleted automatically.",
    pastOther:
      "{count} records have reached the end of retention and may now be disposed of. Nothing is deleted automatically.",
    nonePast: "No record has reached the end of its retention period.",
    registerEmpty: "No document is classified or held yet.",
    onHold: "On hold",
    pastRetention: "Past retention",
    registerMeta: "{category} · dated {date} · keep until {until}",
    months: {
      "1": "January",
      "2": "February",
      "3": "March",
      "4": "April",
      "5": "May",
      "6": "June",
      "7": "July",
      "8": "August",
      "9": "September",
      "10": "October",
      "11": "November",
      "12": "December",
    },
    period: {
      permanent: "Kept permanently",
      fiscalOne: "{n} year after the end of the fiscal year",
      fiscalOther: "{n} years after the end of the fiscal year",
      recordOne: "{n} year after the record's date",
      recordOther: "{n} years after the record's date",
    },
    retainUntil: {
      noRule: "No rule",
      permanently: "Permanently",
    },
    errors: {
      enterYears: "Enter a number of years.",
      wholeYears: "Enter a whole number of years.",
      atLeastYear: "Enter at least one year.",
      atMost100: "Enter 100 years or fewer.",
      chooseCategory: "Choose a record category.",
      chooseMonth: "Choose a month.",
      chooseDay: "Choose a day.",
      noSuchDay: "That day does not exist in that month (February 29 is not accepted).",
      holdReason: "Say why the hold is needed.",
      releaseReason: "Say why the hold is being released.",
      chooseDocument: "Choose a document.",
      dateFormat: "Enter the date as YYYY-MM-DD.",
      invalidInput: "Invalid input.",
      yearEndNotSaved: "The fiscal year end could not be saved.",
      holdNotActive: "That hold is not active any more.",
      documentNotFound: "That document was not found.",
      generic: "That didn't work. Try again.",
    },
    forms: {
      changeOrConfirm: "Change or confirm",
      keepForYears: "Keep for (years)",
      atLeastYears: "At least {n} years.",
      confirmationNote: "Confirmation note (optional)",
      notePlaceholder: "e.g. Confirmed by the {who} by email on …",
      hasConfirmed: "The {who} has confirmed this period",
      save: "Save",
      cancel: "Cancel",
      month: "Month",
      day: "Day",
      saveYearEnd: "Save year end",
      hold: "Hold",
      oneDocument: "One document",
      wholeCategory: "A whole record category",
      category: "Category",
      document: "Document",
      choose: "Choose…",
      reason: "Reason",
      reasonPlaceholder: "e.g. Revenu Québec audit of the 2025 fiscal year",
      placeHold: "Place hold",
      release: "Release",
      releaseWhy: "Why is the hold being released?",
      releaseHold: "Release hold",
      notBusinessRecord: "Not a business record",
      recordDate: "Record date",
      saveClassification: "Save classification",
    },
    /** Keyed by `record_category.key`; the text matches the seeded rows. */
    categories: {
      financial_record: {
        label: "Financial records",
        description:
          "Books of account, ledgers, journals, year-end statements and the working papers behind them.",
        legalReference:
          "Income Tax Act s. 230 (CRA); Tax Administration Act s. 35.2 (Revenu Québec); Excise Tax Act s. 286 (GST/HST). Six years from the end of the last tax year the records relate to.",
      },
      receipt: {
        label: "Receipts",
        description: "Purchase receipts and other evidence of an expense.",
        legalReference:
          "Same rules as financial records: six years from the end of the tax year the receipt relates to. GST and QST input tax claims need the receipt too.",
      },
      bill: {
        label: "Bills and invoices",
        description: "Vendor bills and invoices the organization received or issued.",
        legalReference:
          "Same rules as financial records: six years from the end of the tax year the invoice relates to.",
      },
      bank_statement: {
        label: "Bank statements",
        description: "Bank and credit card statements, deposit records and reconciliations.",
        legalReference:
          "Same rules as financial records: six years from the end of the tax year the statement relates to.",
      },
      contract: {
        label: "Contracts",
        description:
          "Leases, service agreements, funding agreements and other contracts. Use the date the contract ended as the record date.",
        legalReference:
          "Contracts that support the books follow the six-year tax rule. Civil claims in Quebec generally prescribe after 3 years (Civil Code art. 2925); counsel to confirm.",
      },
      signed_document: {
        label: "Signed documents",
        description:
          "Consent forms, volunteer agreements, releases and other signed documents.",
        legalReference:
          "Civil Code of Québec art. 2925 (3-year prescription) as the floor. Documents about minors may need longer; counsel to confirm.",
      },
      form_submission: {
        label: "Form submissions",
        description: "Intake, registration and incident forms submitted through the Hub.",
        legalReference:
          "No single statutory period. Incident reports may need longer; counsel to confirm.",
      },
      governance_record: {
        label: "Governance records",
        description:
          "Letters patent, by-laws, board and general meeting minutes, and resolutions.",
        legalReference:
          "CRA expects these to be kept until two years after the organization is dissolved; the Hub keeps them permanently.",
      },
    },
  },
};
