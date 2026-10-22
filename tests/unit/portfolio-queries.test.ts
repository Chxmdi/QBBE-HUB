import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

/**
 * Home, Projects and the CRM pipeline used to read `{ data }` from the
 * ordinary client, so a failed read rendered as "No projects yet" or an empty
 * pipeline and the error boundary (with Try again) was never reached. They
 * now read through the page client, which throws.
 */
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () =>
    createClient("https://project.supabase.co", "anon-key", {
      global: {
        fetch: async () =>
          new Response(JSON.stringify({ message: "permission denied for table project", code: "42501" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          }),
      },
    }),
}));
const { getPortfolio } = await import("@/features/dashboard/services/portfolio.queries");
const { getPipeline, getOpportunitiesForCrmOrganization } = await import("@/features/crm/services/opportunity.queries");

describe("page loaders surface a failed read", () => {
  it("getPortfolio throws instead of returning no projects", async () => {
    await expect(
      getPortfolio({ userId: "u1", role: "owner", filters: {} as never, now: new Date("2026-11-20T12:00:00Z") }),
    ).rejects.toMatchObject({ message: "permission denied for table project" });
  });

  it("the CRM pipeline readers throw instead of returning an empty pipeline", async () => {
    await expect(getPipeline("2026-11-20")).rejects.toMatchObject({ code: "42501" });
    await expect(getOpportunitiesForCrmOrganization("00000000-0000-0000-0000-000000000001", "2026-11-20")).rejects.toMatchObject({
      code: "42501",
    });
  });
});
