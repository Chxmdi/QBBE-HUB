import { describe, expect, it } from "vitest";
import type { QueryRow } from "@/lib/objects/contracts";
import {
  DEFAULT_VIEW,
  fitView,
  locatedRows,
  panned,
  parseCoordinates,
  pointIn,
  project,
  tilesFor,
  unproject,
} from "./map";

const montreal = { lat: 45.5019, lng: -73.5674, label: "Montréal" };
const quebec = { lat: 46.8139, lng: -71.208, label: "Québec" };

describe("parseCoordinates", () => {
  it("reads coordinates typed into a location", () => {
    expect(parseCoordinates("45.5019, -73.5674")).toMatchObject({ lat: 45.5019, lng: -73.5674 });
    expect(parseCoordinates("Centre (45.50; -73.56)")).toMatchObject({ lat: 45.5, lng: -73.56 });
  });
  it("ignores addresses and out-of-range numbers", () => {
    expect(parseCoordinates("1234 Rue Sainte-Catherine")).toBeNull();
    expect(parseCoordinates("95, 10")).toBeNull();
    expect(parseCoordinates(null)).toBeNull();
  });
});

describe("locatedRows", () => {
  it("keeps rows with a valid location value only", () => {
    const rows: QueryRow[] = [
      { ref: { id: "1", type: "event" }, title: "A", values: { where: { kind: "location", value: montreal } } },
      { ref: { id: "2", type: "event" }, title: "B", values: { where: null } },
      { ref: { id: "3", type: "event" }, title: "C", values: { where: { kind: "text", value: "x" } } },
      { ref: { id: "4", type: "event" }, title: "D", values: { where: { kind: "location", value: { lat: 200, lng: 0, label: null } } } },
    ];
    expect(locatedRows(rows, "where").map((r) => r.row.ref.id)).toEqual(["1"]);
  });
});

describe("projection", () => {
  it("round-trips a location", () => {
    const back = unproject(project(montreal, 12), 12);
    expect(back.lat).toBeCloseTo(montreal.lat, 6);
    expect(back.lng).toBeCloseTo(montreal.lng, 6);
  });
  it("puts 0,0 in the middle of the world", () => {
    expect(project({ lat: 0, lng: 0 }, 0)).toEqual({ x: 128, y: 128 });
  });
});

describe("fitView", () => {
  it("defaults to Montréal with nothing to show", () => {
    expect(fitView([], 600, 400)).toEqual(DEFAULT_VIEW);
  });
  it("fits every location inside the viewport", () => {
    const view = fitView([montreal, quebec], 600, 400);
    expect(pointIn(view, montreal, 600, 400)).not.toBeNull();
    expect(pointIn(view, quebec, 600, 400)).not.toBeNull();
    expect(view.zoom).toBeGreaterThanOrEqual(5);
  });
});

describe("tilesFor", () => {
  it("covers the viewport with OpenStreetMap tiles", () => {
    const tiles = tilesFor({ lat: 45.5, lng: -73.56, zoom: 10 }, 600, 400);
    expect(tiles.length).toBeGreaterThanOrEqual(6);
    expect(tiles.every((t) => t.url.startsWith("https://tile.openstreetmap.org/10/"))).toBe(true);
    expect(Math.min(...tiles.map((t) => t.left))).toBeLessThanOrEqual(0);
    expect(Math.min(...tiles.map((t) => t.top))).toBeLessThanOrEqual(0);
  });
  it("wraps columns across the date line and skips rows off the world", () => {
    const tiles = tilesFor({ lat: 84, lng: 179.9, zoom: 2 }, 600, 400);
    for (const tile of tiles) {
      const [, x, y] = tile.url.replace("https://tile.openstreetmap.org/", "").replace(".png", "").split("/").map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(4);
      expect(y).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("panned", () => {
  it("moves the centre east by half a viewport and keeps the zoom", () => {
    const next = panned({ lat: 45.5, lng: -73.56, zoom: 10 }, 0.5, 0, 600, 400);
    expect(next.zoom).toBe(10);
    expect(next.lng).toBeGreaterThan(-73.56);
    expect(next.lat).toBeCloseTo(45.5, 4);
  });
});
