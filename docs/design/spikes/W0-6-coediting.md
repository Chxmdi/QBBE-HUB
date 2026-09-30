# W0-6 spike: co-editing (Yjs over Supabase Realtime)

Written 2026-09-30 by the S3 Editor session. Epic #199. Same as P0-2 in
`docs/plans/workspace-os-plan.md`. Local Supabase only; nothing touched a
hosted project.

## Decision

**GO for Yjs sent over Supabase Realtime.** The fallback sync server is
**not** needed. There are three conditions for M4c and V1-17, and one editor
finding (F1) that S3 must manage whichever transport is used.

The transport targets are all met:

- **Speed:** 95% of edits arrive within 44 ms. The target was 1,000 ms.
- **No lost edits in the sync layer:** 1,000 random edits from two browsers,
  with the network cut mid-run, arrive exactly. Not a character missing,
  doubled or out of place.
- **Recovery:** after a real connection drop, the client reconnects about 1.9
  seconds after the network returns, then catches up in about 0.01 seconds.
- **Saved copy:** a third browser loading only from the database sees
  exactly what the two editors see.
- **Message size:** the largest message was 29.9 KB. The smallest Supabase
  plan allows 256 KB.

One target is **only partly met**: "no lost edits" measured *through the
editor*. When two people type at exactly the same spot at the same moment,
a few characters can land interleaved. Changing a block's type while someone
else types in it can drop their characters. Both come from y-prosemirror,
the piece that connects the editor to Yjs. BlockNote uses it directly, and plain Tiptap uses
a fork of it (`@tiptap/y-tiptap`) that works the same way, so switching
editors would not avoid it, and neither would a separate sync server. Details, how often it happened and what to do: F1 and
F2 in section 3.

## 1. What was built

All of it is in `src/features/editor/spike/`.

| File | What it does |
|---|---|
| `yjs-broadcast-provider.ts` | A small Yjs provider, about 250 lines. Sends each change (batched for 25 ms and merged), a two-way catch-up "handshake" on every join or rejoin and every 15 s, and cursors. Splits messages over 64 KB into parts. Ignores malformed messages. Correctness never depends on any single message arriving: the handshake sends whatever the other side is missing. |
| `supabase-transport.ts` | One **private** Realtime broadcast channel per document (`yjs-spike:<doc id>`). A private channel is checked by row-level security (RLS, Postgres's per-row access rules) when someone joins. Also listens for the browser going offline and online, because a dead WebSocket otherwise goes unnoticed for up to 25 s (Realtime's heartbeat). |
| `supabase-persistence.ts` | Stores the document as an append-only log of Yjs updates in `spike_yjs_update`. Each person saves only the changes they made themselves, so nothing is saved twice and nobody overwrites anybody. A failed save is kept and retried. `compact()` folds the log into one row in a single SQL call. |
| `sql/spike-schema.sql` | The spike table, its RLS rules and the Realtime channel rules. **It is not a migration** (it is not in `supabase/migrations/`), so no deploy can apply it to a hosted project. `scripts/spikes/apply-spike-schema.sh` applies it to the local database and refuses any other. |
| `fuzz.ts` | Random edits made through the real editor: insert, new block, bold, delete, and optionally "turn into". |

The unit tests (`yjs-broadcast-provider.test.ts`, run by `npm test`) cover:

- 1,000 random edits over an in-memory channel, with 20% of messages dropped
  and a disconnect in the middle: the two sides converge;
- splitting and reassembling large messages;
- malformed messages being ignored.

## 2. Measurements

All from the production build, two Chromium browsers signed in as different
people (`qa-staff`, `qa-pm`), on the local Supabase stack. Raw data is in
`evidence/w0-6-*.json`. How to re-run: section 8 of the W0-5 notes.

### Speed (100 edits, alternating direction)

| Batching | Median (p50) | p95 | p99 | Worst | Network part only (p95) |
|---|---|---|---|---|---|
| 25 ms (default) | 39 ms | **44 ms** | 47 ms | 49 ms | 17 ms |
| 100 ms | 114 ms | **119 ms** | 124 ms | 125 ms | 17 ms |

- The time is measured from the edit in one browser to the text appearing in
  the other, on the same clock.
- Locally, the network part is about 17 ms. A hosted project adds the
  round trip to its region, typically 20–80 ms from Quebec to a North
  American region.
- Both batching settings stay far below the 1 s target, even with a hosted
  round trip added.

### 1,000 random edits from both sides at once

Each side made 500 edits at up to about 33 per second. Mix per side: about
60% inserts, 15% new blocks, 12% bold, 13% deletes.

| | Steady connection | Network cut 2 s in, for 4.7 s |
|---|---|---|
| Both browsers identical at the end | **Yes** | **Yes** |
| A third browser loading from the database alone matches | **Yes** | **Yes** |
| Time to settle after the last edit | 22 ms | 29 ms |
| Edits doubled, or deleted text coming back | 0 | 0 |
| Characters out of place, from the editor binding (F1) | 0 characters lost; 1 of 610 tokens (0.2%) interleaved | 2 characters lost ("[" and "A"), and 18 of 613 tokens (2.9%) interleaved |
| Browser A saw itself go offline, then come back | n/a | Yes |
| Saves that failed while offline, then succeeded on retry | 0 | 2, with 0 left unsaved at the end |
| Final document size (Yjs, including deletion history) | 56 KB | 56 KB |

**The same 1,000 random edits on a plain Yjs text, over the same Realtime
channel, with the same cut, were exact:** 577 of 577 expected tokens, 0
missing, 0 doubled, 0 stray characters (`evidence/w0-6-transport-fuzz.json`).
So the sync layer loses nothing. The differences above come from how the
editor converts its changes into Yjs changes (F1).

### Recovery from a real drop

- **How the drop was simulated.** Chromium's offline mode stops normal web
  requests but **leaves an open WebSocket running**, so it cannot fake a
  drop. The test routes the Realtime socket through Playwright, which cuts
  it and refuses to reconnect while the "network" is down. That is how a
  dead Wi-Fi link behaves.
- **What happened.** During the drop, 50 edits were made on each side. The
  client reconnected **1.9 s** after the network returned, and caught up
  **12 ms** later. 57 of 57 surviving tokens were present on both sides.

### Messages against Supabase Realtime limits

The limits come from Supabase's documentation, read on 2026-09-30.

| | Measured | Free | Pro |
|---|---|---|---|
| Largest message | **29.9 KB** (the catch-up after the drop). Normal edits: at most 0.76 KB; p95 0.45–0.68 KB; median 0.13–0.15 KB | 256 KB | 3,000 KB |
| Messages sent per second per busy editor | 26 at most, under a burst of 33 edits a second, with 25 ms batching | | |
| Messages per second for the whole project | See below | **100** | **500** |
| Connections at once | 1 per open editor tab | 200 | 500 |

- **Messages per second is the limit that matters.** Supabase counts every
  message sent **and every copy delivered**.
- With N people typing in one document at s messages per second each, the
  project uses about s × N² messages per second:
  - normal typing is 5–10 keystrokes a second, and batching caps s at 10
    even for fast typists;
  - 4 people typing in one document can therefore use up to about
    160 messages per second.
- On the Free plan, anyone over the limit is disconnected until the rate
  drops. `supabase-js` then reconnects, and the handshake repairs the
  document.
- Recommendations:
  - **batch for 100 ms in production.** It costs about 75 ms of delay and
    cuts the message rate up to 4 times;
  - **plan for the Pro plan before V1-17 (live co-editing) is turned on.**
    The execution plan already has a step for flagging Supabase limits to
    QBBE when usage passes 70%.
- Large messages are safe either way: anything over 64 KB is split, and the
  unit tests prove the parts reassemble.

## 3. Findings

| # | Finding | Measured | Impact | What to do |
|---|---|---|---|---|
| F1 | **y-prosemirror 1.x works out each change by comparing old and new text** (a "simple diff" on each paragraph), not from the exact change the editor made. Where text repeats (for example, inserting "the " just before "the"), it can pick an identical run of characters next door. That is invisible locally, but a simultaneous insert by someone else at the same spot can then end up **inside** a word. | Steady connection: 0–2 stray characters and 0–1 interleaved tokens per 1,000 edits, across runs. With one side offline for 4.7 s: 11–22 of about 613 tokens (1.8–3.6%) interleaved, and up to 2 characters lost. The test load was deliberately harsh: every edit landed between existing words in a small document. | Garbled characters where two people type in the same place at the same moment. No other text is affected. Nothing is silently deleted elsewhere. Versions and undo can repair it. | Accept for M4b and M4c. Keep the fuzz as a regression test. Report it upstream with this reproduction. Re-test with `@y/prosemirror` 2.x (a rewrite, still pre-release, needs Yjs 14). Show other people's cursors (V1-17) so people avoid typing in the same spot. |
| F2 | **Changing a block's type ("turn into") replaces the block.** Text someone else adds to that block during the delay (normally about 50–150 ms; for an offline person, the whole time offline) is dropped. | 22 type changes lost 4 to 8 of about 390 tokens across runs (6 of 391 in the final run) (`evidence/w0-6-turn-into-probe.json`) | Real lost edits, but only in the block being converted, and only while someone else types in it | Do "turn into" as a change to the block's settings, not a replacement, where the schema allows it. `@y/prosemirror` 2.x has a `customCompare` option aimed at exactly this. Until then, keep offline editing (V3-1) out of scope for documents. |
| F3 | **Two browsers starting from the same empty document** each create the document's outer structure, and the merge keeps one. | 5 of 10 first edits lost (`evidence/w0-6-empty-document-race-probe.json`) | Only in the first seconds of a brand-new page | **Create a page's Yjs content once, on the server, when the page is created (M4c).** Never let a browser create it on first open. All measurements above start from a created document. |
| F4 | Chromium's offline mode, and real Wi-Fi drops, do not close the WebSocket. Realtime only notices after its 25 s heartbeat fails. | Status stayed "connected" for 30 s with offline mode on | Edits "sent" during that time go nowhere, until the next handshake | Fixed in the spike: listen for the browser's offline and online events and handshake on reconnect. Also consider a shorter heartbeat (`heartbeatIntervalMs`, for example 10 s). |
| F5 | Changes are saved by their author only. If an author goes offline for good before saving, their edits exist only in the other browsers' copies. | Not triggered by the tests | A narrow data-loss window | In M4c, have every browser save what it holds (Yjs merges duplicates at the cost of some storage) and run compaction on a schedule. Or save on the server. |

## 4. Conditions for M4c and V1-17

1. **Permissions.** The spike's rules are placeholders. The real ones:
   - joining a document's channel (the `select` rule on `realtime.messages`)
     checks `app.can(read)` on the object;
   - **sending** (the `insert` rule) checks `app.can(edit)`, so people with
     read-only access can watch but not write;
   - the stored-changes table uses the same two checks.
2. **Create the Yjs state when a page is created** (F3). Compact the log on
   a schedule (F5). Take snapshots every 10 minutes (M16a), which also gives
   a way back from F1 and F2.
3. **Batch for 100 ms.** Budget for the Pro plan's message rate before V1-17
   goes live.

## 5. The fallback, documented but not needed

The fallback is a small sync server on the always-on machine planned for
virus scanning (#35), running y-websocket or Hocuspocus (both MIT).

- **How it would work.** It checks Supabase sign-in tokens with the
  project's public keys, asks `app.can` per document, and saves to the same
  table.
- **Switch to it if:**
  - hosted p95 goes over 1 s;
  - the Pro plan's 500 messages per second are not enough; or
  - QBBE does not want the Pro plan.
- **It would not fix F1 or F2.** Those are in the editor binding, which is
  the same whatever carries the messages.
- **Cost:** about 3 days for S3, plus running one more service.

## 6. What was not verified

- **A hosted Supabase project.** The spike used the local stack only, as
  required. Hosted latency and the real rate limiting were not measured.
  - Suggested before V1-17: run the same `coediting` tests against staging
    once the spike table is added there through a proper migration.
  - That needs the lead's approval.
- **More than two editors, Firefox and Safari, and phones.**
- **Awareness (other people's cursors) at scale.** The spike sends it but
  does not measure it.
