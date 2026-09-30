# W0-8 spike: lens query engine (P0-4)

Epic #199, plan section A7 (lens and query engine) and A2 (typed custom
property values). Stream S4. Time-boxed spike: prototype code, not product
code. Nothing here is applied to any database by default.

## Result: GO, with three conditions for Wave 1

- **Fast enough.** On 5,000 tasks with 10 custom properties, a full table-lens
  load takes **186 ms at p95** in the slowest scenario. The target is 1,000 ms.
  "Full load" means the first 100 rows, filtered, sorted and grouped, plus the
  total count and the per-group counts. The slowest count query is **64 ms at
  p95**. The target is 300 ms.
- **Safe.** Every field of the spec was attacked with 18 SQL injection
  payloads. Each attack was either rejected with a typed error or bound as a
  plain value. A 3,000-spec fuzzer found no case where input reached the SQL
  text. Against the database, no payload changed a row, the runner role cannot
  escape RLS, and each of the seven QA viewers sees exactly the rows the
  policy allows. That includes the case of a relation that points at an
  object the viewer cannot see.
- **Conditions** (details in [Recommendations](#recommendations-for-wave-1)):
  1. Make RLS on `property_value` and `object_relation` cheap before M2b and
     M3a ship. At 50,000 objects, RLS on those two tables is 90% of the cost
     of a relation filter.
  2. Choose how the server runs SQL as the viewer. The spike uses a direct
     Postgres connection with a login role that can only become
     `authenticated`. That needs one new server secret and a pooled
     connection string.
  3. Use keyset pagination and cached counts for types that will grow past
     about 20,000 objects.

## What was built

| Path | What it is |
|---|---|
| `src/lib/query/spike/spec.ts` | The query spec: types and a strict zod schema with limits |
| `src/lib/query/spike/catalog.ts` | The allow-list: system columns (code constants) plus custom properties loaded as the viewer |
| `src/lib/query/spike/dates.ts` | Relative dates (`today`, `this_week`, …) in the viewer's time zone, with weeks starting Monday |
| `src/lib/query/spike/compile.ts` | Spec to parameterised SQL: page, count and group counts |
| `src/lib/query/spike/run.ts` | Runs a lens as the viewer in a read-only transaction |
| `src/lib/query/spike/*.test.ts` | Unit tests: 174, no database needed, part of `npm test` |
| `src/lib/query/spike/*.dbtest.ts` | Database suites: security, RLS and the benchmark. Run only with `vitest.spike.config.ts` |
| `supabase/spikes/w0-8-query/` | Spike schema (`wos_spike`), deterministic seed, and a drop script. **Not migrations.** |
| `scripts/spikes/w0-8-query.mjs` | Applies, seeds or drops the spike on the local container only |
| `docs/design/spikes/W0-8-query-engine-plans.md` | Full `EXPLAIN (ANALYZE, BUFFERS)` output for every statement in every scenario |

## The query spec

```jsonc
{
  "version": 1,
  "type": "task",                        // an object type key
  "where": {                             // optional; nested and/or groups
    "and": [
      { "property": "stage", "operator": "is_any_of", "value": ["todo", "doing"] },
      { "or": [
        { "property": "due", "operator": "is", "value": { "relative": "this_week" } },
        { "property": "reviewers", "operator": "contains", "value": { "relative": "me" } }
      ] },
      // One level of relation traversal: "tasks of projects in space X"
      { "property": "project", "operator": "matches",
        "value": { "where": { "and": [{ "property": "space", "operator": "is", "value": "<space id>" }] } } }
    ]
  },
  "sort": [{ "property": "due", "direction": "asc" }, { "property": "title" }],
  "groupBy": { "property": "priority" },
  "select": ["stage", "priority", "due", "project"],   // columns to return
  "limit": 100,                                        // 1–200, default 100
  "offset": 0                                          // 0–10,000
}
```

Properties are named by **key**, a slug that is unique within the type. The
system properties are `title`, `space`, `owner`, `created_at` and
`updated_at`. A custom property cannot take a system key.

### Operators by kind

| Kind | Stored in | Operators | Value |
|---|---|---|---|
| text | `value_text` | equals, not_equals, contains, not_contains, starts_with, is_empty, is_not_empty | string, up to 500 characters; `%` and `_` match literally |
| number | `value_number` | eq, neq, lt, lte, gt, gte, between, is_empty, is_not_empty | finite number; `{from, to}` for between |
| date | `value_date` | is, before, after, on_or_before, on_or_after, between, is_empty, is_not_empty | `{date: "YYYY-MM-DD"}` or `{relative: …}`; `{from, to}` for between |
| select | `value_text` | is, is_not, is_any_of, is_none_of, is_empty, is_not_empty | option id, which must be one of the property's options; `space` takes a space id |
| multi_select | `value_json` (array) | has_any, has_all, has_none, is_empty, is_not_empty | a list of option ids |
| person | `value_json` (array); `owner` is a column | contains, not_contains, is_empty, is_not_empty | a user id or `{relative: "me"}` |
| checkbox | `value_bool` | is | true or false |
| relation | `object_relation` | contains, not_contains, is_empty, is_not_empty, matches | an object id; for `matches`, `{where: group}` on the related type, one level only |

Relative dates are `today`, `yesterday`, `tomorrow`, `this_week`,
`last_week`, `next_week`, `this_month`, `last_7_days` and `next_7_days`.
They resolve to whole days in the viewer's time zone. On `created_at` and
`updated_at`, which are timestamps, a day means midnight to midnight in that
time zone. `me` is always the signed-in viewer taken from the session. The
spec cannot supply it.

The "not" operators (`is_not`, `not_contains`, `has_none`, `neq`, checkbox
`false`) also match empty values, as they do in Notion. An empty value is a
missing row, never an empty string or an empty list.

**Sort** accepts text, number, date, select (in option order) and checkbox.
**Group** accepts select, checkbox, `space` and `owner`. Neither accepts
multi-select, person lists or relations, because one object would sit in
several places. The compiler rejects those with `not_sortable` or
`not_groupable`.

**Limits:** at most 50 conditions, 4 levels of nesting, 3 sort keys, 30
selected columns and 100 values in a list. Unknown keys are rejected at every
level.

## How it stays safe

1. **Strict parsing.** The spec is parsed with a strict zod schema: exact
   shapes, no unknown keys, sizes capped, no NUL bytes. The spike found that
   a NUL byte in a text value crashed the query in Postgres, so it is now
   refused up front.
2. **Allow-list.** Each property key is looked up in the catalog for the
   type. Each operator is checked against the table above for that kind. Each
   value is checked for kind and operator, including option ids and UUIDs.
   Sort and group keys go through the same lookup. Anything not found raises
   a `QueryError` with a code. The message never repeats the caller's text.
3. **No input in SQL text.** Values are only ever bind parameters (`$n::type`,
   with the cast chosen by the compiler). The only identifiers in the SQL are
   constants in `compile.ts` and `SYSTEM_COLUMNS` in `catalog.ts`. A custom
   property reaches SQL as its id, bound as a parameter. Even the property
   key never appears in the SQL text.
4. **Runs as the viewer, read only.** `run.ts` opens a `READ ONLY`
   transaction and runs `SET LOCAL ROLE authenticated`. It sets the JWT
   claims the same way PostgREST does, with a 5-second statement timeout.
   RLS decides which rows exist. The compiler has no permission logic of its
   own, so it cannot bypass RLS.
5. **The login role cannot escape.** `wos_spike_lens_runner` is `NOINHERIT`
   and a member of `authenticated` only. As itself it cannot read any table.
   It cannot `SET ROLE service_role` or `postgres`. No service-role key is
   used anywhere.

### Safety tests

Unit tests (`safety.test.ts`, `compile.test.ts`) run in `npm test` with no
database:

- **Every field.** 18 payloads were placed in every field: type, property
  name (filter, sort, group, select, and inside a relation filter),
  operator, sort direction, unknown keys, limit, offset, version, values of
  every kind, the nested pieces of dates and ranges, the viewer id and the
  time zone. The payloads include quote breaks, `;` plus DDL, comments,
  `$1`, dollar quoting, `e'\x27'`, casts, `set role`, full-width letters
  and a NUL byte. In each case the spec is either rejected with a
  `QueryError` (never a crash) or compiled. When it compiles, the SQL text is
  **identical** to the SQL for the same spec with the payload replaced by a
  harmless word. That proves the SQL text does not depend on values.
- **SQL text checks.** Every compiled statement is checked for:
  - words: every word is in the compiler's fixed vocabulary or is a generated
    alias;
  - literals: the only string literals are the compiler's own four;
  - symbols: no `;`, `--` or `/*`;
  - placeholders: each `$n` matches a bound value.
- **Fuzzing.** A seeded fuzzer builds 3,000 random specs, most of them
  well-typed so they reach the SQL generator, and checks the same rules for
  each one.

Database suite (`security.dbtest.ts`, 19 tests):

- Payloads bound as values run end to end, match nothing, and leave every
  table's row count unchanged.
- `%` and `_` in a contains filter match literally.
- The runner role cannot read tables as itself, cannot switch to
  `service_role` or `postgres`, and cannot write inside a lens transaction.
- **RLS equivalence.** For owner, staff, volunteer, guest, lead and pm, the
  rows returned (all pages) and the count equal the set computed
  independently as admin from the fixture's known access. A non-member cannot
  even resolve the type.
- Filtered counts and group counts for the lead stay inside the lead's
  visible rows.
- **Hidden relations.** The test takes a task the lead can see that links to
  a project the lead cannot see. The lead:
  - sees the task with an empty `project` column;
  - cannot find it by the project's id or title;
  - sees the link as empty.
  The owner sees the link, as a control.
- Direct reads of `property_value` return only the values of visible objects.

## Custom property store (spike schema)

This is `supabase/spikes/w0-8-query/schema.sql`, in its own `wos_spike`
schema:

- `object_type` and `property_definition`: key, names in English and French,
  kind, options, and target type for relations.
- `object`: the minimal A1 registry. Its RLS policy stands in for `app.can`:
  the set-based task-read helpers applied to spaces (programs), plus owner.
- `property_value(object_id, property_id, value_text, value_number,
  value_date, value_bool, value_json)`:
  - primary key `(object_id, property_id)`;
  - a partial B-tree index per typed column: `(property_id, value_x) where
    value_x is not null`;
  - GIN `jsonb_path_ops` on `value_json`;
  - trigram GIN on `value_text`.
  - `value_bool` was added to the four columns in the plan. It keeps
    checkboxes indexable and simple.
- `object_relation(from_id, property_id, to_id)`: primary key on all three,
  plus a reverse index `(to_id, property_id)`.
- RLS: values and relations are visible only when their object (or both
  ends) are visible. Read-only grants for `authenticated`.

The seed is `seed.sql`. It is deterministic and creates 5,000 tasks and 200
projects. Each value is empty about 15% of the time. Tasks spread 45% / 45% /
10% across the two seeded programs and no space. Some tasks link to projects
their viewer cannot see. Result: 38,474 property values and 4,779 relations.

## Numbers

Setup:

- Local Supabase stack, PostgreSQL 17.6, in a 4 vCPU, 15 GB container.
- 40 timed runs per row, after 5 warm-up runs.
- **"Total"** is the server-side lens load: pool checkout, role switch,
  catalog load, compile, page query, count, group counts and decode.
- A browser round-trip to a hosted project adds network time on top.
- Owner sees 4,859 tasks (all non-archived). Lead sees 2,516.

### 5,000 tasks (the target)

| Scenario | Viewer | Matches | Total p50 | **Total p95** | Page p95 | **Count p95** | **Group counts p95** |
|---|---|---|---|---|---|---|---|
| A. 3 filters in and/or, sort date then title, group by select, 9 columns | owner | 762 | 143 | **186** | 79 | **51** | **64** |
| | lead | 393 | 136 | 162 | 81 | 45 | 44 |
| B. Relation: tasks of projects in a space (and not closed), sort updated, group | owner | 1,261 | 96 | 127 | 53 | 33 | 43 |
| | lead | 652 | 112 | 145 | 64 | 36 | 44 |
| C. Title contains + notes does not contain, sort number | owner | 555 | 44 | 56 | 32 | 24 | – |
| | lead | 287 | 44 | 59 | 34 | 20 | – |
| D. No filter, sort title, group by stage | owner | 4,859 | 53 | 69 | 40 | 6 | 20 |
| | lead | 2,516 | 66 | 82 | 48 | 10 | 25 |
| E. "Me": my reviews or mine, due by next week, not done, group by checkbox | owner | 472 | 101 | 137 | 52 | 38 | 43 |
| | lead | 327 | 107 | 133 | 58 | 36 | 44 |

All times are in ms. Worst total p95: **186 ms**, against a budget of 1,000.
Worst count p95: **64 ms**, against a budget of 300. The benchmark asserts
both budgets, so it fails if they are missed.

### 50,000 tasks (10 times the target, for headroom)

Setup: 2,000 projects, 385,151 values, 20 runs per row.

| Scenario | Viewer | Total p95 | Count p95 | Group counts p95 |
|---|---|---|---|---|
| A | owner / lead | 1,622 / 951 | 525 / 311 | 569 / 330 |
| B | owner / lead | **3,285** / 1,427 | 1,082 / 423 | 1,137 / 507 |
| C | owner / lead | 397 / 254 | 202 / 115 | – |
| D | owner / lead | 603 / 422 | 26 / 30 | 236 / 153 |
| E | owner / lead | 1,235 / 684 | 376 / 219 | 440 / 255 |

Cost grows about linearly with rows matched, because each count must visit
every match. At 50,000 the budget is missed.

To find the cause, the B count query was timed as the owner with RLS on
(through the runner) and as admin with RLS off:

| Query at 50,000 tasks | With RLS | Without RLS |
|---|---|---|
| A count | 410 ms | 383 ms |
| B count (relation) | 904 ms | 89 ms |

For plain filters, RLS is cheap. For relation filters, RLS is about 90% of
the cost. The policies on `object_relation` (both ends) and `property_value`
each run a lookup against `object` for every candidate row.

### What the plans show

The full plans are in the
[plans file](./W0-8-query-engine-plans.md).

- **Filters start from the per-kind indexes.** Scenario A begins with a
  bitmap scan of `property_value_text_idx` for `stage`: 2,584 rows. It
  semi-joins to `object` through `object_pkey`, then checks the remaining
  conditions with primary-key lookups on `property_value_pkey`. There is no
  sequential scan of `property_value`.
- **RLS is paid per row.**
  - On `object`, the policy runs as one-time InitPlans (the
    `(select app.…())::uuid[]` pattern from #115). That part costs almost
    nothing.
  - On `property_value` and `object_relation`, the policy is a correlated
    `EXISTS` on `object`: one index lookup per value row touched. This is
    what grows at 50,000.
- **Sorting.**
  - The page query sorts only the matching rows, using a quicksort of about
    110 kB.
  - The selected values and relation titles are then fetched for just the
    100 rows on the page.
  - Planning time is about 4 ms.
- **The slow relation plan at 50,000.** The B count plan has a nested-loop
  anti-join that removed 12.3 million rows by join filter. That is the
  `is_not close` condition inside the relation filter. The planner chose a
  nested loop where a hash anti-join would be far cheaper, most likely from
  a poor row estimate (not confirmed: the plans were captured without
  costs). This will need its statistics or query shape tuned in Wave 1.

## Running SQL as the viewer: the choice for Wave 1

PostgREST, and therefore `supabase-js`, cannot run SQL the server generated.
The spike runs it over a direct Postgres connection:

- the connection logs in as `wos_spike_lens_runner`, which is `NOINHERIT` and
  a member of `authenticated` only;
- each load opens a `READ ONLY` transaction, runs `SET LOCAL ROLE
  authenticated`, and sets `request.jwt.claims` from the verified session.

| Option | For | Against |
|---|---|---|
| **A. Direct connection as a runner role (the spike)** | Compiler in TypeScript and unit-testable; one round trip per statement; read-only transactions; RLS unchanged | New server secret (the runner password). Needs the Supavisor pooler in transaction mode from Netlify functions. Anyone with the password can claim to be any user (bounded by RLS, but still impersonation). Must never reach the browser. |
| B. Compiler ported to a `security invoker` PL/pgSQL function, called with `supabase.rpc` | No new secret; runs through the existing session; RLS applies natively | Two compilers or none in TypeScript; PL/pgSQL is harder to test and fuzz; dynamic SQL built with `format('%I')` and `USING` |
| C. Generic "execute this SQL" RPC | — | **Rejected.** Any signed-in user could run arbitrary SQL (bounded by RLS, but unbounded cost and a huge attack surface). |

**Recommendation: A for the MVP.** Keep the password in the server
environment only, in the same place as the service key today. Add a test that it is never in a `NEXT_PUBLIC_` variable.
Take the user id only from `supabase.auth.getUser()` / `getClaims()` on the
server. If the lead prefers no new secret, B is viable: the spec format and
the tests carry over unchanged, and only the SQL builder moves.

## Recommendations for Wave 1

1. **M2b and M3a: cheap RLS on values and relations.** Copy the object's
   access keys (`organization_id`, `space_id`, `owner_id`) onto
   `property_value` and `object_relation`, maintained by trigger. Their
   policies can then use the same InitPlan arrays as `object` and skip the
   per-row lookup. Alternatively, key them on the P0-3 cached access table
   (`app.can` results) once that exists. Re-run this benchmark at 50,000.
2. **Lens paging.** Use keyset ("after this row") pagination instead of
   `offset`. Show exact counts up to about 10,000 matches; above that, show a
   cached or estimated count, refreshed in the background.
3. **Property-level privacy (M10e)** is not in the spike. The catalog is
   loaded as the viewer, so a restricted property will be absent from it and
   rejected as unknown. Add a test when M10e lands.
4. **Relation filter shape.** Rewrite `matches` as `o.id in (select from_id
   … where to_id in (visible targets))`, and add extended statistics on
   `property_value (property_id, value_text)` so the planner stops picking
   the nested-loop anti-join shown above.
5. **Keep the budgets as tests.** The benchmark asserts 1,000 ms per page
   and 300 ms per count. Run it in the perf workflow (`perf.yml`) against
   the seeded spike data, the same way `perf-fixture.sql` is used today.

## Reproduce locally

Warning: step 3 creates a schema and a login role. Run it on the **local**
stack only. The script only talks to the local Docker container, so it cannot
reach a hosted project.

1. Start the local stack:
   `bash scripts/local-signing-key.sh && npx supabase start -x studio,edge-runtime,logflare,vector,supavisor,imgproxy`.
   It prints the local API URL when ready.
2. Reset and seed the normal workspace:
   `npx supabase db reset && npm run db:seed`.
   It ends with "Seeded. Sign in as qa-owner@example.com …".
3. Apply the spike: `node scripts/spikes/w0-8-query.mjs apply`.
   It prints "Applied schema wos_spike to the local database."
4. Seed the spike: `node scripts/spikes/w0-8-query.mjs seed`.
   It prints a row reading `5000 | 200 | 38474 | 4779`. Use `seed 50000` for
   the headroom run, which takes a few minutes.
5. Run the database suites:
   `SPIKE_REPORT=docs/design/spikes/W0-8-query-engine-plans.md npx vitest run --config vitest.spike.config.ts`.
   You should see "Tests 20 passed" and the timing table.
   - If the benchmark fails with `expected … to be less than 1000`, the
     machine is slower than budget. Compare with the table above before
     drawing conclusions.
   - If every test fails with "password authentication failed", step 3 was
     not run.
6. Remove it when done: `node scripts/spikes/w0-8-query.mjs drop`.
   It prints "Dropped schema wos_spike."

## Verified and not verified

Verified here:

- the 174 unit tests;
- the 20 database tests, including the benchmark assertions, on the local
  stack;
- lint and typecheck;
- the 5,000 and 50,000 runs above.

Not verified:

- **Network time to a hosted project.** All timings are server-side on the
  local stack. Nothing was run against a hosted project, by rule.
- **The runner through the Supavisor pooler.** It is disabled in local
  config.
- **Mixed load.** Concurrent writes during reads were not measured.
- **Property-level privacy.**
- **Performance of real `app.can`.** The object policy here is a stand-in
  built from the existing task-read helpers. The real check is W0-7.
