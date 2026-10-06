import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { DocumentDetailPage } from "@/features/payables/components/document-pages";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.payables.meta.bill") };
}
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
