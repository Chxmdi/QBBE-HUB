import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { NewDocumentPage } from "@/features/payables/components/document-pages";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.payables.meta.newBill") };
}
export const dynamic = "force-dynamic";

export default function NewBillPage() {
  return <NewDocumentPage kind="bill" />;
}
