import { createClient } from "@supabase/supabase-js";

/** One request supabase-js made, kept for inspection. */
export interface CapturedRequest {
  url: URL;
  method: string;
  body: unknown;
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * A real supabase-js client whose network is replaced, so the query builders
 * and RPC calls run for real and every request can be checked. Test support
 * only.
 */
export function fakeClient(respond: (request: CapturedRequest) => Response | Promise<Response>) {
  const requests: CapturedRequest[] = [];
  const client = createClient("https://project.supabase.co", "anon-key", {
    global: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = {
          url: new URL(String(input)),
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : null,
        };
        requests.push(request);
        return respond(request);
      },
    },
  });
  return { client, requests };
}
