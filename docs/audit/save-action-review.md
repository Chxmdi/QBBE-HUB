# Review: saves that did not check whether a row changed

Row-level security refuses an update by matching no row, and PostgREST reports
that as success. A server action that only checks `error` therefore treats a
refusal as done. On 2026-10-03 every `.update(...)` in `src/features/**/*.commands.ts`
and `src/features/**/actions/*.ts` without a row check was reviewed (41 sites,
plus the event actions found earlier). Every verdict below is backed by a test.

Verdicts:

- **Fixed**: now asks for the row back and fails visibly; the test fails without the fix.
- **Own row**: changes only the caller's own record; the test checks the filter.
- **Checked already**: the code already asked for the row back.
- **Guarded**: an app-side check before the write matches the database rule;
  the test denies the check and proves nothing is written, and a matching test
  allows it and proves the write happens.

| Action | File | Verdict | Test |
|---|---|---|---|
| updateEvent, updateEventStatus | events/services/event.commands.ts | Fixed (#362) | `src/features/events/tests/event.commands.test.ts` |
| updateMeeting, cancelMeeting | meetings/services/meeting.commands.ts | Fixed (#364) | `src/features/meetings/tests/meeting-schedule.commands.test.ts` |
| deleteMessage | channels/services/message.commands.ts | Fixed (#364) | `tests/unit/refused-writes.test.ts` |
| setChannelArchived | channels/services/channel.commands.ts | Fixed (#364) | `tests/unit/refused-writes.test.ts` |
| archiveDocument, restoreDocument | documents/services/document.commands.ts | Fixed (#364) | `tests/unit/refused-writes.test.ts` |
| updateOpportunity | crm/services/opportunity.commands.ts | Fixed (#364) | `tests/unit/refused-writes.test.ts` |
| closeProject (task archive order) | projects/services/project.commands.ts | Fixed (#364) | `tests/unit/refused-writes.test.ts` |
| toggleChecklistItem | tasks/services/checklist.commands.ts | Fixed (#364) | `tests/unit/refused-writes.test.ts` |
| triageAgendaItem, moveAgendaItem, saveMeetingNotes | meetings/services/meeting.commands.ts | Fixed | `tests/unit/refused-follow-ups.test.ts` |
| combineAgendaItem (folded item first, undone if the target is refused) | meetings/services/meeting.commands.ts | Fixed | `tests/unit/refused-follow-ups.test.ts` |
| carryForwardAgendaItem (deferred first, undone if the copy fails) | meetings/services/meeting.commands.ts | Fixed | `tests/unit/refused-follow-ups.test.ts` |
| recordProjectDecision (decision removed if the request was already answered) | risks/services/decision.commands.ts | Fixed | `tests/unit/refused-follow-ups.test.ts` |
| escalateRiskToIssue (issue removed if the risk could not be closed) | risks/services/risk.commands.ts | Fixed | `tests/unit/refused-follow-ups.test.ts` |
| reorderChecklist | tasks/services/checklist.commands.ts | Fixed | `tests/unit/refused-follow-ups.test.ts` |
| restoreTasks | tasks/services/task.commands.ts | Fixed | `tests/unit/refused-follow-ups.test.ts` |
| updateAgendaItem | meetings/services/meeting.commands.ts | Checked already | `tests/e2e/meetings-comments.spec.ts` (edit, owner set and cleared) |
| syncOfflineOperations | offline/services/offline.commands.ts | Checked already | `tests/e2e/offline.spec.ts` |
| disconnectIntegration | admin/services/integration.commands.ts | Checked already | `tests/unit/guarded-writes.test.ts` |
| saveOnboardingProfile, completeOnboarding, setReduceMotion, setDisplayDensity | onboarding/services/onboarding.commands.ts | Own row | `src/features/onboarding/tests/onboarding.commands.test.ts` |
| setInterfaceLanguage | preferences/services/locale.commands.ts | Own row | `src/features/preferences/tests/locale.commands.test.ts` |
| setChannelMute, markChannelRead | channels/services/channel.commands.ts | Own row | `tests/unit/guarded-writes.test.ts` |
| markConversationRead | channels/services/message.commands.ts | Own row | `tests/unit/guarded-writes.test.ts` |
| Gmail token refresh | inbox/services/gmail.commands.ts | Own row (service rights; scoped by the caller's connection) | `tests/unit/gmail-token-refresh.test.ts` |
| Calendar-degraded markers in createEvent, updateMeeting, cancelMeeting | events, meetings | Own row / best effort | event and meeting-schedule tests ("marks the connection") |
| connectVolunteerSystem | admin/services/integration.commands.ts | Guarded (administrator) | `tests/unit/guarded-writes.test.ts` |
| saveWorkflow | workflows/services/workflow.commands.ts | Guarded (administrator and switch) | `tests/unit/guarded-writes.test.ts` |
| editMessage | channels/services/message.commands.ts | Guarded (author) | `tests/unit/guarded-writes.test.ts` |
| updateCrmOrganization, setCrmOrganizationStatus, completeFollowUp | crm/services/crm.commands.ts | Guarded (staff) | `tests/unit/guarded-writes.test.ts` |
| completeMilestone, updateMilestone, reorderMilestone, deleteMilestone | projects/services/milestone.commands.ts | Guarded (manage project) | `tests/unit/guarded-writes.test.ts` |
| Gift acknowledgement delivery and resend | gifts/services/gift.commands.ts | Guarded (administrator, same as the table's policy) | `tests/unit/guarded-writes.test.ts` |
| createProgramFromTemplate (colour) | programs/services/program-template.commands.ts | Guarded (administrator) | `tests/unit/guarded-writes.test.ts` |
| applyMeetingReview (capture status) | meetings-v2/services/meeting-v2.commands.ts | Guarded (`can_manage_meeting`) | `src/features/meetings-v2/tests/meeting-v2.commands.test.ts` |
