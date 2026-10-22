import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

/**
 * DataTable renders the <table> itself; its children are the head and body.
 * A <table> passed inside it is a table in a table: the browser closes the
 * outer one, the page markup and React's tree disagree, and hydration fails.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

it("no page puts a <table> inside a DataTable", () => {
  const nested = files(join(process.cwd(), "src"))
    .filter((path) => /<DataTable\b[^>]*>\s*<table\b/.test(readFileSync(path, "utf8")))
    .map((path) => path.replace(process.cwd() + "/", ""));
  expect(nested).toEqual([]);
});
