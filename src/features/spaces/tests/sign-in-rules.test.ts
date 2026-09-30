import { describe, expect, it } from "vitest";
import { csvCell, decideSignIn, defaultAuditRange, parseSessionHours, toCsv, type SignInStatus } from "../admin/sign-in-rules";

const ok: SignInStatus = {
  role: "staff",
  require_mfa: false,
  has_verified_factor: false,
  aal: "aal1",
  mfa_ok: true,
  max_session_hours: null,
  session_started_at: null,
  session_ok: true,
};

describe("decideSignIn", () => {
  it("lets a session that meets its rule through", () => {
    expect(decideSignIn(ok)).toEqual({ action: "allow" });
    expect(decideSignIn(null)).toEqual({ action: "allow" });
  });
  it("asks for two-step sign-in, to set it up when there is no factor yet", () => {
    expect(decideSignIn({ ...ok, require_mfa: true, mfa_ok: false })).toEqual({ action: "mfa", enroll: true });
    expect(decideSignIn({ ...ok, require_mfa: true, mfa_ok: false, has_verified_factor: true })).toEqual({ action: "mfa", enroll: false });
  });
  it("asks to sign in again when the session is too old, before anything else", () => {
    expect(decideSignIn({ ...ok, session_ok: false, mfa_ok: false })).toEqual({ action: "sign_in_again" });
  });
});

describe("parseSessionHours", () => {
  it("reads empty as no limit and whole hours from 1 to 720", () => {
    expect(parseSessionHours("")).toBeNull();
    expect(parseSessionHours(" 8 ")).toBe(8);
    expect(parseSessionHours("720")).toBe(720);
  });
  it("refuses anything else", () => {
    for (const bad of ["0", "721", "1.5", "-3", "eight"]) expect(parseSessionHours(bad)).toBe("invalid");
  });
});

describe("CSV", () => {
  it("quotes cells and never lets one be read as a formula", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell("@evil")).toBe(`"'@evil"`);
    expect(csvCell(null)).toBe('""');
    expect(csvCell({ role: "staff" })).toBe('"{""role"":""staff""}"');
  });
  it("writes a header and rows with Windows line ends", () => {
    expect(toCsv(["a", "b"], [[1, "x"]])).toBe('"a","b"\r\n"1","x"\r\n');
  });
});

describe("defaultAuditRange", () => {
  it("is the last 30 days", () => {
    expect(defaultAuditRange(Date.parse("2026-09-30T12:00:00Z"))).toEqual({ from: "2026-08-31", to: "2026-09-30" });
  });
});
