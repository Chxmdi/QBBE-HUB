import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { DocumentListPage } from "@/features/payables/components/document-pages";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.payables.meta.invoices") };
}
export const dynamic = "force-dynamic";

export default function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <DocumentListPage kind="invoice" searchParams={searchParams} />;
}
