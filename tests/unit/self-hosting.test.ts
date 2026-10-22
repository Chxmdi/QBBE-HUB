import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
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

/**
 * Staging and production deploy access are separate (SEC-011). One deploy
 * user in the docker group, with one SSH key held by both environments, let
 * anything that could deploy staging read production's secrets and control
 * the whole server; both apps also shared Docker networks, so the staging
 * container could call production's directly.
 */
describe("separate deploy access per environment", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
  const setup = read("deploy/server/setup.sh");
  const wrapper = read("deploy/server/qbbe-release");
  const sudoers = read("deploy/server/sudoers.qbbe");

  it("creates one deploy user per environment, outside the docker group and without general sudo", () => {
    expect(setup).toMatch(/for environment in staging production/);
    expect(setup).toContain('useradd --create-home --shell /bin/sh "qbbe-${environment}"');
    // Never added to the docker group (being in it is being root).
    expect(setup).not.toMatch(/usermod -aG docker "?qbbe-/);
    expect(setup).toMatch(/gpasswd -d "\$\{?user\}?" docker/);
  });

  it("allows each user only its own environment's release, through the root-owned wrapper", () => {
    const rules = sudoers.split("\n").filter((line) => line.trim() && !line.trim().startsWith("#"));
    expect(rules).toEqual([
      "qbbe-staging ALL=(root) NOPASSWD: /usr/local/sbin/qbbe-release staging *",
      "qbbe-production ALL=(root) NOPASSWD: /usr/local/sbin/qbbe-release production *",
    ]);
    expect(setup).toContain("visudo -cf");
    expect(setup).toMatch(/install -m 755 -o root -g root "\$\{SRC\}\/qbbe-release" \/usr\/local\/sbin\/qbbe-release/);
  });

  it("the wrapper checks who called it and runs only the server's own copies of the release files", () => {
    expect(wrapper).toContain('[ "${SUDO_USER:-}" = "qbbe-${ENVIRONMENT}" ]');
    // Nothing the deploy user uploads is executed or used as compose input.
    expect(wrapper).toContain('BIN="/opt/qbbe/bin"');
    expect(wrapper).toMatch(/bash "\$\{BIN\}\/release\.sh"/);
    expect(wrapper).not.toMatch(/\/home\/qbbe-/);
    expect(wrapper).toMatch(/^set -euo pipefail$/m);
  });

  it("keeps the environments' folders closed to each other once the old access is removed, for good", () => {
    expect(setup).toMatch(/install -d -m 700 -o root -g root "\$\{ROOT\}\/\$\{environment\}"/);
    // Remembered on the server, so an ordinary later run cannot restore it.
    expect(setup).toContain('[ -f "$LEGACY_MARKER" ] && REMOVE_LEGACY=1');
    expect(setup).toContain('touch "$LEGACY_MARKER"');
    // The old key, held by both environments, stops working as the admin key.
    expect(setup).toContain("removing the old access needs ADMIN_PUBKEY");
    expect(setup).toMatch(/install -m 600 -o "\$ADMIN_USER" -g "\$ADMIN_USER" "\$tmp" "\$\{admin_home\}\/\.ssh\/authorized_keys"/);
  });

  it("keeps deploy keys in root-owned files and gives deploy users no shell", () => {
    // Never written into a folder the deploy user owns.
    expect(setup).not.toMatch(/\$\{home\}\/\.ssh/);
    expect(setup).toContain('install -m 644 -o root -g root "$tmp" "/etc/ssh/authorized_keys/${user}"');
    expect(setup).toContain("AuthorizedKeysFile /etc/ssh/authorized_keys/%u");
    expect(setup).toContain("ForceCommand /usr/local/sbin/qbbe-ssh-gate");
    expect(setup).toContain("PermitTTY no");
    expect(setup).toContain("sshd -t");
    const gate = (command: string) =>
      spawnSync("bash", [join(process.cwd(), "deploy/server/qbbe-ssh-gate")], {
        env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", SSH_ORIGINAL_COMMAND: command },
        encoding: "utf8",
      });
    expect(gate("true").status).toBe(0);
    for (const refused of [
      "bash -i",
      "cat /opt/qbbe/production/app.env",
      "scp -t /tmp",
      "sudo -n /usr/local/sbin/qbbe-release 'staging' 'deploy' 'a' 'b' 'c'; id",
      "sudo -n /usr/local/sbin/qbbe-release 'staging' 'deploy' 'a' 'b' 'c' 'd'",
    ]) {
      const result = gate(refused);
      expect(result.status, refused).not.toBe(0);
      expect(result.stderr, refused).toContain("may only run the release wrapper");
    }
  });

  it("the gate lets through exactly the command Deploy and Rollback send", () => {
    // A stand-in sudo that prints what it was given, so nothing runs.
    const bin = mkdtempSync(join(tmpdir(), "qbbe-gate-"));
    writeFileSync(join(bin, "sudo"), '#!/bin/sh\nprintf "%s|" "$@"\n', { mode: 0o755 });
    for (const [workflow, mode] of [
      [".github/workflows/deploy.yml", "deploy"],
      [".github/workflows/rollback.yml", "rollback"],
    ] as const) {
      const line = read(workflow).match(/ssh qbbe "(sudo -n \/usr\/local\/sbin\/qbbe-release [^"]+)"/);
      expect(line, workflow).not.toBeNull();
      // Fill in the values the workflow's shell would substitute.
      const command = line![1]
        .replace("${TARGET_ENVIRONMENT}", "staging")
        .replace("${IMAGE}", "ghcr.io/qbbe/hub:staging-0123456789abcdef")
        .replace("${host}", "staging.hub.example.org")
        .replace("${REGISTRY_USER}", "someone");
      const result = spawnSync("bash", [join(process.cwd(), "deploy/server/qbbe-ssh-gate")], {
        env: { NODE_ENV: "test", PATH: `${bin}:${process.env.PATH ?? ""}`, SSH_ORIGINAL_COMMAND: command },
        encoding: "utf8",
      });
      expect(result.status, `${workflow}: ${result.stderr}`).toBe(0);
      expect(result.stdout).toBe(
        `-n|/usr/local/sbin/qbbe-release|staging|${mode}|ghcr.io/qbbe/hub:staging-0123456789abcdef|staging.hub.example.org|someone|`,
      );
    }
  });

  it("gives deploy users a shell that reads no startup file, and keeps the old access gone", () => {
    expect(setup).toContain('useradd --create-home --shell /bin/sh "qbbe-${environment}"');
    expect(setup).toContain('usermod --shell /bin/sh "$user"');
    expect(setup).toContain('qbbe-*) fail "DEPLOY_USER is the old shared deploy user');
    expect(setup).toContain("authorized_keys2");
    // The new admin key must already work before the old ones are removed.
    expect(setup).toContain("ADMIN_PUBKEY is not installed yet");
  });

  it("limits what one environment can do to the server's resources", () => {
    expect(read("deploy/server/compose.app.yaml")).toMatch(/^\s+pids_limit: \d+$/m);
    expect(wrapper).toContain("head -c 1048577");
    // Only this repository's images.
    expect(wrapper).toContain('${BIN}/image-repository');
    expect(setup).toContain('"${ROOT}/bin/image-repository"');
  });

  it("puts each app on its own networks, joined only by Caddy and the scanner", () => {
    const app = read("deploy/server/compose.app.yaml");
    const base = read("deploy/server/compose.base.yaml");
    expect(app).toContain("name: qbbe-edge-${QBBE_ENV");
    expect(app).toContain("name: qbbe-scan-${QBBE_ENV");
    expect(app).not.toMatch(/name: qbbe-edge$/m);
    expect(app).not.toMatch(/name: qbbe-scan$/m);
    for (const environment of ["staging", "production"]) {
      expect(base).toContain(`name: qbbe-edge-${environment}`);
      expect(base).toContain(`name: qbbe-scan-${environment}`);
    }
    const scanNetworks = base.match(/name: qbbe-scan-(staging|production)\n\s+internal: true/g) ?? [];
    expect(scanNetworks).toHaveLength(2);
  });

  it("deploys and rolls back as the environment's own user through the wrapper when switched on", () => {
    for (const workflow of [".github/workflows/deploy.yml", ".github/workflows/rollback.yml"]) {
      const text = read(workflow);
      expect(text, workflow).toContain("sudo -n /usr/local/sbin/qbbe-release");
      expect(text, workflow).toContain("qbbe-${{ inputs.environment }}");
      expect(text, workflow).toContain("DEPLOY_MODE");
    }
  });

  it("pushes migrations with the environment's database URL, not a personal access token", () => {
    for (const workflow of [".github/workflows/deploy.yml", ".github/workflows/perf-staging.yml"]) {
      const text = read(workflow);
      expect(text, workflow).not.toContain("SUPABASE_ACCESS_TOKEN");
      expect(text, workflow).not.toMatch(/supabase link/);
    }
    expect(read(".github/workflows/deploy.yml")).toMatch(/supabase db push --db-url "\$SUPABASE_DB_URL"/);
  });

  it("runs server setup only from its own protected environment", () => {
    const text = read(".github/workflows/server-setup.yml");
    expect(text).toMatch(/environment: server-admin/);
    expect(text).not.toMatch(/both environments hold the same/);
  });

  it("the wrapper refuses a caller from the other environment and unknown arguments", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const run = (sudoUser: string, ...args: string[]) => {
      const result = spawnSync("bash", [join(process.cwd(), "deploy/server/qbbe-release"), ...args], {
        env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", SUDO_USER: sudoUser },
        input: "",
        encoding: "utf8",
      });
      return { ok: result.status === 0, output: result.stdout + result.stderr };
    };
    const image = `ghcr.io/qbbe/hub:production-${sha}`;
    const cases = [
      run("qbbe-staging", "production", "deploy", image, "hub.example.org", "someone"),
      run("qbbe-production", "production", "install", image, "hub.example.org", "someone"),
      run("qbbe-production", "production", "deploy", `ghcr.io/qbbe/hub:staging-${sha}`, "hub.example.org", "someone"),
      run("qbbe-production", "production", "deploy", image, "hub.example.org"),
    ];
    for (const result of cases) expect(result.ok, result.output).toBe(false);
    // As root (this container) each is refused for its own reason; elsewhere
    // the wrapper stops first because it was not run through sudo.
    if (process.getuid?.() === 0) {
      expect(cases[0].output).toContain("only qbbe-production may release production");
      expect(cases[1].output).toContain("mode must be deploy or rollback");
      // Before any image check: this machine has no Server setup.
      expect(cases[2].output).toContain("image-repository is missing");
      expect(cases[3].output).toContain("usage:");
    } else {
      for (const result of cases) expect(result.output).toContain("run through sudo");
    }
  });

  it("the shell scripts parse", () => {
    for (const script of ["deploy/server/setup.sh", "deploy/server/release.sh", "deploy/server/qbbe-release"]) {
      const result = spawnSync("bash", ["-n", join(process.cwd(), script)], { encoding: "utf8" });
      expect(result.status, `${script}: ${result.stderr}`).toBe(0);
    }
  });
});
