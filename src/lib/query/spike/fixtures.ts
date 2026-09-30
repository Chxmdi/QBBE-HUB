// W0-8 spike: an in-memory catalog matching supabase/spikes/w0-8-query/seed.sql,
// for the unit tests (no database).

import { buildCatalog, type Option, type PropertyRow } from "./catalog";
import type { CompileContext } from "./compile";

export const TASK_TYPE = "11111111-1111-4111-8111-111111111111";
export const PROJECT_TYPE = "22222222-2222-4222-8222-222222222222";
export const VIEWER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6";

const opts = (...ids: string[]): Option[] => ids.map((id) => ({ id, en: id, fr: id }));

let n = 0;
const prop = (type_id: string, key: string, kind: PropertyRow["kind"], extra: Partial<PropertyRow> = {}): PropertyRow => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  type_id,
  key,
  name_en: key,
  name_fr: key,
  kind,
  options: [],
  target_type_id: null,
  ...extra,
});

export const PROPERTY_ROWS: PropertyRow[] = [
  prop(PROJECT_TYPE, "phase", "select", { options: opts("plan", "run", "close") }),
  prop(PROJECT_TYPE, "budget", "number"),
  prop(TASK_TYPE, "stage", "select", { options: opts("backlog", "todo", "doing", "review", "done") }),
  prop(TASK_TYPE, "priority", "select", { options: opts("low", "medium", "high", "urgent") }),
  prop(TASK_TYPE, "tags", "multi_select", { options: opts("finance", "events", "youth", "board", "grants") }),
  prop(TASK_TYPE, "due", "date"),
  prop(TASK_TYPE, "estimate", "number"),
  prop(TASK_TYPE, "points", "number"),
  prop(TASK_TYPE, "reviewers", "person"),
  prop(TASK_TYPE, "notes", "text"),
  prop(TASK_TYPE, "approved", "checkbox"),
  prop(TASK_TYPE, "project", "relation", { target_type_id: PROJECT_TYPE }),
  // Tries to shadow a system property: must be ignored.
  prop(TASK_TYPE, "title", "number"),
];

export const catalog = buildCatalog(
  [
    { id: TASK_TYPE, key: "task" },
    { id: PROJECT_TYPE, key: "project" },
  ],
  PROPERTY_ROWS,
);

export const ctx: CompileContext = {
  viewerId: VIEWER,
  timeZone: "America/Toronto",
  // 2026-10-01 03:00 UTC is still Wednesday 2026-09-30 in Toronto.
  now: new Date("2026-10-01T03:00:00Z"),
};

export const propId = (key: string, type = TASK_TYPE) =>
  PROPERTY_ROWS.find((p) => p.key === key && p.type_id === type)!.id;

/** SQL injection attempts, used by the unit and database safety suites. */
export const PAYLOADS = [
  "' or 1=1 --",
  "'; drop table wos_spike.object; --",
  '"; select pg_sleep(10); --',
  "Robert'); DROP TABLE students;--",
  "x' union select id, email from auth.users --",
  "1) or (1=1",
  "$1",
  "$$ select 1 $$",
  "\\'; select 1; --",
  "e'\\x27'",
  "::text; reset role",
  "/* comment */ or true",
  "o.id is not null or o.id",
  "stage\u0000",
  "ｓｅｌｅｃｔ",
  "%_%\\",
  "set role service_role",
  "title desc, (select 1)",
];
