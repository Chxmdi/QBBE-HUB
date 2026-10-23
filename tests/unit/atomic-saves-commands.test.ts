import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Creating a project or a meeting, and closing a project, is one database
 * call (create_project_with_channel, create_meeting_series,
 * close_project_with_evidence). A refused call is reported as a failure and
 * nothing else is written around it.
 */

const ORG = "33333333-3333-4333-8333-333333333333";
const ME = "11111111-1111-4111-8111-111111111111";
const state = vi.hoisted(() => ({
  rpc: [] as { name: string; args: Record<string, unknown> }[],
  writes: [] as string[],
  rpcError: null as { message: string } | null,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: async () => null }));
vi.mock("@/lib/access-capabilities", () => ({
  hasProgramCapability: async () => true,
  hasProjectCapability: async () => true,
}));
vi.mock("@/lib/auth", () => {
  const session = { userId: ME, organizationId: ORG, isAdmin: true, isStaff: true, role: "admin", timeZone: "America/Toronto" };
  return { requireSession: async () => session, authorizeAdminAction: async () => ({ ok: true, session }) };
});
vi.mock("@/lib/i18n/server", async () => {
  const { createTranslator } = await import("@/lib/i18n/translate");
  return { getLocale: async () => "en", getT: async () => createTranslator("en") };
});
vi.mock("@/features/calendar/services/google-calendar-write", () => ({
  createGoogleMeetingEvent: async () => null,
  calendarFailureStatus: () => "synchronization_delayed",
}));
vi.mock("@/lib/supabase/server", () => {
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "order", "limit", "maybeSingle", "single"]) q[m] = () => q;
    for (const m of ["insert", "update", "upsert", "delete"]) q[m] = () => (state.writes.push(`${m}:${table}`), q);
    q.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
    return q;
  };
  return {
    createSupabaseServerClient: async () => ({
      from: chain,
      rpc: async (name: string, args: Record<string, unknown>) => {
        state.rpc.push({ name, args });
        return { data: state.rpcError ? null : name === "close_project_with_evidence" ? "closure-1" : null, error: state.rpcError };
      },
    }),
  };
});

const { createProject } = await import("@/features/projects/services/project.commands");
const { createMeeting } = await import("@/features/meetings/services/meeting.commands");

beforeEach(() => {
  state.rpc = [];
  state.writes = [];
  state.rpcError = null;
});

const projectInput = {
  name: "Gala",
  priority: "medium",
  reportingCadence: "monthly",
  stage: "planning",
};

describe("creating a project", () => {
  it("saves the project, its manager and its channel in one call, with a slug base from the name", async () => {
    const result = await createProject(projectInput);
    expect(result.ok).toBe(true);
    expect(state.rpc[0].name).toBe("create_project_with_channel");
    expect(state.rpc[0].args).toMatchObject({ p_slug_base: "gala", p_channel_name: "Gala" });
    expect(state.writes.filter((w) => !w.endsWith(":activity_event"))).toEqual([]);
  });

  it("reports a refused save as a failure and writes nothing else", async () => {
    state.rpcError = { message: "new row violates row-level security policy" };
    const result = await createProject(projectInput);
    expect(result.ok).toBe(false);
    expect(state.writes).toEqual([]);
  });
});

describe("creating a meeting", () => {
  it("reports a refused series as a failure", async () => {
    state.rpcError = { message: "Injected agenda failure" };
    const result = await createMeeting({
      title: "Board",
      startsAt: "2026-11-02T10:00",
      durationMinutes: 60,
      repeat: "weekly",
      occurrences: 3,
    });
    expect(result.ok).toBe(false);
    expect(state.rpc[0].name).toBe("create_meeting_series");
    expect((state.rpc[0].args.p_meetings as unknown[]).length).toBe(3);
    expect((state.rpc[0].args.p_attendees as unknown[]).length).toBe(3);
  });
});

