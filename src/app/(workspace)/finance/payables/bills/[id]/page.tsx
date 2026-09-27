import type { Metadata } from "next";
import { DocumentDetailPage } from "@/features/payables/components/document-pages";

export const metadata: Metadata = { title: "Bill" };
export const dynamic = "force-dynamic";

export default function BillPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  return <DocumentDetailPage kind="bill" params={params} searchParams={searchParams} />;
}
