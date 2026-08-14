import { describe, expect, it } from "vitest";
import { mapGmailListToRows } from "@/features/inbox/services/gmail-ingest";
import fixture from "@/features/inbox/tests/gmail-list.fixture.json";

describe("mapGmailListToRows", () => {
  it("maps metadata from a recorded Gmail list fixture and dedupes ids", () => {
    const rows = mapGmailListToRows(
      fixture.messages as Parameters<typeof mapGmailListToRows>[0],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      external_id: "msg-1",
      thread_id: "thr-1",
      subject: "Venue confirmation",
      from_address: "partner@example.org",
    });
    expect(rows[0].snippet).toBeTruthy();
    expect(JSON.stringify(rows[0])).not.toMatch(/full body/i);
  });
});
