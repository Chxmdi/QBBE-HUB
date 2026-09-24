import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyIntegrationFailure } from "@/features/admin/services/integration-health";
import { reconcileGoogleDrive } from "@/features/documents/services/google-drive-reconcile";
import { googleSync } from "@/features/jobs/services/handlers/google-sync";
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

describe("Google Drive recovery", () => {
  function seedMirror(db: FakeSupabase, pageToken: string | null = "cursor-1") {
    db.seed("document", [{
      id: "known-row",
      organization_id: CONNECTION.organization_id,
      integration_connection_id: CONNECTION.id,
      external_id: "known-file",
      title: "Board packet",
      kind: "link",
      url: "https://drive.google.com/file/d/known/view",
      visibility: "private",
      owner_id: CONNECTION.user_id,
      created_by: CONNECTION.user_id,
    }]);
    db.seed("integration_secret", [{
      connection_id: CONNECTION.id,
      access_token: "access-token",
      refresh_token: "refresh-token",
      token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      google_drive_page_token: pageToken,
    }]);
  }

  function changes(entries: unknown[], newStartPageToken = "cursor-2") {
    return new Response(JSON.stringify({ changes: entries, newStartPageToken }), { status: 200 });
  }

  it.each([
    [401, "authentication_expired"],
    [403, "authentication_expired"],
    [503, "synchronization_delayed"],
  ] as const)("keeps the mirror and the cursor when Drive answers %i, and reports %s", async (status, health) => {
    const db = new FakeSupabase();
    seedMirror(db);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));

    const failure = await reconcileGoogleDrive(asClient(db), CONNECTION, "access-token", "cursor-1")
      .catch((error: unknown) => error);

    expect(classifyIntegrationFailure((failure as Error).message)).toBe(health);
    expect(db.rows("document")).toEqual([expect.objectContaining({ external_id: "known-file" })]);
    expect(db.rows("integration_secret")[0].google_drive_page_token).toBe("cursor-1");
  });

  it("rebuilds from a full read when Google expires the saved cursor", async () => {
    const db = new FakeSupabase();
    seedMirror(db);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 410 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ startPageToken: "fresh-start" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        files: [{ id: "new-file", name: "Minutes", webViewLink: "https://drive.google.com/file/d/new/view" }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await reconcileGoogleDrive(asClient(db), CONNECTION, "access-token", "cursor-1");

    expect(result).toMatchObject({ mode: "full", upserted: 1, removed: 1, pageToken: "fresh-start" });
    expect(db.rows("document").map((row) => row.external_id)).toEqual(["new-file"]);
    expect(db.rows("integration_secret")[0].google_drive_page_token).toBe("fresh-start");
  });

  it.each([
    ["was unshared or deleted", { fileId: "known-file", removed: true }],
    ["was moved to the trash", { fileId: "known-file", file: { id: "known-file", webViewLink: "https://drive.google.com/x", trashed: true } }],
    ["no longer has a link the user can open", { fileId: "known-file", file: { id: "known-file", name: "Board packet" } }],
  ])("stops listing a file that %s", async (_label, change) => {
    const db = new FakeSupabase();
    seedMirror(db);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(changes([change])));

    await reconcileGoogleDrive(asClient(db), CONNECTION, "access-token", "cursor-1");

    expect(db.rows("document")).toHaveLength(0);
  });

  it("updates a renamed or moved file in place instead of listing it twice", async () => {
    const db = new FakeSupabase();
    seedMirror(db);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(changes([{
      fileId: "known-file",
      file: {
        id: "known-file",
        name: "Board packet (final)",
        webViewLink: "https://drive.google.com/file/d/known/view",
        modifiedTime: "2026-09-24T09:00:00Z",
      },
    }])));

    await reconcileGoogleDrive(asClient(db), CONNECTION, "access-token", "cursor-1");

    expect(db.rows("document")).toEqual([expect.objectContaining({
      id: "known-row",
      external_id: "known-file",
      title: "Board packet (final)",
      visibility: "private",
    })]);
  });

  it("marks the connection for reconnection, without touching the mirror, when consent was revoked", async () => {
    const db = new FakeSupabase();
    seedMirror(db);
    db.rows("integration_secret")[0].token_expires_at = new Date(Date.now() - 60_000).toISOString();
    db.seed("integration_connection", [{
      id: CONNECTION.id,
      organization_id: CONNECTION.organization_id,
      user_id: CONNECTION.user_id,
      provider: "google_drive",
      status: "connected",
    }]);
    db.seed("background_job_run", []);
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(
      JSON.stringify({ error: "invalid_grant" }),
      { status: 400 },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const result = await googleSync({
      db: asClient(db),
      definition: { name: "google-sync", description: "", schedule: "", queue: null, enabled: true, batch_size: 25, max_attempts: 5 },
      now: new Date(),
    });
    vi.unstubAllEnvs();

    expect(result).toMatchObject({ processed: 0, failed: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.rows("integration_connection")[0]).toMatchObject({ status: "authentication_expired" });
    expect(db.rows("document")).toHaveLength(1);
  });
});
