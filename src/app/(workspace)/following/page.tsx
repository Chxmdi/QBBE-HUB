import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import {
  FollowButton,
  FollowQueryForm,
  FollowRulesForm,
  UnfollowButton,
} from "@/features/following/components/following-controls";
import { requireFollowing } from "@/features/following/gate";
import { fill, followingText } from "@/features/following/messages";
import {
  DEFAULT_RULES,
  EVENT_KINDS,
  choiceOf,
  effectiveRule,
  type EventKind,
  type FollowRule,
  type PresetQueryKey,
  type RuleChoice,
} from "@/features/following/rules";
import { requireSession } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { createSupabasePageClient } from "@/lib/supabase/page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: followingText(await getLocale()).title };
}
export const dynamic = "force-dynamic";

interface FollowRow {
  id: string;
  object_id: string | null;
  object_type: "task" | "project" | null;
  label: string | null;
}

export default async function FollowingPage({
  searchParams,
}: {
  searchParams: Promise<{ follow?: string; type?: string }>;
}) {
  await requireFollowing();
  const session = await requireSession();
  const text = followingText(await getLocale());
  const supabase = await createSupabasePageClient();
  const [{ data: follows }, { data: rules }] = await Promise.all([
    supabase.from("follow_v2").select("id, object_id, object_type, label").eq("user_id", session.userId).order("created_at"),
    supabase.from("follow_rule_v2").select("event_kind, in_app, email").eq("user_id", session.userId),
  ]);
  const rows = (follows ?? []) as FollowRow[];
  const taskIds = rows.filter((r) => r.object_type === "task").map((r) => r.object_id!);
  const projectIds = rows.filter((r) => r.object_type === "project").map((r) => r.object_id!);

  // ?follow=<id>&type=task|project offers a follow button for one object.
  const params = await searchParams;
  const offerType = params.type === "project" ? "project" : params.type === "task" ? "task" : null;
  const offerId = offerType && /^[0-9a-f-]{36}$/i.test(params.follow ?? "") ? params.follow! : null;
  if (offerId && offerType === "task") taskIds.push(offerId);
  if (offerId && offerType === "project") projectIds.push(offerId);

  const [{ data: tasks }, { data: projects }] = await Promise.all([
    taskIds.length ? supabase.from("task").select("id, title").in("id", taskIds) : Promise.resolve({ data: [] }),
    projectIds.length ? supabase.from("project").select("id, name").in("id", projectIds) : Promise.resolve({ data: [] }),
  ]);
  const names = new Map<string, string>([
    ...((tasks ?? []) as { id: string; title: string }[]).map((t) => [t.id, t.title] as [string, string]),
    ...((projects ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name] as [string, string]),
  ]);
  const nameOf = (row: FollowRow) =>
    row.object_id ? names.get(row.object_id) ?? "" : text.presets[row.label as PresetQueryKey] ?? row.label ?? "";
  const offerName = offerId ? names.get(offerId) : undefined;
  const alreadyFollowed = offerId ? rows.some((r) => r.object_id === offerId) : false;
  const initial = Object.fromEntries(
    EVENT_KINDS.map((kind) => [kind, choiceOf(effectiveRule((rules ?? []) as FollowRule[], kind) ?? DEFAULT_RULES[kind])]),
  ) as Record<EventKind, RuleChoice>;

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={text.eyebrow} title={text.title} description={text.description} />

      {offerId && offerName && offerType && !alreadyFollowed ? (
        <section aria-labelledby="follow-offer" className="card space-y-2 p-4">
          <h2 id="follow-offer" className="text-[15px] font-semibold">
            {fill(text.followThis, { name: offerName })}
          </h2>
          <p className="meta">{text.followHelp}</p>
          <FollowButton objectId={offerId} objectType={offerType} name={offerName} text={text} />
        </section>
      ) : null}

      <section aria-labelledby="follow-list" className="space-y-3">
        <h2 id="follow-list" className="text-[15px] font-semibold">
          {text.followingHeading}
        </h2>
        {rows.length === 0 ? (
          <p className="meta">{text.nothingFollowed}</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.id} className="card flex flex-wrap items-center justify-between gap-3 p-3">
                <div>
                  <span className="meta mr-2">{row.object_type ? text.kinds[row.object_type] : text.kinds.query}</span>
                  <span className="font-medium">{nameOf(row)}</span>
                </div>
                <UnfollowButton followId={row.id} name={nameOf(row)} text={text} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="follow-queries" className="space-y-3">
        <h2 id="follow-queries" className="text-[15px] font-semibold">
          {text.queriesHeading}
        </h2>
        <p className="meta">{text.queriesHelp}</p>
        <FollowQueryForm text={text} followed={rows.map((r) => r.label ?? "")} />
      </section>

      <section aria-labelledby="follow-rules" className="card space-y-3 p-5">
        <h2 id="follow-rules" className="text-[15px] font-semibold">
          {text.rulesHeading}
        </h2>
        <p className="meta">{text.rulesHelp}</p>
        <FollowRulesForm text={text} initial={initial} />
      </section>
    </div>
  );
}
