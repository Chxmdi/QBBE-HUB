import { afterEach, describe, expect, it, vi } from "vitest";
import { mapGmailListToRows } from "@/features/inbox/services/gmail-ingest";
import {
  fetchGmailHistory,
  fetchGmailMetadata,
  fetchCalendarOverlay,
  fetchGoogleDriveSync,
  gmailHistoryMessageIds,
  gmailPushClaimsAreValid,
  gmailWatchNeedsRenewal,
  parseGmailPushNotification,
} from "@/features/inbox/services/gmail-sync";
import fixture from "@/features/inbox/tests/gmail-list.fixture.json";

afterEach(() => vi.unstubAllGlobals());

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

describe("Gmail push/watch boundaries", () => {
  it("renews absent, invalid, and near-expiry watches", () => {
    const now = Date.UTC(2026, 7, 18);
    expect(gmailWatchNeedsRenewal(null, now)).toBe(true);
    expect(gmailWatchNeedsRenewal("not-a-date", now)).toBe(true);
    expect(gmailWatchNeedsRenewal(new Date(now + 23 * 60 * 60_000).toISOString(), now)).toBe(true);
    expect(gmailWatchNeedsRenewal(new Date(now + 2 * 24 * 60 * 60_000).toISOString(), now)).toBe(false);
  });

  it("accepts only a valid Gmail Pub/Sub notification envelope", () => {
    const encoded = Buffer.from(JSON.stringify({ emailAddress: "Member@Example.org", historyId: "12345" })).toString("base64");
    expect(parseGmailPushNotification(encoded)).toEqual({ emailAddress: "member@example.org", historyId: "12345" });
    expect(parseGmailPushNotification("not-base64")).toBeNull();
  });

  it("requires the expected Pub/Sub OIDC audience and service account", () => {
    const claims = { aud: "https://hub.example.org/push", email: "pubsub@example.iam.gserviceaccount.com", email_verified: "true", exp: 2000 };
    expect(gmailPushClaimsAreValid(claims, claims.aud, claims.email, 1000)).toBe(true);
    expect(gmailPushClaimsAreValid(claims, "https://other.example.org", claims.email, 1000)).toBe(false);
  });

  it("collects every Gmail history variant without duplicate message ids", () => {
    expect(
      gmailHistoryMessageIds([
        {
          messages: [{ id: "message-1" }],
          messagesAdded: [{ message: { id: "message-2" } }],
          labelsRemoved: [{ message: { id: "message-1" } }],
        },
      ]),
    ).toEqual(["message-1", "message-2"]);
  });

  it("paginates Gmail history deltas before advancing the cursor", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          history: [{ messagesAdded: [{ message: { id: "message-1" } }] }],
          historyId: "101",
          nextPageToken: "page-2",
        }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          history: [{ labelsRemoved: [{ message: { id: "message-2" } }] }],
          historyId: "102",
        }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchGmailHistory("token", "100")).resolves.toEqual({
      messageIds: ["message-1", "message-2"],
      historyId: "102",
    });
    expect(fetchMock.mock.calls[1]?.[0].toString()).toContain("pageToken=page-2");
  });

  it("enumerates every Inbox page when a history cursor must be reset", async () => {
    const metadata = (id: string) => ({
      id,
      threadId: `thread-${id}`,
      snippet: `Snippet ${id}`,
      internalDate: "1718000000000",
      labelIds: ["INBOX"],
      payload: { headers: [{ name: "From", value: "sender@example.org" }] },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [{ id: "message-1" }], nextPageToken: "page-2" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [{ id: "message-2" }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(metadata("message-1")), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(metadata("message-2")), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchGmailMetadata("token")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ external_id: "message-1" }),
        expect.objectContaining({ external_id: "message-2" }),
      ]),
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[1]?.[0].toString()).toContain("pageToken=page-2");
  });
});

describe("Google Calendar overlay synchronization", () => {
  it("paginates a tokenized delta and reconciles cancelled events", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{
          id: "event-1",
          summary: "Staff check-in",
          htmlLink: "https://calendar.google.com/event-1",
          updated: "2026-08-18T12:00:00Z",
          start: { dateTime: "2026-08-20T14:00:00Z" },
          end: { dateTime: "2026-08-20T15:00:00Z" },
        }],
        nextPageToken: "page-2",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{ id: "event-2", status: "cancelled" }],
        nextSyncToken: "next-token",
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCalendarOverlay("token", "prior-token")).resolves.toEqual({
      rows: [{
        external_id: "event-1",
        title: "Staff check-in",
        starts_at: "2026-08-20T14:00:00Z",
        ends_at: "2026-08-20T15:00:00Z",
        html_link: "https://calendar.google.com/event-1",
        external_updated_at: "2026-08-18T12:00:00Z",
      }],
      removedIds: ["event-2"],
      syncToken: "next-token",
    });
    const firstUrl = fetchMock.mock.calls[0]?.[0].toString();
    const secondUrl = fetchMock.mock.calls[1]?.[0].toString();
    expect(firstUrl).toContain("syncToken=prior-token");
    expect(firstUrl).toContain("showDeleted=true");
    expect(secondUrl).toContain("syncToken=prior-token");
    expect(secondUrl).toContain("pageToken=page-2");
  });

  it("requires a new full synchronization when Google expires the token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 410 })));
    await expect(fetchCalendarOverlay("token", "expired-token"))
      .rejects.toThrow("full synchronization is required");
  });
});

describe("Google Drive metadata synchronization", () => {
  it("paginates changes and distinguishes metadata updates from removals", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        changes: [{ fileId: "file-1", file: {
          id: "file-1", name: "Operating plan", mimeType: "application/pdf",
          modifiedTime: "2026-08-18T12:00:00Z", webViewLink: "https://drive.google.com/file-1",
        } }],
        nextPageToken: "page-2",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        changes: [{ fileId: "file-2", removed: true }],
        newStartPageToken: "next-page-token",
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchGoogleDriveSync("token", "prior-page-token")).resolves.toEqual({
      rows: [{
        external_id: "file-1", title: "Operating plan", description: null,
        url: "https://drive.google.com/file-1", mime_type: "application/pdf",
        updated_at: "2026-08-18T12:00:00Z",
      }],
      removedIds: ["file-2"],
      pageToken: "next-page-token",
    });
    expect(fetchMock.mock.calls[0]?.[0].toString()).toContain("pageToken=prior-page-token");
    expect(fetchMock.mock.calls[0]?.[0].toString()).toContain("includeRemoved=true");
    expect(fetchMock.mock.calls[1]?.[0].toString()).toContain("pageToken=page-2");
  });

  it("takes a baseline token before reading every page of the full metadata mirror", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ startPageToken: "baseline-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        files: [{ id: "file-1", name: "Plan", webViewLink: "https://drive.google.com/file-1" }],
        nextPageToken: "page-2",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        files: [{ id: "file-2", name: "Notes", webViewLink: "https://drive.google.com/file-2" }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchGoogleDriveSync("token");
    expect(result.pageToken).toBe("baseline-token");
    expect(result.rows.map((row) => row.external_id)).toEqual(["file-1", "file-2"]);
    expect(fetchMock.mock.calls[1]?.[0].toString()).toContain("pageSize=1000");
    expect(fetchMock.mock.calls[2]?.[0].toString()).toContain("pageToken=page-2");
  });
});
