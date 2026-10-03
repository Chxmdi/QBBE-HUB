# Review: saves that did not check whether a row changed

Row-level security refuses an update by matching no row, and PostgREST reports
that as success. A server action that only checks `error` therefore treats a
refusal as done. On 2026-10-03 every `.update(...)` in `src/features/**/*.commands.ts`
and `src/features/**/actions/*.ts` without a row check was reviewed (41 sites,
plus the event actions found earlier).

Verdicts:

- **Fixed**: now asks for the row back and fails visibly; unit-tested.
- **Own row**: changes only the caller's own record (profile, read/mute
  marker, own connection), which the caller may always change.
- **Checked already**: the scan missed an existing row check.
- **Guarded**: an app-side check before the write matches the database rule,
  so the refused case cannot reach the write.
- **Known, low impact**: a refusal can still show as success, but nothing
  else happens afterwards (no audit, notification or external call), and the
  next load shows the true state. Left as is; listed so it is not mistaken for
  verified.

| Action | File | Verdict | Notes |
|---|---|---|---|
| updateEvent, updateEventStatus | events/services/event.commands.ts | Fixed (#362) | A reader's "cancel" deleted the owner's Google Calendar event |
| updateMeeting | meetings/services/meeting.commands.ts | Fixed (#364) | Admin without a verified second factor: Calendar still updated |
| cancelMeeting | meetings/services/meeting.commands.ts | Fixed (#364) | Same: organizer's Calendar event still deleted |
| deleteMessage | channels/services/message.commands.ts | Fixed (#364) | Wrote a false `message_deleted` audit record |
| setChannelArchived | channels/services/channel.commands.ts | Fixed (#364) | Wrote a false `channel_archived` audit record |
| archiveDocument, restoreDocument | documents/services/document.commands.ts | Fixed (#364) | Reported success |
| updateOpportunity | crm/services/opportunity.commands.ts | Fixed (#364) | Notified a new owner of a reassignment that did not happen |
| closeProject | projects/services/project.commands.ts | Fixed (#364) | Archived open tasks before the close; a failed close hid them |
| toggleChecklistItem | tasks/services/checklist.commands.ts | Fixed (#364) | A refused tick vanished on reload |
| updateAgendaItem | meetings/services/meeting.commands.ts | Checked already | `.select("id")` and length check present |
| syncOfflineOperations | offline/services/offline.commands.ts | Checked already | Reports `forbidden` on no row |
| disconnectIntegration | admin/services/integration.commands.ts | Checked already | `.select("id")` present |
| saveOnboardingProfile, completeOnboarding, setReduceMotion, setDisplayDensity | onboarding/services/onboarding.commands.ts | Own row | `eq("id", session.userId)` |
| setInterfaceLanguage | preferences/services/locale.commands.ts | Own row | |
| setChannelMute, markChannelRead | channels/services/channel.commands.ts | Own row | Caller's `channel_member` row |
| markConversationRead | channels/services/message.commands.ts | Own row | Caller's `conversation_member` row |
| Gmail secret update | inbox/services/gmail.commands.ts | Own row | Caller's own connection secret |
| Calendar-degraded markers in createMeeting, updateMeeting, cancelMeeting | meetings/services/meeting.commands.ts | Own row / best effort | Status marker after a Calendar failure |
| connectVolunteerSystem | admin/services/integration.commands.ts | Guarded | Admin action authorization first; upsert, update, insert fallback |
| editMessage | channels/services/message.commands.ts | Guarded | Author check before the write |
| createProgramFromTemplate (colour) | programs/services/program-template.commands.ts | Guarded | Same caller just created the program |
| updateCrmOrganization, setCrmOrganizationStatus, completeFollowUp | crm/services/crm.commands.ts | Guarded | `session.isStaff` check matches `can_access_crm` |
| completeMilestone, updateMilestone, reorderMilestone | projects/services/milestone.commands.ts | Guarded | `hasProjectCapability(..., "manage")` first |
| Gift acknowledgement delivery mark | gifts/services/gift.commands.ts | Guarded | Runs after the acknowledgement was created by the same caller |
| applyMeetingReview (capture status) | meetings-v2/services/meeting-v2.commands.ts | Guarded | `can_manage_meeting` checked first; unit-tested |
| saveWorkflow | workflows/services/workflow.commands.ts | Guarded | Admin-only path; organization filter on the update |
| triageAgendaItem, moveAgendaItem, combineAgendaItem, carryForwardAgendaItem | meetings/services/meeting.commands.ts | Known, low impact | No side effect after the write |
| saveMeetingNotes | meetings/services/meeting.commands.ts | Known, low impact | No side effect after the write |
| reorderChecklist | tasks/services/checklist.commands.ts | Known, low impact | Order only |
| restoreTasks | tasks/services/task.commands.ts | Known, low impact | Bulk restore; refused rows stay archived |
| recordProjectDecision (request link) | risks/services/decision.commands.ts | Known, low impact | Decision is recorded; an already-closed request is left unlinked |
| escalateRiskToIssue (risk close) | risks/services/risk.commands.ts | Known, low impact | Issue is created; the risk may stay open if its close is refused |
