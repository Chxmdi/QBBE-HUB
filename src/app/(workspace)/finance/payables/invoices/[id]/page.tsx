import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { DocumentDetailPage } from "@/features/payables/components/document-pages";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.payables.meta.invoice") };
}
export const dynamic = "force-dynamic";

export default function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  return <DocumentDetailPage kind="invoice" params={params} searchParams={searchParams} />;
}
