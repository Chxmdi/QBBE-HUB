import { describe, expect, it } from "vitest";
import { parseImportantLinks } from "@/features/programs/links";

describe("parseImportantLinks", () => {
  it("reads a label and a URL either side of the separator", () => {
    expect(parseImportantLinks("Handbook|https://qbbe.ca/handbook")).toEqual([
      { label: "Handbook", url: "https://qbbe.ca/handbook" },
    ]);
  });

  it("treats a bare address as its own label", () => {
    expect(parseImportantLinks("https://qbbe.ca")).toEqual([
      { label: "https://qbbe.ca", url: "https://qbbe.ca" },
    ]);
  });

  it("keeps a URL that itself contains the separator character", () => {
    // Splitting on every "|" rather than the first would truncate this.
    expect(parseImportantLinks("Report|https://qbbe.ca/r?a=1|b=2")).toEqual([
      { label: "Report", url: "https://qbbe.ca/r?a=1|b=2" },
    ]);
  });

  it("drops anything that is not http or https", () => {
    // These render as anchors, so a javascript: URL here is stored XSS.
    expect(
      parseImportantLinks(
        [
          "Bad|javascript:alert(1)",
          "Worse|data:text/html,<script>alert(1)</script>",
          "File|file:///etc/passwd",
          "Good|https://qbbe.ca",
        ].join("\n"),
      ),
    ).toEqual([{ label: "Good", url: "https://qbbe.ca" }]);
  });

  it("ignores blank lines and lines missing either side", () => {
    expect(parseImportantLinks("\n  \n|https://qbbe.ca\nLabel|\n")).toEqual([]);
  });

  it("returns nothing for empty, null and undefined input", () => {
    expect(parseImportantLinks("")).toEqual([]);
    expect(parseImportantLinks(null)).toEqual([]);
    expect(parseImportantLinks(undefined)).toEqual([]);
  });

  it("caps the list so one paste cannot fill the column", () => {
    const many = Array.from({ length: 50 }, (_, i) => `L${i}|https://qbbe.ca/${i}`).join("\n");
    expect(parseImportantLinks(many)).toHaveLength(20);
  });
});
