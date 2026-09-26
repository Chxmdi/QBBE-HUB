import type { Metadata } from "next";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ContactDialog } from "@/features/payables/components/contact-dialog";
import { PayablesTabs } from "@/features/payables/components/payables-tabs";
import { getPayablesAccess, loadContacts } from "@/features/payables/services/payables.queries";

export const metadata: Metadata = { title: "Vendors and customers" };
export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const { session, supabase } = await getPayablesAccess();
  const contacts = await loadContacts(supabase, session.organizationId);
  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title="Bills and invoices"
        description="Vendors who bill QBBE, and the partners, funders and members QBBE invoices. A contact can be both."
        actions={<ContactDialog />}
      />
      <PayablesTabs />
      {contacts.length === 0 ? (
        <EmptyState icon={<Users />} title="No vendors or customers yet" description="Add the first one to enter a bill or an invoice." />
      ) : (
        <DataTable minWidth="720px">
          <TableHead>
            <TableHeader>Name</TableHeader>
            <TableHeader className="w-44">Role</TableHeader>
            <TableHeader>Email</TableHeader>
            <TableHeader className="w-24">Language</TableHeader>
            <TableHeader className="w-24">Status</TableHeader>
            <TableHeader className="w-16">
              <span className="sr-only">Edit</span>
            </TableHeader>
          </TableHead>
          <tbody>
            {contacts.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>
                  {[c.is_vendor ? "Vendor" : null, c.is_customer ? "Customer" : null].filter(Boolean).join(", ")}
                </TableCell>
                <TableCell>{c.email ?? "—"}</TableCell>
                <TableCell>{c.language === "fr" ? "French" : "English"}</TableCell>
                <TableCell>{c.is_active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</TableCell>
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
