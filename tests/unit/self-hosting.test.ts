import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The container image and the server release script (docs/runbooks/hosting.md).
 * The image bakes NEXT_PUBLIC_* values in at build time, so one the
 * Dockerfile does not declare would silently be empty in the browser.
 */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("Dockerfile", () => {
  const dockerfile = readFileSync(join(process.cwd(), "Dockerfile"), "utf8");

  it("declares every NEXT_PUBLIC_* variable the app reads as a build argument", () => {
    const used = new Set<string>();
    for (const file of sourceFiles(join(process.cwd(), "src"))) {
      for (const match of readFileSync(file, "utf8").matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g)) {
        used.add(match[1]);
      }
    }
    expect(used.size).toBeGreaterThan(0);
    for (const name of used) {
      expect(dockerfile, name).toMatch(new RegExp(`^ARG ${name}\\b`, "m"));
      expect(dockerfile, name).toContain(`${name}=\${${name}}`);
    }
  });

  it("runs as the unprivileged node user and reports its commit", () => {
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toContain("APP_COMMIT=${APP_COMMIT}");
    expect(dockerfile).toContain("/api/health/version");
  });
});

describe("deploy/server/release.sh", () => {
  const script = join(process.cwd(), "deploy/server/release.sh");
  const root = mkdtempSync(join(tmpdir(), "qbbe-release-"));

  function release(...args: string[]) {
    const result = spawnSync("bash", [script, ...args], {
      env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", QBBE_ROOT: root } satisfies NodeJS.ProcessEnv,
      encoding: "utf8",
    });
    return { ok: result.status === 0, output: result.stdout + result.stderr };
  }

  const sha = "0123456789abcdef0123456789abcdef01234567";

  it("refuses an unknown environment", () => {
    const result = release("preview", `ghcr.io/qbbe/hub:preview-${sha}`, "hub.example.org");
    expect(result.ok).toBe(false);
    expect(result.output).toContain("staging or production");
  });

  it("refuses to release one environment's image to the other", () => {
    const result = release("production", `ghcr.io/qbbe/hub:staging-${sha}`, "hub.example.org");
    expect(result.ok).toBe(false);
    expect(result.output).toContain("is not a production image");
  });

  it("refuses an address that is not a host name", () => {
    for (const bad of ["https://hub.example.org", "hub", "hub.example.org/x", "-hub.example.org"]) {
      const result = release("staging", `ghcr.io/qbbe/hub:staging-${sha}`, bad);
      expect(result.ok, bad).toBe(false);
      expect(result.output, bad).toContain("is not a host name");
    }
  });

  it("refuses to run before the server and its files are in place", () => {
    const result = release("staging", `ghcr.io/qbbe/hub:staging-${sha}`, "staging.hub.example.org");
    expect(result.ok).toBe(false);
    expect(result.output).toContain("is missing");
  });
});
