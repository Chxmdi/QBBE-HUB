import type { Metadata } from "next";
import { NewDocumentPage } from "@/features/payables/components/document-pages";

export const metadata: Metadata = { title: "New bill" };
export const dynamic = "force-dynamic";

export default function NewBillPage() {
  return <NewDocumentPage kind="bill" />;
}
