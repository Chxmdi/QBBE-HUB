import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getFormatters, getLocale } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/translate";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { CreateTokenForm, RevokeButton } from "@/features/api-tokens/components/token-controls";
import { apiTokenMessages, type ApiTokensMessages } from "@/features/api-tokens/i18n";

export async function generateMetadata(): Promise<Metadata> {
  return { title: apiTokenMessages(await getLocale()).title };
}
export const dynamic = "force-dynamic";

interface TokenRow {
  id: string;
  user_id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  user_profile: { full_name: string | null; email: string } | null;
}

function status(row: TokenRow, m: ApiTokensMessages): { label: string; tone: "success" | "neutral" | "danger" } {
  if (row.revoked_at) return { label: m.list.revoked, tone: "danger" };
  if (new Date(row.expires_at).getTime() <= Date.now()) return { label: m.list.expired, tone: "neutral" };
  return { label: m.list.active, tone: "success" };
}

/** API access tokens (V2-8), behind wos_workflows_v2. RLS decides which tokens show. */
export default async function ApiTokensPage() {
  if (!(await isEnabled("wos_workflows_v2"))) notFound();
  const session = await requireSession();
  const m = apiTokenMessages(await getLocale());
  const f = await getFormatters();
  const db = await createSupabasePageClient();
  const { data: tokens } = await db
    .from("api_token")
    .select("id, user_id, name, token_prefix, scopes, expires_at, last_used_at, revoked_at, user_profile!api_token_user_id_fkey(full_name, email)")
    .eq("organization_id", session.organizationId)
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (tokens ?? []) as unknown as TokenRow[];
  const { data: calls } = await db
    .from("api_request_log")
    .select("id, method, path, status, created_at")
    .eq("organization_id", session.organizationId)
    .order("created_at", { ascending: false })
    .limit(20);
  const log = (calls ?? []) as { id: string; method: string; path: string; status: number; created_at: string }[];
  const showOwner = rows.some((row) => row.user_id !== session.userId);

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={m.eyebrow} title={m.title} description={m.description}
        actions={<Link href="/api-tokens/docs" className="text-sm text-brand-fg underline-offset-2 hover:underline">{m.docsLink}</Link>} />
      <CreateTokenForm m={m} />

      <section className="rounded-(--radius-md) border border-line bg-surface p-4 sm:p-5" aria-labelledby="token-list">
        <h2 id="token-list" className="section-heading mb-3">{showOwner ? m.list.all : m.list.mine}</h2>
        {rows.length === 0 ? <p className="text-sm text-muted">{m.list.empty}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{showOwner ? m.list.all : m.list.mine}</caption>
              <thead className="text-[12.5px] text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">{m.list.name}</th>
                  {showOwner ? <th scope="col" className="py-2 pr-3 font-medium">{m.list.owner}</th> : null}
                  <th scope="col" className="py-2 pr-3 font-medium">{m.list.prefix}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{m.list.scopes}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{m.list.expires}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{m.list.lastUsed}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{m.list.status}</th>
                  <th scope="col" className="py-2 pr-3 font-medium"><span className="sr-only">{m.list.revokeLabel}</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const state = status(row, m);
                  return (
                    <tr key={row.id} className="border-t border-line">
                      <td className="py-2 pr-3 font-medium text-ink">{row.name}</td>
                      {showOwner ? <td className="py-2 pr-3">{row.user_profile?.full_name || row.user_profile?.email}</td> : null}
                      <td className="py-2 pr-3 font-mono text-[12.5px]">{row.token_prefix}…</td>
                      <td className="py-2 pr-3 text-[12.5px]">{row.scopes.join(", ")}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{f.date(row.expires_at, session.timeZone)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{row.last_used_at ? f.dateTime(row.last_used_at, session.timeZone) : m.list.never}</td>
                      <td className="py-2 pr-3"><Badge tone={state.tone}>{state.label}</Badge></td>
                      <td className="py-2 pr-3">
                        {state.label === m.list.active
                          ? <RevokeButton id={row.id} m={m} label={interpolate(m.list.revoke, { name: row.name })} />
                          : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-(--radius-md) border border-line bg-surface p-4 sm:p-5" aria-labelledby="token-log">
        <h2 id="token-log" className="section-heading mb-3">{m.log.heading}</h2>
        {log.length === 0 ? <p className="text-sm text-muted">{m.log.empty}</p> : (
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{m.log.heading}</caption>
            <thead className="text-[12.5px] text-muted">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">{m.log.when}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{m.log.call}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{m.log.status}</th>
              </tr>
            </thead>
            <tbody>
              {log.map((call) => (
                <tr key={call.id} className="border-t border-line">
                  <td className="py-2 pr-3 whitespace-nowrap">{f.dateTime(call.created_at, session.timeZone)}</td>
                  <td className="py-2 pr-3 font-mono text-[12.5px]">{call.method} {call.path}</td>
                  <td className="py-2 pr-3">{call.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
