import { describe, expect, it, vi } from "vitest";
import {
  BLOCK_ACTIONS,
  FORMAT_ACTIONS,
  MOBILE_QUERY,
  MobileCounter,
  bottomInset,
  isToggleActive,
  nextToolbarIndex,
  safeLinkHref,
  toggleTarget,
} from "./touch";
import { createEditorT } from "@/features/editor/i18n";
import { e4EditorEn } from "@/features/editor/i18n/units/e4.en";
import { e4EditorFrCA } from "@/features/editor/i18n/units/e4.fr-CA";

vi.mock("@/lib/auth", () => ({ getSessionContext: vi.fn() }));
vi.mock("@/lib/feature-flags", () => ({ isEnabled: vi.fn() }));
vi.mock("@/features/mobile/flag", () => ({ mobileEnabled: vi.fn() }));

describe("mobile editing rules (E4)", () => {
  it("only turns on at phone widths", () => {
    expect(MOBILE_QUERY).toBe("(max-width: 767px)");
  });

  it("offers every button E4-1 and E4-2 ask for", () => {
    expect(FORMAT_ACTIONS).toEqual(["bold", "italic", "link", "bulletList", "checkList", "heading", "undo", "redo"]);
    expect(BLOCK_ACTIONS).toEqual(["moveUp", "moveDown", "blockMenu"]);
  });

  it("toggles a block into a list, checklist or heading and back to a paragraph", () => {
    expect(toggleTarget("bulletList", "paragraph")).toEqual({ type: "bulletListItem" });
    expect(toggleTarget("bulletList", "bulletListItem")).toEqual({ type: "paragraph" });
    expect(toggleTarget("checkList", "bulletListItem")).toEqual({ type: "checkListItem" });
    expect(toggleTarget("checkList", "checkListItem")).toEqual({ type: "paragraph" });
    expect(toggleTarget("heading", "paragraph")).toEqual({ type: "heading", props: { level: 2 } });
    expect(toggleTarget("heading", "heading")).toEqual({ type: "paragraph" });
    expect(isToggleActive("heading", "heading")).toBe(true);
    expect(isToggleActive("checkList", "paragraph")).toBe(false);
  });

  it("accepts web and mail links and refuses unsafe ones", () => {
    expect(safeLinkHref("example.org/guide")).toBe("https://example.org/guide");
    expect(safeLinkHref(" https://example.org ")).toBe("https://example.org/");
    expect(safeLinkHref("http://example.org")).toBe("http://example.org/");
    expect(safeLinkHref("mailto:info@example.org")).toBe("mailto:info@example.org");
    expect(safeLinkHref("info@example.org")).toBe("mailto:info@example.org");
    expect(safeLinkHref("example.org:8080/docs")).toBe("https://example.org:8080/docs");
    expect(safeLinkHref("intranet.example.org:3000")).toBe("https://intranet.example.org:3000/");
    for (const bad of ["", "   ", "javascript:alert(1)", "JAVASCRIPT:alert(1)", " javascript:alert(1)", "data:text/html,<b>x</b>", "mailto:nobody", "ftp://example.org", "not a link", "https://localhost", "https://user:pw@example.org", `https://example.org/${"a".repeat(2050)}`]) {
      expect(safeLinkHref(bad), bad).toBeNull();
    }
  });

  it("moves focus around the toolbar like an ARIA toolbar", () => {
    expect(nextToolbarIndex(0, "ArrowRight", 11)).toBe(1);
    expect(nextToolbarIndex(10, "ArrowRight", 11)).toBe(0);
    expect(nextToolbarIndex(0, "ArrowLeft", 11)).toBe(10);
    expect(nextToolbarIndex(4, "Home", 11)).toBe(0);
    expect(nextToolbarIndex(4, "End", 11)).toBe(10);
    expect(nextToolbarIndex(4, "a", 11)).toBeNull();
    expect(nextToolbarIndex(0, "ArrowRight", 0)).toBeNull();
  });

  it("keeps the toolbar above the bottom navigation or the on-screen keyboard, whichever covers more", () => {
    expect(bottomInset({ innerHeight: 640 })).toBe(0);
    expect(bottomInset({ innerHeight: 640, navTop: 578.75 })).toBe(61);
    // Keyboard open: the visible area ends 300 px above the layout bottom.
    expect(bottomInset({ innerHeight: 640, navTop: 579, visibleBottom: 340 })).toBe(300);
    // Keyboard closed: the visible area is the whole window.
    expect(bottomInset({ innerHeight: 640, navTop: 579, visibleBottom: 640 })).toBe(61);
    // A visible area taller than the window (pinch zoom rounding) is no inset.
    expect(bottomInset({ innerHeight: 640, visibleBottom: 641 })).toBe(0);
  });

  it("keeps the page attribute while any editor is in mobile mode", () => {
    const apply = vi.fn();
    const counter = new MobileCounter(apply);
    const leaveA = counter.enter();
    const leaveB = counter.enter();
    expect(apply.mock.calls).toEqual([[true]]);
    leaveA();
    leaveA();
    expect(apply.mock.calls).toEqual([[true]]);
    leaveB();
    expect(apply.mock.calls).toEqual([[true], [false]]);
  });

  it("has every string in both languages, with the same keys", () => {
    const keys = (value: object, prefix = ""): string[] =>
      Object.entries(value).flatMap(([k, v]) => (typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
    expect(keys(e4EditorFrCA)).toEqual(keys(e4EditorEn));
    expect(createEditorT("en")("units.e4.moveUp")).toBe("Move block up");
    expect(createEditorT("fr-CA")("units.e4.moveUp")).toBe("Monter le bloc");
    for (const key of keys(e4EditorEn)) expect(createEditorT("fr-CA")(`units.e4.${key}` as never)).not.toBe(createEditorT("en")(`units.e4.${key}` as never));
  });
});

describe("the mobile editing switch route", () => {
  async function answer(session: boolean, editor: boolean, mobile: boolean) {
    const { getSessionContext } = await import("@/lib/auth");
    const { isEnabled } = await import("@/lib/feature-flags");
    const { mobileEnabled } = await import("@/features/mobile/flag");
    vi.mocked(getSessionContext).mockResolvedValue(session ? ({ userId: "u" } as never) : null);
    vi.mocked(isEnabled).mockImplementation(async (key) => key === "wos_editor" && editor);
    vi.mocked(mobileEnabled).mockResolvedValue(mobile);
    const { GET } = await import("@/app/api/editor/mobile/route");
    const response = await GET();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    return ((await response.json()) as { enabled: boolean }).enabled;
  }

  it("is on only with a session and both switches", async () => {
    expect(await answer(true, true, true)).toBe(true);
    expect(await answer(false, true, true)).toBe(false);
    expect(await answer(true, false, true)).toBe(false);
    expect(await answer(true, true, false)).toBe(false);
  });
});
