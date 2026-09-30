import donorStewardship from "./donor-stewardship.json";
import eventPlanning from "./event-planning.json";
import grant from "./grant.json";
import inventory from "./inventory.json";
import recruiting from "./recruiting.json";
import volunteerIntake from "./volunteer-intake.json";

/**
 * Starter blueprints (V2-2), in English and Quebec French. Each is plain JSON
 * so QBBE can review and change one without reading code; the unit tests check
 * every file against the blueprint schema and against each other, so any
 * combination of starters can be built in one workspace.
 */
export const starterBlueprints: readonly unknown[] = [
  recruiting,
  volunteerIntake,
  eventPlanning,
  grant,
  donorStewardship,
  inventory,
];
