/** Private API scopes (V2-8). No server code, so screens can list them. */
export const apiScopes = ["objects:read", "actions:run"] as const;
export type ApiScope = (typeof apiScopes)[number];

export function isScope(value: string): value is ApiScope {
  return (apiScopes as readonly string[]).includes(value);
}
