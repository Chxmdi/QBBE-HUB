import type { Metadata } from "next";
import Link from "next/link";
import { UserCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LedgerTabs } from "@/features/ledger/components/ledger-tabs";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { GrantAccountantForm, RevokeAccountantButton } from "@/features/ledger/components/year-end-forms";
import { getLedgerAccess, todayIn } from "@/features/ledger/services/ledger.access";

export const metadata: Metadata = { title: "Accountant access" };
export const dynamic = "force-dynamic";

interface Grant {
  id: string;
  user_id: string;
  starts_at: string;
  expires_at: string;
  revoked_at: string | null;
  note: string | null;
  person: { full_name: string; email: string } | null;
  granter: { full_name: string } | null;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Admins give the external accountant (#154) read-only, time-limited access to
 * the books. The accountant is invited as a Guest first, so the rest of the
 * workspace stays closed to them; access needs MFA and can be revoked at once.
 */
export default async function AccountantAccessPage() {
  const { session, supabase, canManage } = await getLedgerAccess();
  const header = (
    <PageHeader
      eyebrow="Ledger"
      title="Accountant access"
      description="Read-only access to the books for your external accountant, for a limited time."
    />
  );
  if (!canManage) {
    return (
      <div>
        {header}
        <NoLedgerAccess isAdmin={session.isAdmin} />
      </div>
    );
  }

  const [{ data: grantData }, { data: guestData }, { data: sessionData }] = await Promise.all([
    supabase
      .from("ledger_accountant_grant")
      .select(
        "id, user_id, starts_at, expires_at, revoked_at, note, person:user_id(full_name, email), granter:granted_by(full_name)",
      )
      .eq("organization_id", session.organizationId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("organization_membership")
      .select("user_id, user_profile:user_id(full_name, email)")
      .eq("organization_id", session.organizationId)
      .eq("role", "guest")
      .eq("status", "active"),
    supabase
      .from("ledger_accountant_session")
      .select("first_seen_at, user_id, person:user_id(full_name)")
      .eq("organization_id", session.organizationId)
      .order("first_seen_at", { ascending: false })
      .limit(20),
  ]);
  const grants = (grantData ?? []) as unknown as Grant[];
  const guests = ((guestData ?? []) as unknown as {
    user_id: string;
    user_profile: { full_name: string; email: string } | null;
  }[]).map((g) => ({
    id: g.user_id,
    name: g.user_profile ? `${g.user_profile.full_name} (${g.user_profile.email})` : g.user_id,
  }));
  const sessions = (sessionData ?? []) as unknown as {
    first_seen_at: string;
    user_id: string;
    person: { full_name: string } | null;
  }[];
  const now = new Date().toISOString();
  const today = todayIn(session.timeZone);

  return (
    <div>
      {header}
      <LedgerTabs />
      <section className="card mb-6 p-4 text-[13.5px]" aria-labelledby="how-heading">
        <h2 id="how-heading" className="mb-2 text-base font-semibold">
          How it works
        </h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            <Link className="text-brand-fg hover:underline" href="/admin">
              Invite the accountant
            </Link>{" "}
            with the role <strong>Guest</strong>. A Guest sees no relationships, finance or people records.
          </li>
          <li>Once they have signed up, grant access below and choose the last day.</li>
          <li>
            The accountant sets up an authenticator app the first time they open the books. Without it they see
            nothing.
          </li>
          <li>
            They can read the ledger, reports, statements, receipts and the files that passed the virus scan, and
            export them. They cannot change anything. Every sign-in and export is recorded.
          </li>
        </ol>
      </section>

      <div className="card mb-6 p-4">
        {guests.length === 0 ? (
          <p className="text-[13.5px] text-muted">
            No active Guest to give access to. Invite the accountant as a Guest first.
          </p>
        ) : (
          <GrantAccountantForm
            guests={guests}
            defaultExpiry={addDays(today, 90)}
            minDate={today}
            maxDate={addDays(today, 366)}
          />
        )}
      </div>

      {grants.length === 0 ? (
        <EmptyState icon={<UserCheck />} title="No accountant access yet" description="Grants appear here with their dates." />
      ) : (
        <DataTable minWidth="720px">
          <TableHead>
            <TableHeader>Accountant</TableHeader>
            <TableHeader>Access</TableHeader>
            <TableHeader>Status</TableHeader>
            <TableHeader>Granted by</TableHeader>
            <TableHeader className="text-right">
              <span className="sr-only">Actions</span>
            </TableHeader>
          </TableHead>
          <tbody>
            {grants.map((g) => {
              const live = !g.revoked_at && g.expires_at > now;
              const name = g.person?.full_name ?? "Former member";
              return (
                <TableRow key={g.id}>
                  <TableCell>
                    {name}
                    {g.person ? <span className="meta block">{g.person.email}</span> : null}
                    {g.note ? <span className="meta block">{g.note}</span> : null}
                  </TableCell>
                  <TableCell className="text-[13px] tabular-nums">
                    {g.starts_at.slice(0, 10)} to {g.expires_at.slice(0, 10)}
                  </TableCell>
                  <TableCell>
                    {g.revoked_at ? (
                      <Badge>Revoked {g.revoked_at.slice(0, 10)}</Badge>
                    ) : live ? (
                      <Badge tone="success">Active</Badge>
                    ) : (
                      <Badge>Expired</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-[13px]">{g.granter?.full_name ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {live ? <RevokeAccountantButton grantId={g.id} name={name} /> : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </tbody>
        </DataTable>
      )}
      <p className="meta mt-2">Access ends at the end of the chosen day, in the organization&apos;s time zone.</p>

      <h2 className="mt-8 mb-2 text-base font-semibold">Recent accountant sign-ins</h2>
      {sessions.length === 0 ? (
        <p className="text-[13.5px] text-muted">No accountant has opened the books yet.</p>
      ) : (
        <ul className="card divide-y divide-line text-[13.5px]">
          {sessions.map((s) => (
            <li key={`${s.user_id}-${s.first_seen_at}`} className="flex justify-between gap-3 px-4 py-2">
              <span>{s.person?.full_name ?? "Former member"}</span>
              <span className="tabular-nums text-muted">{s.first_seen_at.slice(0, 16).replace("T", " ")} UTC</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
