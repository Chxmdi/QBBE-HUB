import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every action a workflow runs from outside this repository, GitHub's own
 * `actions/*` included, is pinned to a full commit SHA with its version in a
 * trailing comment (SEC-017). A tag can be moved to other code after review;
 * a commit cannot. Dependabot (.github/dependabot.yml) keeps the pins current.
 */

const PINNED = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[0-9a-f]{40} # v\d+(\.\d+)*$/;

/** The `uses:` values in a workflow or action file that are not pinned. */
export function unpinnedUses(text: string): string[] {
  const found: string[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(?:-\s+)?uses:\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    const value = match[1].replace(/^["']|["']$/g, "");
    // A local action or reusable workflow is this repository's own code.
    if (value.startsWith("./")) continue;
    if (!PINNED.test(value)) found.push(value);
  }
  return found;
}

function yamlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return yamlFiles(path);
    return /\.ya?ml$/.test(name) ? [path] : [];
  });
}

describe("third-party actions are pinned to a commit", () => {
  it("flags a tag, a branch, a short SHA, a quoted tag, a docker image and a SHA without its version", () => {
    const sha = "11d5960a326750d5838078e36cf38b85af677262";
    expect(
      unpinnedUses(
        [
          "      - uses: actions/checkout@v4",
          "        uses: some/action@main",
          "      - uses: some/action@11d5960",
          `      - uses: "actions/cache@v4"`,
          "      - uses: docker://alpine:3.20",
          `      - uses: actions/checkout@${sha}`,
          `      - uses: github/codeql-action/init@${sha} # v3.39.1`,
          `      - uses: actions/checkout@${sha} # v4.4.0`,
          "      - uses: ./.github/actions/local-supabase",
          "    uses: ./.github/workflows/ci.yml",
          "        # a comment that mentions uses: something@v1 is not a step",
        ].join("\n"),
      ),
    ).toEqual([
      "actions/checkout@v4",
      "some/action@main",
      "some/action@11d5960",
      "actions/cache@v4",
      "docker://alpine:3.20",
      `actions/checkout@${sha}`,
    ]);
  });

  it("holds for every workflow and action in the repository", () => {
    const root = process.cwd();
    const files = yamlFiles(join(root, ".github")).filter((path) => !path.endsWith("dependabot.yml"));
    expect(files.length).toBeGreaterThan(5);
    const unpinned = files.flatMap((path) =>
      unpinnedUses(readFileSync(path, "utf8")).map((value) => `${relative(root, path)}: ${value}`),
    );
    expect(unpinned).toEqual([]);
  });
});
