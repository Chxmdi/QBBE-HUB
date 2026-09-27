import Link from "next/link";
import { Landmark } from "lucide-react";
import type { SessionContext } from "@/lib/auth";
import { hasAccountantGrant } from "@/features/ledger/services/ledger.access";
import { createSupabasePageClient } from "@/lib/supabase/page";

/**
 * The external accountant's way into the books from Home (#154). The sidebar
 * shows the Ledger only to staff, and the accountant is a Guest; this renders
 * nothing for anyone without a current accountant grant.
 */
export async function AccountantHomeCard({ session }: { session: SessionContext }) {
  if (session.isStaff) return null;
  if (!(await hasAccountantGrant(await createSupabasePageClient(), session))) return null;
  return (
    <Link
      href="/finance/ledger"
      className="card mb-6 flex items-center gap-3 p-4 text-[14px] font-medium text-brand-fg hover:bg-surface-soft"
    >
      <Landmark className="size-5 shrink-0" aria-hidden />
      Open the books (read-only accountant access)
    </Link>
  );
}
