import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Per-feature routes for the role matrix and the QA sweep, one JSON file per
 * feature in tests/e2e/routes. A new feature adds its own file instead of a
 * line in role-matrix.spec.ts and qa-matrix.spec.ts, so parallel work stops
 * colliding on those two shared lists.
 *
 *   everyone   reached by every signed-in role
 *   staffOnly  staff and above; volunteers are redirected
 *   adminOnly  owners and admins only
 *   qa         swept for overflow, themes and accessibility in qa-matrix
 */
export interface FeatureRoutes {
  everyone?: string[];
  staffOnly?: string[];
  adminOnly?: string[];
  qa?: { path: string; name: string }[];
}

const DIR = join(process.cwd(), "tests", "e2e", "routes");

export const FEATURE_ROUTES: FeatureRoutes[] = readdirSync(DIR)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => JSON.parse(readFileSync(join(DIR, name), "utf8")) as FeatureRoutes);

/** Paths from every feature file for one access level. */
export function featureRoutes(key: "everyone" | "staffOnly" | "adminOnly"): string[] {
  return FEATURE_ROUTES.flatMap((routes) => routes[key] ?? []);
}

/** Routes from every feature file for the QA sweep. */
export function featureQaRoutes(): { path: string; name: string }[] {
  return FEATURE_ROUTES.flatMap((routes) => routes.qa ?? []);
}
