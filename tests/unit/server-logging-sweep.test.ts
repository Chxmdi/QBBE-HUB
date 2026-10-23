import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Server code logs through src/lib/server-log.ts: one JSON line with a
 * request id and redacted values. A bare console call writes free text that
 * may carry personal information and cannot be matched to a request.
 *
 * ALLOWED lists the files that may still call console directly: the logger
 * and error reporter themselves, and browser-only code. A new file here
 * needs a reason.
 */
const ALLOWED = new Set([
  "src/lib/server-log.ts",
  "src/lib/observability.ts",
  // Imported by server-log.ts; logging through it would be circular.
  "src/lib/rate-limit.ts",
  // Runs before anything else and must not import the database client.
  "src/instrumentation.ts",
  // The development e-mail transport prints the message it would have sent.
  "src/features/notifications/services/email-provider.ts",
  // Browser code.
  "src/features/editor/adapter/blocknote/block-frame.tsx",
  "src/features/editor/spike/editor-spike-inner.tsx",
  "src/features/editor/spike/yjs-broadcast-provider.ts",
  "src/lib/query/spike/bench.dbtest.ts",
]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "tests" ? [] : files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("server logging", () => {
  it("has no bare console calls outside the allowed files", () => {
    const offenders = files(join(process.cwd(), "src"))
      .map((path) => relative(process.cwd(), path))
      .filter((path) => !ALLOWED.has(path))
      .filter((path) => /\bconsole\.(log|info|warn|error|debug)\(/.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });
});
