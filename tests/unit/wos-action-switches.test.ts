import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every Server Action in a Workspace OS module checks its module's switch.
 *
 * A Server Action is a public endpoint: its id is in the browser bundle, so
 * anyone signed in can call it whether or not a page shows the button. A
 * module that is switched off must therefore refuse in the action itself,
 * not only by hiding its pages. This reads each action's source and fails
 * on any exported action that neither calls a switch check (`isEnabled`, or
 * a module's own `…Enabled()` helper) nor goes through a local helper that
 * does.
 */

const WORKSPACE_OS_MODULES = [
  "api-tokens", "apps", "blueprints", "capture", "collab", "commands", "editor", "forms-v2", "goals",
  "insight", "lenses", "meetings-v2", "object-approvals", "object-comments", "object-layouts", "objects",
  "offline", "pages", "public-pages", "sharing", "spaces", "templates-v2", "upkeep", "versions", "workflows",
];
// Workspace OS files that live in a classic module's folder.
const EXTRA_FILES = [
  "src/features/decisions/services/decision-v2.commands.ts",
  "src/features/notifications/services/page-watch.commands.ts",
  "src/features/following/services/following.commands.ts",
  "src/features/google-objects/services/google-objects.commands.ts",
];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const actionFiles = [
  ...WORKSPACE_OS_MODULES.flatMap((module) => walk(join("src/features", module))),
  ...EXTRA_FILES,
].filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && /^["']use server["']/.test(readFileSync(file, "utf8").trimStart()));

// Left callable while their module is off, on purpose.
const ALLOWED = new Set([
  // Taking a public page down must keep working after the module is switched
  // off; it only removes something from the internet, and admins only.
  "src/features/public-pages/services/publication.commands.ts: unpublish",
]);

// A switch check: `isEnabled(...)` or a module's own `…Enabled()` helper.
const GATE = /\b(?:isEnabled|\w+Enabled)\(/;

/** Source without comments or string contents, so a gate named in either does not count. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
}

/** Each top-level function's name and body, in source order. */
function functions(source: string): { name: string; exported: boolean; body: string }[] {
  const starts = [...source.matchAll(/^(export )?(?:async )?function (\w+)|^(export )?const (\w+) = (?:async )?(?:\(|function)/gm)];
  return starts.map((match, index) => ({
    name: match[2] ?? match[4],
    exported: Boolean(match[1] ?? match[3]),
    body: source.slice(match.index, starts[index + 1]?.index ?? source.length),
  }));
}

function unguardedActions(file: string): string[] {
  const all = functions(code(readFileSync(file, "utf8")));
  // Local helpers that check a switch, and helpers that call those (two levels).
  const gated = new Set(all.filter((fn) => !fn.exported && GATE.test(fn.body)).map((fn) => fn.name));
  for (const fn of all) {
    if (!fn.exported && [...gated].some((name) => new RegExp(`\\b${name}\\(`).test(fn.body))) gated.add(fn.name);
  }
  return all
    // An exported `…Enabled` function is a switch check itself, not an action that needs one.
    .filter((fn) => fn.exported && /^export (?:async function|const \w+ = async)/.test(fn.body) && !/Enabled$/.test(fn.name))
    .filter((fn) => !GATE.test(fn.body) && ![...gated].some((name) => new RegExp(`\\b${name}\\(`).test(fn.body)))
    .map((fn) => `${file}: ${fn.name}`);
}

describe("Workspace OS Server Actions", () => {
  it("finds the action files", () => {
    expect(actionFiles.length).toBeGreaterThan(40);
  });

  it("does not count a switch named only in a comment or a string", () => {
    expect(code('// isEnabled("wos_x")\nconst s = "isEnabled(";\n/* goalsEnabled() */')).not.toMatch(GATE);
  });

  it("all check their module's switch", () => {
    expect(actionFiles.flatMap(unguardedActions).filter((entry) => !ALLOWED.has(entry))).toEqual([]);
  });
});
