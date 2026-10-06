import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { AccountInactivePage } from "./account-inactive-page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("account.inactive.title") };
}

export default function Page() {
  return <AccountInactivePage />;
}
