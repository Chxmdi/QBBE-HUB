import type { Metadata } from "next";
import { DocumentListPage } from "@/features/payables/components/document-pages";

export const metadata: Metadata = { title: "Bills" };
export const dynamic = "force-dynamic";

export default function BillsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <DocumentListPage kind="bill" searchParams={searchParams} />;
}
