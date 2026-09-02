# Domain audit — meetings, agendas, decisions, calendar, events, scheduling

<!-- progress: 3 of 20 assessed -->

Requirement families in scope: `CAL-001..006`, `P0-CAL-01/02`, `P1-CAL-03`,
`P0-MTG-01..04`, `P1-MTG-05`, `P0-AGD-01/02`, `P1-AGD-03`, `P0-EVT-01/02`,
`P1-EVT-03` — 20 IDs total (enumerated by grepping the spec for each prefix).

All paths are relative to `/home/user/QBBE-HUB`.

---

### P0-CAL-01 — Unified calendar (week/month)
**Verdict:** Partial
**Requirement:** Week and month views combine authorized meetings, events, task due
dates, milestones, report dates, CRM follow-ups, and optional connected-calendar overlays.
**Evidence:** `src/app/(workspace)/calendar/page.tsx:43` selects week/month;
`:65-113` runs six parallel range-bounded queries over `task`, `milestone`, `meeting`,
`event`, `crm_follow_up` and `calendar_event_link` (the Google overlay), merged into one
`CalendarItem[]` at `:115-164`. Week grid at `src/features/calendar/components/week-view.tsx:45`,
month grid at `calendar/page.tsx:263-333`, mobile agenda fallback at `week-view.tsx:150`.
Authorization is by RLS on each source table, not by a filter in the page.
**Gap:** **Report dates are not on the calendar.** `report_instance`
(`supabase/migrations/0003_operations.sql:187`) has `period_start`/`period_end` but no due
date column, and the calendar page never queries it. Six of the seven required sources are
present; the seventh has no data model to draw from.

### P0-CAL-02 — Create / reschedule schedule items
**Verdict:** Partial
**Requirement:** Authorized users can create or move schedule items while preserving
source-record rules and permissions.
**Evidence:** Source records do support it with permissions intact:
`src/features/meetings/services/meeting.commands.ts:89` `updateMeeting` re-validates staff
role, refuses completed/cancelled meetings (`:104`), restricts to organizer-or-admin (`:107`)
and mirrors the move to Google (`:113-127`); `createMeeting` at `:25`; `cancelMeeting` at
`:138`. Events likewise: `src/features/events/services/event.commands.ts:56` create, `:141`
update (rejects cancelled at `:157`), `:268` status change with Calendar deletion on cancel.
The meeting Edit dialog is wired at `src/app/(workspace)/meetings/[id]/page.tsx:112-126`.
**Gap:** **The calendar itself is read-only.** `src/app/(workspace)/calendar/page.tsx` has no
create action, no drag-to-move and no reschedule affordance — its only interactive elements
are view/date `Link`s (`:198-235`) and per-item links to the source record; `grep -rn "use
server" src/features/calendar` returns nothing and the directory holds only `week-view.tsx`
and the Google write client. `src/app/(workspace)/schedule/page.tsx` is equally read-only.
Also, only meetings and events are movable — task due dates, milestones and CRM follow-ups
are calendar-visible but have no reschedule path from any schedule surface.

### CAL-006 — Bounded, server-prepared Master Schedule
**Verdict:** Complete
**Requirement:** Master Schedule uses server-prepared date ranges and pagination rather than
an unbounded multi-year DOM timeline.
**Evidence:** `src/app/(workspace)/schedule/page.tsx:21` fixes `WINDOW_MONTHS = 6`;
`:44-46` computes the window server-side (`startOfMonth(addMonths(now, -1))` → +6 months);
`:48-57` queries `project` with `.limit(60)` and a stage filter; bars are positioned by
percentage offset within that window (`:119-128`) and anything outside renders as a text
stub, not DOM (`:167`). The calendar page is likewise bounded — `:50-63` derives the range and
every query carries `.gte/.lte` plus a `.limit()`.
