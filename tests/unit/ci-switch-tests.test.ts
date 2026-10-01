import { describe, expect, it } from "vitest";
import { check, offenders, testTitles } from "../../scripts/ci/switch-tests.mjs";

type Offender = { file: string; line: number; title: string; reason: string };

describe("the switch-state title convention", () => {
  it("holds across every browser spec", () => {
    const found: Offender[] = check();
    expect(found.map((o) => `${o.file}:${o.line} ${o.title}`)).toEqual([]);
  });

  it("reads plain string titles with their line", () => {
    const source = `import { test } from "./fixtures";\n\ntest("one", async () => {});\ntest.skip('two "quoted"', x);\n  test("three [switch off]", x);\n`;
    expect(testTitles(source)).toEqual([
      { title: "one", line: 3 },
      { title: 'two "quoted"', line: 4 },
      { title: "three [switch off]", line: 5 },
    ]);
  });

  it("names a title that describes the off state without the suffix", () => {
    const titles = [
      "Home stays hidden while the switch is off",
      "with the switch off the table lens does not exist",
      "the screens do not exist while the switch is off",
      "Off by default: nothing shows",
      "volunteers and a switched-off module see nothing",
      "with every switch off, nothing new appears",
    ];
    const source = titles.map((t) => `test("${t}", x);`).join("\n");
    const found: Offender[] = offenders("x.spec.ts", source);
    expect(found.map((o) => o.title)).toEqual(titles);
    expect(found.every((o) => o.reason.includes("[switch off]"))).toBe(true);
  });

  it("accepts the same titles once they end with the suffix", () => {
    const source = [
      `test("Home stays hidden while the switch is off [switch off]", x);`,
      `test("the exit path needs every switch [switches on]", x);`,
      `test("an admin edits branches as JSON and uses the stop switch", x);`,
    ].join("\n");
    expect(offenders("x.spec.ts", source)).toEqual([]);
  });

  it("refuses a suffix that is not at the end, or both at once", () => {
    const source = [
      `test("[switch off] the page is hidden while the switch is off", x);`,
      `test("needs the override [switches on] for the tabs", x);`,
      `test("both [switch off] [switches on]", x);`,
    ].join("\n");
    const found: Offender[] = offenders("x.spec.ts", source);
    expect(found.map((o) => o.line)).toEqual([1, 2, 3]);
  });
});
