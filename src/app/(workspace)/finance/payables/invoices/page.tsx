import type { Metadata } from "next";
import { DocumentListPage } from "@/features/payables/components/document-pages";

export const metadata: Metadata = { title: "Invoices" };
export const dynamic = "force-dynamic";

export default function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <DocumentListPage kind="invoice" searchParams={searchParams} />;
}
