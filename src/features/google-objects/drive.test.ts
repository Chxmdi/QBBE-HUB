import { describe, expect, it } from "vitest";
import { parseDriveLink } from "./drive";
import { googleObjectsText } from "./messages";

describe("parseDriveLink", () => {
  it("recognises Docs, Sheets, Slides, Forms, Drive files and folders", () => {
    expect(parseDriveLink("https://docs.google.com/document/d/1AbCdEfGhIjK_lm-no/edit")).toMatchObject({ fileId: "1AbCdEfGhIjK_lm-no", kind: "document" });
    expect(parseDriveLink("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlmno/edit#gid=0")?.kind).toBe("spreadsheet");
    expect(parseDriveLink("https://docs.google.com/presentation/d/1AbCdEfGhIjKlmno/")?.kind).toBe("presentation");
    expect(parseDriveLink("https://docs.google.com/forms/d/1AbCdEfGhIjKlmno/viewform")?.kind).toBe("form");
    expect(parseDriveLink("https://drive.google.com/file/d/1AbCdEfGhIjKlmno/view")?.kind).toBe("file");
    expect(parseDriveLink("https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlmno")?.kind).toBe("folder");
    expect(parseDriveLink("https://drive.google.com/open?id=1AbCdEfGhIjKlmno")?.fileId).toBe("1AbCdEfGhIjKlmno");
  });

  it("refuses anything that is not a Drive https address", () => {
    expect(parseDriveLink("http://docs.google.com/document/d/1AbCdEfGhIjKlmno")).toBeNull();
    expect(parseDriveLink("https://docs.google.com.evil.example/document/d/1AbCdEfGhIjKlmno")).toBeNull();
    expect(parseDriveLink("https://user:pw@drive.google.com/file/d/1AbCdEfGhIjKlmno")).toBeNull();
    expect(parseDriveLink("https://drive.google.com/open?id=x")).toBeNull();
    expect(parseDriveLink("javascript:alert(1)")).toBeNull();
    expect(parseDriveLink("not a url")).toBeNull();
  });
});

it("has French for every English string", () => {
  const keys = (o: object, prefix = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
  expect(keys(googleObjectsText("fr-CA"))).toEqual(keys(googleObjectsText("en")));
});
