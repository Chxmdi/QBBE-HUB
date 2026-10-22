import { describe, expect, it } from "vitest";
import { auditCursorOf, auditOlderFilter, isOlderThan, parseAuditCursor } from "../audit-cursor";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TIED = "2026-10-22T21:00:00.123456+00:00";

describe("the admin audit cursor", () => {
  it("round-trips the last row's time and id", () => {
    const cursor = auditCursorOf({ created_at: TIED, id: ID(7) });
    expect(parseAuditCursor(cursor.before, cursor.beforeId)).toEqual({ createdAt: TIED, id: ID(7) });
  });

  it("accepts the timestamp forms the database returns", () => {
    for (const ts of ["2026-10-22T21:00:00+00:00", "2026-10-22T21:00:00.1+00:00", "2026-10-22T21:00:00.123456Z"]) {
      expect(parseAuditCursor(ts, ID(1))).not.toBeNull();
    }
  });

  it("refuses anything else, so nothing can be added to the filter", () => {
    for (const [ts, id] of [
      [`${TIED},id.gt.0`, ID(1)],
      [`${TIED})`, ID(1)],
      ["yesterday", ID(1)],
      [TIED, "not-an-id"],
      [TIED, `${ID(1)},event_type.eq.x`],
      [undefined, ID(1)],
      [TIED, undefined],
    ] as const) {
      expect(parseAuditCursor(ts, id)).toBeNull();
    }
  });

  it("filters to rows older by time, then by id among rows of the same time", () => {
    expect(auditOlderFilter({ createdAt: TIED, id: ID(7) })).toBe(
      `created_at.lt."${TIED}",and(created_at.eq."${TIED}",id.lt.${ID(7)})`,
    );
  });

  it("pages through rows sharing one timestamp across a page boundary with none repeated or skipped", () => {
    // 75 events: 10 newer, 45 sharing one timestamp (straddling the page
    // boundaries), 20 older. Pages are read as the admin page reads them:
    // newest first by (created_at, id), 31 fetched, 30 shown.
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => ({ created_at: "2026-10-22T22:00:00+00:00", id: ID(100 + i) })),
      ...Array.from({ length: 45 }, (_, i) => ({ created_at: TIED, id: ID(200 + i) })),
      ...Array.from({ length: 20 }, (_, i) => ({ created_at: "2026-10-22T20:00:00+00:00", id: ID(300 + i) })),
    ];
    const ordered = [...rows].sort((a, b) =>
      a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1,
    );
    const seen: string[] = [];
    let cursor: ReturnType<typeof parseAuditCursor> = null;
    for (let page = 0; page < 10; page += 1) {
      const fetched = ordered.filter((row) => !cursor || isOlderThan(row, cursor)).slice(0, 31);
      const shown = fetched.slice(0, 30);
      seen.push(...shown.map((row) => row.id));
      if (fetched.length <= 30) break;
      const next = auditCursorOf(shown[shown.length - 1]);
      cursor = parseAuditCursor(next.before, next.beforeId);
    }
    expect(seen).toEqual(ordered.map((row) => row.id));
  });
});
