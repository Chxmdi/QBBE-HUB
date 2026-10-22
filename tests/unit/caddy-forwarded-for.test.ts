import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Per-address rate limits (the private API, browser crash reports) key on the
 * first X-Forwarded-For entry. That is safe only because Caddy, with no
 * trusted_proxies configured, replaces any X-Forwarded-For a client sends with
 * the address it actually connected from (checked on Caddy 2.10.2: a request
 * sent with "X-Forwarded-For: 6.6.6.6" reaches the app as the real address).
 * Trusting upstream proxies, or forwarding the client's header, would let a
 * client choose its own rate-limit key.
 *
 * To check a live server:
 *   curl -s -H 'X-Forwarded-For: 6.6.6.6' https://<site>/api/... and confirm
 *   the app's log line or rate-limit bucket shows the real address.
 */
const files = ["deploy/server/Caddyfile", "deploy/server/site.caddy.template"].map((path) => [
  path,
  readFileSync(join(process.cwd(), path), "utf8").replace(/#[^\n]*/g, ""),
]);

describe("Caddy client address", () => {
  it.each(files)("%s does not trust client-supplied forwarding headers", (_path, text) => {
    expect(text).not.toMatch(/trusted_proxies/);
    expect(text).not.toMatch(/header_up\s+X-Forwarded-For/i);
    expect(text).not.toMatch(/client_ip_headers/);
  });
});
