/** Completion measures activity; only accountable project health drives health. */
export function summarizeProjectHealth(projects: { health: string; stage: string; archived_at: string | null }[]) {
  const active = projects.filter(p => !p.archived_at && !["completed", "cancelled", "archived"].includes(p.stage));
  if (!active.length) return { health: "unknown", statusLabel: "No projects", tone: "neutral" } as const;
  if (active.some(p => p.health === "off_track")) return { health: "off_track", statusLabel: "Off track", tone: "risk" } as const;
  if (active.some(p => p.health === "at_risk")) return { health: "at_risk", statusLabel: "At risk", tone: "attention" } as const;
  if (active.some(p => p.health !== "on_track")) return { health: "unknown", statusLabel: "Not assessed", tone: "neutral" } as const;
  return { health: "on_track", statusLabel: "On track", tone: "good" } as const;
}
