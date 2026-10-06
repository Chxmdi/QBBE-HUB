import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { NewDocumentPage } from "@/features/payables/components/document-pages";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.payables.meta.newInvoice") };
}
export const dynamic = "force-dynamic";

export default function NewInvoicePage() {
  return <NewDocumentPage kind="invoice" />;
}
