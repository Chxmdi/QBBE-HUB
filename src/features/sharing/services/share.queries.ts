import type { Locale } from "@/lib/i18n/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listSharingRoles } from "@/features/spaces/services/roles.queries";
import type { WorkspaceCapability } from "@/lib/objects/contracts";
import { sharingT } from "../i18n";
import {
  buildShareEntries,
  isShareableNode,
  type GrantRow,
  type NodeKind,
  type ShareEntry,
  type ShareNode,
} from "./share";

export interface ShareOption {
  id: string;
  label: string;
}

export interface SharePanel {
  target: ShareNode;
  capabilities: WorkspaceCapability[];
  canShare: boolean;
  /** People may add grants on this kind of node at all. */
  shareable: boolean;
  entries: ShareEntry[];
  options: {
    people: ShareOption[];
    teams: ShareOption[];
    orgRoles: ShareOption[];
    /** Roles the reader may hand out: no more than they hold. */
    roles: ShareOption[];
  };
}

type Db = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const ORG_ROLES = ["owner", "admin", "leadership_viewer", "staff", "volunteer", "guest"] as const;

async function nodeNames(db: Db, ids: string[], locale: Locale): Promise<Map<string, ShareNode>> {
  const nodes = new Map<string, ShareNode>();
  const [spaces, projects, tasks, objects] = await Promise.all([
    db.from("space").select("id, kind, name_en, name_fr").in("id", ids),
    db.from("project").select("id, name").in("id", ids),
    db.from("task").select("id, title").in("id", ids),
    // The object registry (S1) may not exist yet; a failed read names nothing.
    db.from("object").select("id, title").in("id", ids),
  ]);
  for (const row of (objects.data ?? []) as { id: string; title: string }[]) {
    nodes.set(row.id, { id: row.id, kind: "object", name: row.title });
  }
  for (const row of (tasks.data ?? []) as { id: string; title: string }[]) {
    nodes.set(row.id, { id: row.id, kind: "task", name: row.title });
  }
  for (const row of (projects.data ?? []) as { id: string; name: string }[]) {
    nodes.set(row.id, { id: row.id, kind: "project", name: row.name });
  }
  for (const row of (spaces.data ?? []) as { id: string; kind: NodeKind; name_en: string; name_fr: string }[]) {
    nodes.set(row.id, { id: row.id, kind: row.kind, name: locale === "fr-CA" ? row.name_fr : row.name_en });
  }
  return nodes;
}

/**
 * Everything the share menu shows for one space or page, read as the signed-in
 * person: null when they cannot view it.
 */
export async function loadSharePanel(objectId: string, locale: Locale): Promise<SharePanel | null> {
  const db = await createSupabaseServerClient();
  const t = sharingT(locale);
  const [{ data: ancestors }, { data: capabilities }] = await Promise.all([
    db.rpc("access_ancestors", { object_id: objectId }),
    db.rpc("object_capabilities", { object_id: objectId }),
  ]);
  const chain = (ancestors ?? null) as string[] | null;
  if (!chain?.length) return null;
  const caps = ((capabilities ?? []) as WorkspaceCapability[]).slice();
  const canShare = caps.includes("share");

  const [nodes, grantsRead] = await Promise.all([
    nodeNames(db, chain, locale),
    db
      .from("access_grant")
      .select("id, object_id, principal_kind, user_id, team_id, org_role, role_id, reach, source")
      .in("object_id", chain),
  ]);
  if (grantsRead.error) throw new Error(`Could not read who has access: ${grantsRead.error.message}`);
  const grants = (grantsRead.data ?? []) as GrantRow[];

  const userIds = [...new Set(grants.map((g) => g.user_id).filter((id): id is string => Boolean(id)))];
  const teamIds = [...new Set(grants.map((g) => g.team_id).filter((id): id is string => Boolean(id)))];
  const roleIds = [...new Set(grants.map((g) => g.role_id))];
  const [people, teams, roles, members, allTeams, sharingRoles] = await Promise.all([
    userIds.length ? db.from("user_profile").select("id, full_name").in("id", userIds) : { data: [] },
    teamIds.length ? db.from("team").select("id, name").in("id", teamIds) : { data: [] },
    db.from("access_role").select("id, name_en, name_fr").in("id", roleIds),
    canShare
      ? db.from("organization_membership").select("user_id, user_profile:user_id(full_name)").eq("status", "active")
      : { data: [] },
    canShare ? db.from("team").select("id, name").order("name") : { data: [] },
    canShare ? listSharingRoles(false) : Promise.resolve([]),
  ]);

  const personName = new Map(((people.data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));
  const teamName = new Map(((teams.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const roleName = new Map(
    ((roles.data ?? []) as { id: string; name_en: string; name_fr: string }[]).map((r) => [
      r.id,
      locale === "fr-CA" ? r.name_fr : r.name_en,
    ]),
  );
  const orgRoleLabel = (role: string) =>
    (ORG_ROLES as readonly string[]).includes(role) ? t(`orgRoles.${role as (typeof ORG_ROLES)[number]}`) : role;

  const target = nodes.get(objectId) ?? { id: objectId, kind: "object" as const, name: null };
  const entries = buildShareEntries({
    ancestors: chain,
    nodes,
    grants,
    canShare,
    principalLabel: (g) =>
      g.principal_kind === "person"
        ? (personName.get(g.user_id ?? "") ?? "—")
        : g.principal_kind === "team"
          ? (teamName.get(g.team_id ?? "") ?? "—")
          : orgRoleLabel(g.org_role ?? ""),
    roleLabel: (id) => roleName.get(id) ?? "—",
  });

  return {
    target,
    capabilities: caps,
    canShare,
    shareable: isShareableNode(target.kind),
    entries,
    options: {
      people: ((members.data ?? []) as unknown as { user_id: string; user_profile: { full_name: string } | null }[])
        .map((m) => ({ id: m.user_id, label: m.user_profile?.full_name || "—" }))
        .sort((a, b) => a.label.localeCompare(b.label, locale)),
      teams: ((allTeams.data ?? []) as { id: string; name: string }[]).map((team) => ({ id: team.id, label: team.name })),
      orgRoles: canShare ? ORG_ROLES.map((role) => ({ id: role, label: orgRoleLabel(role) })) : [],
      roles: sharingRoles
        .filter((role) => role.capabilities.every((capability) => caps.includes(capability)))
        .map((role) => ({ id: role.id, label: locale === "fr-CA" ? role.name.fr : role.name.en })),
    },
  };
}
