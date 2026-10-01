# Onboarding demo video: plan

A set of short, narrated screen recordings that walk a new QBBE member through every part of the Hub, produced from the real application so they stay accurate as the Hub changes. One combined video with chapter markers for a first sitting, and one file per chapter for reference afterwards.

## What gets delivered

| Deliverable | Form |
|---|---|
| Combined onboarding video | One MP4 (1920 × 1080, H.264), chapter markers, captions burned in, about 45 minutes |
| Chapter videos | One MP4 per chapter (2 to 4 minutes each), same captions |
| Overview trailer | 3-minute tour for the first day, cut from the chapters |
| Narration | Per chapter: the spoken script as plain text and as a subtitle file (SRT) with timings, English first, French second |
| Index page | `docs/onboarding/index.html`: chapter list with timestamps, who each chapter is for, and the transcript |
| Recording tooling | `scripts/demo/`: the recorder, the chapter scripts and the demo dataset, committed so the videos can be regenerated after any release |

The videos themselves are not committed (the repository is public and videos are large); they are delivered as files and can be re-rendered with one command.

## How the recording works

1. **A clean local Hub.** The local Supabase stack is reset, seeded, then loaded with a realistic demo dataset (programs, projects, tasks, meetings with agendas and decisions, channel conversations, documents, contacts and gifts, ledger entries, budgets, receipts, bills, a form, a workflow). Names and content read like a Quebec community organization's, in both languages. Every Workspace OS switch is on for the recording, and the narration says which screens live behind a switch.
2. **A scripted browser.** Playwright drives Chromium at 1920 × 1080 and records the screen. A small overlay drawn inside the page shows a cursor, a click ripple and a caption bar, so the viewer sees where the presenter is and reads what is being said. Actions are paced like a person's (moves, pauses, typing at a readable speed).
3. **A chapter script** is a short TypeScript file: `say("…")` sets the caption and records its timing, `go`, `click`, `type` and `highlight` do the rest. Each run produces the video, a timing file and the subtitle file.
4. **Assembly.** ffmpeg converts each recording to MP4, adds a title card per chapter, joins the chapters with chapter markers and burns the captions. Frames are extracted at every caption and checked automatically (no error state, the expected screen) and reviewed by eye for the key moments.

## Narration

The environment has no reachable neural voice: the voice model hosts (Hugging Face, GitHub releases) and the online voices (Microsoft, Google) are blocked by the network policy. The narration is therefore delivered as burned-in captions plus the script and subtitle files, which a person or any text-to-speech service can voice later, in sync, because the timings are recorded. If a local engine of acceptable quality can be installed from the Ubuntu archive, a synthetic voice track is added as an optional second file.

## Chapters

Each chapter names its audience. "Everyone" chapters come first so a volunteer's onboarding can stop after chapter 8.

| # | Chapter | For | Covers |
|---|---|---|---|
| 0 | Welcome and signing in | Everyone | The invitation email, first sign-in, two-step verification for administrators, choosing English or French, theme and reduced motion, where help is |
| 1 | Getting around | Everyone | Home, My World, the sidebar, the command palette, search, notifications and the inbox, Saved and Following |
| 2 | Your work and tasks | Everyone | My Work, the board, the table lens, a task page, comments and mentions, due dates, undo |
| 3 | Projects and programs | Staff | Creating a project, stages and health, status updates, milestones, unresolved work on closing, programs and program templates |
| 4 | Meetings and decisions | Everyone | Scheduling a meeting, the agenda, notes in the editor, turning lines into tasks, recording a decision, the meeting record afterwards |
| 5 | Talking to each other | Everyone | Channels, direct messages, announcements, following people and things, quiet hours |
| 6 | Calendar and events | Everyone | Calendar, the master schedule, events, Google Calendar connection |
| 7 | Documents | Everyone | The library, folders, uploading and the virus scan, templates, search by words inside files, Drive |
| 8 | Forms, requests and signatures | Everyone | Filling a form, a request's path to approval, signing a document, the signatures screen |
| 9 | Relationships | Staff | Contacts and organizations, activity logs, gifts and grants, acknowledgements and annual statements |
| 10 | Money, part one | Finance staff | The ledger and funds, receipts (with the phone capture and OCR), bills and invoices, approvals and delegation |
| 11 | Money, part two | Finance staff | Bank import and reconciliation, budgets against actuals, GST and QST, payroll import, year-end and the accountant's access, reports |
| 12 | Automation and connections | Admin | Workflows and test runs, approvals routing, API tokens, Gmail and Drive integration, the job runner's health |
| 13 | Administration | Admin | Members and invitations, roles and what each may do, access and sign-in rules, feature switches, exports, workspace upkeep, retention and legal holds |
| 14 | Pages and the editor | Everyone | Pages, the block editor, slash commands, semantic blocks (task, person, status, query, decision, file), versions and compare, trash and restore, spaces and sharing, public pages |
| 15 | Lenses, Find and Insight | Everyone | Table, board, timeline, gallery, feed and dashboard lenses, saved lenses, Find, the insight dashboards, operations, graph, map, process, what-if |
| 16 | Building your own | Staff | Apps, blueprints, templates, goals, capture |
| 17 | On the phone, offline and in French | Everyone | The phone screens, working offline, the whole Hub in French, where to ask for help |

## Checklist

1. **Groundwork** (this session): install a full ffmpeg from PyPI, prove a recording with the overlay and a caption, confirm whether any voice engine is installable.
2. **Demo dataset**: `scripts/demo/dataset.mjs` on top of the QA seed; idempotent; bilingual names; enough rows to make every screen look lived-in.
3. **Recorder and chapter DSL**: `scripts/demo/record.mjs` (cursor and caption overlay, pacing, title cards, timing and SRT output) and `scripts/demo/chapters/*.mjs`.
4. **Chapter scripts and narration**, written in parallel by three build sessions on a shared branch: core and collaboration (0 to 8), money, relationships and administration (9 to 13), Workspace OS (14 to 17). Each session renders its chapters locally and checks the frames before pushing.
5. **Render and assembly** (this session): all chapters on one clean stack, MP4 conversion, title cards, chapter markers, combined video, trailer, index page.
6. **Quality pass**: automated frame checks at every caption, visual review of key frames, a second render to confirm the scripts are stable, durations within target.
7. **Delivery**: the files, the index, and the tooling merged to `main` so the set can be re-rendered after any release; then the French pass with the same scripts.

Estimated effort: about six to seven hours of session time with the chapter work in parallel.

## Decisions taken

- English first, French second, from the same scripts (the Hub's interface is bilingual, so the French pass is a locale cookie and translated captions, not a second production).
- Captions burned in, so the videos work without sound and on any player; the script and SRT are delivered alongside for voicing.
- Switches on, so every feature appears; the narration marks the ones an administrator turns on.
- The demo organization is fictional ("Centre communautaire du Plateau"), so no real member's data is ever on screen.
