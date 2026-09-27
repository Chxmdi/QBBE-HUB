import type { Metadata } from "next";
import { NewDocumentPage } from "@/features/payables/components/document-pages";

export const metadata: Metadata = { title: "New invoice" };
export const dynamic = "force-dynamic";

export default function NewInvoicePage() {
  return <NewDocumentPage kind="invoice" />;
}
