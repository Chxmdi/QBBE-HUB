import { expect, it } from "vitest";
import { requestOrigin } from "@/lib/request-origin";

const build = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { headers });

it("keeps the browser on the host it used, not the server's own name", () => {
  // The exact shape that broke password recovery: the server reports
  // localhost, the browser is on 127.0.0.1, and the session cookie belongs to
  // 127.0.0.1.
  const request = build("http://localhost:3000/auth/callback?code=abc", {
    host: "127.0.0.1:3000",
  });
  expect(requestOrigin(request)).toBe("http://127.0.0.1:3000");
});

it("prefers the forwarded host, because behind a proxy that is the public one", () => {
  const request = build("http://10.0.0.7:3000/auth/callback", {
    host: "10.0.0.7:3000",
    "x-forwarded-host": "hub.qbbe.ca",
    "x-forwarded-proto": "https",
  });
  expect(requestOrigin(request)).toBe("https://hub.qbbe.ca");
});

it("keeps the request's own scheme when the proxy does not state one", () => {
  const request = build("https://hub.qbbe.ca/auth/callback", { host: "hub.qbbe.ca" });
  expect(requestOrigin(request)).toBe("https://hub.qbbe.ca");
});

it("falls back to the request origin when there is no host header", () => {
  const request = new Request("https://hub.qbbe.ca/auth/callback");
  const headerless = new Proxy(request, {
    get(target, property) {
      if (property === "headers") return new Headers();
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  expect(requestOrigin(headerless)).toBe("https://hub.qbbe.ca");
});
