import type { Metadata } from "next";
import { DocumentDetailPage } from "@/features/payables/components/document-pages";

export const metadata: Metadata = { title: "Invoice" };
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
