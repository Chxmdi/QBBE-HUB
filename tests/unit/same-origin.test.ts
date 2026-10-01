import { describe, expect, it } from "vitest";
import { crossSiteResponse, isSameOriginRequest } from "@/lib/same-origin";

const post = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers });

describe("isSameOriginRequest", () => {
  it("accepts a request the Hub's own pages make", () => {
    const request = post("http://127.0.0.1:3000/api/lenses/export", {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
    });
    expect(isSameOriginRequest(request)).toBe(true);
  });

  it("refuses a request another site's page triggers", () => {
    const request = post("http://127.0.0.1:3000/api/lenses/export", {
      host: "127.0.0.1:3000",
      origin: "https://evil.example",
    });
    expect(isSameOriginRequest(request)).toBe(false);
  });

  it("refuses an opaque origin, which a sandboxed page sends", () => {
    const request = post("http://127.0.0.1:3000/api/objects/import", {
      host: "127.0.0.1:3000",
      origin: "null",
    });
    expect(isSameOriginRequest(request)).toBe(false);
  });

  it("judges the public host behind a proxy, not the server's own name", () => {
    const request = post("http://10.0.0.7:3000/api/objects/import", {
      host: "10.0.0.7:3000",
      "x-forwarded-host": "hub.qbbe.ca",
      "x-forwarded-proto": "https",
      origin: "https://hub.qbbe.ca",
    });
    expect(isSameOriginRequest(request)).toBe(true);
  });

  it("falls back to the referer when there is no origin header", () => {
    const ok = post("http://127.0.0.1:3000/api/objects/import", {
      host: "127.0.0.1:3000",
      referer: "http://127.0.0.1:3000/lenses/import",
    });
    const bad = post("http://127.0.0.1:3000/api/objects/import", {
      host: "127.0.0.1:3000",
      referer: "https://evil.example/page",
    });
    expect(isSameOriginRequest(ok)).toBe(true);
    expect(isSameOriginRequest(bad)).toBe(false);
  });

  it("lets a request with neither header through: no page sent it", () => {
    const request = post("http://127.0.0.1:3000/api/objects/import", { host: "127.0.0.1:3000" });
    expect(isSameOriginRequest(request)).toBe(true);
  });
});

describe("crossSiteResponse", () => {
  it("is a 403 that names the refusal and nothing else", async () => {
    const response = crossSiteResponse();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "cross_site_request" });
  });
});
