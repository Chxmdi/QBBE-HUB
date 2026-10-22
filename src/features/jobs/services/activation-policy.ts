/** Optional host-local rollout gate. Unset preserves existing behavior; empty blocks all. */
export function isJobAllowedOnHost(name: string, configured = process.env.JOB_RUNNER_ALLOWLIST): boolean {
  if (configured === undefined) return true;
  return configured.split(",").map((value) => value.trim()).filter(Boolean).includes(name);
}
