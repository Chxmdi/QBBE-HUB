import { afterEach, describe, expect, it, vi } from "vitest";

let requestHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));

const { cookieShouldBeSecure } = await import("@/lib/secure-cookie");

afterEach(() => vi.unstubAllEnvs());

describe("Secure cookies follow the request's protocol, not the build mode", () => {
  it("marks a cookie Secure behind HTTPS", async () => {
    vi.stubEnv("NODE_ENV", "production");
    requestHeaders = new Headers({ host: "hub.example.org", "x-forwarded-proto": "https" });
    expect(await cookieShouldBeSecure()).toBe(true);
  });

  it("does not on a production build served over plain http, which WebKit would refuse", async () => {
    vi.stubEnv("NODE_ENV", "production");
    requestHeaders = new Headers({ host: "127.0.0.1:3000", "x-forwarded-proto": "http" });
    expect(await cookieShouldBeSecure()).toBe(false);
    requestHeaders = new Headers({ host: "127.0.0.1:3000" });
    expect(await cookieShouldBeSecure()).toBe(false);
    requestHeaders = new Headers({ host: "localhost:3000" });
    expect(await cookieShouldBeSecure()).toBe(false);
  });

  it("keeps a production build with no proxy header on another host Secure", async () => {
    vi.stubEnv("NODE_ENV", "production");
    requestHeaders = new Headers({ host: "hub.example.org" });
    expect(await cookieShouldBeSecure()).toBe(true);
  });

  it("reads the first protocol when a chain of proxies lists several", async () => {
    requestHeaders = new Headers({ host: "hub.example.org", "x-forwarded-proto": "https, http" });
    expect(await cookieShouldBeSecure()).toBe(true);
  });
});
