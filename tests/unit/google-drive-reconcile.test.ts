import { afterEach, describe, expect, it, vi } from "vitest";
import { reconcileGoogleDrive } from "@/features/documents/services/google-drive-reconcile";
import { FakeSupabase, asClient } from "../support/fake-supabase";

afterEach(() => vi.unstubAllGlobals());

const CONNECTION = {
  id: "drive-connection-1",
  organization_id: "org-1",
  user_id: "user-1",
};

describe("Google Drive reconciliation", () => {
  it("stores a full mirror privately and prunes stale metadata only after the provider read succeeds", async () => {
    const db = new FakeSupabase(new Date("2026-09-24T06:30:00Z"));
    db.seed("document", [{
      id: "stale-row",
      organization_id: CONNECTION.organization_id,
      integration_connection_id: CONNECTION.id,
      external_id: "stale-file",
      title: "Old file",
      kind: "link",
      url: "https://drive.google.com/file/d/stale/view",
      visibility: "private",
      owner_id: CONNECTION.user_id,
      created_by: CONNECTION.user_id,
    }]);
    db.seed("integration_secret", [{
      connection_id: CONNECTION.id,
      google_drive_page_token: null,
    }]);

    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ startPageToken: "start-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        files: [{
          id: "file-1",
          name: "Board packet",
          mimeType: "application/pdf",
          modifiedTime: "2026-09-24T05:00:00Z",
          webViewLink: "https://drive.google.com/file/d/file-1/view",
          trashed: false,
        }],
      }), { status: 200 })));

    const result = await reconcileGoogleDrive(
      asClient(db),
      CONNECTION,
      "access-token",
    );

    expect(result).toMatchObject({ mode: "full", upserted: 1, removed: 1, pageToken: "start-1" });
    expect(db.rows("document")).toEqual([
      expect.objectContaining({
        external_id: "file-1",
        visibility: "private",
        owner_id: CONNECTION.user_id,
        integration_connection_id: CONNECTION.id,
      }),
    ]);
    expect(db.rows("integration_secret")[0].google_drive_page_token).toBe("start-1");
  });

  it("keeps the last known mirror when the provider full read fails", async () => {
    const db = new FakeSupabase();
    db.seed("document", [{
      id: "known-good",
      organization_id: CONNECTION.organization_id,
      integration_connection_id: CONNECTION.id,
      external_id: "known-file",
      title: "Known file",
      kind: "link",
      url: "https://drive.google.com/file/d/known/view",
      visibility: "private",
      owner_id: CONNECTION.user_id,
      created_by: CONNECTION.user_id,
    }]);
    db.seed("integration_secret", [{
      connection_id: CONNECTION.id,
      google_drive_page_token: null,
    }]);

    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ startPageToken: "start-2" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 })));

    await expect(reconcileGoogleDrive(
      asClient(db),
      CONNECTION,
      "access-token",
    )).rejects.toThrow("Google Drive list failed (503)");

    expect(db.rows("document")).toHaveLength(1);
    expect(db.rows("document")[0].external_id).toBe("known-file");
  });

  it("applies incremental removals without copying file bytes", async () => {
    const db = new FakeSupabase();
    db.seed("document", [{
      id: "removed-row",
      organization_id: CONNECTION.organization_id,
      integration_connection_id: CONNECTION.id,
      external_id: "removed-file",
      title: "Removed",
      kind: "link",
      url: "https://drive.google.com/file/d/removed/view",
      visibility: "private",
      owner_id: CONNECTION.user_id,
      created_by: CONNECTION.user_id,
    }]);
    db.seed("integration_secret", [{
      connection_id: CONNECTION.id,
      google_drive_page_token: "cursor-1",
    }]);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        changes: [{ fileId: "removed-file", removed: true }],
        newStartPageToken: "cursor-2",
      }), { status: 200 }),
    ));

    const result = await reconcileGoogleDrive(
      asClient(db),
      CONNECTION,
      "access-token",
      "cursor-1",
    );

    expect(result).toMatchObject({ mode: "incremental", removed: 1, pageToken: "cursor-2" });
    expect(db.rows("document")).toHaveLength(0);
  });
});
