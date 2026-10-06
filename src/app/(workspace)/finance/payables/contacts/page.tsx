import type { Metadata } from "next";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ContactDialog } from "@/features/payables/components/contact-dialog";
import { PayablesTabs } from "@/features/payables/components/payables-tabs";
import { getPayablesAccess, loadContacts } from "@/features/payables/services/payables.queries";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.payables.meta.contacts") };
}
export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const { session, supabase } = await getPayablesAccess();
  const t = await getT();
  const contacts = await loadContacts(supabase, session.organizationId);
  return (
    <div>
      <PageHeader
        eyebrow={t("finance.common.title")}
        title={t("finance.payables.heading")}
        description={t("finance.payables.contacts.description")}
        actions={<ContactDialog />}
      />
      <PayablesTabs />
      {contacts.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={t("finance.payables.contacts.emptyTitle")}
          description={t("finance.payables.contacts.emptyDescription")}
        />
      ) : (
        <DataTable minWidth="720px">
          <TableHead>
            <TableHeader>{t("finance.payables.contacts.name")}</TableHeader>
            <TableHeader className="w-44">{t("finance.payables.contacts.role")}</TableHeader>
            <TableHeader>{t("finance.payables.contacts.email")}</TableHeader>
            <TableHeader className="w-24">{t("finance.payables.contacts.language")}</TableHeader>
            <TableHeader className="w-24">{t("finance.payables.contacts.status")}</TableHeader>
            <TableHeader className="w-16">
              <span className="sr-only">{t("finance.payables.contacts.edit")}</span>
            </TableHeader>
          </TableHead>
          <tbody>
            {contacts.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>
                  {[
                    c.is_vendor ? t("finance.payables.contacts.vendor") : null,
                    c.is_customer ? t("finance.payables.contacts.customer") : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </TableCell>
                <TableCell>{c.email ?? "—"}</TableCell>
                <TableCell>
                  {c.language === "fr" ? t("finance.payables.languages.fr") : t("finance.payables.languages.en")}
                </TableCell>
                <TableCell>
                  {c.is_active ? (
                    <Badge tone="success">{t("finance.payables.contacts.active")}</Badge>
                  ) : (
                    <Badge>{t("finance.payables.contacts.inactive")}</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <ContactDialog contact={c} />
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
