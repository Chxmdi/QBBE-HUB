import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
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
      [".github/workflows/rollback.yml", "restore"],
    ] as const) {
      const line = read(workflow).match(/ssh qbbe "(sudo -n \/usr\/local\/sbin\/qbbe-release [^"]+)"/);
      expect(line, workflow).not.toBeNull();
      // Fill in the values the workflow's shell would substitute.
      const command = line![1]
        .replace("${TARGET_ENVIRONMENT}", "staging")
        .replace("${IMAGE}", "ghcr.io/qbbe/hub:staging-0123456789abcdef")
        .replace("${host}", "staging.hub.example.org")
        .replace("${REGISTRY_USER}", "someone")
        .replace("${mode}", mode);
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
      expect(cases[1].output).toContain("mode must be deploy, rollback or restore");
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

describe("server base images and access log", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
  const base = read("deploy/server/compose.base.yaml");
  const site = read("deploy/server/site.caddy.template");
  const setup = read("deploy/server/setup.sh");

  it("pins Caddy and the scanner to an exact build that Dependabot proposes updates for", () => {
    const images = [...base.matchAll(/^\s*image:\s*(\S+)/gm)].map((m) => m[1]);
    expect(images).toHaveLength(2);
    for (const image of images) expect(image).toMatch(/:[\w.-]+@sha256:[0-9a-f]{64}$/);
    const dependabot = read(".github/dependabot.yml");
    expect(dependabot).toMatch(/package-ecosystem:\s*docker-compose/);
    expect(dependabot).toMatch(/directory:\s*\/deploy\/server/);
  });

  it("downloads the pinned images before restarting the shared services", () => {
    const pull = setup.indexOf("compose.base.yaml\" pull");
    expect(pull).toBeGreaterThan(-1);
    expect(pull).toBeLessThan(setup.indexOf("compose.base.yaml\" up -d"));
  });

  it("runs Caddy with only the right to bind its ports, and neither service can gain privileges", () => {
    expect(base).toMatch(/cap_drop: \[ALL\]\s*\n\s*cap_add: \[NET_BIND_SERVICE\]/);
    expect(base.match(/no-new-privileges:true/g)).toHaveLength(2);
  });

  it("requires an address for certificate notices", () => {
    const result = spawnSync("bash", [join(process.cwd(), "deploy/server/setup.sh"), "/nonexistent"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, NODE_ENV: "test", ACME_EMAIL: "" },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ACME_EMAIL (the certificate notice address) is required.");
    expect(setup).toContain("printf '{\\n\\temail %s\\n}\\n\\n' \"$ACME_EMAIL\"");
  });

  it("gives each request an ID the app, the browser and the log all see", () => {
    expect(site).toContain("request_header X-Request-Id {http.request.uuid}");
    expect(site).toContain("header X-Request-Id {http.request.uuid}");
  });

  it("writes the access log without codes or tokens from web addresses", () => {
    expect(site).toMatch(/log \{\s*output stdout\s*format filter \{\s*wrap json/);
    for (const name of ["code", "token", "token_hash", "access_token", "refresh_token", "id_token", "invite"]) {
      expect(site).toMatch(new RegExp(`^\\s*delete ${name}$`, "m"));
    }
    expect(site).toMatch(/request>headers>Referer delete/);
    expect(site).toMatch(/resp_headers>Location delete/);
  });

  it("caps every container's logs at 20 MB times ten files", () => {
    for (const path of ["deploy/server/compose.base.yaml", "deploy/server/compose.app.yaml"]) {
      expect(read(path)).toContain('options: { max-size: "20m", max-file: "10" }');
    }
    expect(setup).toContain('"max-size":"20m","max-file":"10"');
  });
});

describe("deploy workflows run from main only and prove signed-in reads", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
  /** Each job's block of a workflow file, by job id. */
  function jobs(path: string): Map<string, string> {
    const body = read(path).split(/^jobs:\n/m)[1];
    const parts = body.split(/^ {2}(?=[\w-]+:\n)/m).filter((part) => /^[\w-]+:\n/.test(part));
    return new Map(parts.map((part) => [part.slice(0, part.indexOf(":")), part]));
  }
  const condition = (job: string) => /^ {4}if: (.+)$/m.exec(job)?.[1] ?? "";
  const main = "github.ref == 'refs/heads/main'";

  it("Rollback and Server setup run every job only from main, and say so from any other branch", () => {
    for (const path of [".github/workflows/rollback.yml", ".github/workflows/server-setup.yml", ".github/workflows/deploy.yml"]) {
      const all = jobs(path);
      const guard = all.get("branch");
      expect(guard, path).toBeDefined();
      expect(condition(guard!), path).toBe("github.ref != 'refs/heads/main'");
      expect(guard, path).toMatch(/::error::.*runs? from main only|publishes main only/);
      expect(guard, path).toContain("exit 1");
      if (path.endsWith("deploy.yml")) continue;
      for (const [id, job] of all) {
        if (id !== "branch") expect(condition(job), `${path} ${id}`).toContain(main);
      }
    }
  });

  it("Deploy publishes from main only: every job after the gates waits for the main-only evidence job", () => {
    const all = jobs(".github/workflows/deploy.yml");
    expect(condition(all.get("evidence")!)).toBe(main);
    for (const id of ["migrate", "build"]) expect(all.get(id), id).toMatch(/^ {4}needs: evidence$/m);
    expect(all.get("release")).toMatch(/^ {4}needs: \[migrate, build\]$/m);
  });

  it("signs in as the environment's smoke user after the swap, in the same job as the release", () => {
    const release = jobs(".github/workflows/deploy.yml").get("release")!;
    const swap = release.indexOf("name: Swap to the new image");
    const smoke = release.indexOf("node scripts/ci/smoke-signed-in.mjs");
    expect(swap).toBeGreaterThan(-1);
    expect(smoke).toBeGreaterThan(swap);
    expect(release).toContain("SMOKE_PASSWORD: ${{ secrets.SMOKE_PASSWORD }}");
    expect(release).toContain("SMOKE_EMAIL: ${{ vars.SMOKE_EMAIL }}");
    // Only the public project address and key go to the check, never the service key.
    const step = release.slice(release.indexOf("name: A signed-in person can read data"));
    expect(step).toContain("get NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(step).not.toContain("SERVICE_ROLE");
    // Third-party code runs here: the server key is gone first, and the check
    // sees only what it needs, not APP_ENV's service key.
    expect(release.indexOf("rm -f ~/.ssh/qbbe ~/.ssh/config")).toBeGreaterThan(swap);
    expect(release.indexOf("rm -f ~/.ssh/qbbe ~/.ssh/config")).toBeLessThan(release.indexOf("actions/setup-node"));
    expect(step).toMatch(/env -i PATH="\$PATH" HOME="\$HOME" SUPABASE_URL=/);
    expect(release).toContain("persist-credentials: false");
    // The public checks still run when the signed-in check fails after the swap.
    expect(jobs(".github/workflows/deploy.yml").get("smoke")).toContain("if: always() && needs.release.outputs.site != ''");
    // Missing smoke credentials stop a production deploy.
    expect(step).toMatch(/production \]; then echo "::error::\$\{message\}"; exit 1; fi/);
  });
});

/**
 * release.sh run end to end against a stand-in docker
 * (tests/fixtures/fake-docker.sh): the swap, the automatic restore when the
 * new container never reports healthy, and the settings kept with each
 * release so a rollback can put them back too (REL-001, OPS-006).
 */
describe("release.sh releases and restores", () => {
  const sha = (n: number) => String(n).repeat(40).slice(0, 40);
  const image = (n: number) => `ghcr.io/qbbe/hub:staging-${sha(n)}`;

  function server() {
    const root = mkdtempSync(join(tmpdir(), "qbbe-root-"));
    const bin = mkdtempSync(join(tmpdir(), "qbbe-bin-"));
    copyFileSync(join(process.cwd(), "tests/fixtures/fake-docker.sh"), join(bin, "docker"));
    spawnSync("chmod", ["755", join(bin, "docker")]);
    const dir = join(root, "staging");
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(root, "base/sites"), { recursive: true });
    for (const f of ["compose.app.yaml", "site.caddy.template"]) {
      copyFileSync(join(process.cwd(), "deploy/server", f), join(dir, f));
    }
    const log = join(root, "docker.log");
    const run = (args: string[], extra: Record<string, string> = {}) => {
      const result = spawnSync("bash", [join(process.cwd(), "deploy/server/release.sh"), ...args], {
        env: {
          NODE_ENV: "test",
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          QBBE_ROOT: root,
          QBBE_SKIP_PULL: "1",
          FAKE_DOCKER_LOG: log,
          ...extra,
        },
        encoding: "utf8",
      });
      return { ok: result.status === 0, output: result.stdout + result.stderr };
    };
    const file = (name: string) => readFileSync(join(dir, name), "utf8");
    const deploy = (n: number, settings: string, extra: Record<string, string> = {}) => {
      writeFileSync(join(dir, "app.env.new"), settings);
      return run(["staging", image(n), "staging.hub.example.org"], extra);
    };
    return { dir, run, file, deploy };
  }

  it("keeps each release's settings next to its image, the five newest only", () => {
    const s = server();
    for (let n = 1; n <= 7; n += 1) expect(s.deploy(n, `VERSION=${n}\n`).ok).toBe(true);
    expect(s.file("current-image").trim()).toBe(image(7));
    expect(s.file(`app.env.staging-${sha(7)}`)).toBe("VERSION=7\n");
    const kept = readdirSync(s.dir).filter((name) => name.startsWith("app.env.staging-"));
    expect(kept.sort()).toEqual([3, 4, 5, 6, 7].map((n) => `app.env.staging-${sha(n)}`).sort());
    expect(statSync(join(s.dir, `app.env.staging-${sha(7)}`)).mode & 0o777).toBe(0o600);
  });

  it("puts the previous image and settings back when the new container never becomes healthy", () => {
    const s = server();
    expect(s.deploy(1, "VERSION=1\n").ok).toBe(true);
    const failed = s.deploy(2, "VERSION=2\n", { FAKE_DOCKER_UNHEALTHY: image(2) });
    expect(failed.ok).toBe(false);
    expect(failed.output).toContain("putting");
    expect(s.file("app.env")).toBe("VERSION=1\n");
    expect(s.file(".env")).toContain(`QBBE_IMAGE=${image(1)}`);
    expect(s.file("current-image").trim()).toBe(image(1));
    expect(existsSync(join(s.dir, `app.env.staging-${sha(2)}`))).toBe(false);
  });

  it("with --restore-settings, a rollback puts back the settings that ran with that image", () => {
    const s = server();
    expect(s.deploy(1, "VERSION=1\n").ok).toBe(true);
    expect(s.deploy(2, "VERSION=2\n").ok).toBe(true);
    const back = s.run(["staging", image(1), "staging.hub.example.org", "--restore-settings"]);
    expect(back.ok, back.output).toBe(true);
    expect(s.file("app.env")).toBe("VERSION=1\n");
    expect(s.file("current-image").trim()).toBe(image(1));
    // Without the flag the current settings stay.
    expect(s.deploy(2, "VERSION=2\n").ok).toBe(true);
    expect(s.run(["staging", image(1), "staging.hub.example.org"]).ok).toBe(true);
    expect(s.file("app.env")).toBe("VERSION=2\n");
  });

  it("a restore whose image cannot be fetched leaves the live settings as they were", () => {
    const s = server();
    expect(s.deploy(1, "VERSION=1\n").ok).toBe(true);
    expect(s.deploy(2, "VERSION=2\n").ok).toBe(true);
    const result = s.run(["staging", image(1), "staging.hub.example.org", "--restore-settings"], {
      QBBE_SKIP_PULL: "0",
      FAKE_DOCKER_PULL_FAIL: image(1),
    });
    expect(result.ok).toBe(false);
    expect(s.file("app.env")).toBe("VERSION=2\n");
    expect(s.file("current-image").trim()).toBe(image(2));
    expect(existsSync(join(s.dir, "app.env.previous"))).toBe(false);
  });

  it("a restore whose container never becomes healthy puts the current image and settings back", () => {
    const s = server();
    expect(s.deploy(1, "VERSION=1\n").ok).toBe(true);
    expect(s.deploy(2, "VERSION=2\n").ok).toBe(true);
    const result = s.run(["staging", image(1), "staging.hub.example.org", "--restore-settings"], {
      FAKE_DOCKER_UNHEALTHY: image(1),
    });
    expect(result.ok).toBe(false);
    expect(s.file("app.env")).toBe("VERSION=2\n");
    expect(s.file(".env")).toContain(`QBBE_IMAGE=${image(2)}`);
    expect(s.file("current-image").trim()).toBe(image(2));
    expect(existsSync(join(s.dir, `app.env.staging-${sha(1)}`))).toBe(true);
  });

  it("refuses an unknown option with a plain message", () => {
    const s = server();
    const result = s.run(["staging", image(1), "staging.hub.example.org", "--bogus"]);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("release: unknown option '--bogus'");
  });

  it("refuses to restore settings it does not have", () => {
    const s = server();
    expect(s.deploy(1, "VERSION=1\n").ok).toBe(true);
    const result = s.run(["staging", image(9), "staging.hub.example.org", "--restore-settings"]);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("no settings kept for");
    expect(s.file("app.env")).toBe("VERSION=1\n");
  });
});
