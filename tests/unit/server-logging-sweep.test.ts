import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Server code logs through src/lib/server-log.ts: one JSON line with a
 * request id and redacted values. A bare console call writes free text that
 * may carry personal information and cannot be matched to a request.
 *
 * ALLOWED lists the files that may still call console directly: the logger
 * and error reporter themselves, browser-only code, and command files whose
 * error handling is being reworked in another change (remove each one as it
 * moves to logActionFailure). A new file here needs a reason.
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
  // Pending: command files and the API handler move with the shared
  // database-error mapper.
  "src/features/object-comments/services/object-comment.commands.ts",
  "src/features/comments/services/comment.commands.ts",
  "src/features/pages/services/page.commands.ts",
  "src/features/versions/services/version.commands.ts",
  "src/features/admin/services/integration.commands.ts",
  "src/features/api-tokens/services/api-handler.ts",
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
